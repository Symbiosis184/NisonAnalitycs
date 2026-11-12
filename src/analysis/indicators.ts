/**
 * Технический индикаторный слой NisonAnalytics.
 * EMA/RSI инициализированы по канону (исправления из коммита 70e4ee2):
 *  - EMA: первое значение SMA(period), далее рекурсия;
 *  - RSI: Уайлдерово сглаживание после начального среднего по первым period изменениям.
 */
import type { Candle } from './types';

/** SMA первого окна; NaN пока окно не заполнено. */
export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA: warm-up SMA(period), затем s = k*x + (1-k)*s_prev. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = k * values[i] + (1 - k) * prev;
    out[i] = prev;
  }
  return out;
}

/** True Range свечи i (по предку i-1); для i=0 — high-low. */
export function trueRange(candles: Candle[], i: number): number {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const p = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
}

/** ATR по Уайлдеру (RMA TR). */
export function atr(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRange(candles, i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + trueRange(candles, i)) / period;
    out[i] = prev;
  }
  return out;
}

/** RSI Уайлдера: начальное среднее gain/loss по первым period изменениям, затем сглаживание. */
export function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function lastFinite(arr: number[]): number | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return undefined;
}
