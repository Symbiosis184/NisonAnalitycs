import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { detectRegime, signalAlignsWithRegime } from '../../utils/regime';

function mkSeries(n: number, f: (i: number) => number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = f(i);
    out.push(new Candle({ time: i, open: c, high: c * 1.002, low: c * 0.998, close: c, volume: 100 }));
  }
  return out;
}

describe('regime: detectRegime', () => {
  it('устойчивый аптренд → trend-up с множителем > 1', () => {
    const r = detectRegime(mkSeries(120, (i) => 100 * Math.pow(1.004, i)));
    expect(r.regime).toBe('trend-up');
    expect(r.trendStrength).toBeGreaterThan(0.3);
    expect(r.multiplier).toBeGreaterThan(1);
  });

  it('устойчивый нисходящий → trend-down', () => {
    const r = detectRegime(mkSeries(120, (i) => 100 * Math.pow(0.996, i)));
    expect(r.regime).toBe('trend-down');
  });

  it('флэт → range со штрафным множителем < 1', () => {
    const r = detectRegime(mkSeries(120, () => 100));
    expect(r.regime).toBe('range');
    expect(r.multiplier).toBeLessThan(1);
  });

  it('короткая история не роняет функцию', () => {
    const r = detectRegime(mkSeries(10, (i) => 100 + i));
    expect(['trend-up', 'trend-down', 'range', 'volatile-breakout']).toContain(r.regime);
  });

  it('детерминированность: один вход → один выход', () => {
    const s = mkSeries(150, (i) => 100 + i * 0.5 + (i % 7));
    expect(detectRegime(s)).toEqual(detectRegime(s));
  });
});

describe('regime: signalAlignsWithRegime', () => {
  it('в аптренде лонг согласован, шорт — нет', () => {
    const up = { regime: 'trend-up' as const, trendStrength: 1, volatilityRatio: 1, multiplier: 1 };
    expect(signalAlignsWithRegime('long', up)).toBe(true);
    expect(signalAlignsWithRegime('short', up)).toBe(false);
  });

  it('в боковике согласованы оба направления', () => {
    const rg = { regime: 'range' as const, trendStrength: 0.2, volatilityRatio: 1, multiplier: 0.85 };
    expect(signalAlignsWithRegime('long', rg)).toBe(true);
    expect(signalAlignsWithRegime('short', rg)).toBe(true);
  });
});
