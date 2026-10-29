/**
 * Dashboard: переключение рынков Crypto ⇄ TradFi.
 * Требование: при переходе на акции карточки крипты исчезают,
 * при возврате на крипту — появляются снова.
 */
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { vi, describe, it, expect, afterEach } from 'vitest';

const mkCandle = (t: number, base: number) => ({
  time: t, open: base, high: base + 1.5, low: base - 1.5, close: base + 0.7, volume: 1000,
});
const candles = Array.from({ length: 60 }, (_, i) => mkCandle(1700000000000 + i * 86400000, 100 + i));
const report: any = {
  symbol: 'X', timeframe: 'D', price: 150, change_24h: 1.2,
  trend: 'up', trend_strength: 0.6, rsi: 55, macd: { value: 1, signal: 0.5, histogram: 0.5 },
  ema20: 140, ema50: 130, ema200: 120, candles,
  patterns: [], signals: [], support: [], resistance: [],
  regime: 'up', regime_description: '', consensus: { score: 1, direction: 'neutral', confidence: 10 },
  generated: Date.now(),
};

// Мок транспорта данных: client.ts строит отчёты из этих ответов; WS-хук — заглушка.
vi.mock('./api/bybit', () => ({
  fetchKlines: vi.fn(async (_symbol: string, _tf: string, opts?: any) => {
    const n = opts?.limit ?? 100;
    return candles.slice(-n);
  }),
  fetch24hTicker: vi.fn(async () => ({ priceChangePercent: 1.5, lastPrice: 150 })),
  fetchInstrumentInfo: vi.fn(async () => null),
}));
vi.mock('./hooks/useBinanceWebSocket', () => ({ useBinanceWebSocket: () => ({}) }));

import Dashboard from './pages/Dashboard';

afterEach(cleanup);

const cryptoCard = () => screen.queryByText('BTC');
const stockCard = () => screen.queryByText('AAPL');
// Ссылки карточек: /analysis/BTCUSDT (крипта) vs /analysis/AAPL:STOCK (акции)
const links = () => Array.from(document.querySelectorAll('a[href^="/analysis/"]')).map(a => a.getAttribute('href'));
const onlyCryptoCards = () => links().length > 0 && links().every(h => !h!.includes(':STOCK'));
const onlyStockCards = () => links().length > 0 && links().every(h => h!.includes(':STOCK'));

describe('Dashboard: переключение рынков Crypto/TradFi', () => {
  it('крипто-карточки исчезают при переходе на акции и возвращаются обратно', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter><Dashboard /></MemoryRouter>
      </HelmetProvider>,
    );

    // Стартовый рынок — крипта: карточки крипты есть, акций нет
    await waitFor(() => expect(cryptoCard()).toBeTruthy(), { timeout: 8000 });
    expect(stockCard()).toBeNull();
    expect(onlyCryptoCards()).toBe(true);

    // Переключаемся на TradFi — крипто-карточки должны исчезнуть сразу
    fireEvent.click(screen.getByText('TradFi · Акции США'));
    expect(cryptoCard()).toBeNull();   // синхронно, ещё до ответа сети
    await waitFor(() => expect(stockCard()).toBeTruthy(), { timeout: 8000 });
    expect(onlyStockCards()).toBe(true);

    // Возврат на Крипто — крипто-карточки появляются снова
    fireEvent.click(screen.getByText('Крипто'));
    expect(stockCard()).toBeNull();    // акции скрыты синхронно
    await waitFor(() => expect(cryptoCard()).toBeTruthy(), { timeout: 8000 });
    expect(onlyCryptoCards()).toBe(true);
  }, 30000);
});
