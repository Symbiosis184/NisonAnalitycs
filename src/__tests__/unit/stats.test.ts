import { describe, it, expect } from 'vitest';
import { wilsonWinRate, expectancyCI, hasEdge, twoTailPFromZ, verdictFor, overallVerdict, type ExpectancyResult } from '../../utils/stats';

describe('stats: wilsonWinRate', () => {
  it('пустая выборка — нули и p=1', () => {
    const r = wilsonWinRate(0, 0);
    expect(r.p).toBe(0);
    expect(r.pValueVsHalf).toBe(1);
  });

  it('50/100 → точка 50%, CI симметричен вокруг 0.5, p≈1', () => {
    const r = wilsonWinRate(50, 100);
    expect(r.p).toBeCloseTo(0.5, 5);
    expect(r.ciLow).toBeLessThan(0.5);
    expect(r.ciHigh).toBeGreaterThan(0.5);
    expect(r.pValueVsHalf).toBeGreaterThan(0.9);
  });

  it('70/100 значимо лучше монеты (p < 0.05) и CI не накрывает 0.5', () => {
    const r = wilsonWinRate(70, 100);
    expect(r.pValueVsHalf).toBeLessThan(0.05);
    expect(r.ciLow).toBeGreaterThan(0.5);
  });

  it('малые n: 3/4 — CI широкий,Includes 0.5', () => {
    const r = wilsonWinRate(3, 4);
    expect(r.ciLow).toBeLessThan(0.5);
    expect(r.pValueVsHalf).toBeGreaterThan(0.05);
  });

  it('CI всегда в [0,1]', () => {
    for (const [w, n] of [[0, 10], [10, 10], [1, 200], [199, 200]] as const) {
      const r = wilsonWinRate(w, n);
      expect(r.ciLow).toBeGreaterThanOrEqual(0);
      expect(r.ciHigh).toBeLessThanOrEqual(1);
    }
  });
});

describe('stats: expectancyCI / hasEdge', () => {
  it('<2 наблюдений — без вывода', () => {
    const e = expectancyCI([0.5]);
    expect(e.pValue).toBe(1);
    expect(hasEdge(e)).toBe(false);
  });

  it('стабильно положительные R при n>=20 → edge', () => {
    const rs = Array.from({ length: 30 }, (_, i) => 0.3 + (i % 3) * 0.05); // ~0.35 средний
    const e = expectancyCI(rs);
    expect(e.meanR).toBeGreaterThan(0.3);
    expect(e.ciLow).toBeGreaterThan(0);
    expect(e.pValue).toBeLessThan(0.05);
    expect(hasEdge(e)).toBe(true);
  });

  it('шум около нуля → нет edge', () => {
    const rs = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1 : -1) * (0.9 + (i % 5) * 0.1));
    const e = expectancyCI(rs);
    expect(Math.abs(e.meanR)).toBeLessThan(0.2);
    expect(hasEdge(e)).toBe(false);
  });

  it('n<20 блокирует EDGE даже при сильном среднем', () => {
    const e = expectancyCI(Array.from({ length: 15 }, () => 1));
    expect(hasEdge(e)).toBe(false);
  });

  it('twoTailPFromZ: z=0 → p≈1, z=3 → p<0.01', () => {
    expect(twoTailPFromZ(0)).toBeCloseTo(1, 3);
    expect(twoTailPFromZ(3)).toBeLessThan(0.01);
  });
});

describe('verdictFor — человеческий вывод из статистики', () => {
  const mkExp = (meanR: number, n: number): ExpectancyResult => {
    // конструируем результат напрямую: se подбираем так, чтобы CI был по ту сторону нуля
    const se = Math.abs(meanR) / 4;
    return { meanR, seR: se, ciLow: meanR - 1.96 * se, ciHigh: meanR + 1.96 * se, pValue: 0.001, n };
  };

  it('n<20 → МАЛО ДАННЫХ независимо от среднего', () => {
    const v = verdictFor({ exp: mkExp(1, 10), oos: 1 });
    expect(v.level).toBe('none');
    expect(v.title).toBe('МАЛО ДАННЫХ');
  });

  it('положительный CI + подтверждение OOS → EDGE ПОДТВЕРЖДЁН', () => {
    const v = verdictFor({ exp: mkExp(0.3, 50), oos: 0.25 });
    expect(v.level).toBe('good');
    expect(v.title).toBe('EDGE ПОДТВЕРЖДЁН');
  });

  it('прибыльная история без OOS-подтверждения → watch', () => {
    expect(verdictFor({ exp: mkExp(0.3, 50), oos: null }).level).toBe('watch');
    expect(verdictFor({ exp: mkExp(0.3, 50), oos: -0.1 }).level).toBe('watch');
    expect(verdictFor({ exp: mkExp(0.3, 50), oos: 0.2, overfitSuspected: true }).title).toBe('EDGE НЕ ПОДТВЕРЖДЁН');
  });

  it('достоверно отрицательный → УБЫТОЧЕН', () => {
    const v = verdictFor({ exp: mkExp(-0.3, 50), oos: null });
    expect(v.level).toBe('bad');
    expect(v.title).toBe('УБЫТОЧЕН');
  });

  it('шум около нуля (CI пересекает 0) → НЕТ РЕБРА', () => {
    const e = expectancyCI(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1 : -1) * (0.9 + (i % 5) * 0.1)));
    const v = verdictFor({ exp: e, oos: null });
    expect(v.level).toBe('watch');
    expect(v.title).toBe('НЕТ РЕБРА');
  });
});

describe('overallVerdict — сводка прогона', () => {
  const mkExp = (meanR: number, n: number): ExpectancyResult => {
    const se = Math.abs(meanR) / 4;
    return { meanR, seR: se, ciLow: meanR - 1.96 * se, ciHigh: meanR + 1.96 * se, pValue: 0.001, n };
  };

  it('пустой прогон или мало сделок → нет выводов', () => {
    expect(overallVerdict([]).level).toBe('none');
    expect(overallVerdict([{ exp: mkExp(0.3, 10), oos: null }]).level).toBe('none');
  });

  it('ни одного edge → РЕБРО НЕ НАЙДЕНО', () => {
    const rows = [{ exp: mkExp(0.05, 30), oos: null }, { exp: mkExp(-0.1, 30), oos: null }];
    // meanR=0.05, se=0.0125 → ciLow>0 → hasEdge true… подберём шум:
    const noisy = { exp: expectancyCI(Array.from({ length: 30 }, (_, i) => (i % 2 ? -1 : 1) * 0.9)), oos: null };
    expect(overallVerdict([noisy, noisy]).title).toBe('РЕБРО НЕ НАЙДЕНО');
    void rows;
  });

  it('несколько стратегий с edge → СТРАТЕГИЯ РАБОТАЕТ', () => {
    const good = { exp: mkExp(0.3, 30), oos: 0.2 };
    expect(overallVerdict([good, good, { exp: mkExp(-0.2, 30), oos: null }]).title).toBe('СТРАТЕГИЯ РАБОТАЕТ');
  });

  it('edge только у одной из многих → узкое ребро', () => {
    const v = overallVerdict([
      { exp: mkExp(0.3, 30), oos: 0.2 },
      { exp: expectancyCI(Array.from({ length: 30 }, (_, i) => (i % 2 ? -1 : 1) * 0.9)), oos: null },
      { exp: mkExp(-0.2, 30), oos: null },
      { exp: mkExp(-0.2, 30), oos: null },
    ]);
    expect(v.level).toBe('watch');
    expect(v.strategiesWithEdge).toBe(1);
  });
});
