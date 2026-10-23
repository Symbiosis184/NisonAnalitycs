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
    expect(isReversalModel('БЫЧЬЕ ПОГЛОЩЕНИЕ')).toBe(true);
    expect(isReversalModel('ПАДАЮЩАЯ ЗВЕЗДА (ОБЪЁМ)')).toBe(true);
    expect(isReversalModel('ТРИ БЕЛЫХ СОЛДАТА')).toBe(false); // продолжение
  });
});

describe('computeSignalQuality — детерминированность и границы', () => {
  /** Нисходящий тренд из 80 свечей: EMA-стопка (10<20<50) подтверждена, close < EMA10 */
  const prior = downtrend(80);
  /** Молот: тело ≤10% диапазона (книжное требование), нижняя тень ≥2×тела,
   *  верхняя тень мала; объём ×2 относительно базовой линии */
  const hammer = mk(100, 100.3, 96, 100.2, 200);

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
    // Нисходящий тренд (80 свечей, ≥65 — EMA-стопка определена), затем
    // бычье поглощение с объёмом (сильное) и вялое поглощение без объёма.
    // Тело поглощающей свечи должно перекрывать тело предыдущей ПОЛНОСТЬЮ
    // (канон Нисона): open ниже тела пред. медвежьей, close выше её тела.
    const candles: Candle[] = [...downtrend(80, 150, 1)];
    const lc = candles[candles.length - 1].close;
    candles.push(mk(lc + 0.4, lc + 0.9, lc - 1.2, lc - 0.9, 40));   // медвежья предыдущая: тело [lc-0.9, lc+0.4]
    candles.push(mk(lc - 1.4, lc + 3.2, lc - 1.6, lc + 1.2, 300));  // бычье поглощение: тело [lc-1.4, lc+1.2] ⊇ пред.
    // ещё нисходная волна и слабое поглощение (малое тело, малый объём)
    for (let k = 0; k < 8; k++) { const o = lc - 2 - k * 0.5; candles.push(mk(o, o + 0.4, o - 1.4, o - 1)); }
    const lc2 = candles[candles.length - 1].close;
    candles.push(mk(lc2 + 0.2, lc2 + 0.6, lc2 - 0.6, lc2 - 0.2, 30));      // медвежья: тело [lc2-0.2, lc2+0.2]
    candles.push(mk(lc2 - 0.4, lc2 + 1.7, lc2 - 0.6, lc2 + 0.4, 60));      // бычье поглощение малого тела (слабый объём)

    // Разворот по Нисону требует структуры: после обвала рисуем V-отскок
    // (быстрые бычьи свечи вверх), чтобы у long-сигнала появился явный
    // структурный ориентир (экстремум/зона) в пределах maxReward.
    let p = candles[candles.length - 1].close;
    for (let k = 0; k < 6; k++) { p += 1.2; candles.push(mk(p - 1.2, p + 0.3, p - 1.4, p, 150)); }
    // вершина отскока + спад на 2 шага (тоже закрытые свечи — не look-ahead)
    const peak = p + 1.5; candles.push(mk(p, peak, p - 0.3, peak - 0.3, 100));
    candles.push(mk(peak - 0.3, peak, peak - 1.5, peak - 1.4, 80));
    candles.push(mk(peak - 1.4, peak - 1.3, peak - 2.6, peak - 2.5, 80));

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
