// Живая свеча через WebSocket Bybit (публичный market stream, без ключей).
// Подписка kline.{interval}.{symbol} отдаёт обновления ТЕКУЩЕГО (незакрытого)
// бара в реальном времени: high/low/close/volume пересчитываются на каждый тик.
// По закрытию бара приходит подтверждение (confirm:true) — тогда UI может
// запустить полный пересчёт анализа по новому закрытому свечному набору.
import { useEffect, useRef, useState } from 'react';
import { isValidSymbol } from '../utils/validation';

export interface LiveCandle {
  /** openTime бара, мс */
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** true когда бар закрыт и подтверждён биржей */
  confirmed: boolean;
  ts: number; // время последнего обновления (мс)
}

const WS_BASE = 'wss://stream.bybit.com/v5/public/spot';

// Интервалы Bybit для потока kline (секунды)
const INTERVAL_SEC: Record<string, string> = {
  '1': '1', '5': '5', '15': '15', '15m': '15', '30': '30', '30m': '30',
  '60': '60', '1H': '60', '240': '240', '4H': '240', 'D': 'D', '1D': 'D', 'W': 'W', '1W': 'W',
};

/**
 * @param symbol торговый инструмент (например BTCUSDT)
 * @param timeframe интервал в нотации приложения ('15m' | '1H' | '4H' | 'D' ...)
 * @param onBarClose колбэк при подтверждении закрытия бара (для полного реанализа)
 */
export function useBybitLiveCandle(
  symbol: string | undefined,
  timeframe: string,
  onBarClose?: () => void,
) {
  const [live, setLive] = useState<LiveCandle | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);
  const onCloseCb = useRef(onBarClose);
  onCloseCb.current = onBarClose;

  useEffect(() => {
    disposed.current = false;
    setLive(null);
    if (!symbol || !isValidSymbol(symbol)) return;

    const sec = INTERVAL_SEC[timeframe];
    if (!sec) return; // неизвестный интервал — живых обновлений не будет

    let attempts = 0;

    const connect = () => {
      if (disposed.current) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_BASE);
      } catch {
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: [`kline.${sec}.${symbol}`],
        }));
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.topic !== `kline.${sec}.${symbol}` || !msg.data) return;
          const d = msg.data;
          const candle: LiveCandle = {
            start: Number(d.start),
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
            volume: Number(d.volume),
            confirmed: d.confirm === true,
            ts: Date.now(),
          };
          if (!Number.isFinite(candle.close) || candle.close <= 0) return;
          setLive(candle);
          if (candle.confirmed) onCloseCb.current?.();
        } catch {
          /* игнорируем нераспознанные сообщения */
        }
      };

      const scheduleReconnect = () => {
        if (disposed.current) return;
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        attempts += 1;
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => { /* onclose последует следом */ };
      ws.onclose = () => {
        wsRef.current = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      disposed.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null; // не переподключаться при плановом закрытии
        try { ws.close(); } catch { /* noop */ }
      }
    };
  }, [symbol, timeframe]);

  return live;
}
