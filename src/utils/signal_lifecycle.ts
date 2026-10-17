// Жизненный цикл сигнала по канону Стива Нисона (аудит №11).
//
// Проблема до фикса: `confirmed` вычислялся ОДИН РАЗ при детекции — по следующей
// свече, которая на момент анализа часто ещё НЕ закрыта (live-данные Bybit отдают
// последующие свечи формирующимися). Итог: «подтверждение» рисовалось по незакрытой
// свече и навсегда замораживалось в статусе journal.
//
// Нисон (гл. 4–6): сигнал живёт до тех пор, пока не произойдёт одно из:
//   • ПОДТВЕРЖДЕНИЕ — первая ЗАКРЫТАЯ свеча после формации продолжила движение
//     в сторону сигнала (или пробила границу формации);
//   • ОТМЕНА — первая закрытая свеча пробила стоп формации (сигнал аннулируется;
//     у Нисона несостоявшийся разворот не «пересиживает», а отменяется);
//   • ожидание — свеча не дала ни того, ни другого: ждём следующую закрытую свечу
//     (в пределах окна ожидания timeoutBars; дальше сигнал «протухает»).
//
// Чистая функция: state(i) = reduce(step, pending, candles[i+1..]). Это даёт
// инвариант согласованности: подтверждение, вычисленное позже по факту закрытия
// свечи, всегда совпадает с мгновенной оценкой на тот же набор закрытых данных
// (см. тесты property-based сверки).

import { Candle } from './candle';

export type SignalStatus = 'pending' | 'confirmed' | 'invalidated' | 'expired';

export interface FormationBoundsLite {
  patternLow: number;
  patternHigh: number;
}

/** Шаг редукции: одна закрытая свеча после паттерна. */
export function stepSignal(
  status: SignalStatus,
  direction: 'long' | 'short',
  signalClose: number,
  bounds: FormationBoundsLite,
  candle: Candle,
): SignalStatus {
  if (status !== 'pending') return status; // терминальные состояния необратимы

  if (direction === 'long') {
    // Отмена сильнее подтверждения: если свеча пробила стоп — сигнал мёртв,
    // даже если внутри неё было движение вверх (проверяем low ДО прогресса).
    if (candle.low <= bounds.patternLow) return 'invalidated';
    const progressed = candle.isBullish && candle.close > signalClose;
    const breakout = candle.close > bounds.patternHigh;
    if (progressed || breakout) return 'confirmed';
    return 'pending';
  } else {
    if (candle.high >= bounds.patternHigh) return 'invalidated';
    const progressed = candle.isBearish && candle.close < signalClose;
    const breakdown = candle.close < bounds.patternLow;
    if (progressed || breakdown) return 'confirmed';
    return 'pending';
  }
}

/**
 * Итоговый статус сигнала по всем свечам, ЗАКРЫВШИМСЯ после паттерна.
 * @param candles полный массив свечей
 * @param idx индекс сигнальной свечи (паттерн завершается на ней)
 * @param closedCount сколько последних свечей уже закрыты (по API Bybit:
 *        для live-графика последняя свеча формируется → closedCount = len - 1;
 *        для исторического бэктеста все свечи закрыты → closedCount = len)
 * @param timeoutBars окно ожидания подтверждения (в свечах), дальше — expired
 */
export function resolveSignalStatus(
  candles: Candle[],
  idx: number,
  direction: 'long' | 'short',
  signalClose: number,
  bounds: FormationBoundsLite,
  closedCount: number,
  timeoutBars: number = 3,
): SignalStatus {
  let status: SignalStatus = 'pending';
  const lastClosedIdx = Math.min(candles.length - 1, closedCount - 1);
  for (let i = idx + 1; i <= lastClosedIdx; i++) {
    status = stepSignal(status, direction, signalClose, bounds, candles[i]);
    if (status !== 'pending') return status;
    if (i - idx >= timeoutBars) return 'expired';
  }
  return status;
}

/** UI-метка статуса. */
export const STATUS_LABEL: Record<SignalStatus, string> = {
  pending: 'ожидает подтверждения',
  confirmed: 'подтверждён',
  invalidated: 'отменён (стоп пробит)',
  expired: 'истёк (нет подтверждения)',
};
