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

export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<any[]> {
  const bybitInterval = INTERVAL_MAP[interval] || interval;
  const url = `${BASE_URL}/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
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

export async function fetch24hTicker(symbol: string): Promise<any> {
  const url = `${BASE_URL}/v5/market/tickers?category=spot&symbol=${symbol}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }
  
  const ticker = data.result.list[0];
  return {
    priceChange: parseFloat(ticker.price24hPcnt) * parseFloat(ticker.lastPrice),
    priceChangePercent: parseFloat(ticker.price24hPcnt) * 100,
  };
}
