import { Candle } from './candle';
import { ema, rsi } from './indicators';
import { detectPatterns } from './patterns';

export type TrendContext = 'ВОСХОДЯЩИЙ' | 'НИСХОДЯЩИЙ' | 'БОКОВИК';

// Структурный тренд по канону Нисона (гл. 13): направление определяется
// последовательностью свингов — Higher High/Higher Low (бычий) или
// Lower High/Lower Low (медвежий), а не расположением цены относительно MA.
export function getSwingTrend(candles: Candle[], k: number = 3): TrendContext {
  if (candles.length < 2 * k + 3) return 'БОКОВИК';

  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }

  // Нужно минимум два подтверждённых экстремума каждого типа
  if (highs.length < 2 || lows.length < 2) return 'БОКОВИК';

  const hhPrev = highs[highs.length - 2];
  const hhLast = highs[highs.length - 1];
  const hlPrev = lows[lows.length - 2];
  const hlLast = lows[lows.length - 1];

  if (hhLast > hhPrev && hlLast > hlPrev) return 'ВОСХОДЯЩИЙ';
  if (hhLast < hhPrev && hlLast < hlPrev) return 'НИСХОДЯЩИЙ';
  return 'БОКОВИК';
}

// Строгий боковик: цена внутри диапазона последних lookback баров и MA65
// горизонтальна (наклон за последние ~10 баров меньше порога). Нисон: в
// flat-рынке направление не определяется — торговать продолжение нельзя.
function isFlatMarket(candles: Candle[]): boolean {
  if (candles.length < 40) return false;
  const closes = candles.map(c => c.close);
  const win = closes.slice(-Math.min(60, closes.length));
  const hi = Math.max(...win);
  const lo = Math.min(...win);
  const mid = (hi + lo) / 2;
  if (mid <= 0) return false;
  const rangePct = (hi - lo) / mid;
  if (rangePct > 0.08) return false; // широкий диапазон — не флэт

  const ma65 = ema(closes, Math.min(65, closes.length - 1));
  const lastMa = ma65[ma65.length - 1];
  const prevMa = ma65[Math.max(0, ma65.length - 11)];
  const slopePct = lastMa > 0 ? Math.abs((lastMa - prevMa) / lastMa) : 1;
  return slopePct < 0.005; // MA65 горизонтальна
}

// Контекст тренда: структура свингов (первична по Нисону) с MA-подтверждением.
// Свечи опережают индикаторы, поэтому расхождение со скользящими трактуется
// как ранний признак нового тренда, а не шум; БОКОВИК — при отсутствии обоих.
// В явном флэте (узкий диапазон + горизонтальная MA65) MA-фильтр отключается:
// он даёт случайное направление там, где направления нет.
export function getTrendContext(candles: Candle[]): TrendContext {
  const swing = getSwingTrend(candles, 3);

  if (candles.length < 20) return swing;

  if (isFlatMarket(candles)) return 'БОКОВИК';

  const closes = candles.map(c => c.close);
  const e10 = ema(closes, 10);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, Math.min(50, closes.length - 1));
  const last = candles[candles.length - 1];
  const v10 = e10[e10.length - 1];
  const v20 = e20[e20.length - 1];
  const v50 = e50[e50.length - 1];

  let ma: TrendContext = 'БОКОВИК';
  if (last.close > v10 && v10 > v20 && v20 > v50) ma = 'ВОСХОДЯЩИЙ';
  else if (last.close < v10 && v10 < v20 && v20 < v50) ma = 'НИСХОДЯЩИЙ';

  if (swing !== 'БОКОВИК') return swing; // структура первична (свечи опережают MA)
  return ma; // нет структуры — лагающий, но подтверждённый контекст MA
}

export function getTrendMacro(candles: Candle[], price: number): TrendContext {
  if (candles.length < 40) return 'БОКОВИК';

  // Первичен структурный признак (свинги HH/HL или LH/LL)
  const swing = getSwingTrend(candles, 4);
  if (swing !== 'БОКОВИК') return swing;

  // Явный флэт: узкий диапазон + горизонтальная MA65 -> БОКОВИК без голоса.
  if (isFlatMarket(candles)) return 'БОКОВИК';

  // Нет выраженной структуры — смотрим на MA65 как на вторичный лагающий фильтр
  const closes = candles.map(c => c.close);
  const ma65 = ema(closes, Math.min(65, closes.length - 1));
  const ma65Val = ma65[ma65.length - 1];

  if (price > ma65Val) {
    return 'ВОСХОДЯЩИЙ';
  } else if (price < ma65Val) {
    return 'НИСХОДЯЩИЙ';
  }

  return 'БОКОВИК';
}

export function detectTrendStart(candles: Candle[], price: number): {
  detected: boolean;
  trend: 'ВОСХОДЯЩИЙ' | 'НИСХОДЯЩИЙ' | null;
  reasons: string[];
  confidence: number;
} {
  if (candles.length < 40) {
    return { detected: false, trend: null, reasons: [], confidence: 0 };
  }
  
  const bull: string[] = [];
  const bear: string[] = [];
  const closes = candles.map(c => c.close);

  // 1) Свечной разворотный сигнал (Нисон гл. 4–6): подтверждаем свежей
  // ЗАКРЫТЫЕ разворотные формации последних 5 баров (а не подменяем их MA).
  const recentPatterns = detectPatterns(candles);
  const freshIdx = candles.length - 5;
  const freshBullish = recentPatterns.some(p => p.confirmed && p.type === 'бычий' && p.candleIndex >= freshIdx);
  const freshBearish = recentPatterns.some(p => p.confirmed && p.type === 'медвежий' && p.candleIndex >= freshIdx);
  if (freshBullish) bull.push('подтверждённая бычья разворотная формация (гл. 4–6)');
  if (freshBearish) bear.push('подтверждённая медвежья разворотная формация (гл. 4–6)');

  // 2) Пробой уровня на объёме
  const avgVolume = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const lastVolume = candles[candles.length - 1].volume;
  
  if (lastVolume > avgVolume * 1.5) {
    const lastCandle = candles[candles.length - 1];
    const prevHigh = Math.max(...candles.slice(-10, -1).map(c => c.high));
    const prevLow = Math.min(...candles.slice(-10, -1).map(c => c.low));
    
    if (lastCandle.close > prevHigh) {
      bull.push(`пробой сопротивления ${prevHigh.toFixed(2)} на объёме (гл. 7, 15)`);
    } else if (lastCandle.close < prevLow) {
      bear.push(`пробой поддержки ${prevLow.toFixed(2)} на объёме (гл. 7, 15)`);
    }
  }
  
  // 3) Полярность уровней
  const levels = findLevels(candles);
  const lastClose = candles[candles.length - 1].close;
  
  for (const r of levels.resistance) {
    if (lastClose > r && candles.slice(-3).every(c => c.close > r * 0.995)) {
      bull.push('полярность: пробитый уровень стал поддержкой (гл. 11)');
      break;
    }
  }
  
  for (const s of levels.support) {
    if (lastClose < s && candles.slice(-3).every(c => c.close < s * 1.005)) {
      bear.push('полярность: пробитый уровень стал сопротивлением (гл. 11)');
      break;
    }
  }
  
  // 4) Окна (гэпы)
  for (let i = candles.length - 15; i < candles.length - 1; i++) {
    const prev = candles[i];
    const curr = candles[i + 1];
    
    if (curr.low > prev.high && price > (prev.high + curr.low) / 2) {
      bull.push('окно вверх открыто и не закрыто (гл. 7)');
      break;
    }
    if (curr.high < prev.low && price < (prev.low + curr.high) / 2) {
      bear.push('окно вниз открыто и не закрыто (гл. 7)');
      break;
    }
  }
  
  // 5) MA65 и пересечения (по канону Нисона: MA10 пересекает MA65; сигнал —
  //    ФАКТ пересечения за последние бары, а не «линия выше линии», которая
  //    срабатывала на всём протяжении уже существующего тренда).
  const MA_CROSS_WINDOW = 8; // окно поиска факта пересечения (в барах)
  const ma65 = ema(closes, Math.min(65, closes.length - 1));
  const ma65Val = ma65[ma65.length - 1];
  const ma65Prev = ma65[ma65.length - 6];

  if (price > ma65Val && ma65Val > ma65Prev && candles.slice(-12, -1).some(c => c.close <= ma65Val)) {
    bull.push('цена выше MA65, средняя развернулась вверх (гл. 13)');
  }
  if (price < ma65Val && ma65Val < ma65Prev && candles.slice(-12, -1).some(c => c.close >= ma65Val)) {
    bear.push('цена ниже MA65, средняя развернулась вниз (гл. 13)');
  }

  const ma10 = ema(closes, 10);
  const ma10Val = ma10[ma10.length - 1];

  // Факт пересечения MA10 через MA65: знак разности сменился в последнем окне.
  let goldenCross = false;
  let deathCross = false;
  for (let i = Math.max(1, ma10.length - 1 - MA_CROSS_WINDOW); i < ma10.length; i++) {
    const diffPrev = ma10[i - 1] - ma65[i - 1];
    const diffNow = ma10[i] - ma65[i];
    if (diffPrev <= 0 && diffNow > 0) goldenCross = true;
    if (diffPrev >= 0 && diffNow < 0) deathCross = true;
  }

  if (goldenCross && ma10Val > ma65Val) {
    bull.push('золотой крест MA10/MA65 — свежее пересечение (гл. 13)');
  }
  if (deathCross && ma10Val < ma65Val) {
    bear.push('мёртвый крест MA10/MA65 — свежее пересечение (гл. 13)');
  }
  
  // 6) Дивергенция RSI
  const rsiCloses = candles.map(c => c.close);
  const rsiValues = rsi(rsiCloses, 14);
  const recent = candles.slice(-20);
  const prev = candles.slice(-40, -20);
  
  const recentHigh = Math.max(...recent.map(c => c.high));
  const prevHigh = Math.max(...prev.map(c => c.high));
  const recentLow = Math.min(...recent.map(c => c.low));
  const prevLow = Math.min(...prev.map(c => c.low));
  
  const recentRsi = rsiValues.slice(-20);
  const prevRsi = rsiValues.slice(-40, -20);
  const recentRsiVal = recentRsi[recentRsi.length - 1];
  const prevRsiVal = prevRsi[prevRsi.length - 1];
  
  if (recentHigh > prevHigh && recentRsiVal < prevRsiVal - 5) {
    bear.push('медвежья дивергенция у перекупленности (гл. 14)');
  }
  if (recentLow < prevLow && recentRsiVal > prevRsiVal + 5) {
    bull.push('бычья дивергенция у перепроданности (гл. 14)');
  }
  
  // 7) Рост объёма
  const recentVolume = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
  const prevVolume = candles.slice(-10, -5).reduce((s, c) => s + c.volume, 0) / 5;
  const oiRatio = prevVolume > 0 ? recentVolume / prevVolume : 1;
  const chg = candles[candles.length - 1].close - candles[candles.length - 5].close;
  
  if (oiRatio > 1.05 && chg > 0) {
    bull.push('объём растёт вместе с ценой (гл. 15)');
  }
  if (oiRatio > 1.05 && chg < 0) {
    bear.push('объём растёт при падении цены (гл. 15)');
  }
  
  // 8) Спружинивание
  const supOld = Math.min(...candles.slice(-25, -5).map(c => c.low));
  const resOld = Math.max(...candles.slice(-25, -5).map(c => c.high));
  
  if (candles.slice(-5).some(c => c.low < supOld) && candles[candles.length - 1].close > supOld) {
    bull.push('нижнее спружинивание: ложный пробой и возврат (гл. 11)');
  }
  if (candles.slice(-5).some(c => c.high > resOld) && candles[candles.length - 1].close < resOld) {
    bear.push('верхнее спружинивание: ложный пробой и возврат (гл. 11)');
  }
  
  const TREND_START_MIN_VOTES = 3;
  
  if (bull.length >= TREND_START_MIN_VOTES && bull.length > bear.length) {
    const confidence = Math.min(100, (bull.length / 8) * 100);
    return { detected: true, trend: 'ВОСХОДЯЩИЙ', reasons: bull, confidence };
  }
  if (bear.length >= TREND_START_MIN_VOTES && bear.length > bull.length) {
    const confidence = Math.min(100, (bear.length / 8) * 100);
    return { detected: true, trend: 'НИСХОДЯЩИЙ', reasons: bear, confidence };
  }
  
  return { detected: false, trend: null, reasons: [], confidence: 0 };
}

// ============================================================
// Каскад таймфреймов (по книгам Стива Нисона)
// ============================================================
// «Торгуй в направлении тренда» для Нисона означает тренд СТАРШЕГО ТФ:
// старший интервал задаёт направление (context), младший даёт точку входа.
// Поэтому контекст определяется не одним ТФ, а каскадом всех доступных
// интервалов — от старшего к младшему:
//   • голос самого старшего ТФ с выраженной структурой (не БОКОВИК) — решающий;
//   • БОКОВИК на старших ТФ не блокирует сигнал с младших, но помечает его
//     как неподтверждённый (higherConfirmed = false);
//   • если все ТФ в боковике — рынок без направления, торговать продолжение
//     нельзя (только развороты у границ диапазона).
export interface TimeframeTrendVote {
  timeframe: string;
  trend: TrendContext;
}

export interface TrendCascadeResult {
  /** Итоговый контекст каскада: направление со старшего значимого ТФ */
  context: TrendContext;
  /** Есть ли подтверждение на ТФ старше того, что дал направление */
  higherConfirmed: boolean;
  /** Голоса по каждому ТФ (от старшего к младшему) */
  votes: TimeframeTrendVote[];
  /** ТФ, чья структура определила контекст (null — все в боковике) */
  decidedByTimeframe: string | null;
}

/**
 * Определение тренда по каскаду ТФ. Входы идут ОТ СТАРШЕГО к МЛАДШЕМУ
 * (например: [['W', wCandles], ['D', dCandles], ['4H', h4], ['1H', h1]]).
 * Первый же старший ТФ с выраженной структурой (HH/HL или LH/LL) задаёт
 * направление; MA65-фильтр применяется только если структура молчит.
 */
export function getTrendCascade(
  entries: Array<[string, Candle[]]>,
): TrendCascadeResult {
  const votes: TimeframeTrendVote[] = [];

  for (const [tf, candles] of entries) {
    if (!candles || candles.length < 40) {
      votes.push({ timeframe: tf, trend: 'БОКОВИК' });
      continue;
    }
    // Структура первична (гл. 13); price передаём через getTrendMacro internally.
    const t = getTrendMacro(candles, candles[candles.length - 1].close);
    votes.push({ timeframe: tf, trend: t });
  }

  const decisiveIdx = votes.findIndex(v => v.trend !== 'БОКОВИК');
  if (decisiveIdx === -1) {
    return { context: 'БОКОВИК', higherConfirmed: false, votes, decidedByTimeframe: null };
  }

  const decisive = votes[decisiveIdx];
  // Подтверждение «сверху»: любой ТФ СТАРШЕ решающего согласен с направлением.
  const higherConfirmed = votes
    .slice(0, decisiveIdx)
    .some(v => v.trend === decisive.trend);

  return {
    context: decisive.trend,
    higherConfirmed,
    votes,
    decidedByTimeframe: decisive.timeframe,
  };
}

function findLevels(candles: Candle[], lookback: number = 50) {
  const recent = candles.slice(-lookback);
  const support: number[] = [];
  const resistance: number[] = [];
  
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];
    
    if (c.low < recent[i - 1].low && c.low < recent[i - 2].low &&
        c.low < recent[i + 1].low && c.low < recent[i + 2].low) {
      support.push(c.low);
    }
    
    if (c.high > recent[i - 1].high && c.high > recent[i - 2].high &&
        c.high > recent[i + 1].high && c.high > recent[i + 2].high) {
      resistance.push(c.high);
    }
  }
  
  return { support, resistance };
}
