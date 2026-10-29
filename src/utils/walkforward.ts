// Walk-forward валидация (рекомендация №2 для v1.2beta).
// Идея: история режется на непересекающиеся окна. В каждом окне «train»
// паттерн/стратегия считается прибыльной только если её in-sample expectancy
// подтверждается на следующем «test» окне, которое стратегия никогда не видела.
// Это защита от подгонки: итоговая статистика считается ТОЛЬКО по out-of-sample
// сделкам (OOS), а сравнение IS/OOS показывает величину переобучения.

import type { Candle } from './candle';
import { runBacktest, type BacktestConfig, type BacktestTrade } from './backtest';

export interface WalkForwardWindow {
  /** Индекс начала test-окна (в глобальной нумерации свечей) */
  testStart: number;
  testEnd: number;
  tradesInSample: BacktestTrade[];   // сделки train-периода (только для диагностики)
  tradesOutOfSample: BacktestTrade[]; // сделки test-периода (идут в итог)
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  oosTrades: BacktestTrade[];      // все OOS-сделки concatenated
  isExpectancy: number | null;     // средний netR in-sample
  oosExpectancy: number | null;    // средний netR out-of-sample — честная цифра
  /** decaying = OOS хуже IS более чем на 25% → признак переобучения */
  overfitSuspected: boolean;
}

export interface WalkForwardConfig {
  /** Длина train-окна в свечах */
  trainBars?: number;
  /** Длина test-окна в свечи */
  testBars?: number;
  /** Минимум свечей до первого сигнала (warm-up индикаторов) */
  warmup?: number;
}

function meanNetR(trades: BacktestTrade[]): number | null {
  if (trades.length === 0) return null;
  return trades.reduce((a, t) => a + t.netR, 0) / trades.length;
}

/**
 * Запуск walk-forward: config.detect вызывается на каждой свечи, но окна
 * ограничивают диапазон открываемых сделок. Сделка относится к OOS, если её
 * entryIndex попадает в test-окно текущего сплита.
 */
export function runWalkForward(
  candles: Candle[],
  config: BacktestConfig,
  wf: WalkForwardConfig = {},
): WalkForwardResult {
  const trainBars = wf.trainBars ?? 300;
  const testBars = wf.testBars ?? 100;
  const warmup = wf.warmup ?? 60;

  const all = runBacktest(candles, config); // один проход без lookahead bias
  const windows: WalkForwardWindow[] = [];
  const oosTrades: BacktestTrade[] = [];
  const isTrades: BacktestTrade[] = [];

  // Полное окно требует: warmup + train + test свечей. Иначе train-период
  // был бы короче заданного — сравнение IS/OOS теряет смысл.
  for (let start = warmup; start + trainBars + testBars <= candles.length; start += trainBars + testBars) {
    const testStart = start + trainBars;
    const testEnd = testStart + testBars;
    const inTrain = all.trades.filter((t) => t.entryIndex >= start && t.entryIndex < testStart);
    const inTest = all.trades.filter((t) => t.entryIndex >= testStart && t.entryIndex < testEnd);
    windows.push({ testStart, testEnd, tradesInSample: inTrain, tradesOutOfSample: inTest });
    isTrades.push(...inTrain);
    oosTrades.push(...inTest);
  }

  const isExpectancy = meanNetR(isTrades);
  const oosExpectancy = meanNetR(oosTrades);
  let overfitSuspected = false;
  if (isExpectancy !== null && oosExpectancy !== null && isExpectancy > 0) {
    overfitSuspected = oosExpectancy < isExpectancy * 0.75;
  }

  return { windows, oosTrades, isExpectancy, oosExpectancy, overfitSuspected };
}
