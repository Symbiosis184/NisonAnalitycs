import { it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';
const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });
it('dbg black', () => {
  const hist = [
    ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 100.05, 100.3, 99.7, 99.95)),
    mk(26, 103, 103.5, 99.6, 100),
    mk(27, 100, 101.2, 99.8, 101),
    mk(28, 101, 101.6, 100.6, 100.9),
    mk(29, 100.9, 101.3, 100.4, 100.7),
    mk(30, 100.7, 101.1, 100.4, 100.6),
    mk(31, 100.6, 101.0, 100.3, 100.5),
    mk(32, 100.5, 100.9, 100.2, 100.4),
    mk(33, 100.4, 100.8, 100.1, 100.3),
    mk(34, 100.3, 100.7, 100.0, 100.2),
    mk(35, 100.2, 100.6, 99.9, 100.1),
  ];
  const zones = ZoneVoter.collect(100.1, hist, 'swing');
  console.log('LB RES:', JSON.stringify(zones.resistance.filter(z=>z.sources.includes('long-body')).map(z=>({level:z.level,hw:z.halfWidth,band:z.bookBand,r:z.reasons})),null,1));
  console.log('LB SUP:', JSON.stringify(zones.support.filter(z=>z.sources.includes('long-body')).map(z=>({level:z.level,hw:z.halfWidth,band:z.bookBand})),null,1));
  console.log('ALLRES:', JSON.stringify(zones.resistance.map(z=>({level:z.level,src:z.sources})),null,1));
  expect(true).toBe(true);
});
