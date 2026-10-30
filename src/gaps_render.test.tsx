// Гэпы на графике: client.ts считает gaps только для акций (порог 1%),
// CandlestickChart получает prop gaps и не падает с ними.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// jsdom не даёт canvas 2D — lightweight-charts падает внутри. Мокаем библиотеку
// и проверяем КОНТРАКТ: компонент принимает prop gaps, для каждого гэпа рисует
// 2 price-line (верх/низ зоны) + 1 текстовый маркер, без падения на крипте [].
const calls = { priceLines: [] as any[], markers: [] as any[] };
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({
      setData: () => {}, update: () => {},
      createPriceLine: (o: any) => { calls.priceLines.push(o); },
      attachPrimitive: () => {}, detachPrimitive: () => {},
    }),
    priceScale: () => ({ applyOptions: () => {} }),
    timeScale: () => ({ applyOptions: () => {}, fitContent: () => {}, scrollToRealTime: () => {}, timeToIndex: () => 0, logicalToCoordinate: () => 0, getVisibleLogicalRange: () => null, subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {} }),
    remove: () => {}, resize: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    attachPrimitive: () => {},
  }),
  ColorType: { Solid: 'solid' },
  CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {},
  BaselineSeries: {}, AreaSeries: {},
  createSeriesMarkers: (_s: any, m: any[]) => { calls.markers.push(...(m ?? [])); return { setMarkers: () => {}, markers: () => [] }; },
}));

import CandlestickChart from './components/CandlestickChart';
import { render } from '@testing-library/react';

(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
if (!(window as any).matchMedia) {
  (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
}
import { detectGaps, MIN_GAP_PCT } from './utils/gaps';
import type { CandleDTO, GapDTO } from './api/types';

const bar = (time: number, o: number, h: number, l: number, c: number): CandleDTO =>
  ({ time, open: o, high: h, low: l, close: c, volume: 10 });

describe('гэпы: порог и рынок', () => {
  it('минимальный порог — 1% (микрогэпы отсекаются)', () => {
    expect(MIN_GAP_PCT).toBe(1.0);
  });

  it('гэп 0.5% игнорируется, гэп 2% детектируется', () => {
    const candles = [
      bar(0, 100, 101, 99, 100),
      bar(86400000, 100.5, 101, 100, 100.8), // +0.5% — микро
      bar(172800000, 102.6, 103, 102, 102.8), // +1.8% от 100.8? нет: prevClose=100.8 -> +1.79% ✓
    ];
    const gaps = detectGaps(candles, 'stock');
    expect(gaps.length).toBe(1);
    expect(gaps[0].direction).toBe('up');
    expect(gaps[0].pct).toBeGreaterThan(1);
  });

  it('на крипте всегда пусто', () => {
    const candles = [bar(0, 100, 101, 99, 100), bar(86400000, 105, 106, 104, 105)];
    expect(detectGaps(candles, 'crypto')).toEqual([]);
  });

  it('fill: гэп закрыт, если последующая свеча пересекла весь диапазон', () => {
    const candles = [
      bar(0, 100, 101, 99, 100),
      bar(86400000, 103, 104, 102.5, 103),   // гэп вверх 3%: зона 100..103
      bar(172800000, 102.8, 103.2, 99.8, 101), // прошла 100 и 103 → закрыт
    ];
    const gaps = detectGaps(candles, 'stock');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].unfilled).toBe(false);
  });
});

describe('CandlestickChart принимает gaps', () => {
  it('для каждого гэпа: 2 границы зоны + текстовый маркер', async () => {
    const gaps: GapDTO[] = [{
      time: 86400000, prevClose: 100, open: 103, top: 103, bottom: 100,
      direction: 'up', pct: 3.0, unfilled: true,
    }];
    const candles = [bar(0, 100, 101, 99, 100), bar(86400000, 103, 104, 102.5, 103)];
    calls.priceLines.length = 0; calls.markers.length = 0;
    render(
      <CandlestickChart candles={candles} patterns={[]} signals={[]} support={[]} resistance={[]} gaps={gaps} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    // Границы зоны гэпа присутствуют на графике
    expect(calls.priceLines.some((l) => l.price === 103)).toBe(true);
    expect(calls.priceLines.some((l) => l.price === 100)).toBe(true);
    // Маркер-подпись в центре зоны
    expect(calls.markers.length).toBe(1);
    expect(String(calls.markers[0].text)).toContain('ГЭП');
    expect(calls.markers[0].price).toBeCloseTo(101.5);
  });

  it('пустой gaps (крипта) — ничего не рисуется, рендер ок', async () => {
    const candles = [bar(0, 100, 101, 99, 100), bar(86400000, 101, 102, 100, 101)];
    calls.priceLines.length = 0; calls.markers.length = 0;
    const { container } = render(
      <CandlestickChart candles={candles} patterns={[]} signals={[]} support={[]} resistance={[]} gaps={[]} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.markers.length).toBe(0);
    expect(container.firstChild).toBeTruthy();
  });
});
