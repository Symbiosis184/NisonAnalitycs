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

describe('Аудит №1: единый источник S/R — транзитивная дедупликация зон', () => {
  it('dedupeZones сливает не-транзитивные кластеры (A≈B, B≈C) в один уровень', async () => {
    const { dedupeZones } = await import('../../utils/levels');
    const map = new Map<number, { reasons: string[]; touches: number; lastTouch: number }>([
      [100.0, { reasons: ['a'], touches: 2, lastTouch: 10 }],
      [100.4, { reasons: ['b'], touches: 1, lastTouch: 20 }], // ≈ обоим соседям по 0.5%
      [100.8, { reasons: ['c'], touches: 3, lastTouch: 30 }],
    ]);
    dedupeZones(map, 0.005);
    expect(map.size).toBe(1);
    const [level, data] = [...map.entries()][0];
    expect(level).toBeCloseTo(100.4, 6);
    expect(data.touches).toBe(6);          // касания суммируются
    expect(data.lastTouch).toBe(30);       // максимум времени
    expect(new Set(data.reasons).size).toBe(data.reasons.length); // без дублей причин
  });

  it('dedupeZones НЕ сливает реально разные зоны (>допуска)', async () => {
    const { dedupeZones } = await import('../../utils/levels');
    const map = new Map<number, { reasons: string[]; touches: number; lastTouch: number }>([
      [100.0, { reasons: ['a'], touches: 1, lastTouch: 1 }],
      [105.0, { reasons: ['b'], touches: 1, lastTouch: 2 }],
    ]);
    dedupeZones(map, 0.005);
    expect(map.size).toBe(2);
  });

  it('findClusterZone симметричен: новый уровень на границе допуска сливается с зоной', async () => {
    const { findClusterZone } = await import('../../utils/levels');
    const map = new Map<number, unknown>([[100.0, {}]]);
    // |Δ|/100 <= 0.005 → входит; даже если проверка шла бы от нового уровня
    expect(findClusterZone(map, 100.49, 0.005)).toBe(100.0);
    expect(findClusterZone(map, 101.0, 0.005)).toBeUndefined();
  });

  it('collect(): в результате нет двух зон ближе 0.5% друг к другу (инвариант)', () => {
    // Генерируем «шумную» историю со свингами около ~90 и ~110 + MA-уровни
    const arr = [] as ReturnType<typeof c>[];
    for (let i = 0; i < 200; i++) {
      const mid = 100 + 10 * Math.sin(i / 7) + (i % 5) * 0.11;
      arr.push(c(mid - 0.3, mid + 0.9, mid - 0.9, mid + 0.3));
    }
    const zones = ZoneVoter.collect(arr[arr.length - 1].close, arr);
    for (const list of [zones.support, zones.resistance]) {
      const sortedLevels = [...list.map((z) => z.level)].sort((a, b) => a - b);
      for (let k = 1; k < sortedLevels.length; k++) {
        const rel = Math.abs(sortedLevels[k] - sortedLevels[k - 1]) / sortedLevels[k - 1];
        expect(rel).toBeGreaterThan(0.005); // никаких «половин» одной зоны
      }
    }
  });

  it('зоны из разных источников (свинг + круглое число) усиливают одну зону, а не дублируют', () => {
    // три V-отскока с минимумами ровно у круглого числа 90 → одна зона поддержки
    const candles = [
      ...flat(30, 96),
      c(93, 94, 89.9, 92), c(93, 96, 91, 94), c(95, 98, 93, 96), c(96, 97, 92, 95),
      c(93, 94, 90.0, 92), c(93, 96, 91, 94), c(95, 98, 93, 96), c(96, 97, 92, 95),
      c(93, 94, 90.1, 92), c(93, 96, 91, 94), c(95, 98, 93, 96),
    ];
    const zones = ZoneVoter.collect(95, candles);
    const near90 = zones.support.filter((z) => Math.abs(z.level - 90) < 1.2);
    expect(near90.length).toBe(1);
    expect(near90[0].touches).toBeGreaterThanOrEqual(3);
  });
});
