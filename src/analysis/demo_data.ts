/**
 * Детерминированные демо-данные для предпросмотра (LCG-конгруэнтный генератор, seed фиксирован).
 * Используется preview-скриптом; в проде заменяется реальными klines Bybit.
 */
import type { Candle } from './types';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Генерирует `n` свечей с трендами и шумом, старт ~ basePrice. */
export function makeDemoCandles(n = 400, basePrice = 45000, seed = 7): Candle[] {
  const rnd = lcg(seed);
  const out: Candle[] = [];
  let price = basePrice;
  let drift = 0;
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.05) drift = (rnd() - 0.5) * 0.008; // смена режима тренда
    const open = price;
    const ret = drift + (rnd() - 0.5) * 0.012;
    const close = open * (1 + ret);
    const high = Math.max(open, close) * (1 + rnd() * 0.004);
    const low = Math.min(open, close) * (1 - rnd() * 0.004);
    out.push({
      time: t0 + i * 3_600_000,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: round2(50 + rnd() * 500),
    });
    price = close;
  }
  return out;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
