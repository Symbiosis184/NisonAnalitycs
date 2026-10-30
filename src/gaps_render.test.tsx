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

  it('overnight-открытие без разрыва диапазонов — НЕ гэп (канон Нисона)', () => {
    // prev: high=101; cur открывается на 102.6 (+1.8% от close), но low=100.5
    // перекрывает high предыдущей → общего диапазона нет → гэпа нет.
    const candles = [
      bar(0, 100, 101, 99, 100),
      bar(86400000, 100.5, 101, 100, 100.8),
      bar(172800000, 102.6, 103, 100.5, 102.8),
    ];
    expect(detectGaps(candles, 'stock')).toHaveLength(0);
  });

  it('настоящий гэп: low текущей выше high предыдущей (разрыв ≥ 1%)', () => {
    const candles = [
      bar(0, 100, 101, 99, 100),
      bar(86400000, 103.5, 105, 102.5, 104), // low 102.5 > high 101 → разрыв 1.485%
    ];
    const gaps = detectGaps(candles, 'stock');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].direction).toBe('up');
    expect(gaps[0].bottom).toBeCloseTo(101);
    expect(gaps[0].top).toBeCloseTo(102.5);
    expect(gaps[0].pct).toBeGreaterThanOrEqual(MIN_GAP_PCT);
  });

  it('нисходящий гэп: high текущей ниже low предыдущей', () => {
    const candles = [
      bar(0, 100, 101, 99, 100),
      bar(86400000, 96, 97.4, 95, 96.5), // high 97.4 < low 99 → разрыв 1.6%+
    ];
    const gaps = detectGaps(candles, 'stock');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].direction).toBe('down');
  });

  it('на крипте всегда пусто', () => {
    const candles = [bar(0, 100, 101, 99, 100), bar(86400000, 105, 106, 104, 105)];
    expect(detectGaps(candles, 'crypto')).toEqual([]);
  });

  it('fill: гэп закрыт, если последующая свеча пересекла весь диапазон', () => {
    const candles = [
      bar(0, 100, 101, 99, 100),
      bar(86400000, 103.5, 105, 102.5, 104), // гэп вверх: зона 101..102.5
      bar(172800000, 102.8, 103.2, 99.8, 101), // прошла 101 и 102.5 → закрыт
    ];
    const gaps = detectGaps(candles, 'stock');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].unfilled).toBe(false);
  });
});

describe('CandlestickChart принимает gaps', () => {
  it('для каждого гэпа: ценовая линия посередине разрыва, без маркера на свече', async () => {
    const gaps: GapDTO[] = [{
      time: 86400000, prevClose: 101, open: 102.5, top: 102.5, bottom: 101,
      direction: 'up', pct: 1.5, unfilled: true,
    }];
    const candles = [bar(0, 100, 101, 99, 100), bar(86400000, 103, 104, 102.5, 103)];
    calls.priceLines.length = 0; calls.markers.length = 0;
    render(
      <CandlestickChart candles={candles} patterns={[]} signals={[]} support={[]} resistance={[]} gaps={gaps} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    // Маркеров-стрелок на баре больше нет (гэп указывается НА разрыве)
    expect(calls.markers.filter((m: any) => String(m.text ?? '').includes('ГЭП'))).toHaveLength(0);
    // Одна ценовая линия ровно посередине зоны разрыва (101..102.5 → 101.75)
    const gapLines = calls.priceLines.filter((l) => l.price === 101.75);
    expect(gapLines).toHaveLength(1);
    expect(String(gapLines[0].title)).toContain('ГЭП');
    expect(String(gapLines[0].title)).toContain('1.5%');
    // Границы зоны не рисуем отдельными линиями — только центр разрыва
    expect(calls.priceLines.filter((l) => l.price === 101 || l.price === 102.5)).toHaveLength(0);
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
