/**
 * Тесты ядра: индикаторы (канон EMA/RSI из 70e4ee2) и детекторы паттернов Нисона.
 */
import { describe, it, expect } from 'vitest';
import { atr, ema, rsi, sma, trueRange } from '../src/analysis/indicators';
import { detectBullishEngulfing, detectHammer, scanPatterns } from '../src/analysis/patterns';
import type { Candle } from '../src/analysis/types';

const c = (o: number, h: number, l: number, cl: number, time = 0): Candle => ({ time, open: o, high: h, low: l, close: cl, volume: 1 });

describe('indicators (канон)', () => {
  it('sma: warm-up NaN, затем скользящее среднее', () => {
    const s = sma([1, 2, 3, 4], 2);
    expect(Number.isNaN(s[0])).toBe(true);
    expect(s[1]).toBeCloseTo(1.5);
    expect(s[3]).toBeCloseTo(3.5);
  });

  it('EMA инициализируется SMA(period), а не первым значением (фикс 70e4ee2)', () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(Number.isNaN(e[1])).toBe(true);
    expect(e[2]).toBeCloseTo(2); // SMA(1,2,3)
    // шаг: k=0.5 → next = 0.5*4+0.5*2 = 3
    expect(e[3]).toBeCloseTo(3);
  });

  it('RSI warm-up: до period значений — NaN, экстремумы 100/близко к 0 (фикс 70e4ee2)', () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    const r = rsi(up, 14);
    expect(Number.isNaN(r[13])).toBe(true);
    expect(r[14]).toBeCloseTo(100); // только рост
    const down = Array.from({ length: 20 }, (_x, i) => 100 - i);
    expect(rsi(down, 14)[14]).toBeCloseTo(0);
  });

  it('ATR по Уайлдеру: TR первого бара = high-low относительно предка', () => {
    const candles = [c(10, 11, 9, 10), c(10, 12, 8, 11)];
    expect(trueRange(candles, 0)).toBeCloseTo(2);
    expect(trueRange(candles, 1)).toBeCloseTo(4); // max(4, |12-10|, |8-10|)
    const a = atr(Array.from({ length: 20 }, (_x, i) => c(10 + i * 0, 11, 9, 10)), 14);
    expect(Number.isNaN(a[13])).toBe(true);
    expect(a[14]).toBeGreaterThan(0);
  });
});

describe('patterns (методология Нисона не изменена)', () => {
  it('Hammer: длинная нижняя тень после нисходящей свечи', () => {
    const candles = [c(100, 100.5, 98, 99), c(99, 99.2, 94, 99.5)];
    expect(detectHammer(candles, 1)).toBe(true);
  });

  it('Bullish Engulfing: бык целиком поглощает медвежью свечу', () => {
    const candles = [c(100, 100.5, 97, 97.5), c(97, 102, 96.5, 101.5)];
    expect(detectBullishEngulfing(candles, 1)).toBe(true);
  });

  it('scanPatterns возвращает индекс подтверждения', () => {
    const candles = [c(100, 100.5, 98, 99), c(99, 99.2, 94, 99.5)];
    const found = scanPatterns(candles);
    expect(found.some((p) => p.name === 'Hammer' && p.index === 1 && p.side === 'long')).toBe(true);
  });

  it('пустая/короткая история не бросает', () => {
    expect(scanPatterns([])).toEqual([]);
    expect(scanPatterns([c(1, 2, 0.5, 1.5)])).toEqual([]);
  });
});
