import { Candle } from './candle';
import { PatternDetector, SupportResistance, setPatternTimeframe } from './pattern_engine';
import { ZoneVoter, timeframeKey } from './zone_voter';
import { 
  requiresNextCandleConfirmation, 
  isSelfConfirmingPattern,
  isNeutralPatternName 
} from './pattern_ids';

/**
 * Жизненный цикл формации по Нисону («Expectation → Confirmation»):
 * - pending   — формация обнаружена, но следующая свеча ещё не закрылась
 *               (последняя свеча графика): «ожидание подтверждения»;
 * - confirmed — следующая свеча закрылась в направлении паттерна за его
 *               экстремумом: сигнал действителен, рисуем маркер;
 * - cancelled — следующая свеча НЕ подтвердила формацию: по канону она
 *               ОТМЕНЕНА и не является сигналом. Раньше такие формации
 *               всё равно попадали в выдачу с пониженной уверенностью —
 *               это главный источник «ложных» стрелок на графике.
 */
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
  /**
   * openTime (мс) бара, закрытие которого ПОДТВЕРДИЛО формацию (по Нисону —
   * факт закрытия следующей свечи в направлении паттерна). Для «завершённых»
   * моделей (гл. 3–6), у которых подтверждение внутри самой формации, — это
   * время последней свечи паттерна. null — если подтверждения ещё нет
   * (pending/cancelled).
   */
  confirmedTime: number | null;
}

/**
 * Длительность одного бара в мс по ТФ (поддерживает канон '30m'/'1H'/'D' и
 * числовые минуты Bybit '30'/'60'/'240'). Локально, а не из api/client.ts:
 * движок паттернов не должен тянуть граф модулей API-анализа.
 */
function tfDurationMs(tf: string): number | undefined {
  const t = String(tf).trim();
  if (/^\d+$/.test(t)) return Number(t) * 60_000; // минуты (формы Bybit)
  switch (t.toUpperCase()) {
    case '1M': return 60_000;      // '1m' — минутный ТФ
    case '5M': return 5 * 60_000;
    case '15M': return 15 * 60_000;
    case '30M': return 30 * 60_000;
    case '1H': case '60M': return 60 * 60_000;
    case '2H': case '120M': return 2 * 60 * 60_000;
    case '4H': case '240M': return 4 * 60 * 60_000;
    case 'D': case '1D': return 24 * 60 * 60_000;
    case 'W': case '1W': return 7 * 24 * 60 * 60_000;
    default: return undefined;
  }
}

/**
 * Момент ЗАКРЫТИЯ бара (openTime + длительность ТФ). Бар считается живым
 * (подтверждение невозможно) до этого времени — на нём формация остаётся
 * pending. Fallback: если ТФ неизвестен, берём сам openTime.
 */
function barCloseTime(bar: Candle, tfMs: number | undefined): number {
  return tfMs ? bar.time + tfMs : bar.time;
}

/**
 * Окно отображения паттернов (последние N свечей). Раньше движок возвращал
 * максимум 10 паттернов, отсортированных по уверенности ПО ВСЕЙ истории —
 * из-за на графике «пропадали» свежие формации (старые срабатывания имели
 * больше шансов накопить бонусы объёма/уровня) и возникало ощущение ложных
 * меток в прошлом. Теперь: сначала отсекаем глубокую историю, затем
 * ранжируем по свежести → подтверждению → уверенности.
 */
export const PATTERN_DISPLAY_WINDOW = 80;

/** Сортировка для отображения: свежие → подтверждённые → уверенные. */
export function sortPatternsForDisplay<T extends { candleIndex: number; confirmed: boolean; confidence: number }>(
  patterns: T[],
  totalCandles: number,
): T[] {
  return [...patterns]
    .filter(p => p.candleIndex >= totalCandles - PATTERN_DISPLAY_WINDOW)
    .sort(
      (a, b) =>
        b.candleIndex - a.candleIndex ||
        Number(b.confirmed) - Number(a.confirmed) ||
        b.confidence - a.confidence,
    );
}

export function detectPatterns(candles: Candle[], timeframe: string = 'D'): PatternResult[] {
  try {
    // ТФ-калибровка зон: вся цепочка isNearSupport/isNearResistance внутри детекторов
    // будет использовать параметры масштаба выбранного интервала.
    setPatternTimeframe(timeframe);
    const patterns: PatternResult[] = [];
    // Длительность бара выбранного ТФ — чтобы датировать МОМЕНТ подтверждения
    // фактическим закрытием подтверждающей свечи (openTime + длительность ТФ),
    // а не открытием её бара.
    const tfMs = tfDurationMs(timeframe);
    
    // FIX канона (гл. 3–4 «ожидание → подтверждение»): цикл раньше шёл до
    // length - 1, т.е. ПОСЛЕДНЯЯ закрытая свеча никогда не проверялась как
    // формация — свежий молот/поглощение исчезали с графика ровно на один бар
    // (задержка анализа). Теперь проверяем и последний бар: для него следующая
    // свеча отсутствует => статус pending («ожидание подтверждения»), что и
    // требует Нисон: формация живёт, пока её не отменит или подтвердит закрытие
    // следующего бара. cancelled-формации фильтруются ниже, так что ложных
    // стрелок это не добавляет.
    for (let i = 1; i < candles.length; i++) {
      const candle = candles[i];
      const prev = candles.slice(0, i);
      const next = candles[i + 1]; // Следующая свеча для подтверждения

      // FIX канона / жалобы «ложные паттерны»: раньше зона проверялась по всей
      // истории — даже очень далёкие уровни считались «поддержкой», и формации
      // в середине флэта получали бонус контекста. Нисон анализирует уровень в
      // рабочем окне графика (~последние 100–150 свечей): всё, что глубже, для
      // текущей цены не является близким уровнем. Окно отсечки — максимум из
      // последних ~120 свечей (и всегда включает предпаттерный сегмент).
      const zonePrev = prev.length > 130 ? prev.slice(-120) : prev;
      
      const checks: Array<{ found: boolean; name: string; type: 'бычий' | 'медвежий' | 'нейтральный'; patternCandles: number }> = [];
      
      // Односвечные
      const hammer = PatternDetector.isHammer(candle, prev);
      if (hammer.found) checks.push({ ...hammer, patternCandles: 1, type: 'бычий' });
      
      const imperfectHammer = PatternDetector.isImperfectHammer(candle, prev);
      if (imperfectHammer.found) checks.push({ ...imperfectHammer, patternCandles: 1, type: 'бычий' });
      
      const invertedHammer = PatternDetector.isInvertedHammer(candle, prev);
      if (invertedHammer.found) checks.push({ ...invertedHammer, patternCandles: 1, type: 'бычий' });
      
      const hangingMan = PatternDetector.isHangingMan(candle, prev);
      if (hangingMan.found) checks.push({ ...hangingMan, patternCandles: 1, type: 'медвежий' });
      
      const shootingStar = PatternDetector.isShootingStar(candle, prev);
      if (shootingStar.found) checks.push({ ...shootingStar, patternCandles: 1, type: 'медвежий' });
      
      const doji = PatternDetector.classifyDoji(candle);
      if (doji.found) checks.push({ ...doji, patternCandles: 1, type: 'нейтральный' });
      
      const highWave = PatternDetector.isHighWave(candle, prev);
      if (highWave.found) checks.push({ ...highWave, patternCandles: 1, type: 'нейтральный' });
      
      const spring = PatternDetector.isSpring(candles.slice(0, i + 1));
      if (spring.found) checks.push({ ...spring, patternCandles: 1, type: 'бычий' });
      
      const upthrust = PatternDetector.isUpthrust(candles.slice(0, i + 1));
      if (upthrust.found) checks.push({ ...upthrust, patternCandles: 1, type: 'медвежий' });
      
      // Двухсвечные
      if (i > 0) {
        const c1 = candles[i - 1];
        
        const bullishEngulfing = PatternDetector.isBullishEngulfing(c1, candle, prev);
        if (bullishEngulfing.found) checks.push({ ...bullishEngulfing, patternCandles: 2, type: 'бычий' });
        
        const bearishEngulfing = PatternDetector.isBearishEngulfing(c1, candle, prev);
        if (bearishEngulfing.found) checks.push({ ...bearishEngulfing, patternCandles: 2, type: 'медвежий' });
        
        const harami = PatternDetector.isHarami(c1, candle, prev);
        if (harami.found) {
          const type = harami.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
          checks.push({ ...harami, patternCandles: 2, type });
        }
        
        const haramiCross = PatternDetector.isHaramiCross(c1, candle, prev);
        if (haramiCross.found) {
          const type = haramiCross.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
          checks.push({ ...haramiCross, patternCandles: 2, type });
        }
        
        // FIX: новая сигнатура isTweezerBottom/isTweezerTop (candles, endIdx)
        const tweezerBottom = PatternDetector.isTweezerBottom(candles, i);
        if (tweezerBottom.found) checks.push({ ...tweezerBottom, patternCandles: 2, type: 'бычий' });
        
        const tweezerTop = PatternDetector.isTweezerTop(candles, i);
        if (tweezerTop.found) checks.push({ ...tweezerTop, patternCandles: 2, type: 'медвежий' });
        
        const darkCloud = PatternDetector.isDarkCloudCover(c1, candle, prev);
        if (darkCloud.found) checks.push({ ...darkCloud, patternCandles: 2, type: 'медвежий' });
        
        const piercing = PatternDetector.isPiercingPattern(c1, candle, prev);
        if (piercing.found) checks.push({ ...piercing, patternCandles: 2, type: 'бычий' });
        
        const bullishBelt = PatternDetector.isBullishBelt(candle, prev);
        if (bullishBelt.found) checks.push({ ...bullishBelt, patternCandles: 2, type: 'бычий' });
        
        const bearishBelt = PatternDetector.isBearishBelt(candle, prev);
        if (bearishBelt.found) checks.push({ ...bearishBelt, patternCandles: 2, type: 'медвежий' });
        
        const counterattack = PatternDetector.isCounterattack(c1, candle, prev);
        if (counterattack.found) {
          const type = counterattack.name.includes('БЫЧЬЯ') ? 'бычий' : 'медвежий';
          checks.push({ ...counterattack, patternCandles: 2, type });
        }
        
        const separating = PatternDetector.isSeparatingLines(c1, candle, prev);
        if (separating.found) {
          const type = separating.name.includes('БЫЧЬЕ') ? 'бычий' : 'медвежий';
          checks.push({ ...separating, patternCandles: 2, type });
        }
        
        // FIX: «ниже шеи / на шее / толчок» — МЕДВЕЖЬИ модели продолжения спада (гл. 4)
        const neck = PatternDetector.isNeckFamily(c1, candle, prev);
        if (neck.found) checks.push({ ...neck, patternCandles: 2, type: 'медвежий' });
        
        const lastEngulfing = PatternDetector.isLastEngulfing(c1, candle, prev);
        if (lastEngulfing.found) {
          const type = lastEngulfing.name.includes('ОСНОВАНИЕ') ? 'бычий' : 'медвежий';
          checks.push({ ...lastEngulfing, patternCandles: 2, type });
        }
      }
      
      // Трёхсвечные
      if (i >= 2) {
        const morningStar = PatternDetector.isMorningStar(candles.slice(0, i + 1));
        if (morningStar.found) checks.push({ ...morningStar, patternCandles: 3, type: 'бычий' });
        
        const eveningStar = PatternDetector.isEveningStar(candles.slice(0, i + 1));
        if (eveningStar.found) checks.push({ ...eveningStar, patternCandles: 3, type: 'медвежий' });
        
        const threeWhite = PatternDetector.isThreeWhiteSoldiers(candles.slice(0, i + 1));
        if (threeWhite.found) checks.push({ ...threeWhite, patternCandles: 3, type: 'бычий' });
        
        const threeBlack = PatternDetector.isThreeBlackCrows(candles.slice(0, i + 1));
        if (threeBlack.found) checks.push({ ...threeBlack, patternCandles: 3, type: 'медвежий' });
        
        const advanceBlock = PatternDetector.isAdvanceBlock(candles.slice(0, i + 1));
        if (advanceBlock.found) checks.push({ ...advanceBlock, patternCandles: 3, type: 'нейтральный' });
        
        const stalled = PatternDetector.isStalled(candles.slice(0, i + 1));
        if (stalled.found) checks.push({ ...stalled, patternCandles: 2, type: 'нейтральный' });
        
        const towerTop = PatternDetector.isTowerTop(candles.slice(0, i + 1));
        if (towerTop.found) checks.push({ ...towerTop, patternCandles: 6, type: 'медвежий' });
        
        const towerBottom = PatternDetector.isTowerBottom(candles.slice(0, i + 1));
        if (towerBottom.found) checks.push({ ...towerBottom, patternCandles: 6, type: 'бычий' });
        
        const threeMountains = PatternDetector.isThreeMountains(candles.slice(0, i + 1));
        if (threeMountains.found) checks.push({ ...threeMountains, patternCandles: 12, type: 'медвежий' });
        
        const threeRivers = PatternDetector.isThreeRivers(candles.slice(0, i + 1));
        if (threeRivers.found) checks.push({ ...threeRivers, patternCandles: 12, type: 'бычий' });
        
        const twoCrows = PatternDetector.isTwoCrows(candles.slice(0, i + 1));
        if (twoCrows.found) checks.push({ ...twoCrows, patternCandles: 3, type: 'медвежий' });
        
        const abandonedBaby = PatternDetector.isAbandonedBaby(candles.slice(0, i + 1));
        if (abandonedBaby.found) {
          const type = abandonedBaby.name.includes('НИЗ') ? 'бычий' : 'медвежий';
          checks.push({ ...abandonedBaby, patternCandles: 3, type });
        }
        
        const tasuki = PatternDetector.isTasuki(candles.slice(0, i + 1));
        if (tasuki.found) {
          const type = tasuki.name.includes('ВОСХОДЯЩЕГО') ? 'бычий' : 'медвежий';
          checks.push({ ...tasuki, patternCandles: 3, type });
        }
        
        const doubleThrusting = PatternDetector.isDoubleThrustingBull(candles.slice(0, i + 1));
        if (doubleThrusting.found) checks.push({ ...doubleThrusting, patternCandles: 4, type: 'бычий' });
        
        const gappingSideBySide = PatternDetector.isGappingSideBySide(candles.slice(0, i + 1));
        if (gappingSideBySide.found) checks.push({ ...gappingSideBySide, patternCandles: 3, type: 'бычий' });
      }
      
      // Пятисвечные
      if (i >= 4) {
        const risingThree = PatternDetector.isRisingThree(candles.slice(0, i + 1));
        if (risingThree.found) checks.push({ ...risingThree, patternCandles: 5, type: 'бычий' });
        
        const fallingThree = PatternDetector.isFallingThree(candles.slice(0, i + 1));
        if (fallingThree.found) checks.push({ ...fallingThree, patternCandles: 5, type: 'медвежий' });
        
        const matHold = PatternDetector.isMatHold(candles.slice(0, i + 1));
        if (matHold.found) checks.push({ ...matHold, patternCandles: 5, type: 'бычий' });
        
        const ladderBottom = PatternDetector.isLadderBottom(candles.slice(0, i + 1));
        if (ladderBottom.found) checks.push({ ...ladderBottom, patternCandles: 5, type: 'бычий' });
      }
      
      // Шестисвечные и более
      if (i >= 5) {
        const gappingPlay = PatternDetector.isGappingPlay(candles.slice(0, i + 1));
        if (gappingPlay.found) {
          const type = gappingPlay.name.includes('МАКСИМУМАХ') ? 'бычий' : 'медвежий';
          checks.push({ ...gappingPlay, patternCandles: 7, type });
        }
      }
      
      // Специальные паттерны
      const consolidationBreakout = PatternDetector.isConsolidationBreakout(candles.slice(0, i + 1));
      if (consolidationBreakout.found) {
        const type = consolidationBreakout.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
        checks.push({ ...consolidationBreakout, patternCandles: 6, type });
      }
      
      const keyReversal = PatternDetector.isKeyReversal(candles.slice(0, i + 1));
      if (keyReversal.found) {
        const type = keyReversal.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
        checks.push({ ...keyReversal, patternCandles: 2, type });
      }
      
      const volSpin = PatternDetector.isVolSpin(candle, candles.slice(0, i + 1));
      if (volSpin.found) {
        const type = volSpin.name.includes('НАКОПЛЕНИЕ') ? 'бычий' : 'медвежий';
        checks.push({ ...volSpin, patternCandles: 1, type });
      }
      
      const levelTest = PatternDetector.isLevelTest(candles.slice(0, i + 1));
      if (levelTest.found) {
        const type = levelTest.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
        checks.push({ ...levelTest, patternCandles: 1, type: 'нейтральный' });
      }
      
      const trendPullback = PatternDetector.isTrendPullbackCandle(candles.slice(0, i + 1));
      if (trendPullback.found) {
        const type = trendPullback.name.includes('БЕЛАЯ') ? 'бычий' : 'медвежий';
        checks.push({ ...trendPullback, patternCandles: 6, type });
      }
      
      // Обработка найденных паттернов
      for (const check of checks) {
        const patternStartIdx = i - check.patternCandles + 1;
        const patternEndIdx = i;
        const lastPatternCandle = candles[patternEndIdx]; // Последняя свеча паттерна
        
        // Защита от отрицательного индекса
        const safeStartIdx = Math.max(0, patternStartIdx);
        
        // Подтверждение по Нисону: следующая свеча должна закрыть выше максимума (для бычьих)
        // или ниже минимума (для медвежьих) ВСЕГО паттерна
        const patternHigh = Math.max(...candles.slice(safeStartIdx, patternEndIdx + 1).map(c => c.high));
        const patternLow = Math.min(...candles.slice(safeStartIdx, patternEndIdx + 1).map(c => c.low));
        
        // FIX канона: используем isSelfConfirmingPattern для явной проверки завершённых формаций
        const noNeedNext = !requiresNextCandleConfirmation(check.name) || isSelfConfirmingPattern(check.name);
        const inFormationOk =
          check.type === 'бычий' ? lastPatternCandle.isBullish :
          check.type === 'медвежий' ? lastPatternCandle.isBearish :
          false;
        let status: PatternStatus;
        // Момент подтверждения (openTime мс) — бар, закрытие которого стало
        // фактом подтверждения; null для pending/cancelled.
        let confirmBar: Candle | null = null;
        if (!next) {
          status = noNeedNext && inFormationOk ? 'confirmed' : 'pending';
          if (status === 'confirmed') confirmBar = lastPatternCandle;
        } else {
          const ok =
            check.type === 'бычий' ? next.isBullish && next.close > patternHigh :
            check.type === 'медвежий' ? next.isBearish && next.close < patternLow :
            false;
          if (ok) {
            // Подтверждение следующей свечой (закрытие next-бара).
            status = 'confirmed';
            confirmBar = next;
          } else if (noNeedNext && inFormationOk) {
            // Завершённая модель: подтверждение — последняя свеча самой формации.
            status = 'confirmed';
            confirmBar = lastPatternCandle;
          } else {
            status = 'cancelled';
          }
        }
        const confirmed = status === 'confirmed';
        const confirmedTime = confirmed && confirmBar ? barCloseTime(confirmBar, tfMs) : null;
        
        // Правильный расчёт среднего объёма с защитой от деления на ноль
        const volumePeriod = Math.min(20, prev.length);
        const hasVolume = volumePeriod > 0 && candle.volume > (prev.slice(-volumePeriod).reduce((s, c) => s + c.volume, 0) / volumePeriod) * 1.3;
        
        let confidence = 50;
        if (check.patternCandles === 3) confidence = 65;
        else if (check.patternCandles === 2 && check.name.includes('ПОГЛОЩЕНИЕ')) confidence = 62;
        else if (check.name.includes('ЗВЕЗДА')) confidence = 63;
        
        // Проверка близости к уровню поддержки/сопротивления
        // FIX (wick-касания): формация тестирует уровень ТЕНЬЮ — передаём low/high
        // свечи паттерна, чтобы молот со сформированной зоной поддержки не терялся.
        const atLevel = check.type === 'бычий' 
          ? ZoneVoter.isNearSupport(candle.close, zonePrev, 0.015, timeframeKey(timeframe), candle.low)
          : check.type === 'медвежий'
          ? ZoneVoter.isNearResistance(candle.close, zonePrev, 0.015, timeframeKey(timeframe), candle.high)
          : false;
        
        if (confirmed) confidence += 15;
        if (hasVolume) confidence += 8;
        if (atLevel) confidence += 7;
        if (check.name.includes('ОБЪЁМ')) confidence += 5;
        if (check.name.includes('ПОДДЕРЖКИ') || check.name.includes('СОПРОТИВЛЕНИЯ')) confidence += 5;
        
        // Нейтральные паттерны (предупреждения) не должны иметь высокую confidence
        if (isNeutralPatternName(check.name)) {
          confidence = Math.min(confidence, 45);
        }
        
        confidence = Math.min(92, confidence);
        
        patterns.push({
          name: check.name,
          type: check.type,
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
      arr.findIndex(x => x.name === p.name && x.candleIndex === p.candleIndex) === idx
    );
    
    // FIX (жалоба «не все паттерны отображаются»): раньше бралось 10 лучших по
    // уверенности ПО ВСЕЙ истории — свежие формации вытеснялись старыми с
    // накопленными бонусами объёма/уровня. Теперь: окно последних свечей +
    // ранжирование по свежести → подтверждению → уверенности, лимит 24.
    // FIX канона: в историю/на график попадают ТОЛЬКО подтверждённые сигналы.
    // cancelled-формации исключаются полностью (Нисон: неподтверждённая
    // формация не является сигналом), pending — как живые «ожидания».
    const filtered = unique.filter(p => p.confidence >= 55 && p.status !== 'cancelled');

    return sortPatternsForDisplay(filtered, candles.length).slice(0, 24);
  } finally {
    // Не оставляем глобальный ТФ-контекст «загрязнённым»: прямые вызовы
    // PatternDetector.isXxx вне detectPatterns должны видеть нейтральный дефолт.
    setPatternTimeframe('D');
  }
}

export function patternStory(pattern: string): string {
  const p = pattern.toUpperCase();
  
  // Односвечные модели (гл. 3–4)
  if (p.includes('МОЛОТ')) {
    if (p.includes('НЕСОВЕРШЕННЫЙ')) {
      return 'Несовершенный молот (тело больше идеального, тень короче): по Нисону (рис. 4.8–4.9) такая свеча работает как разворотная, если есть опора (зона, объём, MA) и подтверждение следующей свечой.';
    }
    return 'Длинная нижняя тень и малое тело у верха диапазона: продавцов выкупили к закрытию — попытка нащупать дно (гл. 4).';
  }
  if (p.includes('ПЕРЕВЁРНУТЫЙ МОЛОТ')) {
    return 'Малое тело внизу и длинная верхняя тень после снижения: медведи не удержали минимумы, ждём бычьего подтверждения (гл. 5).';
  }
  if (p.includes('ПОВЕШЕННЫЙ')) {
    return 'Та же форма, что и молот, но на вершине роста: рынок уязвим к атакам продавцов, нужно медвежье подтверждение (гл. 4).';
  }
  if (p.includes('ПАДАЮЩАЯ ЗВЕЗДА')) {
    return 'Попытка штурма высот не удалась: цена вернулась к открытию после взлёта — быки истощены (гл. 5).';
  }
  
  // Доджи (гл. 8)
  if (p.includes('ДОДЖИ')) {
    if (p.includes('СТРЕКОЗА')) {
      return 'Доджи-стрекоза: длинная нижняя тень, нет верхней — быки отбили атаку; в основании сильнее, чем на вершине (гл. 8).';
    }
    if (p.includes('НАДГРОБИЕ')) {
      return 'Надгробие: длинная верхняя тень, нет нижней — медведи отбили атаку; особенно опасно на вершине после длинной белой свечи (гл. 8).';
    }
    if (p.includes('ДЛИННОНОГАЯ') || p.includes('РИКША')) {
      return 'Длинноногая дожи (рикша): обе тени длинные, открытие/закрытие в середине — рынок потерял направление; требует подтверждения (гл. 8).';
    }
    return 'Открытие и закрытие совпали: нерешительность; на вершине после длинной белой свечи особенно опасна (гл. 8).';
  }
  if (p.includes('ВЫСОКАЯ ВОЛНА')) {
    return 'Свеча «высокая волна»: малое тело и очень длинные обе тени — рынок «потерял ощущение направления» (гл. 2, 8). Предупреждение о завершении тренда.';
  }
  
  // Двухсвечные развороты (гл. 4)
  if (p.includes('ПОГЛОЩЕНИЕ')) {
    if (p.includes('ПОСЛЕДНЕЕ')) {
      if (p.includes('ОСНОВАНИЕ')) {
        return 'Последнее поглощение (основание): крупная чёрная поглощает малое белое во время спада — бычий сигнал, подтверждение = закрытие выше чёрной (ЗГ гл. 3).';
      }
      return 'Последнее поглощение (вершина): крупная белая поглощает чёрную во время роста — медвежий сигнал (ЗГ гл. 3).';
    }
    return 'Второе тело полностью перекрыло первое: инициатива перешла к новой стороне (гл. 4).';
  }
  if (p.includes('ЗАВЕСА')) {
    return 'Открытие выше максимума и закрытие ниже середины белого тела: быки потеряли контроль (гл. 4).';
  }
  if (p.includes('ПРОСВЕТ')) {
    return 'Белая свеча перекрыла больше половины чёрной после гэпа вниз: давление продавцов ослабло (гл. 4).';
  }
  if (p.includes('ПИНЦЕТ')) {
    return 'Повторная проверка экстремума: уровень держит, вторичный сигнал разворота (гл. 6).';
  }
  if (p.includes('ПОЯСА')) {
    return 'Захват за пояс: длинная свеча с открытием на экстремуме сессии — разворот (гл. 6).';
  }
  if (p.includes('КОНТРАТАКА')) {
    return 'Контратака: две свечи с противоположными гэпами закрываются на одном уровне — разворотная пауза (гл. 6).';
  }
  if (p.includes('ХАРАМИ')) {
    if (p.includes('КРЕСТ')) {
      return 'Харами-крест: дожи внутри длинной свечи — сильная нерешительность; требует подтверждения (гл. 6).';
    }
    return 'Пауза тренда: малое тело внутри длинного — перемирие быков и медведей (гл. 6).';
  }
  
  // Модели продолжения (гл. 4, 7)
  if (p.includes('ШЕИ') || p.includes('ТОЛЧОК')) {
    return 'Модели продолжения спада: белая свеча закрывается у минимума/закрытия/внутри тела чёрной — медведи сохраняют контроль (гл. 4).';
  }
  if (p.includes('РАЗДЕЛЕНИЕ')) {
    return 'Разделение: две контрастные свечи с одинаковым открытием — продолжение тренда (гл. 7).';
  }
  
  // Трёхсвечные модели (гл. 5–6)
  if (p.includes('ЗВЕЗДА')) {
    if (p.includes('ДОДЖИ')) {
      return 'Звезда дожи: малое тело-доджи после длинной свечи — сильная нерешительность; требует подтверждения (гл. 5).';
    }
    return 'Малое тело после длинной свечи — равновесие сил; третья свеча подтверждает разворот (гл. 5).';
  }
  if (p.includes('ПОКИНУТЫЙ МЛАДЕНЕЦ')) {
    return 'Покинутый младенец: звезда с гэпами в обе стороны — редкая и сильная разворотная модель (гл. 5).';
  }
  if (p.includes('СОЛДАТА')) {
    return 'Три белые свечи с растущими закрытиями в зоне низких цен: рынок набирает силу (гл. 7).';
  }
  if (p.includes('ВОРОН')) {
    if (p.includes('ОДИНАКОВЫЕ')) {
      return 'Три одинаковые вороны: три чёрные свечи с открытиями у закрытий предыдущих — сильнейший медвежий сигнал (гл. 6).';
    }
    return 'Три чёрные свечи с падающими закрытиями: «у плохих новостей есть крылья» (гл. 6).';
  }
  if (p.includes('ВЗЛЕТЁВШИЕ ВОРОНЫ')) {
    return 'Две взлетевшие вороны: гэп вверх, две чёрные свечи — медвежий разворот на вершине (гл. 6).';
  }
  if (p.includes('БАШЕН')) {
    return 'Башня: длинные свечи до и после консолидации — резкая смена тренда (гл. 6).';
  }
  if (p.includes('ГОРЫ') || p.includes('БУДД')) {
    return 'Три безуспешных штурма уровня: тройная вершина — медвежий разворот (гл. 6).';
  }
  if (p.includes('РЕКИ')) {
    return 'Три теста минимумов: основание достигнуто после подъёма выше промежуточных пиков — бычий разворот (гл. 6).';
  }
  
  // Пятисвечные и более (гл. 7)
  if (p.includes('ТАСУКИ')) {
    return 'Тасуки: продолжение тренда после гэпа — передышка завершена (гл. 7).';
  }
  if (p.includes('ТАТАМИ') || p.includes('УДЕРЖАНИЕ')) {
    return 'Удержание на татами: длинная белая, затем малые свечи внутри её диапазона, завершающая белая — продолжение роста (гл. 6).';
  }
  if (p.includes('ТРИ МЕТОДА') || p.includes('СТУПЕН')) {
    return 'Три ступени: передышка внутри тренда — малые свечи внутри диапазона длинной, затем продолжение (гл. 7).';
  }
  if (p.includes('ГЭП СМЕЖНЫХ')) {
    return 'Гэп смежных белых свечей: две сходные бычьи свечи после гэпа вверх — продолжение роста (гл. 7).';
  }
  if (p.includes('ГЭП НА')) {
    return 'Гэп на максимумах/минимумах: консолидация прорвана гэпом — продолжение тренда (гл. 7).';
  }
  
  // Ослабленные формы (предупреждения)
  if (p.includes('ОТБИТОЕ НАСТУПЛЕНИЕ')) {
    return 'Отбитое наступление: три белые свечи с уменьшающимися телами — рост встречает сопротивление, предупреждение (гл. 7).';
  }
  if (p.includes('ТОРМОЖЕНИЕ')) {
    return 'Торможение: малое тело «едет на плече» длинной белой — истощение быков, предупреждение (гл. 7).';
  }
  
  // Спружинивания (гл. 11)
  if (p.includes('СПРУЖИНИВАНИЕ')) {
    if (p.includes('ВЕРХНЕЕ')) {
      return 'Верхнее спружинивание: ложный пробой вершины с возвратом внутрь диапазона — медвежий сигнал из зоны «ва» (гл. 11).';
    }
    return 'Ложный пробой минимума с возвратом внутрь диапазона: продавцы не удержали новые минимумы — бычий сигнал из зоны «ва» (гл. 11).';
  }
  
  // Контекстные модели
  if (p.includes('КЛЮЧЕВОЙ РАЗВОРОТ')) {
    return 'Ключевой разворотный день: длинная свеча на повышенном объёме закрылась за экстремум предыдущей у границы диапазона — базовый сигнал начала тренда, когда молот и поглощение не сформировались (гл. 4, 15).';
  }
  if (p.includes('ПРОРЫВ КОНСОЛИДАЦИИ')) {
    return 'Зона «ва» прорвана длинной свечой на повышенном объёме: после передышки инициатива перешла к прорвавшей стороне — сигнал продолжения в направлении прорыва (гл. 7).';
  }
  if (p.includes('ТЕСТ ПОДДЕРЖКИ') || p.includes('ТЕСТ СОПРОТИВЛЕНИЯ')) {
    return 'Тест уровня в тренде: свеча коснулась MA/зоны тенью и закрылась в пользу тренда — уровень защищён покупателями (продавцами); классическая точка входа по Нисону на откате (гл. 11, 13).';
  }
  if (p.includes('ДЛИННАЯ') && p.includes('ОТКАТЕ')) {
    return 'Длинная свеча на откате в тренде: после локального отката покупатели (продавцы) вернули инициативу одним сильным движением; вход по направлению тренда (гл. 4).';
  }
  if (p.includes('НАКОПЛЕНИЕ')) {
    return 'Накопление: малоподвижные цены + высокий объём у дна — крупные игроки скупают (гл. 2, 15).';
  }
  if (p.includes('РАСПРЕДЕЛЕНИЕ')) {
    return 'Распределение: малоподвижные цены + высокий объём у потолка — крупные игроки продают (гл. 2, 15).';
  }
  if (p.includes('ЛЕСТНИЧНОЕ')) {
    return 'Лестничное дно: три чёрные свечи со снижающимися закрытиями, затем чёрная с длинной верхней тенью и белая с закрытием выше — бычий разворот (гл. 6).';
  }
  
  return 'Модель предупреждает о вероятном завершении предыдущей тенденции; ждём подтверждения (гл. 4).';
}
