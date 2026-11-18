// Регресс-тест (задача владельца): сигналы с карточек дашборда должны
// автоматически попадать в журнал БЕЗ захода на страницу анализа.
// Проверяем контракт хука useAutoJournalSignals, который MarketCardBody
// вызывает на каждом рендере карточки (src/pages/Dashboard.tsx).

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoJournalSignals } from '../../hooks/useAutoJournalSignals';
import { getAllSignals, clearJournal } from '../../utils/signalJournal';

const sig = (over: Record<string, unknown> = {}) => ({
  direction: 'long' as const,
  pattern: 'БЫЧЬЕ ПОГЛОЩЕНИЕ',
  entry_price: 50000,
  stop_loss: 49000,
  target: 53000,
  risk: 1000,
  rr: 3,
  quality: 0.8,
  confirmed: true,
  bar_time: 1700000000000,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  clearJournal();
});

describe('useAutoJournalSignals — автосигналы дашборда попадают в журнал', () => {
  it('подтверждённый сигнал пишется без ручных действий', () => {
    renderHook(() => useAutoJournalSignals([sig()], 'BTCUSDT', 'D'));
    const entries = getAllSignals();
    expect(entries).toHaveLength(1);
    expect(entries[0].symbol).toBe('BTCUSDT');
    expect(entries[0].timeframe).toBe('D');
    expect(entries[0].pattern).toBe('БЫЧЬЕ ПОГЛОЩЕНИЕ');
    expect(entries[0].barTime).toBe(1700000000000);
  });

  it('pending-сигнал тоже пишется (аудит №11)', () => {
    renderHook(() =>
      useAutoJournalSignals(
        [sig({ confirmed: false, lifecycle_status: 'pending', bar_time: 1700000086400 })],
        'BTCUSDT',
        'D',
      ),
    );
    expect(getAllSignals()).toHaveLength(1);
  });

  it('invalidated/expired не пишутся', () => {
    renderHook(() =>
      useAutoJournalSignals(
        [
          sig({ lifecycle_status: 'invalidated', bar_time: 1 }),
          sig({ lifecycle_status: 'expired', pattern: 'ВЕЕР', bar_time: 2 }),
        ],
        'BTCUSDT',
        'D',
      ),
    );
    expect(getAllSignals()).toHaveLength(0);
  });

  it('повторный рендер карточки не создаёт дублей (дедуп по bar_time)', () => {
    const signals = [sig()];
    const { rerender } = renderHook(() => useAutoJournalSignals(signals, 'BTCUSDT', 'D'));
    rerender();
    rerender();
    // Новый вызов хука (например, второй компонент-карточка с тем же событием)
    renderHook(() => useAutoJournalSignals(signals, 'BTCUSDT', 'D'));
    expect(getAllSignals()).toHaveLength(1);
  });

  it('несколько разных баров одной формации пишутся отдельно', () => {
    renderHook(() =>
      useAutoJournalSignals(
        [sig(), sig({ bar_time: 1700086400000 })],
        'BTCUSDT',
        'D',
      ),
    );
    expect(getAllSignals()).toHaveLength(2);
  });

  it('пустой/отсутствующий список сигналов безопасен', () => {
    renderHook(() => useAutoJournalSignals(undefined, 'BTCUSDT', 'D'));
    renderHook(() => useAutoJournalSignals([], 'BTCUSDT', 'D'));
    expect(getAllSignals()).toHaveLength(0);
  });
});
