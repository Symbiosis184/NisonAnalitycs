import { describe, it, expect } from 'vitest';
import { Candle } from '../../workspace/src/utils/candle';
import { ZoneVoter } from '../../workspace/src/utils/zone_voter';
const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });
describe('dbg', () => {
  it('task1 hist', () => {
    const hist = [
      ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 99.95, 100.3, 99.7, 100.05)),
      mk(26, 100, 103.4, 99.5, 103),
      mk(27, 103, 103.2, 101.8, 102.2),
      mk(28, 102.2, 102.4, 100.6, 101.2),
      mk(29, 101.2, 101.4, 99.8, 100.8),
      mk(30, 100.8, 101.6, 100.4, 101.4),
      mk(31, 101.4, 101.8, 101.0, 101.5),
      mk(32, 101.5, 102.0, 101.2, 101.8),
      mk(33, 101.8, 102.2, 101.5, 102.0),
      mk(34, 102.0, 102.4, 101.7, 102.2),
      mk(35, 102.2, 102.6, 101.9, 102.4),
    ];
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addLongBodyLevels(hist, supMap, resMap, { tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3 });
    console.log('addLongBodyLevels sup:', JSON.stringify([...supMap.entries()], null, 1));
    const zones = ZoneVoter.collect(102.4, hist, 'swing');
    console.log('collect support long-body:', zones.support.filter(z=>z.sources.includes('long-body')).map(z=>({level:z.level,hw:z.halfWidth,band:z.bookBand})));
    expect(true).toBe(true);
  });
});
