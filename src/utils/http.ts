/**
 * Утилиты HTTP для устойчивой работы с публичными API бирж.
 *
 * П.3 плана: обработка сетевых ошибок — retry с экспоненциальным backoff,
 * распознавание rate-limit (HTTP 429 / коды Bybit 10006, Binance -1003) и
 * человекочитаемые сообщения об ошибках для UI.
 */

export class RateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(message = 'Превышен лимит запросов к API', retryAfterMs = 2000) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Распознавание ответов с ограничением частоты запросов */
export function isRateLimited(status: number, payload?: { retCode?: number; code?: number }): boolean {
  if (status === 429) return true;
  // Bybit: 10006 = "ip banned" / too many visits
  if (payload && typeof payload.retCode === 'number' && payload.retCode === 10006) return true;
  // Binance: -1003 = Too many requests
  if (payload && typeof payload.code === 'number' && payload.code === -1003) return true;
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface FetchWithRetryOptions {
  retries?: number;          // количество повторных попыток после первой
  baseDelayMs?: number;      // базовая задержка backoff
  maxDelayMs?: number;       // потолок задержки
  timeoutMs?: number;        // таймаут одной попытки
}

/**
 * fetch с экспоненциальным backoff и jitter.
 * - Повторяет только сетевые ошибки, таймауты и 5xx/429.
 * - 4xx (кроме 429) считаем фатальными — не повторяем.
 * - При 429 уважаем подсказку Retry-After, если сервер её прислал.
 */
export async function fetchWithRetry(url: string, opts: FetchWithRetryOptions = {}): Promise<Response> {
  const { retries = 2, baseDelayMs = 600, maxDelayMs = 8000, timeoutMs = 10_000 } = opts;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });

      if (response.ok) return response;

      // Пробуем прочитать тело для кодов rate-limit (иногда 429 приходит с телом)
      let payload: { retCode?: number; code?: number } | undefined;
      try {
        payload = await response.clone().json();
      } catch {
        /* не-JSON тело — игнорируем */
      }

      if (isRateLimited(response.status, payload)) {
        const retryAfterHeader = Number(response.headers.get('Retry-After'));
        const ra = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : undefined;
        throw new RateLimitError(undefined, ra);
      }

      // 4xx (кроме 429) — повтор бессмысленен
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP ${response.status}`);
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      if (err instanceof RateLimitError) {
        lastError = err;
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new Error('Таймаут запроса');
      } else if (err instanceof TypeError) {
        lastError = new Error('Сетевая ошибка'); // fetch network failure
      } else if ((err as Error).message?.startsWith('HTTP')) {
        lastError = err; // фатальная 4xx — выходим из цикла ниже
        if ((err as Error).message.match(/HTTP 4(?!29)/)) break;
      } else {
        lastError = err;
      }
    } finally {
      clearTimeout(timer);
    }

    attempt++;
    if (attempt > retries) break;

    const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    const jitter = delay * (0.5 + Math.random() * 0.5);
    const wait = lastError instanceof RateLimitError
      ? Math.max(jitter, lastError.retryAfterMs)
      : jitter;
    await sleep(wait);
  }

  if (lastError instanceof RateLimitError) throw lastError;
  throw (lastError instanceof Error ? lastError : new Error('Запрос не выполнен'));
}

/** Понятное для пользователя сообщение о сетевой ошибке */
export function describeNetworkError(err: unknown): string {
  if (err instanceof RateLimitError) {
    return 'Биржа ограничила частоту запросов. Подождите пару минут и попробуйте снова.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 40[13]|invalid symbol/i.test(msg)) {
    return 'Инструмент не найден на бирже или недоступен.';
  }
  if (/таймаут/i.test(msg)) {
    return 'Сервер биржи не ответил вовремя. Попробуйте обновить страницу.';
  }
  if (/сетевая ошибка|failed to fetch|networkerror/i.test(msg)) {
    return 'Нет соединения с API биржи. Проверьте интернет или зайдите позже.';
  }
  return 'Не удалось получить данные с биржи. Попробуйте обновить страницу.';
}
