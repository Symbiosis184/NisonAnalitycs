// Бэктест-движок (backlog П.3 паспорта работ)
// Эмпирическая проверка «ребра» (edge) свечных паттернов Нисона на истории:
// для каждого срабатывания детектора открываем сделку по close свечи сигнала,
// стоп = граница формации, тейк = RR от риска; исход определяем по high/low
// последующих свечей. Издержки вычитаются из результата каждой сделки.
//
// Гарантии честности:
//  • сигнал формируется только по данным history[0..i] (детектор не видит будущего);
//  • вход — close[i], управление позицией начинается со свечи i+1 (без lookahead);
//  • если стоп и тейк попали в одну свечу — засчитывается стоп (консервативно).

import type { Candle } from './candle';
import { cycleCostFraction, DEFAULT_COSTS, type CostModel } from './costs';

export interface BacktestConfig {
  /** Детектор паттерна: получает историю до индекса i включительно, возвращает границы формации или null */
  detect: (history: Candle[], i: number) => FormationBounds | null;
  direction: 'long' | 'short';
  /** Горизонт сделки в свечах: недодержанные позиции закрываются по close (time-based exit) */
  maxHoldingBars?: number;
  /** Тейк как кратное риску; по умолчанию 2R (порог SignalGenerator) */
  rewardRiskRatio?: number;
  costs?: CostModel;
}

export interface FormationBounds {
  patternLow: number;
  patternHigh: number;
}

export interface BacktestTrade {
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  outcome: 'target' | 'stop' | 'timeout';
  grossR: number; // результат в единицах риска до издержек
  netR: number;   // результат после издержек
}

export interface BacktestResult {
  trades: BacktestTrade[];
  stats: BacktestStats;
  equityCurve: number[]; // накопленный net R по сделкам
}

export interface BacktestStats {
  totalTrades: number;
  wins: number;      // закрыты в плюс по netR
  winRate: number;   // % сделок с netR > 0
  avgGrossR: number;
  avgNetR: number;   // expectancy, R/сделка
  profitFactor: number;
  totalNetR: number;
  maxDrawdownR: number;
  costsDragR: number; // суммарные издержки в R
}

/**
 * Прогон конфигурации по серии свечей. Минус one-at-a-time: сигналы одного
 * паттерна могут перекрываться окнами удержания — это осознанно даёт выборку
 * «все срабатывания детектора», а не портфельную симуляцию.
 */
export function runBacktest(candles: Candle[], config: BacktestConfig): BacktestResult {
  const {
    detect, direction,
    maxHoldingBars = 60,
    rewardRiskRatio = 2,
    costs = DEFAULT_COSTS,
  } = config;

  const trades: BacktestTrade[] = [];
  const costFrac = cycleCostFraction(costs);

  for (let i = 0; i < candles.length; i++) {
    const bounds = detect(candles.slice(0, i + 1), i);
    if (!bounds) continue;

    const entry = candles[i].close;
    const stop = direction === 'long' ? bounds.patternLow : bounds.patternHigh;
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) continue;
    if (direction === 'long' && !(stop < entry)) continue;
    if (direction === 'short' && !(stop > entry)) continue;

    const target = direction === 'long' ? entry + rewardRiskRatio * risk : entry - rewardRiskRatio * risk;

    // Управление позицией со следующей свечи
    let exitIndex = -1;
    let exitPrice = 0;
    let outcome: BacktestTrade['outcome'] = 'timeout';

    const horizonEnd = Math.min(i + maxHoldingBars, candles.length - 1);
    for (let j = i + 1; j <= horizonEnd; j++) {
      const c = candles[j];
      if (direction === 'long') {
        if (c.low <= stop) { exitIndex = j; exitPrice = stop; outcome = 'stop'; break; }
        if (c.high >= target) { exitIndex = j; exitPrice = target; outcome = 'target'; break; }
      } else {
        if (c.high >= stop) { exitIndex = j; exitPrice = stop; outcome = 'stop'; break; }
        if (c.low <= target) { exitIndex = j; exitPrice = target; outcome = 'target'; break; }
      }
    }

    if (exitIndex === -1) {
      // История закончилась раньше горизонта: закрываем по последней доступной свече
      const lastJ = horizonEnd > i ? horizonEnd : -1;
      if (lastJ === -1) continue; // нет ни одной свечи для управления — сигнал не тестируем
      exitIndex = lastJ;
      exitPrice = candles[lastJ].close;
      outcome = 'timeout';
    }

    const move = direction === 'long' ? exitPrice - entry : entry - exitPrice;
    const grossR = move / risk;
    const costsR = (costFrac * entry) / risk; // издержки цикла, приведённые к риску
    const netR = grossR - costsR;

    trades.push({
      entryIndex: i,
      entryTime: candles[i].time,
      entryPrice: entry,
      stopPrice: stop,
      targetPrice: target,
      exitIndex,
      exitTime: candles[exitIndex].time,
      exitPrice,
      outcome,
      grossR,
      netR,
    });
  }

  return { trades, stats: computeStats(trades, costFrac), equityCurve: buildEquity(trades) };
}

export function computeStats(trades: BacktestTrade[], costFrac: number): BacktestStats {
  const n = trades.length;
  if (n === 0) {
    return {
      totalTrades: 0, wins: 0, winRate: 0, avgGrossR: 0, avgNetR: 0,
      profitFactor: 0, totalNetR: 0, maxDrawdownR: 0, costsDragR: 0,
    };
  }

  let grossSum = 0, netSum = 0, wins = 0, grossProfit = 0, grossLoss = 0;
  for (const t of trades) {
    grossSum += t.grossR;
    netSum += t.netR;
    if (t.netR > 0) wins++;
    if (t.grossR > 0) grossProfit += t.grossR; else grossLoss += -t.grossR;
  }

  // Profit factor по чистому результату: прибыль/убыток после издержек
  let netProfit = 0, netLossAbs = 0;
  for (const t of trades) {
    if (t.netR > 0) netProfit += t.netR; else netLossAbs += -t.netR;
  }

  // Максимальная просадка кривы капитала (в R)
  let eq = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    eq += t.netR;
    if (eq > peak) peak = eq;
    maxDd = Math.max(maxDd, peak - eq);
  }

  void grossSum; void grossProfit; void grossLoss;
  return {
    totalTrades: n,
    wins,
    winRate: (wins / n) * 100,
    avgGrossR: trades.reduce((s, t) => s + t.grossR, 0) / n,
    avgNetR: netSum / n,
    profitFactor: netLossAbs > 0 ? netProfit / netLossAbs : netProfit > 0 ? Infinity : 0,
    totalNetR: netSum,
    maxDrawdownR: maxDd,
    costsDragR: trades.length * costFrac * 0 + // издержки уже внутри netR; считаем явно:
      trades.reduce((s, t) => s + (t.grossR - t.netR), 0),
  };
}

export function buildEquity(trades: BacktestTrade[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const t of trades) {
    acc += t.netR;
    out.push(acc);
  }
  return out;
}
