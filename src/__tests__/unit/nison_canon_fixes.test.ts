// Регрессии методологического канон-аудита (ЯС/ЗГ Стива Нисона).
// Каждый блок закрепляет исправление одной задачи P0/P1 отдельным тестом.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';

const cc = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: v });

/** Восходящий зигзаг (HH/HL) — аналог генератора из nison_trend_filter.test.ts. */
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

/** Нисходящий зигзаг (LH/LL). */
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

describe('P0-1: повешенный (гл. 4 ЯС, «Молот и повешенный»)', () => {
  // Повешенный имеет ту же форму, что молот: малое тело в ВЕРХНЕЙ части
  // диапазона, длинная нижняя тень; отличается только контекстом (после роста).
  // До фикса atLocalHigh (тело внизу) и close >= mid (тело вверху) взаимно
  // исключались — модель не детектировалась никогда при prev.length >= 5.
  const hangingShape = (lastClose: number): Candle =>
    cc(lastClose - 0.4, lastClose + 0.2, lastClose - 3.4, lastClose - 0.1);

  it('после подтверждённого роста детектится', () => {
    const prev = zigUp(30, 100, 0.6);
    const res = PatternDetector.isHangingMan(hangingShape(prev[prev.length - 1].close), prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('ПОВЕШЕННЫЙ');
  });

  it('та же свеча после спада НЕ детектится (нет контекста роста)', () => {
    const prev = zigDown(30, 150, 0.6);
    const res = PatternDetector.isHangingMan(hangingShape(prev[prev.length - 1].close), prev);
    expect(res.found).toBe(false);
  });
});
