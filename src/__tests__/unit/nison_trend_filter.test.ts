import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';

/**
 * Проверки канонического Нисон-фильтра предшествующего тренда (гл. 13):
 * структура свингов + SMA65 (положение цены) + наклон SMA65 — все три
 * признака должны согласоваться; блокируется только ПОДТВЕРЖДЁННЫЙ
 * противоположный тренд. Прежняя эвристика (6 свечей, фиксированные
 * проценты) на боковике/пиле давала ложные «спады/ралли».
 */

/** Восходящий зигзаг: импульс вверх за 4 бара, откат за 2 — HH/HL структура. */
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

/** Нисходящий зигзаг: LH/LL структура. */
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

/** Пилообразный боковик: экстремумы не смещаются — тренда нет. */
const sawtoothFlat = (n: number, mid = 100, amp = 2) => {
  const a: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const up = i % 2 === 0;
    const cl = mid + (up ? amp : -amp);
    const op = mid + (up ? -amp : amp);
    a.push(new Candle({ time: 1000 + i, open: op, high: Math.max(op, cl) + 0.5, low: Math.min(op, cl) - 0.5, close: cl, volume: 100 }));
  }
  return a;
};

const c = (open: number, high: number, low: number, close: number) =>
  new Candle({ time: 9999, open, high, low, close, volume: 100 });

describe('Нисон-фильтр предшествующего тренда (свинги + SMA65 + наклон)', () => {
  it('выраженный рост блокирует бычье поглощение (разворот против тренда)', () => {
    const prev = zigUp(80, 100, 0.6); // ~+10% за окно SMA65 — тренд подтверждён
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 0.5, lastClose - 3.5, lastClose - 2.5); // bearish
    const c2 = c(lastClose - 2.7, lastClose + 1, lastClose - 4, lastClose + 0.5); // bullish engulfing
    expect(c2.isBullish && c2.isEngulfing(c1)).toBe(true); // формация есть...
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(false); // ...тренд блокирует
  });

  it('выраженный спад блокирует медвежье поглощение', () => {
    const prev = zigDown(80, 200, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 2.5, lastClose - 0.5, lastClose + 2); // bullish
    const c2 = c(lastClose + 2.2, lastClose + 3, lastClose - 1, lastClose - 0.5); // bearish engulfing
    expect(c2.isBearish && c2.isEngulfing(c1)).toBe(true);
    expect(PatternDetector.isBearishEngulfing(c1, c2, prev).found).toBe(false);
  });

  it('после подтверждённого спада бычье поглощение детектится', () => {
    const prev = zigDown(80, 200, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 0.5, lastClose - 3.5, lastClose - 2.5);
    const c2 = c(lastClose - 2.7, lastClose + 1, lastClose - 4, lastClose + 0.5);
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(true);
  });

  it('боковик/пила не трактуется как тренд: разворот не блокируется «выдуманным» направлением', () => {
    // Ключевое отличие от прежней эвристики: на пиле фильтр НЕ определяет
    // направление ('up'/'down'), поэтому обе стороны разворота остаются
    // доступны — ровно как при нейтральном контексте.
    const prev = sawtoothFlat(80);
    const d1 = c(98, 102.5, 97.5, 102);   // bullish
    const d2 = c(102.2, 102.4, 97.8, 97.9); // bearish engulfing
    expect(PatternDetector.isBearishEngulfing(d1, d2, prev).found).toBe(true);
    const u1 = c(102, 102.5, 98, 98.5);   // bearish
    const u2 = c(98.3, 103, 98.2, 102.2); // bullish engulfing
    expect(PatternDetector.isBullishEngulfing(u1, u2, prev).found).toBe(true);
  });

  it('короткая история (<SMA65) ведёт себя как прежде: выраженный тренд блокирует', () => {
    // 25 баров недостаточно для SMA65; fallback-окно применяет ту же тройку
    // признаков к доступной истории — подтверждённый рост блокирует разворот.
    const prevShort = zigUp(25, 100, 0.6);
    const lastClose = prevShort[prevShort.length - 1].close;
    const c1 = c(lastClose, lastClose + 0.5, lastClose - 3.5, lastClose - 2.5);
    const c2 = c(lastClose - 2.7, lastClose + 1, lastClose - 4, lastClose + 0.5);
    expect(PatternDetector.isBullishEngulfing(c1, c2, prevShort).found).toBe(false);
  });
});
