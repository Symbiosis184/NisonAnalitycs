import { describe, it, expect } from 'vitest';
import { wilsonWinRate, expectancyCI, hasEdge, twoTailPFromZ } from '../../utils/stats';

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
