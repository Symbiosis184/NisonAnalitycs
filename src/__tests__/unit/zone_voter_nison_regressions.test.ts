import { beforeEach, describe, expect, it } from 'vitest';
import { c, flat } from '../helpers/candles';
import { ZoneVoter } from '../../utils/zone_voter';
import { addLevelToMap, dedupeZones, type ZoneClusterData } from '../../utils/levels';

const polarityBeforeBreak = [
  c(95, 96, 94, 95), c(98, 100, 97, 99), c(102, 104, 101, 103),
  c(105, 107, 104, 106), c(108, 110, 107, 108),
  c(105, 106, 103, 104), c(104, 105, 102, 103), c(103, 104, 101, 102),
  // Возврат к 110 ДО фактического пробоя close > 110.33.
  c(109.8, 110.2, 109.5, 110.1),
  c(110.5, 111.5, 110.5, 111),
  c(111, 111.5, 110.8, 111.2),
];

const polarityAfterBreak = [
  ...polarityBeforeBreak.slice(0, 10),
  // После пробоя цена вернулась в зону и закрылась выше неё.
  c(110.8, 110.9, 109.9, 110.1),
  c(110.2, 110.7, 110, 110.4),
];

describe('S/R: хронология полярности и независимые источники', () => {
  beforeEach(() => ZoneVoter.clearCache());

  it('возврат до пробоя не создаёт полярность', () => {
    const zones = ZoneVoter.collect(111.2, polarityBeforeBreak, 'swing');
    expect(zones.support.some((z) =>
      Math.abs(z.level - 110) < 0.8 && z.reasons.some((r) => r.includes('полярность')),
    )).toBe(false);
  });

  it('полярность появляется только при последовательности пробой → возврат', () => {
    const zones = ZoneVoter.collect(110.4, polarityAfterBreak, 'swing');
    const polarity = zones.support.find((z) =>
      Math.abs(z.level - 110) < 0.8 && z.sources.includes('polarity'));
    expect(polarity).toBeDefined();
    expect(polarity!.formedAt).toBe(polarityAfterBreak[4].time);
    expect(polarity!.lastTouch).toBeGreaterThanOrEqual(polarityAfterBreak[10].time);
  });

  it('голоса равны независимым источникам, а не числу текстовых причин', () => {
    const map = new Map<number, ZoneClusterData>();
    addLevelToMap(map, 100, 'середина длинного тела', 20, 0.005, 1,
      { source: 'long-body', halfWidth: 0.4, formedAt: 10 });
    addLevelToMap(map, 100.2, 'основание длинного тела', 30, 0.005, 1,
      { source: 'long-body', halfWidth: 0.6, formedAt: 20 });
    addLevelToMap(map, 100.4, 'свинг', 40, 0.005, 2,
      { source: 'swing', halfWidth: 0.3, formedAt: 5 });
    dedupeZones(map, 0.005);
    expect(map.size).toBe(1);
    const data = [...map.values()][0];
    expect(data.sources).toEqual(['long-body', 'swing']);
    // После переноса центра на 100 полоса ещё покрывает 100.2 ± 0.6.
    expect(data.halfWidth).toBeCloseTo(0.8, 8);
    expect(data.formedAt).toBe(5);

    const zones = ZoneVoter.collect(100, polarityAfterBreak, 'swing');
    for (const zone of [...zones.support, ...zones.resistance]) {
      expect(zone.votes).toBe(zone.sources.length);
    }
  });
});

describe('S/R: окна Нисона как фактические зоны', () => {
  beforeEach(() => ZoneVoter.clearCache());

  const windowCandles = [
    ...flat(20, 99),
    c(99, 100, 98, 99.5),
    c(102, 104, 102, 103),
    c(103, 105, 102.5, 104),
  ];

  it('активное окно вверх — поддержка с половиной фактического диапазона', () => {
    const zones = ZoneVoter.collect(104, windowCandles, 'swing', 'stock');
    const window = zones.support.find((z) => z.sources.includes('window'));
    expect(window).toBeDefined();
    expect(window!.level).toBeGreaterThan(100);
    expect(window!.level).toBeLessThan(102);
    expect(window!.level - window!.halfWidth).toBeLessThanOrEqual(100);
    expect(window!.level + window!.halfWidth).toBeGreaterThanOrEqual(102);
    expect(window!.formedAt).toBe(windowCandles[21].time);
    expect(window!.votes).toBeGreaterThanOrEqual(1);
  });

  it('окна не включаются на крипте, а закрытие за границей отменяет зону', () => {
    const crypto = ZoneVoter.collect(104, windowCandles, 'swing', 'crypto');
    expect([...crypto.support, ...crypto.resistance].some((z) => z.sources.includes('window'))).toBe(false);

    const broken = [...windowCandles, c(103, 103.5, 98.5, 99)];
    const stock = ZoneVoter.collect(99, broken, 'swing', 'stock');
    expect([...stock.support, ...stock.resistance].some((z) => z.sources.includes('window'))).toBe(false);
  });

  it('окно вниз — сопротивление', () => {
    const candles = [
      ...flat(20, 103),
      c(103, 104, 102, 103),
      c(100, 100.5, 98, 99),
      c(99, 100, 97.5, 98),
    ];
    const zones = ZoneVoter.collect(98, candles, 'swing', 'stock');
    const window = zones.resistance.find((z) => z.sources.includes('window'));
    expect(window).toBeDefined();
    expect(window!.level).toBeGreaterThan(100.5);
    expect(window!.level).toBeLessThan(102);
    expect(window!.level - window!.halfWidth).toBeLessThanOrEqual(100.5);
    expect(window!.level + window!.halfWidth).toBeGreaterThanOrEqual(102);
  });
});
