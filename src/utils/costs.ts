// Учёт торговых издержек (бэклога П.2 паспорта работ)
// По умолчанию — тейкер-комиссия Bybit 0.1% за сторону плюс проскальзывание.
// Чистый P&L = валовый P&L − комиссия входа − комиссия выхода (по фактической цене выхода).

export interface CostModel {
  /** Комиссия в долях от номинала за одну сторону (0.001 = 0.1% тейкер Bybit) */
  feeRate: number;
  /** Проскальзывание в долях цены за одну сторону (0.0005 = 5 б.п.) */
  slippageRate: number;
}

/** Дефолтная модель: Bybit taker 0.1% + 5 б.п. слиппеджа на сторону */
export const DEFAULT_COSTS: CostModel = { feeRate: 0.001, slippageRate: 0.0005 };

/** Суммарные издержки полного цикла (вход + выход) в долях от номинала позиции */
export function cycleCostFraction(costs: CostModel = DEFAULT_COSTS): number {
  return 2 * (costs.feeRate + costs.slippageRate);
}

/**
 * Процентный эффект издержек на сделку: -(fee+slip) на вход и -(fee+slip) на выход.
 * Возвращает отрицательное число (потеря в % от цены входа), NaN при некорректных ценах.
 */
export function costImpactPercent(
  direction: 'long' | 'short',
  entryPrice: number,
  exitPrice: number,
  costs: CostModel = DEFAULT_COSTS,
): number {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice <= 0 || exitPrice <= 0) {
    return NaN;
  }
  void direction; // симметричные линейные издержки: не зависят от направления
  const side = costs.feeRate + costs.slippageRate;
  return -(side + side * (exitPrice / entryPrice)) * 100;
}

/**
 * Эффект издержек, выраженный в единицах риска (R): величина потерь делится
 * на расстояние до стопа в процентах от входа. Используется журналом, чтобы
 * одна и та же запись содержала gross/net-метрики в одном масштабе.
 */
export function costImpactR(
  direction: 'long' | 'short',
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
  costs: CostModel = DEFAULT_COSTS,
): number {
  const impactPct = costImpactPercent(direction, entryPrice, exitPrice, costs);
  const riskPct = Math.abs(entryPrice - stopLoss) / entryPrice;
  if (!Number.isFinite(impactPct) || !(riskPct > 0)) return NaN;
  return impactPct / (riskPct * 100);
}
