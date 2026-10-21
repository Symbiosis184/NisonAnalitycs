// WebSocket-поток клайнов Bybit для live-обновления графика свечей.
// Заменяет поллинг REST /v5/market/kline: последняя (формирующаяся) свеча
// обновляется в реальном времени по мере поступления тиков биржи.
import { useEffect, useRef, useState } from 'react';
import type { CandleDTO } from '../api/types';
import { assertValidSymbol, isValidTimeframe } from '../utils/validation';

// ВАЖНО: категория потока должна совпадать с REST-источником (src/api/bybit.ts
// запрашивает kline/tickers с category=spot). Иначе для пар, у которых нет
// линейных фьючерсов (например SOLUSDT), подписка молча не получает данных и
// индикатор LIVE не появляется.
const WS_URL = 'wss://stream.bybit.com/v5/public/spot';

// Маппинг UI-таймфреймов в интервалы Bybit (совпадает с INTERVAL_MAP в api/bybit.ts)
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1H': '60',
  '4H': '240',
  '1D': 'D',
  'D': 'D',
  '1W': 'W',
  'W': 'W',
};

interface KlineRaw {
  start: number;   // open time, мс
  end: number;
  interval: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover?: string;
  confirm: boolean; // false — свеча ещё формируется
  timestamp?: number;
}

interface KlineStreamMessage {
  topic: string;
  type: 'snapshot' | 'delta';
  ts: number;
  // По протоколу Bybit v5 поле data — МАССИВ клайнов (в т.ч. public/spot).
  // Объектный вариант оставлен в типах на случай изменений протокола.
  data?: KlineRaw[] | KlineRaw;
}

export interface KlineLiveState {
  /** Живая (формирующаяся) свеча из потока или null */
  liveCandle: CandleDTO | null;
  connected: boolean;
}

/**
 * Подписка на поток kline.{interval}.{symbol} Binance-спота (Bybit v5 public WS).
 * Возвращает последнюю живую свечу: пока она формируется — обновляется на каждом
 * delta-сообщении; после confirm (закрытия) остаётся финальный вариант до прихода
 * следующей свечи. Ошибка/обрыв соединения — мягкий фолбэк (connected=false),
 * UI продолжает показывать данные REST-истории.
 */
export function useKlineWebSocket(symbol: string | undefined, timeframe: string): KlineLiveState {
  const [liveCandle, setLiveCandle] = useState<CandleDTO | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Валидация до формирования URL потока (защита от инъекции в topic)
  let safeSymbol: string | null = null;
  let bybitInterval: string | null = null;
  try {
    if (symbol && isValidTimeframe(timeframe)) {
      safeSymbol = assertValidSymbol(symbol);
      bybitInterval = INTERVAL_MAP[timeframe] ?? null;
    }
  } catch {
    safeSymbol = null;
  }
  const topic = safeSymbol && bybitInterval ? `kline.${bybitInterval}.${safeSymbol}` : null;

  useEffect(() => {
    setLiveCandle(null);
    if (!topic) return;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    // Последнее открытое время полученной свечи — против перемешивания сообщений
    let lastStart = 0;

    const connect = () => {
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        reconnectTimer = setTimeout(connect, 5000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
        ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
        // keep-alive: Bybit требует ping каждые ~20 секунд
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
        }, 15_000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as KlineStreamMessage;
          if (!msg.topic || msg.topic !== topic || !msg.data) return;
          // Bybit v5 присылает data как массив клайнов — берём самый свежий.
          const items = Array.isArray(msg.data) ? msg.data : [msg.data];
          for (const d of items) {
            const start = Number(d.start);
            if (!Number.isFinite(start) || start <= 0) continue;
            // Пропускаем устаревшие сообщения (старт раньше уже принятой свечи).
            // Финальные (confirm=true) закрытия принимаем всегда — они могут
            // приходить с open time, равным уже принятому.
            if (lastStart && start < lastStart) continue;
            lastStart = Math.max(lastStart, start);

            setLiveCandle({
              time: start,
              open: parseFloat(d.open),
              high: parseFloat(d.high),
              low: parseFloat(d.low),
              close: parseFloat(d.close),
              volume: parseFloat(d.volume),
            });
          }
        } catch {
          // повреждённое сообщение — игнорируем
        }
      };

      ws.onerror = () => { /* onclose выполнит переподключение */ };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pingTimer !== null) clearInterval(pingTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null; // предотвращаем переподключение после unmount
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [topic]);

  return { liveCandle, connected };
}

/**
 * Сливает живую WebSocket-свечу с историей из REST: заменяет последний бар,
 * если совпадает по open time, либо добавляет новый бар, если началась
 * следующая свеча. Если история уже содержит закрытую свечу «новее» живой
 * (например, пришла после реконнекта) — история остаётся как есть.
 */
export function mergeLiveCandle(history: CandleDTO[], live: CandleDTO | null): CandleDTO[] {
  if (!live || history.length === 0) return history;
  const last = history[history.length - 1];
  if (live.time === last.time) {
    // Формирующаяся свеча поверх последнего бара истории
    return [...history.slice(0, -1), live];
  }
  if (live.time > last.time) {
    // Началась новая свеча — добавляем её, закрыв предыдущий бар историей
    return [...history, live];
  }
  return history;
}
