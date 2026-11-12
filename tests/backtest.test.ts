/**
 * Тесты П.3 — Бэктест-движок: инварианты симуляции и метрик нетто.
 */
import { describe, it, expect } from 'vitest';
import { computeMetrics, runBacktest, simulateOne, DEFAULT_BACKTEST_PARAMS } from '../src/analysis/backtest';
import type { BacktestTrade, Candle } from '../src/analysis/types';

/** Синтетические свечи: конструктор одной. */
function c(time: number, o: number, h: number, l: number, cl: number, v = 1): Candle {
  return { time, open: o, high: h, low: l, close: cl, volume: v };
}

/** История с принудительным Hammer на индексе 15: нисходящая база + молот. */
function historyWithHammer(): Candle[] {
  const arr: Candle[] = [];
  for (let i = 0; i < 15; i++) {
    const p = 100 - i; // низходящий тренд
    arr.push(c(i, p, p + 0.5, p - 1.5, p - 1));
  }
  // свеча-молот: тело маленькое, нижняя тень длинная
  arr.push(c(15, 85, 85.2, 80, 86));
  // рост после сигнала
  for (let i = 16; i < 30; i++) arr.push(c(i, 86 + (i - 16), 87 + (i - 16), 85 + (i - 16), 87 + (i - 16)));
  return arr;
}

const TP = { ...DEFAULT_BACKTEST_PARAMS };

describe('backtest engine', () => {
  it('сигналирует Hammer на подготовленной истории', () => {
    const res = runBacktest(historyWithHammer(), TP);
    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    expect(res.trades.some((t) => t.patternName === 'Hammer')).toBe(true);
  });

  it('вход лонга исполняется с проскальзыванием вверх, стоп-выход платит комиссии', () => {
    const candles = historyWithHammer();
    const t = simulateOne(candles, 15, 'long', { ...TP, tpR: 0, maxBars: 1 });
    expect(t).not.toBeNull();
    const raw = candles[15].close;
    expect(t!.entryPrice).toBeGreaterThan(raw); // покупка дороже из-за slip
    if (t!.exitReason === 'stop') expect(t!.costR).toBeGreaterThan(0);
  });

  it('нетто-R всегда ниже брутто-R при ненулевых издержках (edge проверяется честно)', () => {
    const res = runBacktest(historyWithHammer(), TP);
    for (const t of res.trades) {
      expect(t.netR).toBeLessThan(t.grossR);
      expect(t.costR).toBeGreaterThan(0);
    }
  });

  it('нулевые издержки ⇒ netR == grossR', () => {
    const res = runBacktest(historyWithHammer(), { ...TP, feeRate: 0, slippageRate: 0 });
    for (const t of res.trades) expect(t.netR).toBeCloseTo(t.grossR, 10);
  });

  it('нет lookahead: сделка не может выйти раньше входа; barsHeld ≥ 1', () => {
    const res = runBacktest(historyWithHammer(), TP);
    for (const t of res.trades) {
      expect(t.exitTime).toBeGreaterThan(t.entryTime);
      expect(t.barsHeld).toBeGreaterThanOrEqual(1);
    }
  });

  it('сигнал на последней свече не порождает сделку', () => {
    const candles = historyWithHammer();
    const tail = candles.slice(0, 16); // hammer — последняя свеча
    expect(simulateOne(tail, 15, 'long', TP)).toBeNull();
  });

  it('короткая история (< ATR warm-up) — пусто, без исключений', () => {
    const tiny = [c(0, 1, 2, 0.5, 1.5), c(1, 1.5, 1.6, 1, 1.55)];
    const res = runBacktest(tiny, TP);
    expect(res.trades).toHaveLength(0);
    expect(res.metrics.trades).toBe(0);
    expect(res.metrics.winRate).toBe(0);
  });

  it('метрики: детерминированный набор сделок даёт точные значения', () => {
    const mk = (r: number): BacktestTrade => ({
      patternName: 'X', side: 'long', entryTime: 0, entryPrice: 1, exitTime: 1,
      exitPrice: 1, exitReason: 'tp', barsHeld: 1, grossR: r, costR: 0.1, netR: r - 0.1,
    });
    const m = computeMetrics([mk(2), mk(-1), mk(0.5)]);
    expect(m.trades).toBe(3);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(1);
    expect(m.winRate).toBeCloseTo(2 / 3);
    expect(m.totalNetR).toBeCloseTo(2 - 0.1 + (-1 - 0.1) + (0.5 - 0.1));
    expect(m.profitFactor).toBeCloseTo((1.9 + 0.4) / 1.1);
    expect(m.maxDrawdownR).toBeGreaterThan(0);
    expect(m.byPattern['X'].trades).toBe(3);
  });

  it('profitFactor = Infinity при нулях без убытков и 0 при пустом входе', () => {
    const mk = (r: number): BacktestTrade => ({
      patternName: 'X', side: 'long', entryTime: 0, entryPrice: 1, exitTime: 1,
      exitPrice: 1, exitReason: 'tp', barsHeld: 1, grossR: r, costR: 0, netR: r,
    });
    expect(computeMetrics([mk(1)]).profitFactor).toBe(Infinity);
    expect(computeMetrics([]).profitFactor).toBe(0);
    expect(Number.isNaN(computeMetrics([]).avgNetR)).toBe(false);
  });

  it('параметры прогона сохраняются в результате', () => {
    const res = runBacktest(historyWithHammer(), { stopAtrMult: 3 });
    expect(res.params.stopAtrMult).toBe(3);
    expect(res.params.tpR).toBe(DEFAULT_BACKTEST_PARAMS.tpR);
  });
});
