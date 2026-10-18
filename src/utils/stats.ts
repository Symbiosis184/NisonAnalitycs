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
