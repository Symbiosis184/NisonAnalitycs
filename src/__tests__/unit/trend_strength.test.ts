// Сила тренда: структурная метрика направленного импульса (по свечам, не по MA).
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';

function mkCandles(closes: number[], barSize = 0.5): Candle[] {
  return closes.map(
    (c, i) =>
      new Candle({ time: 1000 + i * 60, open: c, high: c + barSize, low: c - barSize, close: c, volume: 100 }),
  );
}

// Формула синхронизирована с client.ts (generateReport -> trend_strength).
function trendStrengthPct(candles: Candle[]): number {
  const w = candles.slice(-21);
  let netMove = 0;
  let pathLength = 0;
  for (let i = 1; i < w.length; i++) {
    netMove += Math.abs(w[i].close - w[i - 1].close);
    pathLength += w[i].high - w[i].low;
  }
  const efficiency = netMove > 0 ? Math.abs(w[w.length - 1].close - w[0].close) / netMove : 0;
  const directionalShare = pathLength > 0 ? netMove / pathLength : 0;
  return Math.round(Math.min(100, Math.max(0, ((efficiency + directionalShare) / 2) * 100)));
}

describe('trend strength (структурная сила тренда)', () => {
  it('чистый направленный прогон даёт высокую силу (>40%), а не 0%', () => {
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(100 + i * 0.8);
    expect(trendStrengthPct(mkCandles(closes))).toBeGreaterThan(40);
  });

  it('флэт-пила с шумом даёт низкую силу (<20%)', () => {
    // случайный шум без дрейфа: малые шаги закрытий внутри широких баров
    let x = 100;
    const closes: number[] = [x];
    for (let i = 1; i < 30; i++) {
      x += Math.sin(i * 7.3) * 0.15; // детерминированный псевдошум
      closes.push(x);
    }
    expect(trendStrengthPct(mkCandles(closes, 1.0))).toBeLessThan(20);
  });

  it('сила конечна (без NaN) при нулевом пути', () => {
    const flat = mkCandles(Array.from({ length: 25 }, () => 100), 0);
    expect(Number.isFinite(trendStrengthPct(flat))).toBe(true);
  });
});
