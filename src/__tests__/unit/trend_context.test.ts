import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';
import { c } from '../helpers/candles';

/** Ровный рост: закрытия повышаются — выраженный восходящий тренд. */
const rally = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const cl = start + i * step;
    a.push(new Candle({ time: 1000 + i, open: cl - 0.5, high: cl + 0.3, low: cl - 0.8, close: cl, volume: 100 }));
  }
  return a;
};

/** Ровное снижение: закрытия понижаются — выраженный нисходящий тренд. */
const decline = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const cl = start - i * step;
    a.push(new Candle({ time: 1000 + i, open: cl + 0.5, high: cl + 0.8, low: cl - 0.3, close: cl, volume: 100 }));
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
    const prev = rally(25, 100, 0.6); // closes 100 → ~114.4
    const c1 = c(114, 114.5, 111, 111.5); // bearish
    const c2 = c(111, 115, 110.8, 114.8); // bullish engulfing
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(false);
  });

  it('медвежье поглощение НЕ детектится после выраженного спада', () => {
    const prev = decline(25, 114, 0.6);
    const c1 = c(100, 103, 99.5, 102.5); // bullish
    const c2 = c(103, 103.2, 98.8, 99.2); // bearish engulfing
    expect(PatternDetector.isBearishEngulfing(c1, c2, prev).found).toBe(false);
  });

  it('после реального спада бычье поглощение по-прежнему детектится', () => {
    const prev = decline(25, 114, 0.6);
    const c1 = c(100, 100.5, 97, 97.5);
    const c2 = c(97, 101, 96.8, 100.8);
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(true);
  });

  it('боковик/пила не даёт ложных разворотных сигналов поглощений', () => {
    const prev = sawtoothFlat(25);
    // Бычья поглощающая свеча в середине пилообразного канала: формально
    // поглощает предыдущую, но трендового контекста нет — Нисон требует
    // движения против сигнала. Проверяем сам контекст через харами-крест
    // (у него нет зоны S/R, только precededBy*): медвежий длинный candle
    // внутри флэта не должен порождать ни бычий, ни медвежий харами...
    // Для поглощения проверяем симметричную пару: обе стороны заблокированы
    // либо сигнал остаётся нейтральным без ложного «разворота после тренда».
    const d1 = c(98, 102.5, 97.5, 102);   // bullish
    const d2 = c(102, 102.2, 97.8, 98.2); // bearish engulfing
    // В плоском боковике закрытие не у потолка и не у значимого роста окна —
    // медвежий разворот обязан быть заблокирован (прежняя эвристика пропускала
    // его по условию last >= hi * 0.98 на любом отскоке пилы).
    expect(PatternDetector.isBearishEngulfing(d1, d2, prev).found).toBe(false);
  });
});
