import { Candle } from './candle';
import { PatternDetector, setPatternTimeframe } from './pattern_engine';
import { ZoneVoter, timeframeKey } from './zone_voter';
import { requiresNextCandleConfirmation } from './pattern_ids';
import { getPatternCandleCount } from './pattern_ids';

export type PatternStatus = 'pending' | 'confirmed' | 'cancelled';

export interface PatternResult {
  name: string;
  type: 'бычий' | 'медвежий' | 'нейтральный';
  candleIndex: number;
  confidence: number;
  confirmed: boolean;
  status?: PatternStatus;
  hasVolume: boolean;
  atLevel: boolean;
  confirmedTime: number | null;
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

/** Тип модели по имени (бычий/медвежий/нейтральный). */
function patternType(name: string): 'бычий' | 'медвежий' | 'нейтральный' {
  const n = name.toUpperCase();
  if (['ДОДЖИ', 'ДОДЖИ-СТРЕКОЗА', 'НАДГРОБИЕ', 'ДЛИННОНОГАЯ ДОДЖИ', 'ВЫСОКАЯ ВОЛНА',
    'ОТБИТОЕ НАСТУПЛЕНИЕ', 'ТОРМОЖЕНИЕ', 'ТЕСТ ПОДДЕРЖКИ', 'ТЕСТ СОПРОТИВЛЕНИЯ'].some(k => n.startsWith(k))) {
    return 'нейтральный';
  }
  if (n.includes('ДОДЖИ')) return 'нейтральный';
  if (['МОЛОТ', 'ПЕРЕВЁРНУТЫЙ МОЛОТ', 'БЫЧЬЕ ПОГЛОЩЕНИЕ', 'ПРОСВЕТ В ОБЛАКАХ',
    'УТРЕННЯЯ ЗВЕЗДА', 'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА', 'ТРИ БЕЛЫХ СОЛДАТА',
    'БЫЧИЙ ХАРАМИ', 'БЫЧИЙ ХАРАМИ-КРЕСТ', 'ПИНЦЕТ (НИЗ)', 'ЛИНИЯ ПОЯСА (БЫЧЬЯ)',
    'КОНТРАТАКА (БЫЧЬЯ)', 'РАЗДЕЛЕНИЕ (БЫЧЬЕ)', 'БАШЕННОЕ ДНО', 'ТРИ РЕКИ',
    'ВОСХОДЯЩИЕ ТРИ МЕТОДА', 'УДЕРЖАНИЕ НА ТАТАМИ', 'ЛЕСТНИЧНОЕ ДНО',
    'ПОКИНУТЫЙ МЛАДЕНЕЦ (НИЗ)', 'ТАСУКИ ВОСХОДЯЩЕГО ГЭПА', 'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ',
    'ГЭП НА МАКСИМУМАХ', 'ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)', 'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)',
    'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)', 'НАКОПЛЕНИЕ', 'СПРУЖИНИВАНИЕ',
    'ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)', 'ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ',
  ].some(k => n.startsWith(k))) return 'бычий';
  if (['ПОВЕШЕННЫЙ', 'ПАДАЮЩАЯ ЗВЕЗДА', 'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ', 'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ',
    'ВЕЧЕРНЯЯ ЗВЕЗДА', 'ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА', 'ТРИ ЧЁРНЫХ ВОРОНЫ', 'ТРИ ОДИНАКОВЫЕ ВОРОНЫ',
    'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ', 'МЕДВЕЖИЙ ХАРАМИ', 'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ', 'ПИНЦЕТ (ВЕРХ)',
    'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)', 'КОНТРАТАКА (МЕДВЕЖЬЯ)', 'РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)',
    'БАШЕННАЯ ВЕРШИНА', 'ТРИ ГОРЫ', 'НИСХОДЯЩИЕ ТРИ МЕТОДА',
    'ПОКИНУТЫЙ МЛАДЕНЕЦ (ВЕРХ)', 'ТАСУКИ НИСХОДЯЩЕГО ГЭПА', 'ГЭП НА МИНИМУМАХ',
    'ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)', 'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)',
    'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)', 'РАСПРЕДЕЛЕНИЕ', 'ВЕРХНЕЕ СПРУЖИНИВАНИЕ',
    'НИЖЕ ШЕИ', 'НА ШЕЕ', 'ТОЛЧОК', 'ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ',
  ].some(k => n.startsWith(k))) return 'медвежий';
  if (n.includes('БЫЧИЙ') || n.includes('БЫЧЬЕ') || n.includes('ОСНОВАНИЕ')) return 'бычий';
  if (n.includes('МЕДВЕЖИЙ') || n.includes('МЕДВЕЖЬЕ') || n.includes('ВЕРШИНА')) return 'медвежий';
  return 'нейтральный';
}

export function detectPatterns(candles: Candle[], timeframe: string = 'D'): PatternResult[] {
  try {
    setPatternTimeframe(timeframe);
    const patterns: PatternResult[] = [];
    const tfMs = tfDurationMs(timeframe);

    for (let i = 1; i < candles.length; i++) {
      const candle = candles[i];
      const prev = candles.slice(0, i);
      const next = candles[i + 1];
      const zonePrev = prev.length > 130 ? prev.slice(-120) : prev;

      const checks: Array<{ found: boolean; name: string }> = [];

      // Односвечные.
      checks.push(PatternDetector.isHammer(candle, prev));
      checks.push(PatternDetector.isImperfectHammer(candle, prev));
      checks.push(PatternDetector.isInvertedHammer(candle, prev));
      checks.push(PatternDetector.isHangingMan(candle, prev));
      checks.push(PatternDetector.isShootingStar(candle, prev));
      checks.push(PatternDetector.classifyDoji(candle));
      checks.push(PatternDetector.isHighWave(candle, prev));
      checks.push(PatternDetector.isSpring(candles.slice(0, i + 1)));
      checks.push(PatternDetector.isUpthrust(candles.slice(0, i + 1)));
      checks.push(PatternDetector.isVolSpin(candle, candles.slice(0, i + 1)));
      checks.push(PatternDetector.isLevelTest(candles.slice(0, i + 1)));
      checks.push(PatternDetector.isTrendPullbackCandle(candles.slice(0, i + 1)));
      checks.push(PatternDetector.isKeyReversal(candles.slice(0, i + 1)));
      checks.push(PatternDetector.isConsolidationBreakout(candles.slice(0, i + 1)));

      // Двухсвечные.
      if (i > 0) {
        const c1 = candles[i - 1];
        const hist = candles.slice(0, i - 1);
        checks.push(PatternDetector.isBullishEngulfing(c1, candle, prev));
        checks.push(PatternDetector.isBearishEngulfing(c1, candle, prev));
        checks.push(PatternDetector.isHarami(c1, candle, prev));
        checks.push(PatternDetector.isHaramiCross(c1, candle, prev));
        checks.push(PatternDetector.isTweezerBottom(c1, candle, prev));
        checks.push(PatternDetector.isTweezerTop(c1, candle, prev));
        checks.push(PatternDetector.isDarkCloudCover(c1, candle, prev));
        checks.push(PatternDetector.isPiercingPattern(c1, candle, prev));
        checks.push(PatternDetector.isBullishBelt(c1, candle, prev));
        checks.push(PatternDetector.isBearishBelt(c1, candle, prev));
        checks.push(PatternDetector.isCounterattack(c1, candle, prev));
        checks.push(PatternDetector.isSeparatingLines(c1, candle, prev));
        checks.push(PatternDetector.isNeckFamily(c1, candle, prev));
        checks.push(PatternDetector.isLastEngulfing(c1, candle, prev));
      }

      // Трёхсвечные и более.
      if (i >= 2) {
        checks.push(PatternDetector.isMorningStar(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isEveningStar(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isThreeWhiteSoldiers(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isThreeBlackCrows(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isAdvanceBlock(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isStalled(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isTwoCrows(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isAbandonedBaby(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isTasuki(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isDoubleThrustingBull(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isGappingSideBySide(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isTowerTop(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isTowerBottom(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isThreeMountains(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isThreeRivers(candles.slice(0, i + 1)));
      }
      if (i >= 4) {
        checks.push(PatternDetector.isRisingThree(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isFallingThree(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isMatHold(candles.slice(0, i + 1)));
        checks.push(PatternDetector.isLadderBottom(candles.slice(0, i + 1)));
      }
      if (i >= 5) {
        checks.push(PatternDetector.isGappingPlay(candles.slice(0, i + 1)));
      }

      for (const check of checks) {
        if (!check.found) continue;

        // ИСПРАВЛЕНО: размерность берётся из канонического справочника.
        const patternCandles = getPatternCandleCount(check.name);
        const type = patternType(check.name);
        const patternStartIdx = Math.max(0, i - patternCandles + 1);
        const patternEndIdx = i;
        const lastPatternCandle = candles[patternEndIdx];

        const patternHigh = Math.max(...candles.slice(patternStartIdx, patternEndIdx + 1).map(c => c.high));
        const patternLow = Math.min(...candles.slice(patternStartIdx, patternEndIdx + 1).map(c => c.low));

        const noNeedNext = !requiresNextCandleConfirmation(check.name);
        const inFormationOk =
          type === 'бычий' ? lastPatternCandle.isBullish :
            type === 'медвежий' ? lastPatternCandle.isBearish :
              false;

        let status: PatternStatus;
        let confirmBar: Candle | null = null;
        if (!next) {
          status = noNeedNext && inFormationOk ? 'confirmed' : 'pending';
          if (status === 'confirmed') confirmBar = lastPatternCandle;
        } else {
          const ok =
            type === 'бычий' ? next.isBullish && next.close > patternHigh :
              type === 'медвежий' ? next.isBearish && next.close < patternLow :
                false;
          if (ok) {
            status = 'confirmed';
            confirmBar = next;
          } else if (noNeedNext && inFormationOk) {
            status = 'confirmed';
            confirmBar = lastPatternCandle;
          } else {
            status = 'cancelled';
          }
        }
        const confirmed = status === 'confirmed';
        const confirmedTime = confirmed && confirmBar ? barCloseTime(confirmBar, tfMs) : null;

        const volumePeriod = Math.min(20, prev.length);
        const hasVolume = volumePeriod > 0 &&
          candle.volume > (prev.slice(-volumePeriod).reduce((s, c) => s + c.volume, 0) / volumePeriod) * 1.3;

        let confidence = 50;
        if (patternCandles >= 3) confidence = 65;
        else if (patternCandles === 2 && check.name.includes('ПОГЛОЩЕНИЕ')) confidence = 62;
        else if (check.name.includes('ЗВЕЗДА')) confidence = 63;

        const atLevel = type === 'бычий'
          ? ZoneVoter.isNearSupport(candle.close, zonePrev, 0.015, timeframeKey(timeframe), candle.low)
          : type === 'медвежий'
            ? ZoneVoter.isNearResistance(candle.close, zonePrev, 0.015, timeframeKey(timeframe), candle.high)
            : false;

        if (confirmed) confidence += 15;
        if (hasVolume) confidence += 8;
        if (atLevel) confidence += 7;
        if (check.name.includes('ОБЪЁМ')) confidence += 5;
        if (check.name.includes('ПОДДЕРЖКИ') || check.name.includes('СОПРОТИВЛЕНИЯ')) confidence += 5;
        // Нейтральные модели не конкурируют с направленными сигналами.
        if (type === 'нейтральный') confidence = Math.min(confidence, 45);
        confidence = Math.min(92, confidence);

        patterns.push({
          name: check.name,
          type,
          candleIndex: i,
          confidence,
          confirmed,
          status,
          hasVolume,
          atLevel,
          confirmedTime,
        });
      }
    }

    const unique = patterns.filter((p, idx, arr) =>
      arr.findIndex(x => x.name === p.name && x.candleIndex === p.candleIndex) === idx);
    const filtered = unique.filter(p => p.confidence >= 55 && p.status !== 'cancelled');
    return sortPatternsForDisplay(filtered, candles.length).slice(0, 24);
  } finally {
    setPatternTimeframe('D');
  }
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
    return 'Лестничное дно: серия чёрных свечей со снижающимися закрытиями, затем разворотная белая (гл. 6 ЯС).';
  }
  if (p.includes('ПОКИНУТЫЙ МЛАДЕНЕЦ')) {
    return 'Покинутый младенец: дожи с гэпами в обе стороны — редкий и очень сильный сигнал разворота (гл. 5 ЯС).';
  }
  if (p.includes('ТАСУКИ')) {
    return 'Тасуки: передышка после гэпа перед продолжением основного тренда (гл. 7 ЯС).';
  }
  if (p.includes('ГЭП СМЕЖНЫХ')) {
    return 'Гэп смежных белых свечей: две сходные бычьи свечи после гэпа — продолжение роста (гл. 7 ЯС).';
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
