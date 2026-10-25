// Фазовый анализ рынка по Вайкоффу (запрос пользователя: «контекст рынка»).
//
// Методология Р. Вайкоффа: рынок циклически проходит четыре фазы —
//   accumulation  — накопление: цена волатильна, но удерживается в горизонтальном
//                   диапазоне после нисходящего движения; объём на lows расширяется;
//   markup        — рост: цена последовательно обновляет максимумы диапазона;
//   distribution  — распределение: диапазон после восходящего движения, объём на
//                   highs расширяется, цена не может закрепиться выше вершин;
//   markdown      — падение: цена последовательно обновляет минимумы диапазона.
//
// Здесь фаза определяется детерминированно и без lookahead: только по закрытым
// свечам, доступным на момент анализа. Дополнительно оценивается позиция цены
// внутри диапазона (POC-нормированная), ширина диапазона в ATR и объёмный перекос
// (relative volume на верхних/нижних половинах диапазона — прокси «effort vs result»).
//
// Модуль дополняет regime.ts (тренд/флэт/волатильность), давая более глубокий
// контекст: в какой фазе цикла находится инструмент и насколько сигналу «место».

import type { Candle } from './candle';

export type WyckoffPhase = 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'transition';

export interface PhaseInfo {
  phase: WyckoffPhase;
  /** Уверенность классификации 0..1 */
  confidence: number;
  /** Нижняя граница последнего выраженного диапазона */
  rangeLow: number;
  /** Верхняя граница последнего выраженного диапазона */
  rangeHigh: number;
  /** Позиция текущей цены в диапазоне: 0 = у низа, 1 = у верха */
  positionInRange: number;
  /** Ширина диапазона в единицах ATR (значимость консолидации) */
  rangeWidthAtr: number;
  /** Отношение среднего объёма на верхних половинах свечей к объёму на нижних (>1 — перекос вверх) */
  volSkewHighLow: number;
  /** Человекочитаемое описание для UI */
  description: string;
}

const PHASE_LABELS_RU: Record<WyckoffPhase, string> = {
  accumulation: 'Накопление (Вайкофф): диапазон после падения, объём тяготеет к низам — крупные игроки набирают позицию',
  markup: 'Рост (markup): цена обновила вершину диапазона — фаза восходящего движения',
  distribution: 'Распределение (Вайкофф): диапазон после роста, объём тяготеет к верхам — позиция передаётся рынку',
  markdown: 'Падение (markdown): цена пробила основание диапазона — фаза нисходящего движения',
  transition: 'Переход: явной фазы цикла не определено',
};

/** Wilder ATR (последнее значение) — локально, чтобы не зависеть от порядка инициализации. */
function atrWilder(candles: Candle[], period = 14): number {
  if (candles.length <= period) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    atr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

/** SMA последних n значений массива чисел. */
function tailMean(values: number[], n: number): number {
  const s = values.slice(-n);
  if (s.length === 0) return 0;
  return s.reduce((a, b) => a + b, 0) / s.length;
}

/**
 * Объёмный перекос «верх/низ» диапазона (прокси effort vs result):
 * для каждой свечи берётся относительная позиция close в её собственном диапазоне;
 * свечи выше середины своего тела-диапазона считаются «верхними».
 * Возвращает отношение среднего объёма верхних свечей к среднему объёму нижних.
 */
function volumeSkew(candles: Candle[]): number {
  let hiVol = 0, loVol = 0, hiN = 0, loN = 0;
  for (const c of candles) {
    const range = c.high - c.low;
    const rel = range > 0 ? (c.close - c.low) / range : 0.5;
    if (rel >= 0.6) { hiVol += c.volume; hiN++; }
    else if (rel <= 0.4) { loVol += c.volume; loN++; }
  }
  const hiAvg = hiN > 0 ? hiVol / hiN : 0;
  const loAvg = loN > 0 ? loVol / loN : 0;
  if (loAvg > 0 && hiAvg > 0) return hiAvg / loAvg;
  if (hiAvg > 0) return 1.2; // односторонние данные — лёгкий перекос в их сторону
  return 1;
}

/**
 * Определение фазы Вайкоффа по последним `lookback` свечам.
 * Логика:
 *  1) строится ценовой канал диапазона из экстремумов окна;
 *  2) тренд «до» канала задаёт контекст (после падения → accumulation, после роста → distribution);
 *  3) пробой границы канала с закреплением (2 последние свечи вне) → markup/markdown;
 *  4) объёмный перекос уточняет классификацию консолидации.
 */
export function detectPhase(candles: Candle[], lookback = 90): PhaseInfo {
  const data = candles.slice(-Math.max(30, lookback));
  const fallback: PhaseInfo = {
    phase: 'transition', confidence: 0,
    rangeLow: 0, rangeHigh: 0, positionInRange: 0.5,
    rangeWidthAtr: 0, volSkewHighLow: 1,
    description: PHASE_LABELS_RU.transition,
  };
  if (data.length < 30) return fallback;

  const closes = data.map((c) => c.close);
  const price = closes[closes.length - 1];

  // Диапазон: экстремумы первых 70% окна (последние 30% — зона подтверждения пробоя)
  const rangeEnd = Math.floor(data.length * 0.7);
  const rangeCandles = data.slice(0, rangeEnd);
  const confirmCandles = data.slice(rangeEnd);
  const rangeLow = Math.min(...rangeCandles.map((c) => c.low));
  const rangeHigh = Math.max(...rangeCandles.map((c) => c.high));
  const rangeWidth = Math.max(rangeHigh - rangeLow, 1e-9);
  const atr = atrWilder(data, 14) || rangeWidth / 10;
  const rangeWidthAtr = rangeWidth / Math.max(atr, 1e-9);
  const positionInRange = Math.min(1, Math.max(0, (price - rangeLow) / rangeWidth));

  // Контекст ДО канала: движение на предшествующем участке истории
  const preStart = Math.max(0, candles.length - data.length - 40);
  const preSlice = candles.slice(preStart, candles.length - data.length);
  let priorDirection: 'up' | 'down' | 'flat' = 'flat';
  if (preSlice.length >= 10) {
    const first = tailMean(preSlice.slice(0, 5).map((c) => c.close), 5);
    const last = tailMean(preSlice.slice(-5).map((c) => c.close), 5);
    const chg = (last - first) / first;
    if (chg > 0.03) priorDirection = 'up';
    else if (chg < -0.03) priorDirection = 'down';
  }

  // Закрепление за границами канала (пробой vs ложный пробой)
  const lastTwo = confirmCandles.slice(-2);
  const brokeUp = lastTwo.length >= 2 && lastTwo.every((c) => c.close > rangeHigh);
  const brokeDown = lastTwo.length >= 2 && lastTwo.every((c) => c.close < rangeLow);

  const skew = volumeSkew(data);
  const inRange = !brokeUp && !brokeDown;

  let phase: WyckoffPhase;
  let confidence: number;
  if (brokeUp) {
    phase = 'markup';
    // сила подтверждения: чем больше свечей закрываются выше вершины, тем увереннее
    const above = confirmCandles.filter((c) => c.close > rangeHigh).length;
    confidence = Math.min(1, 0.55 + 0.15 * above + (skew >= 1.1 ? 0.1 : 0));
  } else if (brokeDown) {
    phase = 'markdown';
    const below = confirmCandles.filter((c) => c.close < rangeLow).length;
    confidence = Math.min(1, 0.55 + 0.15 * below + (skew <= 0.9 ? 0.1 : 0));
  } else if (inRange && rangeWidthAtr >= 4 && rangeWidthAtr <= 20) {
    // консолидация: накопление/распределение по предшествующему тренду + объёмному перекосу
    if (priorDirection === 'down') {
      phase = 'accumulation';
      confidence = Math.min(1, 0.5 + (skew <= 0.9 ? 0.2 : 0) + (positionInRange <= 0.5 ? 0.15 : 0));
    } else if (priorDirection === 'up') {
      phase = 'distribution';
      confidence = Math.min(1, 0.5 + (skew >= 1.1 ? 0.2 : 0) + (positionInRange >= 0.5 ? 0.15 : 0));
    } else {
      phase = 'transition';
      confidence = 0.35;
    }
  } else {
    phase = 'transition';
    confidence = 0.3;
  }

  return {
    phase,
    confidence: Math.round(confidence * 100) / 100,
    rangeLow,
    rangeHigh,
    positionInRange: Math.round(positionInRange * 100) / 100,
    rangeWidthAtr: Math.round(rangeWidthAtr * 100) / 100,
    volSkewHighLow: Math.round(skew * 100) / 100,
    description: PHASE_LABELS_RU[phase],
  };
}

/**
 * Множитель доверия к сигналу в зависимости от фазы и направления сделки.
 *
 * ВАЖНО (аудит совместимости с методом Стива Нисона): фаза по умолчанию НЕ
 * влияет на качество сигнала (нейтральна, 1.0). В каноне Нисона решение
 * принимает паттерн + объём + уровень S/R, а не «ярлык» фазы цикла.
 * Корректировка включается только при УВЕРЕННОЙ классификации фазы
 * (confidence >= 0.55) и ограничена ±10% — чтобы контекст мог лишь слегка
 * подсвечивать/ослаблять сигнал, но не переопределять его суть.
 * При низкой уверенности или фазе «переход» множитель строго 1.0 —
 * анализ остаётся чисто нисоновским.
 */
export const PHASE_CONFIDENCE_THRESHOLD = 0.55;

export function phaseMultiplier(direction: 'long' | 'short', info: PhaseInfo): number {
  // Низкая уверенность классификации → фаза не имеет права искажать сигнал.
  if (info.confidence < PHASE_CONFIDENCE_THRESHOLD) return 1.0;
  let m: number;
  switch (info.phase) {
    case 'markup':
      m = direction === 'long' ? 1.1 : 0.9;
      break;
    case 'markdown':
      m = direction === 'short' ? 1.1 : 0.9;
      break;
    case 'accumulation':
      // разворотные лонги у низа диапазона — «по месту»; шорт против цикла — лёгкий штраф
      m = direction === 'long' ? (info.positionInRange <= 0.35 ? 1.1 : 1.0) : 0.9;
      break;
    case 'distribution':
      m = direction === 'short' ? (info.positionInRange >= 0.65 ? 1.1 : 1.0) : 0.9;
      break;
    default:
      m = 1.0;
  }
  // Полупропорционально уверенности: conf=0.55 → ~±5%, conf=1 → ±10%.
  const w = Math.min(1, (info.confidence - PHASE_CONFIDENCE_THRESHOLD) / (1 - PHASE_CONFIDENCE_THRESHOLD));
  return Math.round((1 + (m - 1) * w) * 100) / 100;
}

/** Человекочитаемая метка фазы для бейджа в UI (эмодзи убраны — иконки рисует слой UI). */
export function phaseLabel(info: PhaseInfo): string {
  const labels: Record<WyckoffPhase, string> = {
    accumulation: 'Накопление',
    markup: 'Рост',
    distribution: 'Распределение',
    markdown: 'Падение',
    transition: 'Переход',
  };
  return `${labels[info.phase]} · ${(info.confidence * 100).toFixed(0)}%`;
}
