/**
 * TradFi-акции: serving-stale. Если Yahoo/прокси недоступен (429/5xx),
 * fetchKlines для акций отдаёт последние успешные свечи вместо ошибки —
 * дашборд показывает карточки с прошлыми ценами, а не «Ошибка загрузки».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const kline = (t: number) => ({
  openTime: t, open: 100, high: 101, low: 99, close: 100.5, volume: 10,
});
const goodBars = Array.from({ length: 5 }, (_, i) => kline(1700000000000 + i * 86400000));

describe('fetchKlines(:STOCK): serving-stale при недоступном источнике', () => {
  beforeEach(() => {
    // Боевой домен: hasBackend() === true (есть meta-токен)
    document.head.innerHTML = '<meta name="kairi-api-token" content="tok">';
    vi.resetModules();
  });
  afterEach(() => {
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('отдаёт протухший кэш, когда прокси отвечает 429', async () => {
    let first = true;
    const fetchMock = vi.fn(async (_url: string, _init?: any) => {
      if (first) {
        first = false;
        return { ok: true, status: 200, json: async () => ({ data: goodBars }) };
      }
      return { ok: false, status: 429, json: async () => ({ detail: 'yahoo rate limited' }) };
    }) as any;
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./api/bybit');
    // 1) успешный запрос — попадает в клиентский кэш
    const got1 = await mod.fetchKlines('AAPL:STOCK', 'D', 5);
    expect(got1).toHaveLength(5);

    // 2) TTL кэша истёк, источник падает с 429 — получаем stale-данные
    await vi.waitFor(() => {
      // троттлер выдержит ~350мс; кэш KLINES_TTL_MS=30с — искусственно
      // «состарим» его через force=false повтор после смены времени
    });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
    try {
      const got2 = await mod.fetchKlines('AAPL:STOCK', 'D', 5);
      expect(got2).toHaveLength(5);
      expect(got2[0].openTime).toBe(goodBars[0].openTime);
    } finally {
      vi.useRealTimers();
    }
  });

  it('бросает ошибку, если кэша нет вообще', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 502, json: async () => ({ detail: 'bad gateway' }),
    })) as any);
    const mod = await import('./api/bybit');
    await expect(mod.fetchKlines('TSLA:STOCK', 'D', 5)).rejects.toThrow(/недоступен|502|Ошибка источника/i);
  });
});
