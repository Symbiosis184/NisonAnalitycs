// Регрессии методологического аудита по канону Стива Нисона (P0/P1).
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';
import { nearestStructuralTarget } from '../../utils/nison_targets';

/** Восходящий зигзаг (аналог zigUp из nison_trend_filter.test.ts): HH/HL структура. */
const zigUp = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    if (phase < 4) cl += step; else cl -= step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

/** Нисходящий зигзаг (аналог zigDown): LH/LL структура. */
const zigDown = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    if (phase < 4) cl -= step; else cl += step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

const c = (o: number, h: number, l: number, cl: number): Candle =>
  new Candle({ time: 9999, open: o, high: h, low: l, close: cl, volume: 100 });

describe('P0-1: повешенный (ЯС гл. «Молот и повешенный»), тело вверху диапазона', () => {
  // Малое тело ВВЕРХУ диапазона, нижняя тень >= 2 тел — форма молота/повешенного.
  const hm = c(158, 160, 150, 159);

  it('после подтверждённого роста детектируется (found === true)', () => {
    const prev = zigUp(80, 100, 0.6); // ~+10% за окно SMA65 — тренд вверх
    const res = PatternDetector.isHangingMan(hm, prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('ПОВЕШЕННЫЙ');
  });

  it('та же свеча после спада НЕ детектируется (контекст решает)', () => {
    const prev = zigDown(80, 200, 0.6);
    expect(PatternDetector.isHangingMan(hm, prev).found).toBe(false);
  });
});

describe('P0-2: «ниже шеи» / «на шее» (ЯС гл. 4, «Другие модели разворота»)', () => {
  const prev = zigDown(80, 200, 0.6); // подтверждённый спад — контекст модели
  // Медвежья свеча: тело 100→90, low 89 (шея = район минимума/закрытия).
  // Тело 12 > 0.6*диапазона (14) — требуется гейтом isLongCandle модели.
  const black = c(102, 103.5, 88.5, 90);

  it('закрытие белой ВБЛИЗИ МИНИМУМА чёрной → НИЖЕ ШЕИ', () => {
    const white = c(88.2, 89.5, 88.0, 89.1); // close≈low чёрной (tol=0.75)
    const res = PatternDetector.isNeckFamily(black, white, prev);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НИЖЕ ШЕИ');
  });

  it('закрытие белой ЧУТЬ ВЫШЕ ЗАКРЫТИЯ чёрной → НА ШЕЕ', () => {
    const white = c(88.2, 90.9, 88.0, 90.4); // close чуть выше закрытия чёрной: [89.25, 91.5]
    const res = PatternDetector.isNeckFamily(black, white, prev);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НА ШЕЕ');
  });
});
