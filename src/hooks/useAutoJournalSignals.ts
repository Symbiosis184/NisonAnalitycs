// Вынос из Analysis.tsx (реконструкция): автосохранение сигналов в журнал.
// Аудит №11: в журнал попадают сигналы со статусом pending (ожидает подтверждения)
// и confirmed; invalidated/expired не записываем.

import { useEffect } from 'react';
import type { SignalDTO } from '../api/types';
import { addSignal } from '../utils/signalJournal';

/** Минимальный набор полей, нужный для записи в журнал (карточки дашборда
 * отдают сокращённый DTO без story/индексов — см. MarketOverviewItem.signals). */
type JournalableSignal = Pick<
  SignalDTO,
  'pattern' | 'direction' | 'entry_price' | 'stop_loss' | 'target' | 'rr' | 'quality' | 'confirmed'
> & Partial<Pick<SignalDTO, 'bar_time' | 'lifecycle_status'>>;

export function useAutoJournalSignals(
  signals: JournalableSignal[] | undefined,
  symbol: string | undefined,
  timeframe: string,
) {
  useEffect(() => {
    if (!signals) return;
    // Проходим по КОПИИ в исходном порядке: addSignal пишет через unshift,
    // поэтому после сортировки по бару newest-first в журнале первым окажется
    // самый свежий сигнал.
    [...signals].forEach((signal) => {
      const st = signal.lifecycle_status ?? (signal.confirmed ? 'confirmed' : 'pending');
      if (st === 'pending' || st === 'confirmed') {
        const result = addSignal({
          symbol: symbol || '',
          timeframe,
          pattern: signal.pattern,
          direction: signal.direction,
          entryPrice: signal.entry_price,
          stopLoss: signal.stop_loss,
          target: signal.target,
          riskReward: signal.rr,
          confidence: signal.quality * 100,
          // Бар подтверждения формации — ключ дедупликации: движок отдаёт ту
          // же формацию на каждом реанализе в пределах окна сканирования.
          barTime: signal.bar_time,
        });

        if (result) {
          console.log(`✓ Сигнал автоматически сохранён в журнал: ${signal.pattern} для ${symbol}`);
        }
      }
    });
  }, [signals, symbol, timeframe]);
}
