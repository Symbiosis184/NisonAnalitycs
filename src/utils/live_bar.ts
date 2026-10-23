import { Candle } from './candle';

/**
 * Bybit (как и любая биржа) возвращает в kline-истории ПОСЛЕДНИЙ бар
 * незакрытым: его high/low/close/volume меняются в реальном времени.
 *
 * Структурные алгоритмы (свинги Нисона, режим рынка, голоса зон, HTF-тренд)
 * на незакрытом баре дают «мерцающие» результаты: один и тот же бар то
 * становится подтверждённым свингом, то снова им не является — режим рынка
 * переключается туда-сюда без реального изменения структуры.
 *
 * Поэтому ВСЕ структурные расчёты обязаны видеть только ЗАКРЫТЫЕ бары.
 * Живая цена при этом остаётся доступной отдельно (lastClosedCandles.livePrice).
 */

export interface ClosedCandles<T extends Pick<Candle, 'time' | 'close'> = Candle> {
  /** Только закрытые бары — вход для всех структурных функций. */
  closed: T[];
  /** Живая цена последнего (незакрытого) бара; если истории <2 — close предпоследнего. */
  livePrice: number;
}

/**
 * Разделяет историю на закрытую часть и живую цену.
 * Первый бар считается незавершённым всегда (Bybit отдаёт открытым текущий
 * интервал последним элементом массива), поэтому отбрасывается ровно один
 * хвостовой бар. При длине <2 отбрасывать нечего — возвращаем как есть.
 */
export function splitLiveBar<T extends Pick<Candle, 'time' | 'close'>>(
  candles: T[],
): ClosedCandles<T> {
  if (candles.length < 2) {
    return { closed: candles, livePrice: candles[candles.length - 1]?.close ?? 0 };
  }
  return {
    closed: candles.slice(0, -1),
    livePrice: candles[candles.length - 1].close,
  };
}

/** Сокращение для мест, где нужны только закрытые бары. */
export function lastClosedOnly(candles: Candle[]): Candle[] {
  return splitLiveBar(candles).closed;
}
