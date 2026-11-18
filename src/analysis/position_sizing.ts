/**
 * П.1 бэклога — Position Sizing: расчёт размера позиции по ATR (правило 1% риска).
 * В signal_generator стоп по ATR был, но сайзинга не было — здесь он появляется.
 */
import type { RiskPlan, Side, TradeSettings } from './types';

export interface RiskInput {
  entryPrice: number;
  side: Side;
  atr: number;
  settings: TradeSettings;
}

/**
 * Чистая функция расчёта плана сделки:
 *  stopDistance = stopAtrMult × ATR
 *  riskAmount   = capital × riskPct/100
 *  qty          = riskAmount / stopDistance
 *  costs        = qty × entry × 2 × (feeRate + slippageRate)   // вход+выход
 *  netStopLoss  = grossStopLoss + costs
 */
export function computeRiskPlan({ entryPrice, side, atr, settings }: RiskInput): RiskPlan {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`computeRiskPlan: некорректная цена входа ${entryPrice}`);
  }
  if (!Number.isFinite(atr) || atr <= 0) {
    throw new Error(`computeRiskPlan: некорректный ATR ${atr}`);
  }
  const { capital, riskPct, stopAtrMult, feeRate, slippageRate } = settings;
  if (!(capital > 0) || !(riskPct > 0) || !(stopAtrMult > 0)) {
    throw new Error('computeRiskPlan: capital/riskPct/stopAtrMult должны быть > 0');
  }

  const stopDistance = stopAtrMult * atr;
  const stopPrice = side === 'long' ? entryPrice - stopDistance : entryPrice + stopDistance;
  if (side === 'long' && stopPrice <= 0) {
    throw new Error('computeRiskPlan: стоп ушёл в отрицательную зону — уменьшите stopAtrMult');
  }

  const riskAmount = (capital * riskPct) / 100;
  const positionQty = riskAmount / stopDistance;
  const positionValue = positionQty * entryPrice;
  const grossStopLoss = positionQty * stopDistance;
  const costs = positionValue * 2 * (feeRate + slippageRate);
  const netStopLoss = grossStopLoss + costs;

  return {
    atr,
    stopPrice,
    stopAtrMult,
    feeRate,
    slippageRate,
    capital,
    riskPct,
    riskAmount,
    stopDistance,
    positionQty,
    positionValue,
    grossStopLoss,
    costs,
    netStopLoss,
  };
}

/** Формат для UI: «≈ 0.053 BTC» из qty и символа. */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return '—';
  const abs = Math.abs(qty);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return qty.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}
