import { assertValidSymbol, isValidTimeframe, clampNumber } from '../utils/validation';
import { fetchWithRetry } from '../utils/http';
import { parseMarket } from './market';

const BASE_URL = 'https://api.bybit.com'; // только fallback (dev без backend-прокси)

// --- Серверный котировочный прокси (/api/quotes/*) ---------------------------
// Коммерческий контур: браузер не ходит на api.bybit.com напрямую — запросы
// идут через nginx на quotes_server.py (FastAPI), где стоит серверный кэш,
// дедупликация и защита от abuse. Токен доступа — тот же X-Kairi-Key, что и
// для журнала (meta kairi-journal-token / kairi-api-token в index.html).
import { getJournalToken } from '../utils/journalSync';

let quotesMode: 'proxy' | 'fallback' | null = null; // определяется по первому ответу

/** true, если страница открыта на боевом домене (есть наш backend за nginx). */
function hasBackend(): boolean {
  try {
    return typeof document !== 'undefined' &&
      (!!document.querySelector('meta[name="kairi-api-token"]') ||
       !!document.querySelector('meta[name="kairi-journal-token"]'));
  } catch {
    return false;
  }
}

/** Токен котировочного API: расширенный JSON-токен (role=user), fallback — journal-токен. */
function getApiToken(): string {
  try {
    const meta = document.querySelector('meta[name="kairi-api-token"]');
    const t = (meta?.getAttribute('content') || '').trim();
    if (t) return t;
  } catch { /* нет DOM */ }
  return getJournalToken();
}

/**
 * Ответ серверного кэша QuoteCache — {'data': ..., 'cached': bool}.
 * Разворачиваем обёртку, если она есть; иначе считаем ответ «сырым» и
 * возвращаем как есть (обратная совместимость с прежними формами).
 */
function unwrapProxy(body: any): any {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return (body as { data: unknown }).data ?? null;
  }
  return body ?? null;
}

async function proxyFetch(path: string, params: Record<string, string | number>, force = false): Promise<any | null> {
  if (!hasBackend()) return null; // dev/vitest — сразу fallback на Bybit
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const token = getApiToken();
  try {
    const res = await fetch(`${path}?${qs}${force ? `${qs ? '&' : '?'}_t=${Date.now()}` : ''}`, {
      headers: token ? { 'X-Kairi-Key': token } : {},
      signal: (AbortSignal as any)?.timeout ? AbortSignal.timeout(10_000) : undefined,
    });
    if (res.status === 401 || res.status === 403) return null; // токен просрочен -> деградация
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    quotesMode = 'proxy';
    const body = await res.json();
    return unwrapProxy(body);
  } catch {
    return null; // сеть/5xx -> fallback напрямую (как до коммерческого контура)
  }
}

// --- Кэш и троттлинг обращений к Bybit -------------------------------------
// Dashboard запрашивает 8 символов × 2 эндпоинта при каждой загрузке и
// периодически автообновляется. Без кэша это быстро упирается в rate-limit
// биржи (бан по IP). Кэшируем ответы на короткое время и дедуплицируем
// параллельные одинаковые запросы (in-flight coalescing).
interface CacheEntry<T> { value: T; expires: number }
const cache = new Map<string, CacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

async function cachedFetchJson(key: string, url: string, ttlMs: number): Promise<any> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;

  // Если такой запрос уже выполняется — ждём его результат вместо дубля
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      // fetchWithRetry: экспоненциальный backoff при 5xx/таймаутах,
      // уважение Retry-After / распознавание rate-limit (429, retCode 10006)
      const response = await fetchWithRetry(url);
      const data = await response.json();
      // Ошибки реткода проверяются в самих fetchKlines/fetch24hTicker;
      // здесь не бросаем, чтобы не ломать семантику «кэшируем сырой ответ».
      cache.set(key, { value: data, expires: Date.now() + ttlMs });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

const KLINES_TTL_MS = 30_000;   // свечи переиспользуем 30 секунд
const TICKER_TTL_MS = 10_000;   // тикер — 10 секунд

// --- TradFi: американские акции через Finnhub (бесплатный tier) --------------
// Ограничения бесплатного плана учитаны здесь же:
//  • история до ~1 года, максимум 30 000 баров за запрос — берём ≤1000;
//  • внутридневные интервалы (1/5/15/30/60 минут) доступны только для
//    американских акций — это ровно наши 30m/1H;
//  • soft limit ~30 запросов/сек — защищаемся глобальным троттлером ниже.
// Ключ FINNHUB_API_KEY задаётся на сервере (systemd Environment=), в браузер
// не попадает: прямые обращения к finnhub.io идут ТОЛЬКО через прокси
// /api/quotes/* (dev-фолбэк с ключом запрещён намеренно).
const STOCK_INTERVAL_MAP: Record<string, string> = {
  '30': '30', '60': '60', '120': '120', '240': '240',
  'D': 'D', 'W': 'W', 'M': 'M',
};

/** ТФ приложения -> Finnhub resolution ('30','60','D','W'); null — недоступен. */
export function toFinnhubResolution(tf: unknown): string | null {
  const bybitForm = toBybitInterval(tf);
  if (!bybitForm) return null;
  return STOCK_INTERVAL_MAP[bybitForm] ?? null;
}

// Глобальный троттлер исходящих запросов к прокси (min interval между стартами).
const STOCK_MIN_INTERVAL_MS = 350; // ≈ 2.9 req/s — запас под лимит бесплатного тарифа
let lastStockReqAt = 0;
let stockQueue: Promise<unknown> = Promise.resolve();

function throttledStockFetch<T>(fn: () => Promise<T>): Promise<T> {
  const run = stockQueue.then(async () => {
    const wait = STOCK_MIN_INTERVAL_MS - (Date.now() - lastStockReqAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStockReqAt = Date.now();
    return fn();
  });
  // Очередь не должна «ломаться» из-за ошибки одного запроса
  stockQueue = run.catch(() => undefined);
  return run;
}

/**
 * Свечи акции через котировочный прокси (ключ Finnhub — только на сервере).
 * Общий путь с fetchKlines: глобальный троттлер + короткий клиентский кэш
 * (in-flight coalescing), чтобы не выбить бесплатный лимит Finnhub при
 * каскаде ТФ и мульти-ТФ зонах (несколько параллельных запросов).
 */
async function fetchStockKlines(base: string, resolution: string, limit: number, force: boolean): Promise<Kline[]> {
  const cacheKey = `klines:finnhub:${base}:${resolution}:${limit}`;
  if (force) { cache.delete(cacheKey); inflight.delete(cacheKey); }
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value as Kline[];
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const p = (async (): Promise<Kline[]> => {
    try {
      const proxied = await throttledStockFetch(() =>
        proxyFetch('/api/quotes/klines',
          { symbol: `${base}:STOCK`, interval: resolution, limit, exchange: 'finnhub' }, force));
      if (!Array.isArray(proxied)) {
        // Ключ Finnhub живёт только на сервере — прямого browser-fallback нет.
        throw new Error('Источник данных по акциям недоступен: котировочный прокси (Finnhub) не отвечает. Попробуйте позже.');
      }
      const klines = proxied as Kline[];
      cache.set(cacheKey, { value: klines, expires: Date.now() + KLINES_TTL_MS });
      return klines;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, p);
  return p;
}

/** Текущая цена акции: котировка прокси -> фолбэк по последним дневным свечам. */
async function fetchStockQuote(base: string): Promise<Ticker24h> {
  try {
    const proxied = await throttledStockFetch(() =>
      proxyFetch('/api/quotes/ticker', { symbol: `${base}:STOCK`, exchange: 'finnhub' }));
    if (proxied && Number.isFinite(Number(proxied.lastPrice))) {
      const q = proxied as { lastPrice: number; priceChange?: number; priceChangePercent?: number };
      return {
        lastPrice: Number(q.lastPrice),
        priceChange: Number.isFinite(Number(q.priceChange)) ? Number(q.priceChange) : 0,
        priceChangePercent: Number.isFinite(Number(q.priceChangePercent)) ? Number(q.priceChangePercent) : 0,
      };
    }
  } catch { /* падаем на фолбэк по свечам */ }
  const candles = await fetchStockKlines(base, 'D', 3, false);
  const last = candles[candles.length - 1];
  const prev = candles.length >= 2 ? candles[candles.length - 2] : last;
  const change = last.close - prev.close;
  return {
    lastPrice: last.close,
    priceChange: change,
    priceChangePercent: prev.close > 0 ? (change / prev.close) * 100 : 0,
  };
}

/** Одна свеча (K-line) в нормализованном виде */
export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Тикер за 24 часа в нормализованном виде */
export interface Ticker24h {
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
}

// Маппинг таймфреймов для Bybit API.
// Ключи — ВСЕ формы, которые ходят по коду: канон приложения ('15m', '1H', 'D'),
// сырые числа секунд/минут из строк URL и мульти-ТФ списков ('15', '60', '240')
// и Bybit-формы ('1', '5', ...). Раньше числовые формы отсутствовали, и
// getMultiTimeframeZones(['15','60',...]) падал с «Invalid interval: 15».
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
};

/** Нормализация произвольной записи ТФ в канон Bybit REST/WS ('15', '60', 'D'...). */
export function toBybitInterval(tf: unknown): string | null {
  if (typeof tf !== 'string') return null;
  const t = tf.trim();
  return INTERVAL_MAP[t] ?? INTERVAL_MAP[t.toUpperCase()] ?? null;
}

export async function fetchKlines(rawSymbol: string, interval: string, rawLimit: number, opts: { force?: boolean } = {}): Promise<Kline[]> {
  // Валидация ввода: symbol — whitelist-символы тикера (крипто и 'ТИКЕР:STOCK'),
  // interval — из разрешённого списка, limit — безопасный диапазон.
  // Это исключает инъекцию параметров в URL запроса к API.
  const symbol = assertValidSymbol(rawSymbol);
  const mapped = toBybitInterval(interval);
  if (!mapped && !isValidTimeframe(interval)) {
    throw new Error(`Invalid interval: ${String(interval).slice(0, 32)}`);
  }
  const limit = clampNumber(rawLimit, 1, 1000, 250);

  const bybitInterval = mapped || interval;

  // ── TradFi: американские акции (Finnhub, бесплатный tier) ──────────────────
  const { base: stockBase, market } = parseMarket(symbol);
  if (market === 'stock') {
    const resolution = toFinnhubResolution(bybitInterval);
    if (!resolution) {
      throw new Error(`Таймфрейм ${String(interval).slice(0, 16)} недоступен для акций`);
    }
    return fetchStockKlines(stockBase, resolution, limit, opts.force === true);
  }

  // force: обход короткого кэша (закрытие бара по WS) — иначе реанализ
  // получит тот же кэшированный ответ и последний бар не обновится
  const cacheKey = `klines:${symbol}:${bybitInterval}:${limit}`;
  if (opts.force) { cache.delete(cacheKey); inflight.delete(cacheKey); }

  // 1) серверный прокси (боевой домен): /api/quotes/klines
  const proxied = await proxyFetch('/api/quotes/klines',
    { symbol, interval: bybitInterval, limit });
  if (Array.isArray(proxied)) return proxied as Kline[];

  // 2) fallback напрямую (dev-режим / backend недоступен)
  const url = `${BASE_URL}/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(bybitInterval)}&limit=${limit}${opts.force ? `&_t=${Date.now()}` : ''}`;
  const data = await cachedFetchJson(cacheKey, url, KLINES_TTL_MS);
  
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }
  
  return data.result.list.map((item: any) => ({
    openTime: parseInt(item[0]),
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
  })).reverse();
}

/** Информация об инструменте Bybit (спот) — для проверки существования пары. */
export interface InstrumentInfo {
  symbol: string;
  status: string;
  is_trading: boolean;
}

export async function fetchInstrumentInfo(rawSymbol: string): Promise<InstrumentInfo | null> {
  const symbol = assertValidSymbol(rawSymbol);
  // Акции: проверка существования тикера — по ответу /quote на сервере
  // (Finnhub отдаёт {} / null для неизвестного символа).
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
  const data = await cachedFetchJson(`instrument:${symbol}`, url, 300_000); // 5 минут
  if (data.retCode !== 0) return null;
  const item = data?.result?.list?.[0];
  if (!item) return null;
  return {
    symbol: item.symbol,
    status: item.status ?? '',
    is_trading: item.isTrading === true || item.status === 'Trading',
  };
}

export async function fetch24hTicker(rawSymbol: string): Promise<Ticker24h> {
  // Валидация symbol защищает от инъекции параметров в URL запроса к Bybit
  const symbol = assertValidSymbol(rawSymbol);

  // TradFi: акции — только через серверный прокси (ключ Finnhub на сервере)
  const { base: stockBase, market: stockMarket } = parseMarket(symbol);
  if (stockMarket === 'stock') return fetchStockQuote(stockBase);

  // 1) серверный прокси (боевой домен)
  const proxied = await proxyFetch('/api/quotes/ticker', { symbol });
  if (proxied && typeof proxied.lastPrice === 'number') return proxied as Ticker24h;

  // 2) fallback напрямую
  const url = `${BASE_URL}/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`;
  const data = await cachedFetchJson(`ticker:${symbol}`, url, TICKER_TTL_MS);
  
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }
  
  const ticker = data.result.list[0];
  const lastPrice = parseFloat(ticker.lastPrice);
  const pct = parseFloat(ticker.price24hPcnt);
  return {
    lastPrice,
    priceChange: Number.isFinite(pct) && Number.isFinite(lastPrice) ? pct * lastPrice : 0,
    priceChangePercent: Number.isFinite(pct) ? pct * 100 : 0,
  };
}
