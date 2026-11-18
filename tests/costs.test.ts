/**
 * Тесты П.2 — Учёт издержек (комиссия Bybit + проскальзывание) в журнале.
 */
import { describe, it, expect } from 'vitest';
import { applyCosts, journalStats, roundTripCostPct, sideSign } from '../src/analysis/costs';
import type { JournalEntry } from '../src/analysis/types';

const P = { feeRate: 0.001, slippageRate: 0.0005 }; // 0.1% + 0.05% за сторону

const base: JournalEntry = {
  id: '1',
  symbol: 'BTCUSDT',
  timeframe: '60',
  side: 'long',
  patternName: 'Hammer',
  patternId: 'pat-1',
  entryPrice: 100,
  stopPrice: 98,
  createdAt: 0,
  status: 'closed',
  exitPrice: 104,
};

describe('costs', () => {
  it('roundTripCostPct = 2×(fee+slip)', () => {
    expect(roundTripCostPct(P)).toBeCloseTo(0.003);
  });

  it('sideSign: long=+1, short=-1', () => {
    expect(sideSign('long')).toBe(1);
    expect(sideSign('short')).toBe(-1);
  });

  it('лонг в плюс: net < gross ровно на издержки цикла', () => {
    const e = applyCosts(base, P);
    expect(e.grossPnlPct).toBeCloseTo(4);
    expect(e.costsPct).toBeCloseTo(0.3);
    expect(e.netPnlPct).toBeCloseTo(3.7);
  });

  it('шорт: падение цены = прибыль по нетто', () => {
    const e = applyCosts({ ...base, side: 'short', exitPrice: 96 }, P);
    expect(e.grossPnlPct).toBeCloseTo(4);
    expect(e.netPnlPct).toBeCloseTo(3.7);
  });

  it('малый профит съедается издержками → net отрицательный (win-rate не завышается)', () => {
    const e = applyCosts({ ...base, exitPrice: 100.2 }, P);
    expect(e.grossPnlPct).toBeCloseTo(0.2);
    expect(e.netPnlPct!).toBeLessThan(0);
  });

  it('netPnlMoney считается при наличии qty', () => {
    const e = applyCosts({ ...base, qty: 2 }, P);
    // gross = 2×(104−100)=8; costs = 2×100×0.003=0.6 → net = 7.4
    expect(e.netPnlMoney).toBeCloseTo(7.4);
  });

  it('открытая запись не пересчитывается; исходный объект не мутируется', () => {
    const open: JournalEntry = { ...base, status: 'open', exitPrice: undefined };
    const before = JSON.stringify(base);
    expect(applyCosts(open, P)).toBe(open);
    applyCosts(base, P);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('журнал: winRateNet ≤ winRateGross всегда', () => {
    const entries = [
      applyCosts({ ...base, qty: 2 }, P),
      applyCosts({ ...base, id: '2', qty: 2, exitPrice: 100.2 }, P), // gross-win → net-loss
      applyCosts({ ...base, id: '3', qty: 2, exitPrice: 97 }, P),
    ];
    const s = journalStats(entries);
    expect(s.closed).toBe(3);
    expect(s.winsGross).toBe(2);
    expect(s.winsNet).toBe(1);
    expect(s.winRateNet).toBeLessThanOrEqual(s.winRateGross);
    // money: +7.4 −0.2 −6.6 = +0.6 (нетто-сумма положительна при двух gross-победах)
    expect(s.totalNetMoney).toBeGreaterThan(0);
    expect(s.totalNetMoney).toBeCloseTo(0.6, 1);
  });

  it('пустой журнал — нулевая статистика без NaN', () => {
    const s = journalStats([]);
    expect(s.winRateGross).toBe(0);
    expect(s.avgNetR).toBe(0);
    expect(Number.isFinite(s.totalNetMoney)).toBe(true);
  });
});
