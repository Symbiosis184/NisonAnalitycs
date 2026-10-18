import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { runWalkForward } from '../../utils/walkforward';
import type { FormationBounds } from '../../utils/backtest';

// Синтетика: каждые 40 свечей — детектируемый «паттерн» с фиксированными границами.
function mkCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += i % 3 === 0 ? 0.5 : -0.2; // лёгкий дрейф вверх
    out.push(new Candle({ time: i, open: price, high: price * 1.01, low: price * 0.99, close: price, volume: 100 }));
  }
  return out;
}

const detect = (_hist: Candle[], idx: number): FormationBounds | null =>
  idx % 40 === 0 && idx > 0 ? { patternLow: _hist[idx].low, patternHigh: _hist[idx].high } : null;

describe('walkforward', () => {
  it('режет историю на окна train/test без пересечений test-зон', () => {
    const candles = mkCandles(1000);
    const wf = runWalkForward(candles, { detect, direction: 'long' }, { trainBars: 300, testBars: 100, warmup: 60 });
    expect(wf.windows.length).toBeGreaterThan(1);
    for (let k = 1; k < wf.windows.length; k++) {
      expect(wf.windows[k].testStart).toBeGreaterThanOrEqual(wf.windows[k - 1].testEnd);
    }
  });

  it('OOS-сделки — подмножество всех сделок, IS+OOS покрывают сделанные entry', () => {
    const candles = mkCandles(1000);
    const wf = runWalkForward(candles, { detect, direction: 'long' }, { trainBars: 300, testBars: 100, warmup: 60 });
    const oosIdx = new Set(wf.oosTrades.map((t) => t.entryIndex));
    for (const t of wf.oosTrades) expect(oosIdx.has(t.entryIndex)).toBe(true);
    // каждая OOS-сделка лежит внутри какого-то test-окна
    for (const t of wf.oosTrades) {
      expect(wf.windows.some((w) => t.entryIndex >= w.testStart && t.entryIndex < w.testEnd)).toBe(true);
    }
  });

  it('короткая история (<train+test+warmup) — пустые окна и null- expectancy', () => {
    const wf = runWalkForward(mkCandles(200), { detect, direction: 'long' }, { trainBars: 300, testBars: 100, warmup: 60 });
    expect(wf.windows).toHaveLength(0);
    expect(wf.oosExpectancy).toBeNull();
    expect(wf.overfitSuspected).toBe(false);
  });

  it('нет сигналов → no trades, но структура результата валидна', () => {
    const wf = runWalkForward(mkCandles(900), { detect: () => null, direction: 'long' }, {});
    expect(wf.oosTrades).toHaveLength(0);
    expect(wf.isExpectancy).toBeNull();
    expect(wf.oosExpectancy).toBeNull();
  });
});
