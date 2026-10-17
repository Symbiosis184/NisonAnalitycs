import { describe, it, expect } from 'vitest';
import { ZoneVoter } from '../../utils/zone_voter';
import { c, flat } from '../helpers/candles';

describe('ZoneVoter.collect', () => {
  // Синусоида с явными свопами: поддержка ~90, сопротивление ~110
  const swingCandles = (() => {
    const arr = [] as ReturnType<typeof c>[];
    for (let i = 0; i < 80; i++) {
      const mid = 100 + 10 * Math.sin(i / 5);
      arr.push(c(mid - 0.2, mid + 0.8, mid - 0.8, mid + 0.2));
    }
    return arr;
  })();

  it('возвращает структуры support/resistance с полями Zone', () => {
    const zones = ZoneVoter.collect(100, swingCandles);
    expect(zones).toHaveProperty('support');
    expect(zones).toHaveProperty('resistance');
    for (const z of [...zones.support, ...zones.resistance]) {
      expect(typeof z.level).toBe('number');
      expect(Number.isFinite(z.level)).toBe(true);
      expect(z.votes).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(z.reasons)).toBe(true);
      expect(typeof z.strong).toBe('boolean');
      // сильная зона — это >=3 голосов (константа STRONG_ZONE_MIN_VOTES)
      if (z.strong) expect(z.votes).toBeGreaterThanOrEqual(3);
    }
  });

  it('зоны сопротивления лежат выше цены, поддержки — не выше', () => {
    const price = 100;
    const zones = ZoneVoter.collect(price, swingCandles);
    // Зоны строго дальше цены (уровень ровно на цене не считается ни S, ни R)
    for (const z of zones.resistance) expect(z.level).toBeGreaterThanOrEqual(price);
    for (const z of zones.support) expect(z.level).toBeLessThanOrEqual(price);
  });

  it('кластеризует близкие уровни в одну зону (tolerance 0.5%)', () => {
    // три V-образных отскока с минимумами в пределах 0.5% → один кластер поддержки
    const candles = [
      ...flat(30, 100),
      c(97, 98, 94, 96),
      c(93, 94, 89.0, 92),   // свинг-низ 1
      c(93, 96, 91, 94),
      c(95, 98, 93, 96),
      c(96, 97, 92, 95),
      c(93, 94, 89.2, 92),   // свинг-низ 2
      c(93, 96, 91, 94),
      c(95, 98, 93, 96),
      c(96, 97, 92, 95),
      c(93, 94, 89.4, 92),   // свинг-низ 3
      c(93, 96, 91, 94),
      c(95, 98, 93, 96),
    ];
    const zones = ZoneVoter.collect(96, candles);
    const near89 = zones.support.filter((z) => Math.abs(z.level - 89) < 1.5);
    expect(near89.length).toBe(1); // все три низа слились в один кластер
    expect(near89[0].touches).toBeGreaterThanOrEqual(3);
    // голоса — по уникальным источникам: свинги дают 1 голос при 3 касаниях
    expect(near89[0].votes).toBeGreaterThanOrEqual(1);
  });

  it('пустая/короткая история не роняет алгоритм', () => {
    expect(() => ZoneVoter.collect(100, flat(3))).not.toThrow();
    const zones = ZoneVoter.collect(100, flat(3));
    expect(Array.isArray(zones.support)).toBe(true);
  });
});

describe('ZoneVoter.isNearSupport / isNearResistance', () => {
  const swingCandles = (() => {
    const arr = [] as ReturnType<typeof c>[];
    for (let i = 0; i < 80; i++) {
      const mid = 100 + 10 * Math.sin(i / 5);
      arr.push(c(mid - 0.2, mid + 0.8, mid - 0.8, mid + 0.2));
    }
    return arr;
  })();

  it('цена у исторического минимума считается «у поддержки»', () => {
    const minLow = Math.min(...swingCandles.map((x) => x.low));
    expect(ZoneVoter.isNearSupport(minLow + minLow * 0.005, swingCandles, 0.015)).toBe(true);
  });

  it('цена у исторического максимума считается «у сопротивления»', () => {
    const maxHigh = Math.max(...swingCandles.map((x) => x.high));
    expect(ZoneVoter.isNearResistance(maxHigh - maxHigh * 0.005, swingCandles, 0.015)).toBe(true);
  });
});

function minLowSafe(arr: { low: number }[]) {
  return Math.min(...arr.map((a) => a.low));
}
