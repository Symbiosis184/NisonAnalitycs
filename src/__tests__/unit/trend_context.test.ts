import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';
import { c } from '../helpers/candles';

/** Восходящий зигзаг: импульс за 4 бара и откат за 2 образуют HH/HL. */
const rally = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    cl += phase < 4 ? step : -step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

/** Нисходящий зигзаг: импульс за 4 бара и откат за 2 образуют LH/LL. */
const decline = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    cl += phase < 4 ? -step : step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

/** Пилообразный боковик: экстремумы НЕ смещаются — прежняя эвристика
 * (6 свечей, last <= lo * 1.02) принимала любое закрытие у дна окна за «спад». */
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

describe('trendContext: блокировка разворотов против тренда', () => {
  it('бычье поглощение НЕ детектится после выраженного роста', () => {
    const prev = rally(25, 100, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 0.5, lastClose - 3.5, lastClose - 2.5); // bearish
    const c2 = c(lastClose - 2.7, lastClose + 1, lastClose - 4, lastClose + 0.5); // bullish engulfing
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(false);
  });

  it('медвежье поглощение НЕ детектится после выраженного спада', () => {
    const prev = decline(25, 114, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 2.5, lastClose - 0.5, lastClose + 2); // bullish
    const c2 = c(lastClose + 2.2, lastClose + 3, lastClose - 1, lastClose - 0.5); // bearish engulfing
    expect(PatternDetector.isBearishEngulfing(c1, c2, prev).found).toBe(false);
  });

  it('после реального спада бычье поглощение по-прежнему детектится', () => {
    const prev = decline(25, 114, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 0.5, lastClose - 3.5, lastClose - 2.5);
    const c2 = c(lastClose - 2.7, lastClose + 1, lastClose - 4, lastClose + 0.5);
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(true);
  });

  it('боковик/пила не считается подтверждённым противоположным трендом', () => {
    const prev = sawtoothFlat(25);
    const d1 = c(98, 102.5, 97.5, 102);   // bullish
    const d2 = c(102.2, 102.4, 97.8, 97.9); // bearish engulfing
    // Ни структура, ни положение цены и наклон SMA65 не подтверждают тренд.
    // Нейтральный контекст не блокирует разворот по каноническому фильтру;
    // это не приравнивает боковик к доказательству силы сигнала.
    expect(PatternDetector.isBearishEngulfing(d1, d2, prev).found).toBe(true);
  });
});
