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

export interface RateLimitInfo {
  isLimited: boolean;
  retryAfterMs?: number;
}

/**
 * Проверка ответа на rate-limit с извлечением Retry-After.
 * FIX: теперь возвращает объект с retryAfterMs, а не просто boolean.
 */
export function checkRateLimit(
  status: number,
  headers: Headers,
  payload?: { retCode?: number; code?: number } | null
): RateLimitInfo {
  if (status === 429) {
    const retryAfterHeader = Number(headers.get('Retry-After'));
    const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 2000;
    return { isLimited: true, retryAfterMs };
  }
  if (!payload) return { isLimited: false };

  // Bybit: 10006 = "ip banned" / too many visits
  if (typeof payload.retCode === 'number' && payload.retCode === 10006) {
    return { isLimited: true, retryAfterMs: 5000 };
  }
  // Binance: -1003 = Too many requests
  if (typeof payload.code === 'number' && payload.code === -1003) {
    return { isLimited: true, retryAfterMs: 3000 };
  }
  return { isLimited: false };
}

/** Backward compatibility wrapper */
export function isRateLimited(status: number, payload?: { retCode?: number; code?: number } | null): boolean {
  return checkRateLimit(status, new Headers(), payload).isLimited;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface FetchWithRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  logger?: (message: string) => void;
}

export interface FetchMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  totalRetries: number;
  averageLatencyMs: number;
}

const metrics: FetchMetrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  rateLimitedRequests: 0,
  totalRetries: 0,
  averageLatencyMs: 0,
};

export function getFetchMetrics(): FetchMetrics {
  return { ...metrics };
}

export function resetFetchMetrics(): void {
  metrics.totalRequests = 0;
  metrics.successfulRequests = 0;
  metrics.failedRequests = 0;
  metrics.rateLimitedRequests = 0;
  metrics.totalRetries = 0;
  metrics.averageLatencyMs = 0;
}

/**
 * fetch с экспоненциальным backoff и jitter.
 * - Повторяет только сетевые ошибки, таймауты и 5xx/429.
 * - 4xx (кроме 429) считаем фатальными — не повторяем.
 * - При 429 уважаем подсказку Retry-After, если сервер её прислал.
 * - Поддерживает внешний AbortSignal для отмены извне.
 */
export async function fetchWithRetry(url: string, opts: FetchWithRetryOptions = {}): Promise<Response> {
  const {
    retries = 2,
    baseDelayMs = 600,
    maxDelayMs = 8000,
    timeoutMs = 10_000,
    signal,
    headers,
    logger,
  } = opts;

  metrics.totalRequests++;
  const startTime = Date.now();

  let attempt = 0;
  let lastError: unknown;

  // retries — общий верхний предел повторов, включая 429 и Retry-After.
  while (attempt <= retries) {
    if (signal?.aborted) {
      throw new DOMException('Request aborted by user', 'AbortError');
    }

    if (logger) logger(`Попытка ${attempt + 1}/${retries + 1}: ${url}`);

    const controller = new AbortController();
    const abortHandler = () => controller.abort();
    signal?.addEventListener('abort', abortHandler);

    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;

    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: headers ? new Headers(headers) : undefined,
      });

      if (response.ok) {
        metrics.successfulRequests++;
        const latency = Date.now() - startTime;
        metrics.averageLatencyMs =
          (metrics.averageLatencyMs * (metrics.successfulRequests - 1) + latency) / metrics.successfulRequests;
        metrics.totalRetries += attempt;
        return response;
      }

      // Пробуем прочитать тело для кодов rate-limit
      let payload: { retCode?: number; code?: number } | undefined;
      try {
        payload = await response.clone().json();
      } catch {
        /* не-JSON тело — игнорируем */
      }

      const rateLimitInfo = checkRateLimit(response.status, response.headers, payload);
      if (rateLimitInfo.isLimited) {
        throw new RateLimitError(undefined, rateLimitInfo.retryAfterMs);
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
        if (signal?.aborted) {
          throw err; // пользовательская отмена — не повторяем
        }
        lastError = new Error('Таймаут запроса');
      } else if (err instanceof TypeError) {
        lastError = new Error('Сетевая ошибка');
      } else if ((err as Error).message?.startsWith('HTTP')) {
        lastError = err;
        if ((err as Error).message.match(/HTTP 4(?!29)/)) break;
      } else {
        lastError = err;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortHandler);
    }

    attempt++;
    if (attempt > retries) break;

    const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    const jitter = delay * (0.5 + Math.random() * 0.5);
    const wait = lastError instanceof RateLimitError
      ? Math.max(jitter, lastError.retryAfterMs)
      : jitter;

    if (logger) logger(`Ожидание ${Math.round(wait)}мс перед повтором`);
    await sleep(wait);
  }

  metrics.failedRequests++;
  metrics.totalRetries += attempt;
  if (lastError instanceof RateLimitError) {
    metrics.rateLimitedRequests++;
    throw lastError;
  }
  throw lastError instanceof Error ? lastError : new Error('Запрос не выполнен');
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
  if (/HTTP 404/i.test(msg)) {
    return 'API endpoint не найден. Проверьте URL или обратитесь к разработчику.';
  }
  if (/HTTP 5\d\d/i.test(msg)) {
    return 'Сервер биржи временно недоступен. Попробуйте через минуту.';
  }
  if (/таймаут|timeout/i.test(msg)) {
    return 'Сервер биржи не ответил вовремя. Попробуйте обновить страницу.';
  }
  if (/CORS|Access-Control/i.test(msg)) {
    return 'Браузер заблокировал запрос к API биржи (CORS). Используйте прокси или обратитесь к разработчику.';
  }
  if (/DNS|getaddrinfo|ENOTFOUND/i.test(msg)) {
    return 'Не удалось разрешить имя сервера биржи. Проверьте интернет-соединение.';
  }
  if (/сетевая ошибка|failed to fetch|networkerror/i.test(msg)) {
    return 'Нет соединения с API биржи. Проверьте интернет или зайдите позже.';
  }
  if (/aborted|cancelled/i.test(msg)) {
    return 'Запрос был отменён.';
  }
  return 'Не удалось получить данные с биржи. Попробуйте обновить страницу.';
}
