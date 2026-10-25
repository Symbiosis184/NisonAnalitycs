// Статистическая честность результатов: биномиальные доверительные интервалы
// (Wilson score), точный критерий для win-rate против монеты 50/50 (через
// нормальное приближение при малых n — консервативно) и оценка expectancy
// с стандартной ошибкой. Используется на странице «Бэктест» и в когортах.

export interface BinomialResult {
  /** Точка (доля успехов) */
  p: number;
  /** Wilson 95% CI: [low, high] */
  ciLow: number;
  ciHigh: number;
  /** двусторонняя p-value против H0: p = 0.5 */
  pValueVsHalf: number;
  n: number;
}

const Z95 = 1.959963984540054;

/** Двусторонняя p-value стандартной нормальной через erf (Abramowitz-Stegun). */
export function twoTailPFromZ(z: number): number {
  const x = Math.abs(z);
  // Q(x) ≈ exp(-x^2/2)*poly — точность ~1e-7, достаточно для UI
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const prob =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.min(1, 2 * prob);
}

/** Wilson score interval + p-value против 50% (exact binomial approximation). */
export function wilsonWinRate(wins: number, n: number): BinomialResult {
  if (n === 0) return { p: 0, ciLow: 0, ciHigh: 0, pValueVsHalf: 1, n: 0 };
  const p = wins / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z95 / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // z-статистика против p0=0.5
  const se0 = Math.sqrt(0.25 / n);
  const z = (p - 0.5) / se0;
  return {
    p,
    ciLow: Math.max(0, center - half),
    ciHigh: Math.min(1, center + half),
    pValueVsHalf: twoTailPFromZ(z),
    n,
  };
}

export interface ExpectancyResult {
  meanR: number;
  seR: number;
  ciLow: number;
  ciHigh: number;
  /** p-value: средний R ≠ 0 */
  pValue: number;
  n: number;
}

/** Средний expectancy (в R) с 95% CI по t-приближению (n>=30 — нормально). */
export function expectancyCI(rMultiples: number[]): ExpectancyResult {
  const n = rMultiples.length;
  if (n < 2) return { meanR: n === 1 ? rMultiples[0] : 0, seR: Infinity, ciLow: -Infinity, ciHigh: Infinity, pValue: 1, n };
  const mean = rMultiples.reduce((a, b) => a + b, 0) / n;
  const varr = rMultiples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(varr / n);
  const z = se > 0 ? mean / se : 0;
  return {
    meanR: mean,
    seR: se,
    ciLow: mean - Z95 * se,
    ciHigh: mean + Z95 * se,
    pValue: twoTailPFromZ(z),
    n,
  };
}

/** Есть ли эмпирическое edge: CI expectancy целиком > 0 (или < 0 для шорт-R). */
export function hasEdge(r: ExpectancyResult): boolean {
  return r.n >= 20 && r.ciLow > 0;
}

// ── Вердикт по результатам прогона ───────────────────────────────────────────
// Переводит сухую статистику (expectancy, CI, p-value, walk-forward OOS) в
// короткую человеческую оценку: «торговать можно», «наблюдать» или «не
// торговать». Пороги согласованы с hasEdge(): минимум 20 сделок, достоверность
// по 95% CI и p-value, плюс подтверждение на out-of-sample данных.

export type VerdictLevel = 'good' | 'watch' | 'bad' | 'none';

export interface Verdict {
  level: VerdictLevel;
  title: string;   // одно слово-статус
  text: string;    // 1–2 предложения: что это значит практически
}

export interface VerdictInput {
  exp: ExpectancyResult;
  /** Walk-forward OOS expectancy; null — если OOS-сделок нет */
  oos: number | null;
  overfitSuspected?: boolean;
}

export function verdictFor({ exp, oos, overfitSuspected }: VerdictInput): Verdict {
  if (exp.n < 20) {
    return {
      level: 'none',
      title: 'МАЛО ДАННЫХ',
      text: `Всего ${exp.n} сделок — статистика случайна, никаких выводов делать нельзя. Накопите больше сигналов этого паттерна.`,
    };
  }
  const positive = exp.ciLow > 0 && exp.pValue < 0.05;
  const negative = exp.ciHigh < 0 && exp.pValue < 0.05;
  if (positive && oos !== null && oos > 0 && !overfitSuspected) {
    return {
      level: 'good',
      title: 'EDGE ПОДТВЕРЖДЁН',
      text: `Средний результат +${exp.meanR.toFixed(2)} R/сделку достоверно выше нуля и подтверждён на будущих данных (OOS ${oos >= 0 ? '+' : ''}${oos.toFixed(2)} R). Паттерн можно торговать с полным риском.`,
    };
  }
  if (positive) {
    return {
      level: 'watch',
      title: 'EDGE НЕ ПОДТВЕРЖДЁН',
      text: `История выглядит прибыльной (+${exp.meanR.toFixed(2)} R), но ${overfitSuspected ? 'на свежих данных результат заметно хуже (возможна подгонка)' : 'для проверки на будущих данных не хватает сделок'}. Торговать осторожно, уменьшенным объёмом.`,
    };
  }
  if (negative) {
    return {
      level: 'bad',
      title: 'УБЫТОЧЕН',
      text: `Средний результат ${exp.meanR.toFixed(2)} R достоверно ниже нуля — на этом инструменте паттерн системно теряет. Сигналы игнорировать.`,
    };
  }
  return {
    level: 'watch',
    title: 'НЕТ РЕБРА',
    text: `Результат (+${exp.meanR.toFixed(2)} R) неотличим от нуля — сделки закрываются «в шум». Паттерн сам по себе преимущества не даёт, используйте только как контекст.`,
  };
}

export interface CohortVerdict {
  level: VerdictLevel;
  title: string;
  text: string;
  trades: number;
  strategiesWithEdge: number;
}

/** Сводный вердикт по всем стратегиям прогона (одна выборка инструментов/ТФ). */
export function overallVerdict(perStrategy: Array<{ exp: ExpectancyResult; oos: number | null }>): CohortVerdict {
  const allTrades = perStrategy.reduce((s, x) => s + x.exp.n, 0);
  const withEdge = perStrategy.filter((x) => hasEdge(x.exp)).length;
  if (perStrategy.length === 0 || allTrades < 20) {
    return {
      level: 'none', title: 'НЕТ ВЫВОДОВ',
      text: `Сделок слишком мало (${allTrades}) — текущая выборка не позволяет оценить стратегию.`,
      trades: allTrades, strategiesWithEdge: withEdge,
    };
  }
  if (withEdge === 0) {
    return {
      level: 'bad', title: 'РЕБРО НЕ НАЙДЕНО',
      text: `Ни одна из ${perStrategy.length} стратегий не показала положительного результата вне шума (${allTrades} сделок). На этом инструменте/таймфрейме паттерны Нисона сейчас не дают преимущества.`,
      trades: allTrades, strategiesWithEdge: withEdge,
    };
  }
  if (withEdge >= Math.max(2, Math.ceil(perStrategy.length / 3))) {
    return {
      level: 'good', title: 'СТРАТЕГИЯ РАБОТАЕТ',
      text: `${withEdge} из ${perStrategy.length} паттернов показывают достоверное ребро на ${allTrades} сделках. Текущая конфигурация подтверждена историей.`,
      trades: allTrades, strategiesWithEdge: withEdge,
    };
  }
  return {
    level: 'watch', title: 'РЕБРО ЕСТЬ, НО УЗКОЕ',
    text: `Достоверное преимущество только у ${withEdge} из ${perStrategy.length} паттернов (${allTrades} сделок). Торговать следует лишь отобранные стратегии, остальные — наблюдения.`,
    trades: allTrades, strategiesWithEdge: withEdge,
  };
}
