import { describe, it, expect } from 'vitest';
import { PatternDetector } from '../../utils/pattern_engine';
import { Candle } from '../../utils/candle';

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 1, open: o, high: h, low: l, close: cl, volume: v });

const sideBySide = [c(110, 111, 99, 100), c(111.5, 116, 111, 115.5), c(111.7, 116.1, 111.3, 115.6)];
const tasuki = [c(100, 106, 99.5, 105.5), c(107, 112, 106.5, 111.5), c(111, 111.5, 103, 106)];
const baby = [c(110, 110.5, 105, 105.2), c(103, 103.5, 102.5, 103), c(104.5, 110, 104.2, 109.5)];
const gapPlay = [c(110, 111, 99, 100), c(100.4, 101, 100, 100.5), c(100.5, 101.2, 100.2, 100.4), c(100.4, 101.1, 100.1, 100.3), c(100.3, 101, 100, 100.2), c(100.2, 100.9, 99.9, 100.4), c(100.4, 100.7, 100.1, 100.3), c(103, 106, 102.8, 105.5)];

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
