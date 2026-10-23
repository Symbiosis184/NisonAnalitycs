// Аудит Consensus Score: по Нисону консенсус — это СОГЛАСИЕ факторов, а не сумма голосов.
// Чистая функция-агрегатор вынесена в src/utils/consensus.ts и используется client.ts.
import { describe, it, expect } from 'vitest';
import { aggregateConsensus, type ConsensusInput } from '../../utils/consensus';

const sig = (direction: 'long' | 'short', quality: number): ConsensusInput => ({ direction, quality });

describe('aggregateConsensus (канон Нисона: согласие > количество)', () => {
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

  it('один сильный сигнал без поддержки других → умеренный балл (не максимум)', () => {
    const r = aggregateConsensus([sig('long', 0.9)]);
    expect(r.direction).toBe('buy');
    expect(r.score).toBeLessThanOrEqual(4.3);
    // Балл ограничен: ratio*4 + бонус ≤ 4 + 0 (бонус за широту = 0 при одном сигнале)
    expect(r.score).toBeCloseTo(4, 5);
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
});
