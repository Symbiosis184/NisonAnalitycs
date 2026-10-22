import { describe, it, expect } from 'vitest';
import { mergeJournals } from './journalSync';
import type { SignalEntry } from './signalJournal';

const base: Omit<SignalEntry, 'id' | 'status' | 'timestamp' | 'barTime'> = {
  symbol: 'BTCUSDT',
  timeframe: '1h',
  pattern: 'Morning Star',
  direction: 'long',
  entryPrice: 100,
  stopLoss: 95,
  target: 110,
  riskReward: 2,
  confidence: 70,
};

const sig = (over: Partial<SignalEntry>): SignalEntry =>
  ({ ...base, id: 'x', status: 'pending', timestamp: 1000, ...over }) as SignalEntry;

describe('mergeJournals — слияние локального и серверного журналов', () => {
  it('по id выигрывает более финальная запись (закрытая > pending)', () => {
    const local = sig({ id: 'a', status: 'hit_target', exitTimestamp: 2000 });
    const server = sig({ id: 'a', status: 'pending' });
    const merged = mergeJournals([local], [server]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('hit_target');
  });

  it('при равных статусах по id выигрывает более свежая запись', () => {
    const local = sig({ id: 'a', status: 'pending', timestamp: 5000 });
    const server = sig({ id: 'a', status: 'pending', timestamp: 1000 });
    const merged = mergeJournals([local], [server]);
    expect(merged[0].timestamp).toBe(5000);
  });

  it('схлопывает одно событие с двух устройств (разные id, тот же barTime)', () => {
    const devA = sig({ id: 'a', barTime: 777, status: 'pending', timestamp: 1000 });
    const devB = sig({ id: 'b', barTime: 777, status: 'hit_stop', exitTimestamp: 3000, timestamp: 2000 });
    const merged = mergeJournals([devA], [devB]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('b'); // закрытая сделка побеждает pending-близнеца
  });

  it('разные бары одной формации — два разных сигнала (валидная серия)', () => {
    const s1 = sig({ id: 'a', barTime: 100 });
    const s2 = sig({ id: 'b', barTime: 200 });
    expect(mergeJournals([s1], [s2])).toHaveLength(2);
  });

  it('записи без barTime не схлопываются (старые данные)', () => {
    const s1 = sig({ id: 'a' });
    const s2 = sig({ id: 'b', timestamp: 900 });
    expect(mergeJournals([s1], [s2])).toHaveLength(2);
  });

  it('результат отсортирован по timestamp (новые вверху)', () => {
    const merged = mergeJournals(
      [sig({ id: 'a', timestamp: 1000 }), sig({ id: 'b', timestamp: 3000 })],
      [sig({ id: 'c', timestamp: 2000 })],
    );
    expect(merged.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });
});
