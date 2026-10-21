// Живая свеча через WebSocket Bybit (публичный market stream, без ключей).
// Подписка kline.{interval}.{symbol} отдаёт обновления ТЕКУЩЕГО (незакрытого)
// бара в реальном времени: high/low/close/volume пересчитываются на каждый тик.
// По закрытию бара приходит подтверждение (confirm:true) — тогда UI может
// запустить полный пересчёт анализа по новому закрытому свечному набору.
import { useEffect, useRef, useState } from 'react';
import { isValidSymbol } from '../utils/validation';
import { toBybitInterval } from '../api/bybit';

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

// Интервалы нормализуются через единый маппинг toBybitInterval (src/api/bybit.ts):
// он понимает и канон приложения ('15m', '1H', 'D'), и числовые формы из URL/списков
// ('15', '60', '240'). Раньше локальная таблица не содержала 'D'/'1D' — на дневном
// ТФ (дефолт страницы) подписка вообще не создавалась, LIVE не появлялся никогда.

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

    const sec = toBybitInterval(timeframe);
    if (!sec) return; // неизвестный интервал — живых обновлений не будет

    let attempts = 0;
    // Bybit закрывает бездействующее соединение через ~20 секунд (ping/pong).
    // Прикладной ping каждые 15 секунд держит сокет живым — иначе постоянное
    // переподключение и «мигающий»/отсутствующий статус LIVE.
    let pingTimer: ReturnType<typeof setInterval> | null = null;

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
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
        }, 15_000);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.op === 'pong' || (msg.success !== undefined && msg.topic === undefined)) return;
          // Bybit присылает kline-обновления как data=[{...}] (массив из одного элемента)
          const raw = Array.isArray(msg.data) ? msg.data[0] : msg.data;
          if (msg.topic !== `kline.${sec}.${symbol}` || !raw) return;
          const d = raw;
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
      if (pingTimer) clearInterval(pingTimer);
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
