import { assertValidSymbol, isValidTimeframe, clampNumber } from '../utils/validation';

const BASE_URL = 'https://api.bybit.com';

// Маппинг таймфреймов для Bybit API
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1H': '60',
  '4H': '240',
  '1D': 'D',
  'D': 'D',
  '1W': 'W',
  'W': 'W',
};

export async function fetchKlines(rawSymbol: string, interval: string, rawLimit: number): Promise<any[]> {
  // Валидация ввода: symbol — whitelist-символы тикера, interval — из разрешённого списка,
  // limit — безопасный диапазон. Это исключает инъекцию параметров в URL запроса к API.
  const symbol = assertValidSymbol(rawSymbol);
  if (!isValidTimeframe(interval)) {
    throw new Error(`Invalid interval: ${String(interval).slice(0, 32)}`);
  }
  const limit = clampNumber(rawLimit, 1, 1000, 250);

  const bybitInterval = INTERVAL_MAP[interval] || interval;
  const url = `${BASE_URL}/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(bybitInterval)}&limit=${limit}`;
  const response = await fetch(url);
  const data = await response.json();
  
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

export async function fetch24hTicker(rawSymbol: string): Promise<any> {
  // Валидация symbol защищает от инъекции параметров в URL запроса к Bybit
  const symbol = assertValidSymbol(rawSymbol);
  const url = `${BASE_URL}/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`;
  const response = await fetch(url);
  const data = await response.json();
  
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
