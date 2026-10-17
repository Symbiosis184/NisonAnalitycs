import { describe, it, expect } from 'vitest';
import { ema, sma, rsi, atr, pivotLevels, detectTrend } from '../../utils/indicators';

describe('ema', () => {
  it('значение EMA равно цене на константном ряду', () => {
    const out = ema(Array(30).fill(100), 20);
    expect(out[out.length - 1]).toBeCloseTo(100, 6);
  });

  it('EMA растёт на возрастающем ряду и отстаёт от цены', () => {
    const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
    const out = ema(rising, 20);
    expect(out[out.length - 1]).toBeLessThan(rising[rising.length - 1]);
    expect(out[out.length - 1]).toBeGreaterThan(out[10]);
  });

  it('пустой вход — пустой выход', () => {
    expect(ema([], 20)).toEqual([]);
  });
});

describe('sma', () => {
  it('среднее арифметическое окна', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    // последние значения скользящего среднего: 3, 4, 5
    expect(out[out.length - 1]).toBeCloseTo(4);
  });
});

describe('rsi', () => {
  it('только рост → RSI близок к 100', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = rsi(closes, 14);
    const last = out[out.length - 1];
    expect(last).toBeGreaterThan(90);
  });

  it('только падение → RSI близок к 0', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
    const out = rsi(closes, 14);
    expect(out[out.length - 1]).toBeLessThan(10);
  });

  it('значения в диапазоне [0, 100]', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + 5 * Math.sin(i / 3));
    const out = rsi(closes, 14);
    // Первые `period` значений — warm-up (NaN), остальные в диапазоне [0, 100]
    expect(out.slice(0, 14).every(Number.isNaN)).toBe(true);
    for (const v of out.slice(14)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('atr', () => {
  it('положительное конечное число на нормальном ряду', () => {
    const candles = Array.from({ length: 30 }, (_, i) => {
      const mid = 100 + Math.sin(i);
      return { time: i, open: mid, high: mid + 1, low: mid - 1, close: mid + 0.2, volume: 1 };
    }) as any;
    const a = atr(candles, 14);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
  });

  it('короткий ряд не роняет функцию', () => {
    const tiny = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }] as any;
    expect(() => atr(tiny, 14)).not.toThrow();
  });
});

describe('pivotLevels', () => {
  it('pivot между high/low, поддержки ниже, сопротивления выше', () => {
    const candles = Array.from({ length: 10 }, (_, i) => ({
      time: i, open: 100, high: 110, low: 90, close: 100, volume: 1,
    })) as any;
    const p = pivotLevels(candles);
    expect(p.pivot).toBeCloseTo((110 + 90 + 100) / 3);
    expect(p.s1).toBeLessThan(p.pivot);
    expect(p.r1).toBeGreaterThan(p.pivot);
    expect(p.s2).toBeLessThan(p.s1);
    expect(p.r2).toBeGreaterThan(p.r1);
  });
});

describe('detectTrend', () => {
  it('цена выше всех EMA — бычий, ниже — медвежий', () => {
    expect(detectTrend(120, 110, 105, 100)).toBe('бычий');
    expect(detectTrend(80, 90, 95, 100)).toBe('медвежий');
  });
});
