// Глубокий прогон рендера Analysis (dev-React): ловит #310 на синтетическом отчёте.
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

const mkCandle = (t: number, base: number) => ({ time: t, open: base, high: base * 1.01, low: base * 0.99, close: base, volume: 100 });
const candles = Array.from({ length: 60 }, (_, i) => mkCandle(1700000000000 + i * 86400000, 100 + i));
const report: any = {
  symbol: 'BTCUSDT', timeframe: 'D', price: 150, change_24h: 1.2,
  trend: 'up', trend_strength: 0.6, rsi: 55, macd: { value: 1, signal: 0.5, histogram: 0.5 },
  ema20: 140, ema50: 130, ema200: 120, candles,
  patterns: [{ name: 'Bullish Engulfing', type: 'bullish', candleIndex: 58, confidence: 0.8, confirmed: true, hasVolume: true, atLevel: false, story: 'test' }],
  signals: [{ direction: 'long', pattern: 'Bullish Engulfing', entry_price: 150, stop_loss: 140, target: 170, risk: 10, rr: 2, quality: 0.7, timestamp: Date.now(), confirmed: true, story: 'test',
    path: { distance_pct: 13, path_quality: 0.8, adjusted_rr: 1.8, obstacles: [{ level: 160, kind: 'zone', strength: 0.5, detail: 'S/R' }], first_obstacle_pct: 6, description: 'ok' } }],
  support: [{ level: 130, votes: 3, strong: true, reasons: ['r'], touches: 2 }],
  resistance: [{ level: 170, votes: 2, strong: false, reasons: [], touches: 1 }],
  regime: 'up', regime_description: 'trend up',
  consensus: { score: 4, direction: 'buy', confidence: 80 },
  trend_analysis: { trendStart: { detected: true, trend: 'up', reasons: [], confidence: 0.7 }, bookTrend: 'up' },
  generated: Date.now(),
};

vi.mock('../src/api/client', () => ({
  api: { getAnalysis: async () => report, getMultiTimeframeZones: async () => [], planForSignal: () => null },
}));
vi.mock('../src/hooks/useBybitLiveCandle', () => ({ useBybitLiveCandle: () => null }));
vi.mock('../src/hooks/useAutoJournalSignals', () => ({ useAutoJournalSignals: () => {} }));
vi.mock('../src/components/CandlestickChart', () => ({ default: () => <div data-testid="chart-stub" /> }));

import Analysis from '../src/pages/Analysis';

// jsdom-полифилы: ChartWidget и matchMedia требуются для пассивных эффектов
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
if (!(window as any).matchMedia) {
  (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
}

describe('Analysis full render probe', () => {
  it('renders without React #310 on synthetic report', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { findAllByText } = render(
        <HelmetProvider>
          <MemoryRouter initialEntries={['/analysis/BTCUSDT']}>
            <Routes><Route path="/analysis/:symbol" element={<Analysis />} /></Routes>
          </MemoryRouter>
        </HelmetProvider>,
      );
      await findAllByText(/BTC\/USDT/, undefined, { timeout: 4000 });
      await new Promise((r) => setTimeout(r, 300)); // дать дочитать мульти-ТФ/пассивные эффекты
      const msgs = errSpy.mock.calls.flat().map((a: any) => String(a?.message ?? a))
        .filter((m: string) => m.includes('Objects are not valid'));
      if (msgs.length) console.log('FOUND #310:', msgs[0].slice(0, 500));
      expect(msgs.length).toBe(0);
    } finally {
      errSpy.mockRestore();
    }
  });
});
