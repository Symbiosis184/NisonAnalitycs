import { assertValidSymbol, isValidTimeframe, clampNumber } from '../utils/validation';
import { fetchWithRetry } from '../utils/http';

const BASE_URL = 'https://api.bybit.com';

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
  // Валидация ввода: symbol — whitelist-символы тикера, interval — из разрешённого списка,
  // limit — безопасный диапазон. Это исключает инъекцию параметров в URL запроса к API.
  const symbol = assertValidSymbol(rawSymbol);
  const mapped = toBybitInterval(interval);
  if (!mapped && !isValidTimeframe(interval)) {
    throw new Error(`Invalid interval: ${String(interval).slice(0, 32)}`);
  }
  const limit = clampNumber(rawLimit, 1, 1000, 250);

  const bybitInterval = mapped || interval;
  // force: обход короткого кэша (закрытие бара по WS) — иначе реанализ
  // получит тот же кэшированный ответ и последний бар не обновится
  const url = `${BASE_URL}/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(bybitInterval)}&limit=${limit}${opts.force ? `&_t=${Date.now()}` : ''}`;
  const cacheKey = `klines:${symbol}:${bybitInterval}:${limit}`;
  if (opts.force) { cache.delete(cacheKey); inflight.delete(cacheKey); }
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
