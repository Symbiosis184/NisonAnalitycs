import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKlines, fetch24hTicker } from '../../api/bybit';

const klinesResponse = (n = 3) => ({
  retCode: 0,
  result: {
    list: Array.from({ length: n }, (_, i) => [
      String((1700000000 + i * 86400) * 1000),
      '100', '105', '98', '104', '12.5',
    ]).reverse(), // Bybit отдаёт новые в начале — код реверсит
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchKlines — валидация и защита от инъекций', () => {
  it('бросает на вредный symbol и НЕ делает сетевой запрос', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchKlines('BTCUSDT&interval=D', '1D', 250)).rejects.toThrow();
    await expect(fetchKlines('', '1D', 250)).rejects.toThrow();
    await expect(fetchKlines('<script>', '1D', 250)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('бросает на недопустивый interval без запроса', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchKlines('BTCUSDT', '5m; DROP', 250)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('клампит limit в безопасный диапазон', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return { json: async () => klinesResponse() };
    }));
    await fetchKlines('BTCUSDT', '1D', 1_000_000);
    expect(capturedUrl).toContain('limit=1000');
    await fetchKlines('ETHUSDT', '1H', -5);
    expect(capturedUrl).toContain('limit=1');
    vi.unstubAllGlobals();
  });

  it('возвращает разобранные свечи в хронологическом порядке', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => klinesResponse(3) })));
    const candles = await fetchKlines('SOLUSDT', '1D', 3);
    expect(candles).toHaveLength(3);
    expect(candles[0].close).toBe(104);
    expect(candles[0].volume).toBe(12.5);
    // time монотонно возрастает после reverse
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].openTime).toBeGreaterThan(candles[i - 1].openTime);
    }
    vi.unstubAllGlobals();
  });

  it('бросает при retCode != 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ retCode: 10001, retMsg: 'invalid symbol' }),
    })));
    await expect(fetchKlines('FAKECOIN', '1D', 10)).rejects.toThrow(/Bybit API error/);
    vi.unstubAllGlobals();
  });
});

describe('fetch24hTicker', () => {
  it('валидирует symbol до запроса', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(fetch24hTicker('BTC USDT!')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('парсит lastPrice и процент изменения', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        retCode: 0,
        result: { list: [{ lastPrice: '50000', price24hPcnt: '0.025' }] },
      }),
    })));
    const t = await fetch24hTicker('XRPUSDT');
    expect(t.lastPrice).toBe(50000);
    expect(t.priceChangePercent).toBeCloseTo(2.5);
    expect(t.priceChange).toBeCloseTo(1250);
    vi.unstubAllGlobals();
  });

  it('не выдаёт NaN при мусорных данных цены', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        retCode: 0,
        result: { list: [{ lastPrice: 'abc', price24hPcnt: 'xyz' }] },
      }),
    })));
    const t = await fetch24hTicker('DOGEUSDT');
    expect(Number.isNaN(t.lastPrice)).toBe(true); // lastPrice остаётся честным NaN из API
    expect(t.priceChange).toBe(0);               // но производные поля защищены от NaN
    expect(t.priceChangePercent).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe('Кэш Bybit-клиента', () => {
  it('повторный идентичный запрос берётся из кэша (fetch вызывается 1 раз)', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => klinesResponse(2) }));
    vi.stubGlobal('fetch', fetchMock);
    // уникальный symbol, чтобы не пересечься с кэшем других тестов
    await fetchKlines('CACHEOK', '1D', 2);
    await fetchKlines('CACHEOK', '1D', 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
