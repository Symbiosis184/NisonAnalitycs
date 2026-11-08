import { assertValidSymbol, isValidTimeframe, clampNumber } from '../utils/validation';
import { fetchWithRetry } from '../utils/http';
import { parseMarket } from './market';

const BASE_URL = 'https://api.bybit.com';

import { getJournalToken } from '../utils/journalSync';

// --- Серверный котировочный прокси (/api/quotes/*) ---------------------------

function hasBackend(): boolean {
  try {
    return typeof document !== 'undefined' &&
      (!!document.querySelector('meta[name="kairi-api-token"]') ||
       !!document.querySelector('meta[name="kairi-journal-token"]'));
  } catch {
    return false;
  }
}

function getApiToken(): string {
  try {
    const meta = document.querySelector('meta[name="kairi-api-token"]');
    const t = (meta?.getAttribute('content') || '').trim();
    if (t) return t;
  } catch { /* нет DOM */ }
  return getJournalToken();
}

function unwrapProxy(body: any): any {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return (body as { data: unknown }).data ?? null;
  }
  return body ?? null;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const d = body?.detail ?? body?.error ?? '';
    return String(d).slice(0, 200);
  } catch {
    return '';
  }
}

async function proxyFetch(path: string, params: Record<string, string | number>, force = false): Promise<any | null> {
  if (!hasBackend()) return null;
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const token = getApiToken();
  try {
    const res = await fetch(`${path}?${qs}${force ? `${qs ? '&' : '?'}_t=${Date.now()}` : ''}`, {
      headers: token ? { 'X-Kairi-Key': token } : {},
      signal: (AbortSignal as any)?.timeout ? AbortSignal.timeout(10_000) : undefined,
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return unwrapProxy(body);
  } catch {
    return null;
  }
}

async function proxyFetchStrict(path: string, params: Record<string, string | number>, force = false): Promise<any> {
  if (!hasBackend()) {
    throw new Error('Источник данных по акциям недоступен: нет серверного прокси (Twelvedata работает только на боевом домене).');
  }
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const token = getApiToken();
  let res: Response;
  try {
    res = await fetch(`${path}?${qs}${force ? `${qs ? '&' : '?'}_t=${Date.now()}` : ''}`, {
      headers: token ? { 'X-Kairi-Key': token } : {},
      signal: (AbortSignal as any)?.timeout ? AbortSignal.timeout(10_000) : undefined,
    });
  } catch {
    throw new Error('Источник данных по акциям недоступен: котировочный прокси (Twelvedata) не отвечает. Попробуйте позже.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Сессия истекла — обновите страницу и войдите заново.');
  }
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    if (res.status === 404 && /unknown symbol/i.test(detail)) {
      throw new Error('Акция не найдена на Twelvedata — проверьте тикер.');
    }
    if (res.status === 429 || /rate.?limit|too many|quota/i.test(detail)) {
      throw new Error('Twelvedata временно ограничил запросы (лимит частоты). Попробуйте через минуту.');
    }
    if (res.status === 503 && /api key/i.test(detail)) {
      throw new Error('Источник данных по акциям не настроен на сервере (нет ключа Twelvedata). Обратитесь в поддержку.');
    }
    throw new Error(detail ? `Ошибка источника данных (${res.status}): ${detail}`
                           : `Источник данных по акциям недоступен (HTTP ${res.status}). Попробуйте позже.`);
  }
  const body = await res.json();
  return unwrapProxy(body);
}

// --- Кэш и троттлинг обращений к Bybit -------------------------------------
interface CacheEntry<T> { value: T; expires: number }
const cache = new Map<string, CacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

/** Метрики кэша для мониторинга */
export interface CacheMetrics {
  hits: number;
  misses: number;
  errors: number;
}

const cacheMetrics: CacheMetrics = { hits: 0, misses: 0, errors: 0 };

export function getCacheMetrics(): CacheMetrics {
  return { ...cacheMetrics };
}

export function resetCacheMetrics(): void {
  cacheMetrics.hits = 0;
  cacheMetrics.misses = 0;
  cacheMetrics.errors = 0;
}

/**
 * Кэшированный fetch с in-flight coalescing.
 * FIX: кэшируются ТОЛЬКО успешные ответы (retCode === 0).
 * Ошибки API (retCode !== 0) НЕ кэшируются — иначе при rate-limit
 * система "замораживается" на TTL кэша.
 */
async function cachedFetchJson(key: string, url: string, ttlMs: number): Promise<any> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    cacheMetrics.hits++;
    return hit.value;
  }
  cacheMetrics.misses++;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const response = await fetchWithRetry(url);
      const data = await response.json();
      
      // FIX: кэшируем только успешные ответы
      if (data && typeof data === 'object' && 'retCode' in data) {
        if (data.retCode !== 0) {
          cacheMetrics.errors++;
          // НЕ кэшируем ошибку — пусть следующая попытка попробует снова
          return data;
        }
      }
      
      cache.set(key, { value: data, expires: Date.now() + ttlMs });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

const KLINES_TTL_MS = 30_000;
const TICKER_TTL_MS = 10_000;

// --- TradFi: американские акции через Twelvedata ---
const STOCK_INTERVAL_MAP: Record<string, string> = {
  '1': '1', '3': '5', '5': '5', '15': '15',
  '30': '30', '60': '60', '120': '120', '240': '240', '480': '480',
  'D': 'd', 'W': 'w', 'M': 'm',
};

export function toStockResolution(tf: unknown): string | null {
  const bybitForm = toBybitInterval(tf);
  if (!bybitForm) return 'd';
  return STOCK_INTERVAL_MAP[bybitForm] ?? 'd';
}

/**
 * FIX троттлера: проверка Number.isFinite() вместо ?? 250.
 * Number(undefined) возвращает NaN, а NaN ?? 250 возвращает NaN.
 */
const rawInterval = typeof import.meta !== 'undefined' 
  ? Number((import.meta as any).env?.VITE_STOCK_MIN_INTERVAL_MS) 
  : NaN;
const STOCK_MIN_INTERVAL_MS = Number.isFinite(rawInterval) && rawInterval > 0 
  ? rawInterval 
  : 250;

let lastStockReqAt = 0;
let stockQueue: Promise<unknown> = Promise.resolve();

function throttledStockFetch<T>(fn: () => Promise<T>): Promise<T> {
  const run = stockQueue.then(async () => {
    const wait = STOCK_MIN_INTERVAL_MS - (Date.now() - lastStockReqAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStockReqAt = Date.now();
    return fn();
  });
  stockQueue = run.catch(() => undefined);
  return run;
}

const stockCacheKey = (base: string, resolution: string, limit: number) =>
  `klines:twelvedata:${base}:${String(resolution).toLowerCase()}:${limit}`;

async function fetchStockKlines(base: string, resolution: string, limit: number, force: boolean): Promise<Kline[]> {
  const cacheKey = stockCacheKey(base, resolution, limit);
  if (force) { cache.delete(cacheKey); inflight.delete(cacheKey); }
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value as Kline[];
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const p = (async (): Promise<Kline[]> => {
    try {
      const proxied = await throttledStockFetch(() =>
        proxyFetchStrict('/api/quotes/klines',
          { symbol: `${base}:STOCK`, interval: resolution, limit, exchange: 'twelvedata' }, force));
      if (!Array.isArray(proxied)) {
        throw new Error('Источник данных по акциям недоступен: котировочный прокси (Twelvedata) вернул неожиданный ответ. Попробуйте позже.');
      }
      const klines = proxied as Kline[];
      
      // FIX: проверяем пустой ответ
      if (klines.length === 0) {
        console.warn(`fetchStockKlines: пустой ответ для ${base}:${resolution}`);
      }
      
      cache.set(cacheKey, { value: klines, expires: Date.now() + KLINES_TTL_MS });
      return klines;
    } catch (err) {
      if (Array.isArray(hit?.value) && hit!.value.length > 0) {
        return hit!.value as Kline[];
      }
      throw err;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, p);
  return p;
}

export async function fetchMarketOverviewBatch<T>(
  jobs: Array<() => Promise<T>>,
  onItemError?: (index: number, err: unknown) => void,
  onItem?: (item: T, index: number) => void,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < jobs.length; i++) {
    try {
      const item = await jobs[i]();
      out.push(item);
      // Дашборд может показать готовую карточку, не дожидаясь остальных тикеров.
      onItem?.(item, i);
    } catch (err) {
      onItemError?.(i, err);
    }
  }
  return out;
}

async function fetchStockQuote(base: string): Promise<Ticker24h> {
  try {
    const proxied = await throttledStockFetch(() =>
      proxyFetch('/api/quotes/ticker', { symbol: `${base}:STOCK`, exchange: 'twelvedata' }));
    if (proxied && Number.isFinite(Number(proxied.lastPrice))) {
      const q = proxied as { lastPrice: number; priceChange?: number; priceChangePercent?: number };
      return {
        lastPrice: Number(q.lastPrice),
        priceChange: Number.isFinite(Number(q.priceChange)) ? Number(q.priceChange) : 0,
        priceChangePercent: Number.isFinite(Number(q.priceChangePercent)) ? Number(q.priceChangePercent) : 0,
      };
    }
  } catch { /* падаем на фолбэк по свечам */ }
  const candles = await fetchStockKlines(base, 'd', 3, false);
  const last = candles[candles.length - 1];
  const prev = candles.length >= 2 ? candles[candles.length - 2] : last;
  const change = last.close - prev.close;
  return {
    lastPrice: last.close,
    priceChange: change,
    priceChangePercent: prev.close > 0 ? (change / prev.close) * 100 : 0,
  };
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Признак формирующейся (незакрытой) свечи для live-режима */
  isForming?: boolean;
}

export interface Ticker24h {
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1', '1': '1',
  '3m': '3', '3': '3',
  '5m': '5', '5': '5',
  '15m': '15', '15': '15',
  '30m': '30', '30': '30',
  '1H': '60', '60': '60', '60m': '60', '1h': '60',
  '2H': '120', '120': '120', '2h': '120',
  '4H': '240', '240': '240', '4h': '240',
  '1D': 'D', 'D': 'D', 'd': 'D', '1d': 'D',
  '1W': 'W', 'W': 'W', 'w': 'W', '1w': 'W',
  '1M': 'M', 'M': 'M', '1mo': 'M',
};

export function toBybitInterval(tf: unknown): string | null {
  if (typeof tf !== 'string') return null;
  const t = tf.trim();
  return INTERVAL_MAP[t] ?? null;
}

// Внутренний прокси принимает wire-формы '1h'/'1d', а прямой API Bybit —
// '60'/'D'. Раньше в прокси уходил прямой формат: 'D' получал 400, после чего
// браузер запускал медленный внешний fallback с повторными 10-секундными
// таймаутами. Преобразуем интервал только для прокси, не меняя запрос к Bybit.
const QUOTE_PROXY_INTERVAL_MAP: Record<string, string> = {
  '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', '120': '2h', '240': '4h',
  'D': '1d', 'W': '1w',
};

export function toQuoteProxyInterval(bybitInterval: string): string {
  return QUOTE_PROXY_INTERVAL_MAP[bybitInterval] ?? bybitInterval;
}

export async function fetchKlines(rawSymbol: string, interval: string, rawLimit: number, opts: { force?: boolean } = {}): Promise<Kline[]> {
  const symbol = assertValidSymbol(rawSymbol);
  const mapped = toBybitInterval(interval);
  if (!mapped && !isValidTimeframe(interval) && parseMarket(symbol).market !== 'stock') {
    throw new Error(`Invalid interval: ${String(interval).slice(0, 32)}`);
  }
  const limit = clampNumber(rawLimit, 1, 1000, 250);

  const bybitInterval = mapped || interval;

  const { base: stockBase, market } = parseMarket(symbol);
  if (market === 'stock') {
    const resolution = toStockResolution(bybitInterval) ?? 'd';
    return fetchStockKlines(stockBase, resolution, limit, opts.force === true);
  }

  const cacheKey = `klines:${symbol}:${bybitInterval}:${limit}`;
  if (opts.force) { cache.delete(cacheKey); inflight.delete(cacheKey); }

  const proxied = await proxyFetch('/api/quotes/klines',
    { symbol, interval: toQuoteProxyInterval(bybitInterval), limit });
  if (Array.isArray(proxied)) return proxied as Kline[];

  const url = `${BASE_URL}/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(bybitInterval)}&limit=${limit}${opts.force ? `&_t=${Date.now()}` : ''}`;
  const data = await cachedFetchJson(cacheKey, url, KLINES_TTL_MS);
  
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }
  
  const klines = data.result.list.map((item: any, index: number, arr: any[]) => ({
    openTime: parseInt(item[0]),
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
    // FIX: помечаем последнюю свечу как формирующуюся в live-режиме
    // (если запрос не force и это первая свеча в ответе — она ещё не закрыта)
    isForming: !opts.force && index === 0,
  })).reverse();
  
  return klines;
}

export interface InstrumentInfo {
  symbol: string;
  status: string;
  is_trading: boolean;
}

export async function fetchInstrumentInfo(rawSymbol: string): Promise<InstrumentInfo | null> {
  const symbol = assertValidSymbol(rawSymbol);
  const { base, market } = parseMarket(symbol);
  if (market === 'stock') {
    try {
      await fetchStockQuote(base);
      return { symbol, status: 'Trading', is_trading: true };
    } catch {
      return null;
    }
  }
  const url = `${BASE_URL}/v5/market/instruments-info?category=spot&symbol=${encodeURIComponent(symbol)}`;
  const data = await cachedFetchJson(`instrument:${symbol}`, url, 300_000);
  if (data.retCode !== 0) return null;
  const item = data?.result?.list?.[0];
  if (!item) return null;
  return {
    symbol: item.symbol,
    status: item.status ?? '',
    is_trading: item.isTrading === true || item.status === 'Trading',
  };
}

/**
 * FIX: точный расчёт priceChange из процентного изменения.
 * Если цена выросла на pct (в долях) до lastPrice, то:
 *   previousPrice = lastPrice / (1 + pct)
 *   priceChange = lastPrice - previousPrice = lastPrice * pct / (1 + pct)
 */
export async function fetch24hTicker(rawSymbol: string): Promise<Ticker24h> {
  const symbol = assertValidSymbol(rawSymbol);

  const { base: stockBase, market: stockMarket } = parseMarket(symbol);
  if (stockMarket === 'stock') return fetchStockQuote(stockBase);

  const proxied = await proxyFetch('/api/quotes/ticker', { symbol });
  if (proxied && typeof proxied.lastPrice === 'number') return proxied as Ticker24h;

  const url = `${BASE_URL}/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`;
  const data = await cachedFetchJson(`ticker:${symbol}`, url, TICKER_TTL_MS);
  
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }
  
  const ticker = data.result.list[0];
  const lastPrice = parseFloat(ticker.lastPrice);
  const pct = parseFloat(ticker.price24hPcnt);
  
  // FIX: точный расчёт вместо приближения pct * lastPrice
  const priceChange = Number.isFinite(pct) && Number.isFinite(lastPrice) && pct !== -1
    ? (lastPrice * pct) / (1 + pct)
    : 0;
  
  return {
    lastPrice,
    priceChange,
    priceChangePercent: Number.isFinite(pct) ? pct * 100 : 0,
  };
}

/** Очистка кэша (для тестов) */
export function clearCache(): void {
  cache.clear();
  inflight.clear();
}
