import { describe, it, expect } from 'vitest';
import { PatternDetector } from '../../utils/pattern_engine';
import { Candle } from '../../utils/candle';

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 1, open: o, high: h, low: l, close: cl, volume: v });

const risingHistory = Array.from({ length: 6 }, (_, i) => {
  const open = 80 + i * 2;
  return c(open, open + 2.4, open - 0.3, open + 2);
});
const sideBySide = [
  ...risingHistory,
  c(100, 105, 99.5, 104.5),
  c(106, 112, 105.5, 111.5),
  c(106, 112.2, 105.6, 111.7),
];
const tasuki = [
  ...risingHistory,
  c(100, 105, 99, 104.5),
  c(106, 112.5, 105.5, 112),
  c(111.5, 112, 104.8, 105.2),
];
const baby = [c(110, 110.5, 105, 105.2), c(103, 103.5, 102.5, 103), c(104.5, 110, 104.2, 109.5)];
const gapPlay = [
  ...risingHistory,
  c(92, 100.3, 91.8, 100), c(100, 108.3, 99.8, 108),
  c(108, 110, 107.8, 108.2), c(108.2, 109.8, 108, 108.4),
  c(108.3, 109.7, 108.1, 108.5), c(108.4, 109.9, 108.2, 108.6),
  c(108.5, 110, 108.3, 108.7),
  c(114, 119, 113.5, 118.5),
];

describe('Гэповые модели и явный рыночный контекст', () => {
  it('по умолчанию используется crypto, гэповые модели отключены', () => {
    expect(PatternDetector.isGappingSideBySide(sideBySide).found).toBe(false);
    expect(PatternDetector.isTasuki(tasuki).found).toBe(false);
    expect(PatternDetector.isAbandonedBaby(baby).found).toBe(false);
    expect(PatternDetector.isGappingPlay(gapPlay).found).toBe(false);
  });

  it('тот же ряд со context.market=stocks включает гэповые модели', () => {
    const context = { market: 'stocks' as const };
    expect(PatternDetector.isGappingSideBySide(sideBySide, context).found).toBe(true);
    expect(PatternDetector.isAbandonedBaby(baby, context).found).toBe(true);
    expect(PatternDetector.isGappingPlay(gapPlay, context).found).toBe(true);
    expect(PatternDetector.isTasuki(tasuki, context).found).toBe(true);
  });

  it('вызов для акций не изменяет результат следующего вызова для криптовалюты', () => {
    expect(PatternDetector.isGappingSideBySide(sideBySide, { market: 'stocks' }).found).toBe(true);
    expect(PatternDetector.isGappingSideBySide(sideBySide, { market: 'crypto' }).found).toBe(false);
    expect(PatternDetector.isGappingSideBySide(sideBySide).found).toBe(false);
  });

  it('контратака на крипте отключена как гэповая модель', () => {
    const prev = [c(112, 113, 110, 111), c(111, 111.5, 108, 108.5), c(108.5, 109, 105, 105.5), c(105.5, 106, 102, 102.5)];
    const c1 = c(102.5, 103, 96, 96.5);
    const c2 = c(95.5, 101, 95, 96.6);
    expect(PatternDetector.isCounterattack(c1, c2, prev, { market: 'crypto' }).found).toBe(false);
  });
});
