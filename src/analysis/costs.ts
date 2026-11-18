/**
 * П.2 бэклога — Учёт издержек: комиссии Bybit (~0.1% за сторону) и проскальзывание.
 * Раньше PnL в журнале считался брутто → win-rate и матожидание были завышены.
 */
import type { JournalEntry, Side } from './types';

export interface CostParams {
  /** Комиссия за сторону, доля от цены (0.001 = 0.1%). */
  feeRate: number;
  /** Проскальзывание за сторону, доля от цены. */
  slippageRate: number;
}

/** Полные издержки цикла сделки как доля от цены входа: вход+выход. */
export function roundTripCostPct(p: CostParams): number {
  return 2 * (p.feeRate + p.slippageRate);
}

/** Направление движения цены для стороны (+1 лонг, −1 шорт). */
export function sideSign(side: Side): 1 | -1 {
  return side === 'long' ? 1 : -1;
}

/**
 * Пересчитать закрытую запись журнала: добавить gross/net/издержки.
 * Чистая функция — возвращает новый объект, исходную запись не мутирует.
 *
 *  grossPnlPct = sign × (exit − entry)/entry × 100
 *  costsPct    = 2×(fee+slip)×100
 *  netPnlPct   = grossPnlPct − costsPct
 *  netPnlMoney = qty × (exit−entry) × sign − costs_money
 */
export function applyCosts(entry: JournalEntry, p: CostParams): JournalEntry {
  if (entry.status !== 'closed' || entry.exitPrice == null) return entry;
  const { entryPrice, exitPrice, side } = entry;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(exitPrice)) {
    return entry;
  }
  const dir = sideSign(side);
  const priceMovePct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const grossPnlPct = dir * priceMovePct;
  const costsPct = roundTripCostPct(p) * 100;
  const netPnlPct = grossPnlPct - costsPct;

  let netPnlMoney: number | undefined;
  if (entry.qty != null && Number.isFinite(entry.qty)) {
    const grossMoney = entry.qty * (exitPrice - entryPrice) * dir;
    const costsMoney = entry.qty * entryPrice * roundTripCostPct(p);
    netPnlMoney = grossMoney - costsMoney;
  }

  return { ...entry, grossPnlPct, costsPct, netPnlPct, netPnlMoney };
}

/** Итоговая статистика журнала с раздельным учётом gross/net — «реальный» win rate считается по net. */
export interface JournalStats {
  closed: number;
  open: number;
  winsGross: number;
  winsNet: number;
  winRateGross: number;
  winRateNet: number;
  totalNetMoney: number;
  avgNetR: number;
}

export function journalStats(entries: JournalEntry[]): JournalStats {
  const closed = entries.filter((e) => e.status === 'closed');
  const open = entries.length - closed.length;
  let winsGross = 0;
  let winsNet = 0;
  let totalNetMoney = 0;
  let sumR = 0;
  let rCount = 0;
  for (const e of closed) {
    if ((e.grossPnlPct ?? 0) > 0) winsGross++;
    if ((e.netPnlPct ?? 0) > 0) winsNet++;
    if (e.netPnlMoney != null) totalNetMoney += e.netPnlMoney;
    const risk = Math.abs(e.entryPrice - e.stopPrice);
    if (risk > 0 && e.netPnlPct != null) {
      sumR += (e.netPnlPct / 100) * (e.entryPrice / risk);
      rCount++;
    }
  }
  return {
    closed: closed.length,
    open,
    winsGross,
    winsNet,
    winRateGross: closed.length ? winsGross / closed.length : 0,
    winRateNet: closed.length ? winsNet / closed.length : 0,
    totalNetMoney,
    avgNetR: rCount ? sumR / rCount : 0,
  };
}
