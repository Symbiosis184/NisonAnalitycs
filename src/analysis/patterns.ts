/**
 * Детекторы свечных паттернов Стива Нисона (методология не изменена — П.7 паспорта).
 * Каждый детектор возвращает индекс свечи подтверждения или -1.
 * Пороги relative body: small ≤ 0.3×среднего, big ≥ 1.5×среднего тел за окно lookback.
 */
import type { Candle } from './types';

export interface BodyInfo {
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  bullish: boolean;
  bearish: boolean;
}

export function body(c: Candle): BodyInfo {
  const range = c.high - c.low;
  const b = Math.abs(c.close - c.open);
  return {
    body: b,
    range,
    upperWick: c.high - Math.max(c.open, c.close),
    lowerWick: Math.min(c.open, c.close) - c.low,
    bullish: c.close > c.open,
    bearish: c.close < c.open,
  };
}

/** Среднее тело за `lookback` свечей, предшествующих индексу i (не включая i). */
export function avgBody(candles: Candle[], i: number, lookback = 10): number {
  const start = Math.max(0, i - lookback);
  let sum = 0;
  let n = 0;
  for (let j = start; j < i; j++) {
    sum += Math.abs(candles[j].close - candles[j].open);
    n++;
  }
  return n ? sum / n : 0;
}

export function isDoji(c: Candle, tol = 0.1): boolean {
  const bi = body(c);
  return bi.range > 0 && bi.body <= tol * bi.range;
}

/** Молот (Hammer): маленький верхний фитиль, длинный нижний ≥2×тела, на нисходящем тренде. */
export function detectHammer(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const c = candles[i];
  const bi = body(c);
  const prevDown = candles[i - 1].close < candles[i - 1].open;
  return (
    prevDown &&
    bi.range > 0 &&
    bi.lowerWick >= 2 * bi.body &&
    bi.upperWick <= 0.3 * bi.body + Number.EPSILON &&
    bi.body > 0
  );
}

/** Повешенный (Hanging Man): та же форма, но на восходящем тренде → медвежий. */
export function detectHangingMan(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const c = candles[i];
  const bi = body(c);
  const prevUp = candles[i - 1].close > candles[i - 1].open;
  return (
    prevUp &&
    bi.range > 0 &&
    bi.lowerWick >= 2 * bi.body &&
    bi.upperWick <= 0.3 * bi.body + Number.EPSILON &&
    bi.body > 0
  );
}

/** Бычье поглощение (Bullish Engulfing). */
export function detectBullishEngulfing(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const p = candles[i - 1];
  const c = candles[i];
  const pb = body(p);
  const cb = body(c);
  return (
    pb.bearish &&
    cb.bullish &&
    c.close > p.open &&
    c.open <= p.close &&
    cb.body > pb.body
  );
}

/** Медвежье поглощение (Bearish Engulfing). */
export function detectBearishEngulfing(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const p = candles[i - 1];
  const c = candles[i];
  const pb = body(p);
  const cb = body(c);
  return (
    pb.bullish &&
    cb.bearish &&
    c.open >= p.close &&
    c.close < p.open &&
    cb.body > pb.body
  );
}

/** Утренняя звезда (Morning Star): 3 свечи, нисход → doji/small → бык выше 50% первой. */
export function detectMorningStar(candles: Candle[], i: number): boolean {
  if (i < 2) return false;
  const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
  const ab = body(a);
  const bb = body(b);
  const cb = body(c);
  const midSmall = bb.body <= 0.4 * Math.max(ab.body, cb.body);
  return (
    ab.bearish &&
    cb.bullish &&
    midSmall &&
    b.high < a.close &&
    c.close > (a.open + a.close) / 2
  );
}

/** Вечерняя звезда (Evening Star) — зеркало. */
export function detectEveningStar(candles: Candle[], i: number): boolean {
  if (i < 2) return false;
  const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
  const ab = body(a);
  const bb = body(b);
  const cb = body(c);
  const midSmall = bb.body <= 0.4 * Math.max(ab.body, cb.body);
  return (
    ab.bullish &&
    cb.bearish &&
    midSmall &&
    b.low > a.close &&
    c.close < (a.open + a.close) / 2
  );
}

/** Харами бычий (Bullish Harami): вторая свеча целиком внутри тела первой. */
export function detectBullishHarami(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const p = candles[i - 1];
  const c = candles[i];
  const pb = body(p);
  const cb = body(c);
  return (
    pb.bearish &&
    cb.bullish &&
    c.open < p.close &&
    c.close > p.open &&
    cb.body < 0.5 * pb.body
  );
}

/** Харами медвежий. */
export function detectBearishHarami(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const p = candles[i - 1];
  const c = candles[i];
  const pb = body(p);
  const cb = body(c);
  return (
    pb.bullish &&
    cb.bearish &&
    c.open > p.close &&
    c.close < p.open &&
    cb.body < 0.5 * pb.body
  );
}

export interface PatternDef {
  name: string;
  side: 'long' | 'short';
  detect: (candles: Candle[], i: number) => boolean;
}

/** Реестр паттернов Нисона — используется и UI, и бэктест-движком. */
export const PATTERN_DEFS: PatternDef[] = [
  { name: 'Hammer', side: 'long', detect: detectHammer },
  { name: 'BullishEngulfing', side: 'long', detect: detectBullishEngulfing },
  { name: 'MorningStar', side: 'long', detect: detectMorningStar },
  { name: 'BullishHarami', side: 'long', detect: detectBullishHarami },
  { name: 'HangingMan', side: 'short', detect: detectHangingMan },
  { name: 'BearishEngulfing', side: 'short', detect: detectBearishEngulfing },
  { name: 'EveningStar', side: 'short', detect: detectEveningStar },
  { name: 'BearishHarami', side: 'short', detect: detectBearishHarami },
];

export interface DetectedPattern {
  name: string;
  side: 'long' | 'short';
  index: number;
}

/** Все срабатывания паттернов на истории (для бэктеста). */
export function scanPatterns(candles: Candle[]): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  for (let i = 1; i < candles.length; i++) {
    for (const def of PATTERN_DEFS) {
      if (def.detect(candles, i)) out.push({ name: def.name, side: def.side, index: i });
    }
  }
  return out;
}
