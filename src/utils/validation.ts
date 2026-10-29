// Валидация пользовательского ввода (символы бирж, таймфреймы, данные журнала)
// Защита от инъекции параметров в URL внешних API и от некорректных данных из localStorage/импорта

// A–Z/0-9 плюс необязательный суффикс рынка ':STOCK' (TradFi-тикеры вида
// 'AAPL:STOCK' — см. src/api/market.ts). Двоеточие разрешено только в этой
// форме, поэтому инъекция параметров в URL внешних API по-прежнему исключена.
const SYMBOL_RE = /^[A-Z0-9]{3,20}(?::STOCK)?$/;

const ALLOWED_TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '1H', '4H', '1D', 'D', '1W', 'W']);

// Числовые формы интервалов Bybit (секунды/минуты), встречающиеся в URL и
// мульти-ТФ списках: '15' -> '15m', '60' -> '1H', '240' -> '4H' и т.д.
const NUMERIC_TF_CANON: Record<string, string> = {
  '1': '1m', '3': '5m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1H', '120': '4H', '240': '4H',
};

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

/** Валидация таймфрейма по whitelist (принимает канон '15m'/'1H'/'D' и числовые формы Bybit '15'/'60'/'240'). */
export function isValidTimeframe(tf: unknown): tf is string {
  return typeof tf === 'string' && (ALLOWED_TIMEFRAMES.has(tf) || ALLOWED_TIMEFRAMES.has(NUMERIC_TF_CANON[tf] ?? ''));
}

/**
 * Приведение к безопасному числу: не-числа/NaN/Infinity → fallback,
 * конечные значения клампятся в [min, max].
 */
export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallbackOrMax: number = max,
): number {
  // Фолбэк — необязательный 4-й аргумент. Если он не передан, используется max.
  // Важно: сам `value` может быть NaN/null/строкой — тогда возвращаем фолбэк,
  // но валидное число всегда клампится в [min, max].
  const fallback = arguments.length >= 4 ? fallbackOrMax : max;
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
