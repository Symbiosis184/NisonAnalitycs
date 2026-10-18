/**
 * П.3 бэклога — Бэктест-движок: эмпирическая проверка edge паттернов Нисона на истории.
 * Модель сделки (консервативная, без lookahead):
 *  - вход по close свечи подтверждения;
 *  - стоп = entry ∓ stopAtrMult×ATR[i] (ATR считается только по данным ≤ i);
 *  - TP = entry ± tpR × risk (если tpR > 0);
 *  - внутри бара: сначала проверяется стоп (пессимистично), затем TP;
 *  - проскальзывание и комиссии применяются к цене исполнения (п.2).
 */
import type {
  BacktestMetrics,
  BacktestParams,
  BacktestResult,
  BacktestTrade,
  Candle,
} from './types';
import { atr } from './indicators';
import { scanPatterns } from './patterns';

export const DEFAULT_BACKTEST_PARAMS: BacktestParams = {
  stopAtrMult: 1.5,
  tpR: 2,
  maxBars: 48,
  feeRate: 0.001,
  slippageRate: 0.0005,
};

/** Проскальзывание ухудшает цену: покупка дороже, продажа дешевле. */
function slipped(price: number, isBuy: boolean, slip: number): number {
  return isBuy ? price * (1 + slip) : price * (1 - slip);
}

export function simulateOne(
  candles: Candle[],
  signalIndex: number,
  side: 'long' | 'short',
  params: BacktestParams,
): BacktestTrade | null {
  const n = candles.length;
  if (signalIndex >= n - 1) return null;
  const atrSeries = atr(candles, 14);
  const a = atrSeries[signalIndex];
  if (!Number.isFinite(a) || a <= 0) return null;

  const c = candles[signalIndex];
  const rawEntry = c.close;
  const entryIsBuy = side === 'long';
  const entryPrice = slipped(rawEntry, entryIsBuy, params.slippageRate);
  const risk = params.stopAtrMult * a;
  const stopPrice = side === 'long' ? entryPrice - risk : entryPrice + risk;
  const tpPrice = params.tpR > 0
    ? side === 'long' ? entryPrice + params.tpR * risk : entryPrice - params.tpR * risk
    : null;

  const lastBar = Math.min(n - 1, signalIndex + params.maxBars);
  let exitRaw = candles[lastBar].close;
  let exitReason: BacktestTrade['exitReason'] = 'time';
  let exitIndex = lastBar;

  for (let i = signalIndex + 1; i <= lastBar; i++) {
    const bar = candles[i];
    if (side === 'long') {
      if (bar.low <= stopPrice) {
        exitRaw = stopPrice;
        exitReason = 'stop';
        exitIndex = i;
        break;
      }
      if (tpPrice != null && bar.high >= tpPrice) {
        exitRaw = tpPrice;
        exitReason = 'tp';
        exitIndex = i;
        break;
      }
    } else {
      if (bar.high >= stopPrice) {
        exitRaw = stopPrice;
        exitReason = 'stop';
        exitIndex = i;
        break;
      }
      if (tpPrice != null && bar.low <= tpPrice) {
        exitRaw = tpPrice;
        exitReason = 'tp';
        exitIndex = i;
        break;
      }
    }
  }

  const exitIsBuy = side !== 'long'; // выход шорта = покупка
  const exitPrice = slipped(exitRaw, exitIsBuy, params.slippageRate);

  // Издержки на единицу: комиссии за обе стороны + суммарное проскальзывание входа и выхода.
  const dir = side === 'long' ? 1 : -1;
  const grossMoneyPerUnit = dir * (exitRaw - rawEntry);
  const feesPerUnit = entryPrice * params.feeRate + exitPrice * params.feeRate;
  const entrySlip = Math.abs(entryPrice - rawEntry);
  const exitSlip = Math.abs(exitPrice - exitRaw);
  const costPerUnit = feesPerUnit + entrySlip + exitSlip;

  const grossR = grossMoneyPerUnit / risk;
  const costR = costPerUnit / risk;
  const netR = grossR - costR;

  return {
    patternName: '',
    side,
    entryTime: c.time,
    entryPrice,
    exitTime: candles[exitIndex].time,
    exitPrice,
    exitReason,
    barsHeld: exitIndex - signalIndex,
    grossR,
    costR,
    netR,
  };
}

/** Полный прогон: сканирование истории → симуляция каждой сигнальной свечи → метрики нетто. */
export function runBacktest(
  candles: Candle[],
  params: Partial<BacktestParams> = {},
): BacktestResult {
  const p: BacktestParams = { ...DEFAULT_BACKTEST_PARAMS, ...params };
  const signals = scanPatterns(candles);
  const trades: BacktestTrade[] = [];

  for (const s of signals) {
    const t = simulateOne(candles, s.index, s.side, p);
    if (t) {
      t.patternName = s.name;
      trades.push(t);
    }
  }

  return { params: p, trades, metrics: computeMetrics(trades) };
}

export function computeMetrics(trades: BacktestTrade[]): BacktestMetrics {
  const wins = trades.filter((t) => t.netR > 0);
  const losses = trades.filter((t) => t.netR <= 0);
  const sumNet = trades.reduce((s, t) => s + t.netR, 0);
  const grossWin = wins.reduce((s, t) => s + t.netR, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netR, 0));

  // Максимальная просадка накопленного нетто-R.
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    cum += t.netR;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
  }

  const byPattern: BacktestMetrics['byPattern'] = {};
  const groups = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const g = groups.get(t.patternName) ?? [];
    g.push(t);
    groups.set(t.patternName, g);
  }
  for (const [name, list] of groups) {
    const w = list.filter((t) => t.netR > 0).length;
    byPattern[name] = {
      trades: list.length,
      winRate: list.length ? w / list.length : 0,
      avgNetR: list.reduce((s, t) => s + t.netR, 0) / list.length,
    };
  }

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgNetR: trades.length ? sumNet / trades.length : 0,
    expectancy: trades.length ? sumNet / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    totalNetR: sumNet,
    maxDrawdownR: maxDd,
    byPattern,
  };
}
