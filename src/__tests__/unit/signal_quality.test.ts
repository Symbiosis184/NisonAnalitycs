// Аудит №12: ранжирование сигналов по канону Нисона (не все паттерны равны).
import { describe, it, expect } from 'vitest';
import { computeSignalQuality, isReversalModel } from '../../utils/signal_quality';
import { Candle } from '../../utils/candle';
import { signalGenerator } from '../../utils/signal_generator';

let t = 1_700_000_000;
const mk = (open: number, high: number, low: number, close: number, volume = 100): Candle =>
  new Candle({ time: ++t, open, high, low, close, volume });

/** Нисходящая серия из n свечей (для контекста разворота вверх) */
const downtrend = (n: number, start = 120, step = 2): Candle[] => {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = start - i * step;
    const c = o - step;
    out.push(mk(o, o + 0.5, c - 0.5, c));
  }
  return out;
};

describe('isReversalModel', () => {
  it('разворотные модели распознаны по стабильным ID (включая имя с бейджем объёма)', () => {
    expect(isReversalModel('БУЛЬЕ ПОГЛОЩЕНИЕ')).toBe(true);
    expect(isReversalModel('ПАДАЮЩАЯ ЗВЕЗДА (ОБЪЁМ)')).toBe(true);
    expect(isReversalModel('ТРИ БЕЛЫХ ВОИНА')).toBe(false); // продолжение
  });
});

describe('computeSignalQuality — детерминированность и границы', () => {
  const prior = downtrend(20);
  const hammer = mk(100, 100.8, 96, 100.5, 200); // молот: тень ~4 > 2×тела, объём ×2

  it('сильный сигнал (тренд+объём+тень+подтверждение) = 1.0', () => {
    const q = computeSignalQuality({
      direction: 'long', pattern: 'МОЛОТ', confirmCandle: hammer, priorCandles: prior, status: 'confirmed',
    });
    expect(q).toBe(1.0);
  });

  it('тот же паттерн без подтверждения ниже, чем с подтверждением', () => {
    const confirmed = computeSignalQuality({ direction: 'long', pattern: 'МОЛОТ', confirmCandle: hammer, priorCandles: prior, status: 'confirmed' });
    const pending = computeSignalQuality({ direction: 'long', pattern: 'МОЛОТ', confirmCandle: hammer, priorCandles: prior, status: 'pending' });
    const invalidated = computeSignalQuality({ direction: 'long', pattern: 'МОЛОТ', confirmCandle: hammer, priorCandles: prior, status: 'invalidated' });
    expect(confirmed).toBeGreaterThan(pending);
    expect(pending).toBeGreaterThan(invalidated);
  });

  it('вялая свеча без объёма против направления даёт заметно меньшую оценку', () => {
    const weakPrior = downtrend(20).slice(0, 10).concat(downtrend(10, 130, 1)); // всё ещё нисх. — тренд ок, но тело/объём плохие
    const weak = mk(100, 101.5, 98.5, 100.2, 40); // крошечное тело, объём ниже среднего
    const strong = computeSignalQuality({ direction: 'long', pattern: 'МОЛОТ', confirmCandle: hammer, priorCandles: prior, status: 'confirmed' });
    const q = computeSignalQuality({ direction: 'long', pattern: 'МОЛОТ', confirmCandle: weak, priorCandles: weakPrior, status: 'pending' });
    expect(q).toBeLessThan(strong);
    expect(q).toBeGreaterThanOrEqual(0.2);
  });

  it('оценка всегда в [0.2, 1.0] и округлена до сотых', () => {
    const cases = [
      { direction: 'short' as const, pattern: 'ПОВЕШЕННЫЙ', confirmCandle: hammer, priorCandles: downtrend(8), status: 'expired' as const },
      { direction: 'long' as const, pattern: 'УТРЕННЯЯ ЗВЕЗДА', confirmCandle: mk(99, 100, 98, 99.2, 10), priorCandles: [], status: undefined },
    ];
    for (const cse of cases) {
      const q = computeSignalQuality(cse);
      expect(q).toBeGreaterThanOrEqual(0.2);
      expect(q).toBeLessThanOrEqual(1.0);
      expect(Math.round(q * 100)).toBeCloseTo(q * 100, 10);
    }
  });

  it('нет look-ahead: priorCandles пустой → трендовый множитель нейтрален (0.7 не применяется вслепую)', () => {
    // при <6 свечах истории trendScore остаётся 0.7 — одинаков для любых паттернов;
    // качество не может быть максимальным без контекста
    const q = computeSignalQuality({ direction: 'long', pattern: 'МОЛОТ', confirmCandle: hammer, priorCandles: [], status: 'confirmed' });
    expect(q).toBeLessThan(1.0);
  });
});

describe('SignalGenerator: quality больше не константа 1.0', () => {
  it('сигналы получают оценку ∈ [0.2, 1.0], как минимум один < 1.0 на типовой серии', () => {
    // строим серию с двумя поглощениями: одно сильное (объём), другое вялое
    const candles: Candle[] = [...downtrend(30)];
    // бычье поглощение с объёмом
    candles.push(mk(60, 61, 59.5, 60.5, 50));
    candles.push(mk(58, 66, 57.5, 65.5, 300));
    // ещё нисходная волна и слабое поглощение (малое тело, малый объём)
    for (let k = 0; k < 8; k++) { const o = 65 - k; candles.push(mk(o, o + 0.4, o - 1.4, o - 1)); }
    candles.push(mk(56, 56.6, 55.4, 55.8, 30));
    candles.push(mk(55.6, 57.2, 55.2, 56.9, 60));

    const signals = signalGenerator.findSignals(candles, 'D');
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.quality).toBeGreaterThanOrEqual(0.2);
      expect(s.quality).toBeLessThanOrEqual(1.0);
    }
    // инвариант аудита №12: хотя бы один сигнал НЕ «стопроцентный»
    expect(signals.some(s => s.quality < 1.0)).toBe(true);
  });
});
