// Рыночные режимы (market regime) — детекция по истории закрытых свечей.
// Идея: паттерны Нисона (разворотные) статистически сильнее в трендовом рынке
// и слабее в боковике; continuation-сетапы наоборот. Модуль даёт бейдж режима
// и коэффициент доверия к сигналам, не меняя саму методологию распознавания.

import type { Candle } from './candle';

export type Regime = 'trend-up' | 'trend-down' | 'range' | 'volatile-breakout';

export interface RegimeInfo {
  regime: Regime;
  /** Сила тренда 0..1 (нормированный ADX-подобный показатель) */
  trendStrength: number;
  /** Волатильность относительно среднего ATR (коэффициент) */
  volatilityRatio: number;
  /** Множитель качества сигнала: >1 усиливает, <1 ослабляет */
  multiplier: number;
}

/** SMA закрытий */
function sma(values: number[], period: number): number {
  const s = values.slice(-period);
  return s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
}

/** Wilder ATR на полном массиве свечей (последнее значение) */
function atrLast(candles: Candle[], period = 14): number {
  if (candles.length <= period) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    atr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

/**
 * Детекция режима рынка по последним `lookback` свечам.
 * Только закрытые свечи; никаких данных из будущего.
 */
export function detectRegime(candles: Candle[], lookback = 60): RegimeInfo {
  const data = candles.slice(-Math.max(30, lookback));
  const closes = data.map((c) => c.close);
  const fast = sma(closes, 10);
  const slow = sma(closes, 30);
  const atr = atrLast(data, 14);
  const price = closes[closes.length - 1] ?? 0;
  const spreadPct = price > 0 ? Math.abs(fast - slow) / price : 0;
  // волатильность: ATR периода против длинного базового ATR
  const baseAtr = atrLast(candles, 50) || atr || 1;
  const volatilityRatio = atr / baseAtr;

  let regime: Regime;
  let trendStrength = Math.min(1, spreadPct * 25); // ~4% спред MA => сила 1.0

  if (spreadPct > 0.012 && volatilityRatio > 1.6) {
    regime = 'volatile-breakout';
  } else if (spreadPct > 0.008) {
    regime = fast > slow ? 'trend-up' : 'trend-down';
  } else {
    regime = 'range';
    trendStrength = Math.max(0.1, trendStrength);
  }

  let multiplier = 1.0;
  switch (regime) {
    case 'trend-up':
    case 'trend-down':
      multiplier = 1.0 + 0.15 * trendStrength; // тренд усиливает развороты по тренду
      break;
    case 'range':
      multiplier = 0.85; // в боковике сигналы надёжнее только у границ — штраф
      break;
    case 'volatile-breakout':
      multiplier = 0.75; // высокий риск ложных пробоев/шума
      break;
  }

  return { regime, trendStrength, volatilityRatio, multiplier };
}

/** Согласован ли сигнал (BUY/SELL) с направлением тренда? */
export function signalAlignsWithRegime(side: 'long' | 'short', info: RegimeInfo): boolean {
  if (info.regime === 'trend-up') return side === 'long';
  if (info.regime === 'trend-down') return side === 'short';
  return true; // range/breakout — нейтрально
}
