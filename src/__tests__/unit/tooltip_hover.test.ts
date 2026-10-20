import { describe, it, expect, vi, beforeAll } from 'vitest';

// jsdom не предоставляет ResizeObserver — заглушка для монтирования компонента
beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
import React from 'react';
import { render } from '@testing-library/react';

let emitCrosshair: ((p: any) => void) | null = null;
let subscribed = false;
// детерминированное отображение время -> X-координата графика
const timeToCoord = (t: any) => 100 + Number(t);

vi.mock('lightweight-charts', () => ({
  createChart: () => {
    const chart: any = {
      addSeries: () => ({
        setData: () => {},
        createPriceLine: () => {},
        priceToCoordinate: (p: number) => 200 + p,
      }),
      priceScale: () => ({ applyOptions: () => {} }),
      timeScale: () => ({ fitContent: () => {}, timeToCoordinate: (t: any) => timeToCoord(t) }),
      applyOptions: () => {},
      subscribeCrosshairMove: (h: Function) => { subscribed = true; emitCrosshair = h as any; },
      unsubscribeCrosshairMove: () => {},
      remove: () => {},
    };
    return chart;
  },
  ColorType: { Solid: 'solid' },
  CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {},
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
}));

import CandlestickChart from '../../components/CandlestickChart';

describe('CandlestickChart tooltip на сигналах (паттернах)', () => {
  it('подписывается на crosshair move и показывает tooltip при наведении на маркер', () => {
    const baseTime = 1700000000000;
    const candles = Array.from({ length: 5 }, (_, i) => ({
      time: baseTime + i * 60000, open: 100, high: 110, low: 90, close: 105, volume: 10,
    }));
    const patterns = [{ name: 'Morning Star', type: 'bullish' as const, candleIndex: 2, confidence: 80, confirmed: true }];

    // в jsdom useEffect выполняется синхронно при mount — после render
    // обработчик crosshair уже подписан, а tipEl добавлен в DOM контейнера
    const { container } = render(React.createElement(CandlestickChart as any, { candles, patterns }));
    expect(subscribed).toBe(true);
    expect(emitCrosshair).toBeTruthy();

    const t = candles[2].time / 1000; // время маркера в секундах
    const markerX = timeToCoord(t);   // X маркера в системе координат графика
    emitCrosshair!({ point: { x: markerX, y: 150 }, time: t });

    // tipEl — div, созданный компонентом вне React (append в контейнер графика)
    const tipEl = [...container.querySelectorAll('div')].find(d => d.style.zIndex === '30');
    expect(tipEl).toBeTruthy();
    expect((tipEl as HTMLElement).style.display).toBe('block');
    expect(tipEl!.textContent).toContain('Morning Star');
    expect(tipEl!.textContent).toContain('80%');

    // уход курсора за пределы графика — tooltip скрывается после scheduleHide
    vi.useFakeTimers();
    emitCrosshair!({ point: null, time: undefined });
    vi.advanceTimersByTime(200);
    expect((tipEl as HTMLElement).style.display).toBe('none');
    vi.useRealTimers();
  });

  it('не показывает tooltip при наведении далеко от маркеров', () => {
    const baseTime = 1700000000000;
    const candles = Array.from({ length: 5 }, (_, i) => ({
      time: baseTime + i * 60000, open: 100, high: 110, low: 90, close: 105, volume: 10,
    }));
    const patterns = [{ name: 'Evening Star', type: 'bearish' as const, candleIndex: 1, confidence: 70, confirmed: true }];
    const { container } = render(React.createElement(CandlestickChart as any, { candles, patterns }));
    // курсор в 500px правее любого маркера
    emitCrosshair!({ point: { x: 100_000, y: 100 }, time: candles[4].time / 1000 });
    const tipEl = [...container.querySelectorAll('div')].find(d => d.style.zIndex === '30');
    expect(tipEl).toBeTruthy();
    expect((tipEl as HTMLElement).style.display).not.toBe('block');
  });
});
