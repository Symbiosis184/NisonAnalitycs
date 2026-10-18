// Верификация преимущества / edge verification (запрос пользователя: пункт 3).
//
// Две задачи:
//
// A) Мониторинг ДЕГРАДАЦИИ стратегии: expectancy последних 90 календарных дней
//    сравнивается с «историей» (все закрытые сделки старше этого окна). Это не
//    просто «среднее упало» — модуль считает стандартную ошибку разности и
//    z-статистику, чтобы не путать деградацию со случайной дисперсией на малой
//    выборке. Порог флага: медианный сдвиг вниз И z-значимость ≥ 1.64 (односторонне).
//
// B) Статистика ПО РЕЖИМАМ РЫНКА (тренд/флэт/волатильность): каждая сделка
//    помечается режимом рынка на момент её входа (detectRegime по свечам ДО входа —
//    без lookahead), после чего считается отдельная expectancy/win-rate когорта.
//    Это позволяет увидеть, где edge реален, а где стратегия его лишь имитирует.
//
// Опирается на stats.ts (expectancyCI, wilsonWinRate, twoTailPFromZ) — единый
// статистический инструментарий проекта.

import type { Candle } from './candle';
import type { BacktestTrade } from './backtest';
import { detectRegime, type Regime } from './regime';
import { expectancyCI, wilsonWinRate, twoTailPFromZ, type ExpectancyResult } from './stats';

const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_WINDOW_DAYS = 90;

/** Режим, в котором был открыт вход сделки (по истории ДО entryTime). */
export type TradeRegime = Regime;

export interface TaggedTrade extends BacktestTrade {
  regimeAtEntry: TradeRegime;
}

/** Ключ когорты: 'trend' объединяет trend-up/trend-down (направление — отдельный срез). */
export type CohortKey = 'trend' | 'range' | 'volatile-breakout';

export function toCohort(regime: TradeRegime): CohortKey {
  return regime === 'trend-up' || regime === 'trend-down' ? 'trend' : regime;
}

export interface CohortStats {
  cohort: CohortKey;
  label: string;
  trades: number;
  wins: number;
  winRate: number;          // % netR > 0
  ciLow: number;
  ciHigh: number;
  avgNetR: number;
  totalNetR: number;
  expectancy: ExpectancyResult;
  /** Есть ли в когорте статистически подтверждённый edge (CI expectancy > 0, n>=20) */
  hasEdge: boolean;
}

export interface DegradationReport {
  windowDays: number;
  recentTrades: number;
  historyTrades: number;
  recentExpectancy: number | null;   // средний net R за окно
  historyExpectancy: number | null;  // средний net R до окна
  delta: number | null;              // recent − history
  /** z-статистика разности средних (приближение; консервативно при малых n) */
  zScore: number | null;
  pValue: number | null;             // односторонняя: recent < history
  degraded: boolean;                 // флаг деградации
  insufficientData: boolean;         // слишком мало наблюдений для вывода
  note: string;
}

/**
 * Пометка сделок режимом рынка на момент входа.
 * Для каждой сделки вызывается detectRegime(candles.slice(0, entryIndex + 1)) —
 * только данные, доступные трейдеру в момент входа (без подглядывания в будущее).
 */
export function tagTradesByRegime(candles: Candle[], trades: BacktestTrade[]): TaggedTrade[] {
  return trades.map((t) => {
    const history = candles.slice(0, Math.min(t.entryIndex + 1, candles.length));
    const info = detectRegime(history);
    return { ...t, regimeAtEntry: info.regime };
  });
}

function meanOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function varianceOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs)!;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/**
 * A) Мониторинг деградации: последние `windowDays` против остальной истории.
 * @param trades сделки (обязательны entryTime в секундах или миллисекундах — см. isMs)
 * @param nowMs текущее время в мс
 * @param isMs true если entryTime в миллисекундах (journal), false если в секундах (bybit)
 */
export function detectDegradation(
  trades: Array<{ entryTime: number; netR: number }>,
  nowMs: number = Date.now(),
  isMs: boolean = true,
): DegradationReport {
  const toMs = (t: number) => (isMs ? t : t * 1000);
  const cutoff = nowMs - RECENT_WINDOW_DAYS * DAY_MS;

  const recent = trades.filter((t) => toMs(t.entryTime) >= cutoff);
  const history = trades.filter((t) => toMs(t.entryTime) < cutoff);

  const base: DegradationReport = {
    windowDays: RECENT_WINDOW_DAYS,
    recentTrades: recent.length,
    historyTrades: history.length,
    recentExpectancy: null,
    historyExpectancy: null,
    delta: null,
    zScore: null,
    pValue: null,
    degraded: false,
    insufficientData: true,
    note: '',
  };

  const rMean = meanOf(recent.map((t) => t.netR));
  const hMean = meanOf(history.map((t) => t.netR));

  if (rMean === null || hMean === null) {
    return { ...base, recentExpectancy: rMean, historyExpectancy: hMean,
      note: 'Недостаточно закрытых сделок в одном из периодов для сравнения.' };
  }

  // Консервативный порог наблюдений: минимум 10 сделок в окне и 20 в истории.
  const insufficient = recent.length < 10 || history.length < 20;

  // Welch-подобная z-статистика разности средних
  const v1 = varianceOf(recent.map((t) => t.netR)) / recent.length;
  const v2 = varianceOf(history.map((t) => t.netR)) / history.length;
  const se = Math.sqrt(v1 + v2);
  const delta = rMean - hMean;
  const z = se > 0 ? delta / se : 0;
  // односторонняя p-value: H1: recent < history
  const pOneSided = se > 0 && delta < 0 ? twoTailPFromZ(z) / 2 : (delta >= 0 ? 1 : twoTailPFromZ(z) / 2);

  const degraded = !insufficient && delta < 0 && z <= -1.645;

  let note: string;
  if (insufficient) {
    note = `Выборка мала (окно: ${recent.length}, история: ${history.length}) — вывод о деградации не делается.`;
  } else if (degraded) {
    note = `Expectancy окна (${rMean.toFixed(2)} R) значимо ниже истории (${hMean.toFixed(2)} R), p≈${pOneSided.toFixed(3)} — деградация стратегии.`;
  } else if (delta < 0) {
    note = `Expectancy окна ниже истории (${delta.toFixed(2)} R), но статистически не значимо (z=${z.toFixed(2)}).`;
  } else {
    note = 'Признаков деградации нет: последние 90 дней не хуже истории.';
  }

  return {
    ...base,
    recentExpectancy: Math.round(rMean * 1000) / 1000,
    historyExpectancy: Math.round(hMean * 1000) / 1000,
    delta: Math.round(delta * 1000) / 1000,
    zScore: Math.round(z * 100) / 100,
    pValue: Math.round(pOneSided * 10000) / 10000,
    degraded,
    insufficientData: insufficient,
    note,
  };
}

const COHORT_LABELS: Record<CohortKey, string> = {
  trend: '📈 Тренд',
  range: '↔️ Флэт',
  'volatile-breakout': '⚡ Волатильный пробой',
};

/** B) Разбивка эффективности по режимам рынка. */
export function statsByRegime(trades: TaggedTrade[]): CohortStats[] {
  const cohorts: CohortKey[] = ['trend', 'range', 'volatile-breakout'];
  const out: CohortStats[] = [];
  for (const cohort of cohorts) {
    const group = trades.filter((t) => toCohort(t.regimeAtEntry) === cohort);
    if (group.length === 0) continue;
    const rs = group.map((t) => t.netR);
    const wins = rs.filter((r) => r > 0).length;
    const exp = expectancyCI(rs);
    const wr = wilsonWinRate(wins, group.length);
    out.push({
      cohort,
      label: COHORT_LABELS[cohort],
      trades: group.length,
      wins,
      winRate: Math.round(wr.p * 1000) / 10,
      ciLow: Math.round(wr.ciLow * 1000) / 10,
      ciHigh: Math.round(wr.ciHigh * 1000) / 10,
      avgNetR: Math.round(exp.meanR * 1000) / 1000,
      totalNetR: Math.round(rs.reduce((a, b) => a + b, 0) * 100) / 100,
      expectancy: exp,
      hasEdge: exp.n >= 20 && exp.ciLow > 0,
    });
  }
  return out.sort((a, b) => b.avgNetR - a.avgNetR);
}

/** Сводный вердикт по edge: есть ли когорта(-и) с подтверждённым преимуществом. */
export function edgeVerdict(cohorts: CohortStats[], degradation: DegradationReport): {
  verdict: 'positive-edge' | 'no-edge' | 'edge-degrading' | 'insufficient';
  bestCohort: CohortStats | null;
  summary: string;
} {
  const withEdge = cohorts.filter((c) => c.hasEdge);
  const best = cohorts.length > 0 ? cohorts[0] : null;

  if (cohorts.length === 0 || cohorts.every((c) => c.trades < 10)) {
    return { verdict: 'insufficient', bestCohort: null, summary: 'Недостаточно сделок для оценки преимущества.' };
  }
  if (withEdge.length === 0) {
    return {
      verdict: 'no-edge',
      bestCohort: best,
      summary: `Ни одна когорта режима не показала CI expectancy > 0 (лучшая: ${best ? best.label + ' ' + best.avgNetR.toFixed(2) + ' R' : '—'}).`,
    };
  }
  if (degradation.degraded) {
    return {
      verdict: 'edge-degrading',
      bestCohort: withEdge[0],
      summary: `Edge есть в когортах ${withEdge.map((c) => c.label).join(', ')}, НО последние ${RECENT_WINDOW_DAYS} дней значимо хуже истории — риск затухания преимущества.`,
    };
  }
  return {
    verdict: 'positive-edge',
    bestCohort: withEdge[0],
    summary: `Подтверждённое преимущество в когортах: ${withEdge.map((c) => `${c.label} (+${c.avgNetR.toFixed(2)} R)`).join(', ')}. Деградации не обнаружено.`,
  };
}
