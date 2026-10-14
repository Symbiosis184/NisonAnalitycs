// Валидация пользовательского ввода (символы бирж, таймфреймы, данные журнала)
// Защита от инъекции параметров в URL внешних API и от некорректных данных из localStorage/импорта

const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;

const ALLOWED_TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '1H', '4H', '1D', 'D', '1W', 'W']);

/**
 * Проверяет, что symbol — это безопасный идентификатор тикера (A-Z, 0-9).
 * Бросает исключение при недопустимом значении, чтобы предотвратить
 * манипуляцию параметрами запросов к Bybit/Binance.
 */
export function assertValidSymbol(symbol: unknown): string {
  if (typeof symbol !== 'string') {
    throw new Error('Invalid symbol: not a string');
  }
  const normalized = symbol.trim().toUpperCase();
  if (!SYMBOL_RE.test(normalized)) {
    throw new Error(`Invalid symbol: ${JSON.stringify(symbol).slice(0, 64)}`);
  }
  return normalized;
}

/** Возвращает true, если symbol проходит валидацию (для мягких проверок в UI). */
export function isValidSymbol(symbol: unknown): boolean {
  return typeof symbol === 'string' && SYMBOL_RE.test(symbol.trim().toUpperCase());
}

/** Валидация таймфрейма по whitelist. */
export function isValidTimeframe(tf: unknown): tf is string {
  return typeof tf === 'string' && ALLOWED_TIMEFRAMES.has(tf);
}

/** Ограничение числа безопасным диапазоном с фолбэком. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Ограничение длины строки + удаление управляющих символов. */
export function sanitizeText(value: unknown, maxLen: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return cleaned.slice(0, maxLen);
}
