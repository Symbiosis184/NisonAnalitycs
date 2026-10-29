// Слой выбора рынка данных: Crypto (Bybit/Binance, бессрочный 24/7 режим) и
// TradFi (американские акции через Yahoo Finance, сессия NYSE/NASDAQ 09:30–16:00 ET).
// Рынок кодируется в самом тикере: 'AAPL:STOCK' — акция, 'BTCUSDT' — крипта.
// Маркер ':STOCK' проходит whitelist-валидацию SYMBOL_RE ([A-Z0-9:.]{3,25})
// и серверную проверку котировочного прокси, поэтому пробрасывается вплоть до
// api/bybit.ts, где выбирается источник котировок.

import { assertValidSymbol } from '../utils/validation';

export type MarketKind = 'crypto' | 'stock';

/** Маркер фондового рынка в тикере (суффикс после «:»). */
export const STOCK_SUFFIX = ':STOCK';

/** Разбор тикера на базовый символ и рынок. 'AAPL:STOCK' -> {base:'AAPL', market:'stock'} */
export function parseMarket(symbolRaw: unknown): { base: string; market: MarketKind } {
  const s = typeof symbolRaw === 'string' ? symbolRaw.trim().toUpperCase() : '';
  if (s.endsWith(STOCK_SUFFIX)) return { base: s.slice(0, -STOCK_SUFFIX.length), market: 'stock' };
  return { base: s, market: 'crypto' };
}

/** Сборка канонического тикера UI из пары (база + рынок). */
export function makeMarketSymbol(base: string, market: MarketKind): string {
  const b = base.trim().toUpperCase();
  return market === 'stock' ? `${b}${STOCK_SUFFIX}` : b;
}

/** true, если тикер относится к рынку акций. */
export function isStockSymbol(symbol: unknown): boolean {
  return parseMarket(symbol).market === 'stock';
}

/**
 * Тикер для внешних запросов (роуты /analysis/<symbol>, журнал, URL):
 * только A–Z/0-9 и опциональный суффикс ':STOCK'. Дефолт — крипто-тикеры
 * вида BTCUSDT; для беты допускаются и старые формы ('AAPL.US', 'BRK.B'),
 * которые нормализуются к 'AAPL:STOCK'/'BRKB:STOCK'.
 */
export function normalizeTickerInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  if (/^[A-Z0-9]{3,20}$/.test(t)) return t; // крипто и простые тикеры акций
  if (/^[A-Z0-9]{1,10}:STOCK$/.test(t)) return t; // явная фондовая форма
  const legacy = /^([A-Z0-9]{1,8})\.(US|N|O|CM)$/.exec(t); // AAPL.US / BRK.B (старые формы)
  if (legacy) return `${legacy[1]}${STOCK_SUFFIX}`;
  return null;
}

/** Валидация тикера обеих рынков для UI-проверок (мягкая, без исключения). */
export function isValidMarketSymbol(symbol: unknown): boolean {
  return normalizeTickerInput(symbol) !== null;
}

/** Валидация тикера с исключением (используется перед внешними API-запросами). */
export function assertValidMarketSymbol(symbol: unknown): string {
  const n = normalizeTickerInput(symbol);
  if (!n) throw new Error(`Invalid symbol: ${JSON.stringify(symbol)?.slice(0, 64) ?? String(symbol)}`);
  return assertValidSymbol(n);
}

/** Отображаемый тикер: 'AAPL:STOCK' -> 'AAPL', 'BTCUSDT' -> 'BTCUSDT'. */
export function displayTicker(symbol: string): string {
  return parseMarket(symbol).base;
}

/** Подпись рынка для UI-бейджей. */
export function marketLabel(market: MarketKind): string {
  return market === 'stock' ? 'Акции США · NYSE/NASDAQ' : 'Крипто · Bybit спот 24/7';
}
