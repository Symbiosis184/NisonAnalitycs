// Аудит совместимости фазового анализа Вайкоффа с методом Стива Нисона:
// фаза — только лёгкий контекстный корректор, никогда не переопределяет сигнал.
import { describe, it, expect } from 'vitest';
import { phaseMultiplier, type PhaseInfo } from '../../utils/wyckoff';

const mk = (over: Partial<PhaseInfo>): PhaseInfo => ({
  phase: 'transition',
  confidence: 0.35,
  rangeLow: 90,
  rangeHigh: 110,
  positionInRange: 0.5,
  rangeWidthAtr: 3,
  volSkewHighLow: 1,
  description: '',
  ...over,
});

describe('phaseMultiplier — нейтральность к методу Нисона', () => {
  it('при низкой уверенности классификации (<0.55) множитель строго 1.0 для любой фазы', () => {
    for (const phase of ['accumulation', 'markup', 'distribution', 'markdown'] as const) {
      for (const dir of ['long', 'short'] as const) {
        expect(phaseMultiplier(dir, mk({ phase, confidence: 0.5 }))).toBe(1.0);
      }
    }
  });

  it('фаза transition никогда не влияет на качество', () => {
    expect(phaseMultiplier('long', mk({ phase: 'transition', confidence: 1 }))).toBe(1.0);
    expect(phaseMultiplier('short', mk({ phase: 'transition', confidence: 1 }))).toBe(1.0);
  });

  it('максимальное влияние ограничено ±10% даже при полной уверенности', () => {
    const boost = phaseMultiplier('long', mk({ phase: 'markup', confidence: 1 }));
    const penalty = phaseMultiplier('short', mk({ phase: 'markup', confidence: 1 }));
    expect(boost).toBeLessThanOrEqual(1.1);
    expect(penalty).toBeGreaterThanOrEqual(0.9);
    expect(boost).toBe(1.1);
    expect(penalty).toBe(0.9);
  });

  it('влияние растёт пропорционально уверенности (порог → ~нейтрально)', () => {
    const weak = phaseMultiplier('long', mk({ phase: 'markup', confidence: 0.7 }));
    const strong = phaseMultiplier('long', mk({ phase: 'markup', confidence: 1 }));
    expect(weak).toBeGreaterThan(1.0);
    expect(weak).toBeLessThan(strong);
    // сразу над порогом влияние округляется до нейтрального 1.0
    const justAbove = phaseMultiplier('long', mk({ phase: 'markup', confidence: 0.56 }));
    expect(justAbove).toBeGreaterThanOrEqual(1.0);
    expect(justAbove).toBeLessThanOrEqual(1.02);
  });

  it('лонг у низа накопления усиливается, шорт против цикла — мягкий штраф (не 0.8)', () => {
    const accLow = phaseMultiplier('long', mk({ phase: 'accumulation', confidence: 1, positionInRange: 0.2 }));
    const accMidLong = phaseMultiplier('long', mk({ phase: 'accumulation', confidence: 1, positionInRange: 0.7 }));
    const accShort = phaseMultiplier('short', mk({ phase: 'accumulation', confidence: 1 }));
    expect(accLow).toBe(1.1);
    expect(accMidLong).toBe(1.0); // нетLocation → нейтрально, а не штраф
    expect(accShort).toBe(0.9);
    expect(accShort).toBeGreaterThan(0.85); // прежний жёсткий штраф убран
  });

});
