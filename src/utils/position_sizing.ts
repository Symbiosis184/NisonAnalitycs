// Расчёт размера позиции (backlog П.1 паспорта работ)
// Правило фиксированного риска: рискуем не более riskPct капитала на сделку,
// расстояние до стопа берём из сигнала (стоп по границе формации Нисона).
// Учитываем издержки: стоп-лосс срабатывает вместе с комиссиями/слиппеджем,
// поэтому фактический убыток = риск + издержки цикла — sizing это закладывает.

import { cycleCostFraction, DEFAULT_COSTS, type CostModel } from './costs';

export interface PositionPlanInput {
  capitalUsd: number;      // размер депозита в USDT
  riskPct: number;         // риск на сделку, доля капитала (0.01 = 1%)
  entryPrice: number;      // цена входа
  stopPrice: number;       // цена защитного ордера
  costs?: CostModel;       // модель издержек (по умолчанию Bybit taker 0.1% + слиппедж)
  maxNotionalPct?: number; // потолок номинала позиции, доля капитала (по умолчанию 1.0)
}

export interface PositionPlan {
  riskUsd: number;         // заявленный риск (деньги)
  stopDistancePct: number; // |entry − stop| / entry
  qty: number;             // размер позиции в базовом активе (BTC и т.п.)
  notionalUsd: number;     // qty * entry
  costReserveUsd: number;  // резерв на комиссии+слиппедж полного цикла
  worstCaseLossUsd: number;// реальный убыток при срабатывании стопа (риск + издержки)
  worstCaseLossPct: number;// то же, в % капитала
  cappedByNotional: boolean; // упёрся ли размер в потолок номинала
  leverage: number;        // требуемое кредитное плечо (notional / capital), 1 = без плеча
}

/**
 * Рассчитывает план позиции. Возвращает null при некорректных входных данных
 * (цена вне стопа в нужную сторону, нулевой капитал/риск и т.д.).
 */
export function planPosition(input: PositionPlanInput): PositionPlan | null {
  const {
    capitalUsd, riskPct, entryPrice, stopPrice,
    costs = DEFAULT_COSTS,
    maxNotionalPct = 1,
  } = input;

  if (!Number.isFinite(capitalUsd) || capitalUsd <= 0) return null;
  if (!Number.isFinite(riskPct) || riskPct <= 0 || riskPerCheck(riskPct)) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) return null;
  if (Math.abs(entryPrice - stopPrice) < 1e-12) return null; // нулевой риск — R не определить

  const stopDistancePct = Math.abs(entryPrice - stopPrice) / entryPrice;
  const riskUsd = capitalUsd * riskPct;

  // Убыток на единицу базы при срабатывании стопа + издержки цикла (от номинала)
  const lossPerUnit = Math.abs(entryPrice - stopPrice);
  const costPerUnitFraction = cycleCostFraction(costs);

  // qty из условия: qty*lossPerUnit + qty*entryPrice*costFrac = riskUsd
  let qty = riskUsd / (lossPerUnit + entryPrice * costPerUnitFraction);

  const maxNotional = capitalUsd * maxNotionalPct;
  let capped = false;
  if (qty * entryPrice > maxNotional) {
    qty = maxNotional / entryPrice;
    capped = true;
  }

  const notionalUsd = qty * entryPrice;
  const costReserveUsd = notionalUsd * costPerUnitFraction;
  const worstCaseLossUsd = qty * lossPerUnit + costReserveUsd;

  return {
    riskUsd,
    stopDistancePct,
    qty,
    notionalUsd,
    costReserveUsd,
    worstCaseLossUsd,
    worstCaseLossPct: (worstCaseLossUsd / capitalUsd) * 100,
    cappedByNotional: capped,
    leverage: notionalUsd / capitalUsd,
  };
}

function riskPerCheck(riskPct: number): boolean {
  return riskPct > 1; // риск больше 100% капитала — явная ошибка ввода
}
