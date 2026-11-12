// Consensus Score — проектная оценка согласия факторов, а не сумма голосов.
// Чистая функция-агрегатор вынесена в src/utils/consensus.ts и используется client.ts.
import { describe, it, expect } from 'vitest';
import { aggregateConsensus, type ConsensusInput } from '../../utils/consensus';

const sig = (direction: 'long' | 'short', quality: number): ConsensusInput => ({ direction, quality });

describe('aggregateConsensus (проектная эвристика: согласие > количество)', () => {
  it('нет подтверждённых сигналов → 0/5, нейтрально', () => {
    const r = aggregateConsensus([]);
    expect(r.score).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.direction).toBe('neutral');
  });

  it('противоречивые сигналы (long+short равным весом) → низкий балл, НЕ 5/5', () => {
    // Старая формула давала здесь ~4.2/5 просто за «много сигналов».
    const mixed = [
      sig('long', 0.9), sig('long', 0.8),
      sig('short', 0.9), sig('short', 0.8),
    ];
    const r = aggregateConsensus(mixed);
    expect(r.direction).toBe('neutral');
    expect(r.score).toBeLessThan(1);
    expect(r.confidence).toBeLessThan(20);
  });

  it('все сигналы в одну сторону → высокий балл', () => {
    const bulls = [sig('long', 0.9), sig('long', 0.85), sig('long', 0.8)];
    const r = aggregateConsensus(bulls);
    expect(r.direction).toBe('buy');
    expect(r.score).toBeGreaterThanOrEqual(4);
    expect(r.confidence).toBeGreaterThan(60);
  });

  it('один сильный сигнал без поддержки других → низкий балл, не консенсус 4/5', () => {
    const r = aggregateConsensus([sig('long', 0.9)]);
    expect(r.direction).toBe('buy');
    expect(r.score).toBeCloseTo(1.5833, 3);
    expect(r.confidence).toBe(33);
  });

  it('качество влияет на силу даже при одинаковом направлении сигналов', () => {
    const weak = aggregateConsensus([sig('long', 0.1), sig('long', 0.2), sig('long', 0.15)]);
    const strong = aggregateConsensus([sig('long', 0.9), sig('long', 0.85), sig('long', 0.8)]);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(weak.score).toBeLessThan(3);
    expect(strong.score).toBeGreaterThan(4);
  });

  it('повторы одной модели не раздувают независимую широту консенсуса', () => {
    const repeated = aggregateConsensus([
      { ...sig('long', 0.7), pattern: 'МОЛОТ' },
      { ...sig('long', 0.9), pattern: 'МОЛОТ' },
      { ...sig('long', 0.8), pattern: 'МОЛОТ' },
    ]);
    const single = aggregateConsensus([{ ...sig('long', 0.9), pattern: 'МОЛОТ' }]);
    const independent = aggregateConsensus([
      { ...sig('long', 0.9), pattern: 'МОЛОТ' },
      { ...sig('long', 0.9), pattern: 'БЫЧЬЕ ПОГЛОЩЕНИЕ' },
      { ...sig('long', 0.9), pattern: 'УТРЕННЯЯ ЗВЕЗДА' },
    ]);
    expect(repeated).toEqual(single);
    expect(independent.score).toBeGreaterThan(repeated.score);
  });

  it('широта считается по победившему направлению, а не по большей противоположной группе', () => {
    const r = aggregateConsensus([
      sig('long', 1), sig('long', 1),
      sig('short', 0), sig('short', 0), sig('short', 0),
    ]);
    expect(r.direction).toBe('buy');
    expect(r.confidence).toBe(22); // ratio=1/3, два бычьих фактора, а не три медвежьих
  });

  it('преобладание быков над медведями → buy, но слабее чистого консенсуса', () => {
    const mostlyBull = [sig('long', 0.9), sig('long', 0.8), sig('short', 0.7)];
    const pureBull = [sig('long', 0.9), sig('long', 0.8), sig('long', 0.7)];
    const rm = aggregateConsensus(mostlyBull);
    const rp = aggregateConsensus(pureBull);
    expect(rm.direction).toBe('buy');
    expect(rm.score).toBeLessThan(rp.score);
  });

  it('score никогда не превышает 5 и не отрицателен', () => {
    for (const set of [
      Array.from({ length: 12 }, () => sig('long', 1)),
      Array.from({ length: 12 }, () => sig('short', 0.6)),
      [sig('long', 0.5), sig('short', 1)],
    ]) {
      const r = aggregateConsensus(set);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(5);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(95);
    }
  });

  it('NaN/garbage в quality не отравляет результат (не превращает всё в NaN)', () => {
    const r = aggregateConsensus([
      sig('long', 0.9),
      sig('long', NaN),
      { direction: 'long', quality: undefined as unknown as number },
    ] as ConsensusInput[]);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(Number.isFinite(r.confidence)).toBe(true);
    expect(r.direction).toBe('buy');
    // бракованные сигналы проигнорированы — результат как от одного чистого
    expect(r).toEqual(aggregateConsensus([sig('long', 0.9)]));
  });

  it('качество вне [0,1] клампится (завышенное quality не даёт >5/5)', () => {
    const r = aggregateConsensus([sig('long', 50), sig('long', 1.5)]);
    expect(r.score).toBeLessThanOrEqual(5);
    expect(r.confidence).toBeLessThanOrEqual(95);
    const neg = aggregateConsensus([sig('long', -3)]);
    expect(neg.score).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(neg.score)).toBe(true);
  });
});

// B2 (follow-up к PR #40): контракт варианта B — confidence это «Широта согласия»
// (балл 0..95), а НЕ вероятность прибыли. Качество подтверждений учитывается в
// score (× qualityFactor), поэтому три слабых и три сильных подтверждения одного
// направления одинаково «широки», но дают разный итоговый балл консенсуса.
describe('B2: контракты метрики «Широта согласия» (вариант B)', () => {
  it('3×long q=0 и 3×long q=1 → одинаковый confidence, разный score', () => {
    const weak = aggregateConsensus([sig('long', 0), sig('long', 0), sig('long', 0)]);
    const strong = aggregateConsensus([sig('long', 1), sig('long', 1), sig('long', 1)]);
    // Широта не зависит от качества: формула сохранена (не × qualityFactor).
    expect(weak.confidence).toBe(strong.confidence);
    expect(weak.confidence).toBe(95);
    // А значимость подтверждений различается именно в score (правило множества
    // приёмов ЯС ч. II: подтверждения должны быть независимыми И значимыми).
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(weak.score).toBeLessThan(strong.score);
  });

  it('UI-метрика — балл /95 без «%» (MarketContextSection, Dashboard)', async () => {
    const fs = await import('node:fs');
    const files = [
      'src/components/analysis/MarketContextSection.tsx',
      'src/pages/Dashboard.tsx',
    ];
    for (const f of files) {
      const srcText = fs.readFileSync(f, 'utf8');
      // confidence рядом с этой метрикой отображается как /95, не как процент.
      const confLines = srcText.split('\n').filter(l => l.includes('confidence'));
      expect(confLines.length).toBeGreaterThan(0);
      for (const line of confLines) {
        expect(line).not.toMatch(/%/);
        if (line.includes('/')) expect(line).toMatch(/\/95|\/100/);
      }
      // Название метрики в UI — «Широта согласия».
      expect(srcText).toMatch(/Широта согласия/);
    }
  });

  it('RU/EN паритет ключей широты согласия', async () => {
    const { UI_STRINGS } = await import('../../i18n/dictionaries');
    const ruKeys = ['Широта согласия', 'Широта согласия:', 'Эвристическая широта согласия, не вероятность'];
    for (const k of ruKeys) {
      expect(UI_STRINGS[k]).toBeTruthy();
    }
    expect(UI_STRINGS['Широта согласия']).toBe('Agreement breadth');
    expect(UI_STRINGS['Широта согласия:']).toBe('Agreement breadth:');
  });
});
