// Тесты live-потока клайнов: формат сообщений Bybit v5 (data = МАССИВ),
// корректная категория потока (spot — совпадает с REST-источником) и
// слияние живой свечи с историей.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useKlineWebSocket, mergeLiveCandle } from '../../hooks/useKlineWebSocket';
import type { CandleDTO } from '../../api/types';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  url: string;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }

  // helpers for tests
  emitOpen() { this.onopen?.(); }
  emitMessage(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const snapshotMsg = (candle: Record<string, unknown>) => ({
  type: 'snapshot',
  topic: 'kline.1.SOLUSDT',
  ts: Date.now(),
  data: [candle], // Bybit v5: data — массив
});

const baseCandle = {
  start: 1_700_000_060_000,
  end: 1_700_000_119_999,
  interval: '1',
  open: '100', high: '102', low: '99', close: '101', volume: '10',
  confirm: false,
};

describe('useKlineWebSocket', () => {
  const realWs = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    // @ts-expect-error — подмена браузерного WebSocket в jsdom
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    cleanup();
    globalThis.WebSocket = realWs;
    vi.useRealTimers();
  });

  it('подключается к spot-потоку (совпадает с REST category=spot)', () => {
    renderHook(() => useKlineWebSocket('SOLUSDT', '1m'));
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('wss://stream.bybit.com/v5/public/spot');
    ws.emitOpen();
    expect(JSON.parse(ws.sent[0])).toEqual({ op: 'subscribe', args: ['kline.1.SOLUSDT'] });
  });

  it('принимает свечу из snapshot с data-массивом и ставит connected=true', () => {
    const { result } = renderHook(() => useKlineWebSocket('SOLUSDT', '1m'));
    const ws = FakeWebSocket.instances[0];
    expect(result.current.connected).toBe(false);

    act(() => { ws.emitOpen(); });
    expect(result.current.connected).toBe(true);

    act(() => { ws.emitMessage(snapshotMsg(baseCandle)); });
    expect(result.current.liveCandle).toEqual({
      time: baseCandle.start, open: 100, high: 102, low: 99, close: 101, volume: 10,
    });
  });

  it('игнорирует сообщения другого топика и служебные ответы (без topic)', () => {
    const { result } = renderHook(() => useKlineWebSocket('SOLUSDT', '1m'));
    const ws = FakeWebSocket.instances[0];
    act(() => { ws.emitOpen(); });

    act(() => {
      ws.emitMessage({ success: true, ret_msg: 'subscribe', op: 'subscribe' });
      ws.emitMessage({ ...snapshotMsg(baseCandle), topic: 'kline.5.SOLUSDT' });
    });
    expect(result.current.liveCandle).toBeNull();

    act(() => { ws.emitMessage(snapshotMsg(baseCandle)); });
    expect(result.current.liveCandle).not.toBeNull();
  });

  it('пропускает устаревшие сообщения (start раньше принятого)', () => {
    const { result } = renderHook(() => useKlineWebSocket('SOLUSDT', '1m'));
    const ws = FakeWebSocket.instances[0];
    act(() => { ws.emitOpen(); });

    act(() => { ws.emitMessage(snapshotMsg(baseCandle)); });
    act(() => {
      ws.emitMessage(snapshotMsg({ ...baseCandle, start: baseCandle.start - 60_000, close: '50' }));
    });
    expect(result.current.liveCandle?.close).toBe(101);
  });

  it('connected=false после закрытия соединения (OFFLINE до реконнекта)', () => {
    const { result } = renderHook(() => useKlineWebSocket('SOLUSDT', '1m'));
    const ws = FakeWebSocket.instances[0];
    act(() => { ws.emitOpen(); });
    expect(result.current.connected).toBe(true);
    act(() => { ws.onclose?.(); });
    expect(result.current.connected).toBe(false);
  });

  it('не создаёт соединение при недопустивом symbol/timeframe', () => {
    renderHook(() => useKlineWebSocket('BTC;USDT', '1m'));
    renderHook(() => useKlineWebSocket('SOLUSDT', 'bad-tf'));
    expect(FakeWebSocket.instances.length).toBe(0);
  });
});

describe('mergeLiveCandle', () => {
  const history: CandleDTO[] = [
    { time: 1_000, open: 1, high: 2, low: 1, close: 2, volume: 5 },
    { time: 2_000, open: 2, high: 3, low: 2, close: 2.5, volume: 6 },
  ];

  it('заменяет последний бар живой свечой с тем же временем', () => {
    const live: CandleDTO = { time: 2_000, open: 2, high: 4, low: 2, close: 3.9, volume: 9 };
    const merged = mergeLiveCandle(history, live);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual(live);
  });

  it('добавляет новый бар, если живая свеча свежее истории', () => {
    const live: CandleDTO = { time: 3_000, open: 2.5, high: 3, low: 2.4, close: 2.8, volume: 1 };
    const merged = mergeLiveCandle(history, live);
    expect(merged).toHaveLength(3);
    expect(merged[2]).toEqual(live);
  });

  it('история без изменений при пустой живой свече или устаревшей', () => {
    expect(mergeLiveCandle(history, null)).toBe(history);
    const stale: CandleDTO = { time: 500, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    expect(mergeLiveCandle(history, stale)).toBe(history);
  });
});
