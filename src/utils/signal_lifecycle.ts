// Жизненный цикл торгового сценария поверх книжных свечных формаций.
//
// Отдельное подтверждение применяется только к моделям из pattern_ids.ts; оно
// не приписывается каждой формации как универсальное правило Нисона. Проверка
// идёт исключительно по закрытым барам после завершения модели.
//
// Состояния:
//   • confirmed — последующая закрытая свеча закрылась за соответствующей
//     границей формации; движения внутри её диапазона недостаточно;
//   • invalidated — до подтверждения достигнута противоположная граница;
//   • pending — решающего события ещё нет;
//   • expired — исчерпано проектное окно ожидания timeoutBars.
//
// Конкретные условия переходов и лимит ожидания — правила торгового движка
// проекта. Чистая функция: state(i) = reduce(step, pending, candles[i+1..]). Это даёт
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
  _signalClose: number,
  bounds: FormationBoundsLite,
  candle: Candle,
): SignalStatus {
  if (status !== 'pending') return status; // терминальные состояния необратимы

  if (direction === 'long') {
    // Отмена сильнее подтверждения: если свеча пробила стоп — сигнал мёртв.
    // При неизвестном порядке внутрибарных событий выбираем консервативный исход.
    if (candle.low <= bounds.patternLow) return 'invalidated';
    // Бычье закрытие выше close модели, но внутри её диапазона — ещё не
    // подтверждение. Такой мягкий критерий порождал серии шумовых входов.
    return candle.close > bounds.patternHigh ? 'confirmed' : 'pending';
  } else {
    if (candle.high >= bounds.patternHigh) return 'invalidated';
    return candle.close < bounds.patternLow ? 'confirmed' : 'pending';
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
export interface SignalLifecycle {
  status: SignalStatus;
  /** Закрытый бар, на котором впервые появилось подтверждение. */
  confirmationIndex: number | null;
  /** Закрытый бар, отменивший сценарий. */
  invalidationIndex: number | null;
  /** Бар истечения проектного окна ожидания. */
  expirationIndex: number | null;
}

/**
 * Полный жизненный цикл с фактическими индексами событий. Три бара ожидания —
 * настройка проекта, а не универсальное числовое правило книг.
 */
export function resolveSignalLifecycle(
  candles: Candle[],
  idx: number,
  direction: 'long' | 'short',
  signalClose: number,
  bounds: FormationBoundsLite,
  closedCount: number,
  timeoutBars: number = 3,
): SignalLifecycle {
  let status: SignalStatus = 'pending';
  const lastClosedIdx = Math.min(candles.length - 1, closedCount - 1);
  for (let i = idx + 1; i <= lastClosedIdx; i++) {
    status = stepSignal(status, direction, signalClose, bounds, candles[i]);
    if (status === 'confirmed') {
      return { status, confirmationIndex: i, invalidationIndex: null, expirationIndex: null };
    }
    if (status === 'invalidated') {
      return { status, confirmationIndex: null, invalidationIndex: i, expirationIndex: null };
    }
    if (i - idx >= timeoutBars) {
      return { status: 'expired', confirmationIndex: null, invalidationIndex: null, expirationIndex: i };
    }
  }
  return { status: 'pending', confirmationIndex: null, invalidationIndex: null, expirationIndex: null };
}

/** Совместимая обёртка для вызовов, которым нужен только статус. */
export function resolveSignalStatus(
  candles: Candle[],
  idx: number,
  direction: 'long' | 'short',
  signalClose: number,
  bounds: FormationBoundsLite,
  closedCount: number,
  timeoutBars: number = 3,
): SignalStatus {
  return resolveSignalLifecycle(
    candles, idx, direction, signalClose, bounds, closedCount, timeoutBars,
  ).status;
}

/** UI-метка статуса. */
export const STATUS_LABEL: Record<SignalStatus, string> = {
  pending: 'ожидает подтверждения',
  confirmed: 'подтверждён',
  invalidated: 'отменён (стоп пробит)',
  expired: 'истёк (нет подтверждения)',
};
