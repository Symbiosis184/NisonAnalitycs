import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, isRateLimited, describeNetworkError, RateLimitError } from '../../utils/http';


const mkResponse = (status: number, body: unknown = {}, retryAfter?: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k: string) => (k === 'Retry-After' ? retryAfter ?? null : null) },
  clone: () => ({ json: async () => body }),
  json: async () => body,
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('isRateLimited', () => {
  it('распознаёт HTTP 429', () => expect(isRateLimited(429)).toBe(true));
  it('распознаёт Bybit retCode 10006', () => expect(isRateLimited(200, { retCode: 10006 })).toBe(true));
  it('распознаёт Binance code -1003', () => expect(isRateLimited(200, { code: -1003 })).toBe(true));
  it('не срабатывает на обычные коды', () => {
    expect(isRateLimited(200, { retCode: 0 })).toBe(false);
    expect(isRateLimited(500)).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('возвращает успешный ответ без повторов', async () => {
    const fetchMock = vi.fn(async () => mkResponse(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchWithRetry('https://x.test/a', { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('повторяет 5xx до успеха', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      return n < 3 ? mkResponse(503) : mkResponse(200);
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchWithRetry('https://x.test/b', { retries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('не повторяет фатальные 4xx (кроме 429)', async () => {
    const fetchMock = vi.fn(async () => mkResponse(404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('https://x.test/c', { baseDelayMs: 1 })).rejects.toThrow(/HTTP 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('бросает RateLimitError после исчерпания попыток при 429', async () => {
    const fetchMock = vi.fn(async () => mkResponse(429, {}, '1'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchWithRetry('https://x.test/d', { retries: 1, baseDelayMs: 1, maxDelayMs: 2 })
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('сетевая ошибка TypeError превращается в понятное сообщение', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchWithRetry('https://x.test/e', { retries: 0 })).rejects.toThrow(/Сетевая ошибка/);
  });

  it('HTTP 200 с реткодом 10006 (ip banned) прокидывается наверх как обычный ответ', async () => {
    // Bybit отдаёт rate-limit в теле при HTTP 200; fetchWithRetry не читает тело
    // успешных ответов — семантику retCode сохраняет слой bybit.ts
    const fetchMock = vi.fn(async () => mkResponse(200, { retCode: 10006, retMsg: 'ip banned' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchWithRetry('https://x.test/f', { retries: 2, baseDelayMs: 1 });
    expect((await r.json()).retCode).toBe(10006);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('повторяет запрос при 429 и уважает Retry-After', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      return n === 1 ? mkResponse(429, {}, '1') : mkResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchWithRetry('https://x.test/g', { retries: 2, baseDelayMs: 1, maxDelayMs: 2 });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('describeNetworkError', () => {
  it('даёт разные сообщения для разных классов ошибок', () => {
    expect(describeNetworkError(new RateLimitError())).toMatch(/ограничила частоту/i);
    expect(describeNetworkError(new Error('HTTP 404'))).toMatch(/данные|бирж/i);
    expect(describeNetworkError(new Error('Сетевая ошибка'))).toMatch(/соединени/i);
    expect(describeNetworkError(new Error('Таймаут запроса'))).toMatch(/вовремя/i);
    expect(describeNetworkError('что-то')).toMatch(/Не удалось получить данные/);
  });
});
