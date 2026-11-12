import { Candle } from './candle';
import { PatternDetector, type PatternContext } from './pattern_engine';
import { ZoneVoter, timeframeKey } from './zone_voter';
import { isDojiPatternName, isReversalPatternName, requiresNextCandleConfirmation } from './pattern_ids';
import { resolveSignalLifecycle } from './signal_lifecycle';
import { scanPatternCandidates } from './pattern_scanner';

export type PatternStatus = 'pending' | 'confirmed' | 'cancelled';

export interface PatternResult {
  name: string;
  type: 'бычий' | 'медвежий' | 'нейтральный';
  candleIndex: number;
  confidence: number;
  confirmed: boolean;
  /**
   * Отдельный фильтр стрелки на графике: после завершённой разворотной модели
   * последующая закрытая свеча должна выйти за её границу. Не меняет книжный
   * статус confirmed самой формации и не участвует в торговом бэктесте.
   */
  priceConfirmed: boolean;
  /** Направление стрелки; у дожи определяется контекстом, не меняя их тип. */
  priceDirection?: 'bullish' | 'bearish';
  status?: PatternStatus;
  hasVolume: boolean;
  atLevel: boolean;
  confirmedTime: number | null;
  /** Абсолютный индекс закрытого бара, подтвердившего модель. */
  confirmationIndex: number | null;
}

/**
 * ИСПРАВЛЕНО: единый словарь длительностей баров. '1M'/'1m' — минута,
 * '1MO'/'MO'/'M' — месяц. Рассинхрон с zone_voter.timeframeKey устранён.
 */
function tfDurationMs(tf: string): number | undefined {
  const t = String(tf).trim();
  if (/^\d+$/.test(t)) return Number(t) * 60_000;
  switch (t.toUpperCase()) {
    case '1M': case '1MIN': return 60_000;
    case '5M': return 5 * 60_000;
    case '15M': return 15 * 60_000;
    case '30M': return 30 * 60_000;
    case '1H': case '60M': return 60 * 60_000;
    case '2H': case '120M': return 2 * 60 * 60_000;
    case '4H': case '240M': return 4 * 60 * 60_000;
    case 'D': case '1D': return 24 * 60 * 60_000;
    case 'W': case '1W': return 7 * 24 * 60 * 60_000;
    case 'MO': case '1MO': case 'M': return 30 * 24 * 60 * 60_000;
    default: return undefined;
  }
}

function barCloseTime(bar: Candle, tfMs: number | undefined): number {
  return tfMs ? bar.time + tfMs : bar.time;
}

export const PATTERN_DISPLAY_WINDOW = 80;

export function sortPatternsForDisplay<T extends { candleIndex: number; confirmed: boolean; confidence: number }>(
  patterns: T[],
  totalCandles: number,
): T[] {
  return [...patterns]
    .filter(p => p.candleIndex >= totalCandles - PATTERN_DISPLAY_WINDOW)
    .sort((a, b) =>
      b.candleIndex - a.candleIndex ||
      Number(b.confirmed) - Number(a.confirmed) ||
      b.confidence - a.confidence);
}

export function detectPatterns(
  candles: Candle[],
  timeframe: string = 'D',
  context: PatternContext = {},
): PatternResult[] {
  const patterns: PatternResult[] = [];
  const tfMs = tfDurationMs(timeframe);
  const candidates = scanPatternCandidates(candles, {
    context: { ...context, timeframe },
  });

  for (const candidate of candidates) {
    const i = candidate.patternEndIdx;
    const candle = candles[i];
    const prior = candles.slice(0, candidate.patternStartIdx);
    const zonePrev = prior.length > 130 ? prior.slice(-120) : prior;
    const type = candidate.direction === 'long'
      ? 'бычий'
      : candidate.direction === 'short' ? 'медвежий' : 'нейтральный';

    let status: PatternStatus = 'pending';
    let confirmationIndex: number | null = null;
    if (type === 'нейтральный') {
      // Доджи и предупреждения — наблюдения, а не направленные сделки.
      status = 'confirmed';
      confirmationIndex = i;
    } else if (!requiresNextCandleConfirmation(candidate.name)) {
      status = 'confirmed';
      confirmationIndex = i;
    } else {
      const direction = candidate.direction === 'short' ? 'short' : 'long';
      const lifecycle = resolveSignalLifecycle(
        candles,
        i,
        direction,
        candle.close,
        candidate,
        candles.length,
        3,
        candidate.name,
      );
      if (lifecycle.status === 'confirmed') {
        status = 'confirmed';
        confirmationIndex = lifecycle.confirmationIndex;
      } else if (lifecycle.status === 'invalidated' || lifecycle.status === 'expired') {
        status = 'cancelled';
      }
    }

    const confirmed = status === 'confirmed';
    let priceConfirmed = false;
    let priceDirection: 'bullish' | 'bearish' | undefined;
    const reactionDirection = type === 'нейтральный'
      ? isDojiPatternName(candidate.name)
        ? PatternDetector.getDojiContextDirection(prior)
        : null
      : candidate.direction === 'short' ? 'short' : 'long';

    if (confirmed && reactionDirection !== null) {
      // Для моделей, которые по книге завершаются собственным последним баром,
      // confirmed означает именно завершение формации. Стрелка на графике — более
      // строгое отображение: ждём реакцию следующей закрытой свечи. Для дожи
      // на вершине это консервативное проектное подтверждение медвежьей реакции;
      // одиночный дожи в основании направленной стрелки не получает (см. гл. 8).
      // Этот фильтр не меняет книжную модель и не создаёт торговый сигнал.
      const needsPriceReaction = type === 'нейтральный' || (
        isReversalPatternName(candidate.name)
        && !requiresNextCandleConfirmation(candidate.name)
      );
      if (needsPriceReaction) {
        const reaction = resolveSignalLifecycle(
          candles,
          i,
          reactionDirection,
          candle.close,
          candidate,
          candles.length,
          3,
          candidate.name,
        );
        priceConfirmed = reaction.status === 'confirmed';
      } else {
        priceConfirmed = true;
      }
      if (priceConfirmed) {
        priceDirection = reactionDirection === 'long' ? 'bullish' : 'bearish';
      }
    }

    const confirmBar = confirmationIndex === null ? null : candles[confirmationIndex];
    const confirmedTime = confirmBar ? barCloseTime(confirmBar, tfMs) : null;
    const volumePeriod = Math.min(20, prior.length);
    const hasVolume = volumePeriod > 0 && candle.volume >
      (prior.slice(-volumePeriod).reduce((sum, c) => sum + c.volume, 0) / volumePeriod) * 1.3;

    // Эвристический балл ранжирования, а не вероятность прибыли.
    let confidence = 50;
    if (candidate.formationSize >= 3) confidence = 65;
    else if (candidate.formationSize === 2 && candidate.name.includes('ПОГЛОЩЕНИЕ')) confidence = 62;
    else if (candidate.name.includes('ЗВЕЗДА')) confidence = 63;

    const zoneMarket = context.market === 'stocks' ? 'stock' : 'crypto';
    const atLevel = type === 'бычий'
      ? ZoneVoter.isNearSupport(candle.close, zonePrev, 0.015, timeframeKey(timeframe), candle.low, zoneMarket)
      : type === 'медвежий'
        ? ZoneVoter.isNearResistance(candle.close, zonePrev, 0.015, timeframeKey(timeframe), candle.high, zoneMarket)
        : false;

    if (confirmed) confidence += 15;
    if (hasVolume) confidence += 8;
    if (atLevel) confidence += 7;
    if (candidate.name.includes('ОБЪЁМ')) confidence += 5;
    if (candidate.name.includes('ПОДДЕРЖКИ') || candidate.name.includes('СОПРОТИВЛЕНИЯ')) confidence += 5;
    if (type === 'нейтральный') confidence = Math.min(confidence, 45);
    confidence = Math.min(92, confidence);

    patterns.push({
      name: candidate.name,
      type,
      candleIndex: i,
      confidence,
      confirmed,
      priceConfirmed,
      priceDirection,
      status,
      hasVolume,
      atLevel,
      confirmedTime,
      confirmationIndex,
    });
  }

  const filtered = patterns.filter(p =>
    (p.confidence >= 55 || (p.priceConfirmed && p.priceDirection !== undefined))
    && p.status !== 'cancelled');
  return sortPatternsForDisplay(filtered, candles.length).slice(0, 24);
}

export function patternStory(pattern: string): string {
  const p = pattern.toUpperCase();

  if (p.includes('ДЛИННАЯ') && p.includes('ОТКАТЕ')) {
    return 'Длинная свеча на откате в тренде: после локального отката покупатели (продавцы) вернули инициативу одним сильным движением; вход по направлению тренда (гл. 4 ЯС).';
  }
  if (p.includes('ТЕСТ ПОДДЕРЖКИ') || p.includes('ТЕСТ СОПРОТИВЛЕНИЯ')) {
    return 'Тест уровня в тренде: свеча коснулась MA/зоны тенью и закрылась в пользу тренда — уровень защищён (гл. 11, 13 ЯС).';
  }
  if (p.includes('КЛЮЧЕВОЙ РАЗВОРОТ')) {
    return 'Ключевой разворотный день: новый экстремум с закрытием за предыдущей ценой закрытия — базовый сигнал разворота (глоссарий ЯС).';
  }
  if (p.includes('ВЕРХНЕЕ СПРУЖИНИВАНИЕ')) {
    return 'Верхнее спружинивание: ложный пробой вершины с возвратом внутрь диапазона — медвежий сигнал из зоны «ва» (гл. 11 ЯС).';
  }
  if (p.includes('СПРУЖИНИВАНИЕ')) {
    return 'Нижнее спружинивание: ложный пробой дна с возвратом внутрь диапазона — бычий сигнал из зоны «ва» (гл. 11 ЯС).';
  }
  if (p.includes('ПРОРЫВ КОНСОЛИДАЦИИ')) {
    return 'Зона «ва» прорвана длинной свечой на повышенном объёме — сигнал продолжения в направлении прорыва (гл. 7 ЯС).';
  }
  if (p.includes('ПЕРЕВЁРНУТЫЙ МОЛОТ')) {
    return 'Малое тело внизу и длинная верхняя тень после снижения: ждём бычьего подтверждения следующей свечой (гл. 5 ЯС).';
  }
  if (p.includes('НЕСОВЕРШЕННЫЙ')) {
    return 'Несовершенный молот: тень короче идеала, но есть опора и контекст дна (гл. 4, рис. 4.8–4.9 ЯС).';
  }
  if (p.includes('МОЛОТ')) {
    return 'Длинная нижняя тень и малое тело у верха диапазона: продавцов выкупили к закрытию — попытка нащупать дно (гл. 4 ЯС).';
  }
  if (p.includes('ПОВЕШЕННЫЙ')) {
    return 'Та же форма, что у молота, но на вершине роста: рынок уязвим к атакам продавцов, нужно подтверждение (гл. 4 ЯС).';
  }
  if (p.includes('ПАДАЮЩАЯ ЗВЕЗДА')) {
    return 'Попытка штурма высот не удалась: цена вернулась к открытию после взлёта — быки истощены (гл. 5 ЯС).';
  }
  if (p.includes('ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ')) {
    return 'Последнее поглощение: крупная свеча поглощает малое тело во время тренда; подтверждение — закрытие за уровнем поглощающей свечи (ЗГ гл. 3).';
  }
  if (p.includes('ПОГЛОЩЕНИЕ')) {
    return 'Второе тело полностью перекрыло первое: инициатива перешла к новой стороне (гл. 4 ЯС).';
  }
  if (p.includes('ЗАВЕСА')) {
    return 'Открытие выше закрытия и закрытие ниже середины белого тела: быки потеряли контроль (гл. 4 ЯС).';
  }
  if (p.includes('ПРОСВЕТ')) {
    return 'Белая свеча перекрыла больше половины чёрной: давление продавцов ослабло (гл. 4 ЯС).';
  }
  if (p.includes('ДОДЖИ-ЗВЕЗДА')) {
    return 'Звезда дожи: малое тело-дожи после длинной свечи — сильная нерешительность; требует подтверждения (гл. 5, 8 ЯС).';
  }
  if (p.includes('ЗВЕЗДА')) {
    return 'Малое тело после длинной свечи — равновесие сил; третья свеча подтверждает разворот (гл. 5 ЯС).';
  }
  if (p.includes('ХАРАМИ-КРЕСТ')) {
    return 'Крест харами: дожи внутри длинной свечи — оцепенение рынка; сильный сигнал разворота (гл. 6 ЯС).';
  }
  if (p.includes('ХАРАМИ')) {
    return 'Пауза тренда: малое тело внутри длинного — перемирие быков и медведей (гл. 6 ЯС).';
  }
  if (p.includes('РИКША')) {
    return 'Рикша: длинноногая дожи с телом в середине диапазона — рынок потерял направление (гл. 8 ЯС).';
  }
  if (p.includes('ДЛИННОНОГАЯ ДОДЖИ')) {
    return 'Длинноногая дожи: длинные обе тени, нерешительность; на вершине особенно опасна (гл. 8 ЯС).';
  }
  if (p.includes('СТРЕКОЗА')) {
    return 'Доджи-стрекоза: длинная нижняя тень — быки отбили атаку; в основании сильнее (гл. 8 ЯС).';
  }
  if (p.includes('НАДГРОБИЕ')) {
    return 'Надгробие: длинная верхняя тень — медведи отбили атаку; на вершине особенно опасно (гл. 8 ЯС).';
  }
  if (p.includes('ДОДЖИ')) {
    return 'Открытие и закрытие совпали: нерешительность; на вершине после длинной белой свечи особенно опасна (гл. 8 ЯС).';
  }
  if (p.includes('ВЫСОКАЯ ВОЛНА')) {
    return 'Высокая волна: малое тело и длинные обе тени — рынок «потерял ощущение направления» (гл. 2 ЯС).';
  }
  if (p.includes('ОДИНАКОВЫЕ ВОРОНЫ')) {
    return 'Три одинаковые вороны: открытия у закрытий предыдущих — сильнейший медвежий сигнал (гл. 6 ЯС).';
  }
  if (p.includes('СОЛДАТА')) {
    return 'Три белые свечи с растущими закрытиями в зоне низких цен: рынок набирает силу (гл. 7 ЯС).';
  }
  if (p.includes('ВОРОН')) {
    return 'Чёрные свечи с падающими закрытиями: «у плохих новостей есть крылья» (гл. 6 ЯС).';
  }
  if (p.includes('ОТБИТОЕ НАСТУПЛЕНИЕ')) {
    return 'Отбитое наступление: рост встречает сопротивление — тела уменьшаются или тени растут; защищайте длинные позиции (гл. 7 ЯС).';
  }
  if (p.includes('ТОРМОЖЕНИЕ')) {
    return 'Торможение: малая свеча «едет на плече» длинной белой — истощение быков; фиксируйте прибыль (гл. 7 ЯС).';
  }
  if (p.includes('ПИНЦЕТ')) {
    return 'Повторная проверка экстремума: уровень держит, вторичный сигнал разворота (гл. 6 ЯС).';
  }
  if (p.includes('ГОРЫ') || p.includes('БУДД')) {
    return 'Три безуспешных штурма уровня: тройная вершина (гл. 6 ЯС).';
  }
  if (p.includes('РЕКИ')) {
    return 'Три теста минимумов: основание достигнуто после подъёма выше промежуточных пиков (гл. 6 ЯС).';
  }
  if (p.includes('БАШЕН')) {
    return 'Башня: длинные свечи до и после консолидации — резкая смена тренда (гл. 6 ЯС).';
  }
  if (p.includes('ЛЕСТНИЧНОЕ')) {
    return 'Лестничное дно: серия чёрных свечей со снижающимися закрытиями, затем разворотная белая (вспомогательная модель, вне канона: у Нисона не описана; геометрия — проектная формализация).';
  }
  if (p.includes('ПОКИНУТЫЙ МЛАДЕНЕЦ')) {
    return 'Покинутый младенец: дожи с гэпами в обе стороны — редкий и очень сильный сигнал разворота (гл. 5 ЯС).';
  }
  if (p.includes('ТАСУКИ')) {
    return 'Тасуки: передышка после гэпа перед продолжением основного тренда (гл. 7 ЯС).';
  }
  if (p.includes('ГЭП СМЕЖНЫХ') && p.includes('ВНИЗ')) {
    return 'Гэп смежных белых свечей вниз: две белые свечи после гэпа вниз на падающем рынке — медвежий сигнал продолжения; белые свечи лишь частично закрывают короткие позиции (гл. 7 ЯС).';
  }
  if (p.includes('ГЭП СМЕЖНЫХ')) {
    return 'Гэп смежных белых свечей: две сходные бычьи свечи после гэпа вверх — продолжение роста (гл. 7 ЯС).';
  }
  if (p.includes('ГЭП НА МАКСИМУМАХ')) {
    return 'Гэп на максимумах: консолидация прорвана гэпом вверх — продолжение роста (гл. 7 ЯС).';
  }
  if (p.includes('ГЭП НА МИНИМУМАХ')) {
    return 'Гэп на минимумах: консолидация прорвана гэпом вниз — продолжение спада (гл. 7 ЯС).';
  }
  if (p.includes('ТАТАМИ') || p.includes('УДЕРЖАНИЕ')) {
    return 'Удержание на татами: длинная белая, затем малые свечи внутри её диапазона, завершающая белая — продолжение роста (гл. 6 ЯС).';
  }
  if (p.includes('ТРИ МЕТОДА')) {
    return 'Три ступени: передышка внутри тренда — малые свечи в диапазоне длинной, затем продолжение (гл. 7 ЯС).';
  }
  if (p.includes('РАЗДЕЛЕНИЕ')) {
    return 'Разделение: две контрастные свечи с одинаковым открытием — продолжение существующего тренда (гл. 7 ЯС).';
  }
  if (p.includes('КОНТРАТАКА')) {
    return 'Контратака: встречные гэпы с закрытием на одном уровне — разворотная пауза тренда (гл. 6 ЯС).';
  }
  if (p.includes('ПОЯСА')) {
    return 'Захват за пояс: длинная свеча с открытием на экстремуме сессии — разворот в области низких/высоких цен (гл. 6 ЯС).';
  }
  if (p.includes('НИЖЕ ШЕИ') || p.includes('НА ШЕЕ') || p.includes('ТОЛЧОК')) {
    return 'Модели продолжения спада: белая свеча закрывается у минимума/закрытия/внутри тела чёрной — медведи сохраняют контроль (гл. 4 ЯС).';
  }
  if (p.includes('НАКОПЛЕНИЕ')) {
    return 'Накопление: малоподвижные цены + высокий объём у дна — крупные игроки скупают (гл. 2, 15 ЯС).';
  }
  if (p.includes('РАСПРЕДЕЛЕНИЕ')) {
    return 'Распределение: малоподвижные цены + высокий объём у потолка — крупные игроки продают (гл. 2, 15 ЯС).';
  }
  return 'Модель предупреждает о вероятном завершении предыдущей тенденции; ждём подтверждения (гл. 4 ЯС).';
}
