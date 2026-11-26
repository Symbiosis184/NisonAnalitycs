import { describe, it } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

describe('dbg task2 trace', () => {
  it('trace', () => {
    const hist = [
      ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 99.95, 100.3, 99.7, 100.05)),
      mk(26, 100, 103.4, 99.5, 103),
      mk(27, 103, 103.2, 102.5, 102.8),
      mk(28, 102.8, 103.0, 102.2, 102.5),
      mk(29, 102.5, 102.8, 102.0, 102.2),
      mk(30, 102.2, 102.5, 101.8, 102.0),
      mk(31, 102.0, 102.3, 101.5, 101.8),
      mk(32, 101.8, 102.0, 101.2, 101.5),
      mk(33, 101.5, 101.8, 101.0, 101.2),
      mk(34, 101.2, 101.5, 100.8, 101.0),
      mk(35, 101.0, 101.2, 100.5, 100.8),
      mk(36, 100.8, 101.0, 100.2, 100.5),
      mk(37, 100.5, 100.8, 100.0, 100.2),
      mk(38, 100.2, 100.5, 99.8, 100.0),
      mk(39, 100.0, 100.2, 99.5, 99.8),
      mk(40, 99.8, 100.0, 99.2, 99.5),
      mk(41, 99.5, 99.8, 99.0, 99.2),
      mk(42, 99.2, 99.5, 98.8, 99.0),
      mk(43, 99.0, 99.2, 98.5, 98.8),
      mk(44, 98.8, 99.0, 98.2, 98.5),
      mk(45, 98.5, 98.8, 98.0, 98.2),
      mk(46, 98.2, 98.5, 97.5, 98.0),
      mk(47, 98.0, 98.5, 97.8, 98.2),
      mk(48, 98.2, 98.8, 98.0, 98.5),
      mk(49, 98.5, 99.0, 98.2, 98.8),
      mk(50, 98.8, 99.2, 98.5, 99.0),
    ];
    const h2 = [
      ...hist.slice(0, 46),
      mk(47, 98.0, 98.5, 97.8, 98.2),
      mk(48, 98.2, 98.8, 98.0, 98.5),
      mk(49, 98.5, 99.0, 98.2, 98.8),
      mk(50, 98.8, 99.5, 98.5, 99.2),
      mk(51, 99.2, 100.0, 99.0, 99.8),
      mk(52, 99.8, 102.0, 99.5, 101.8),
      mk(53, 101.8, 102.2, 101.5, 102.0),
      mk(54, 102.0, 102.5, 101.8, 102.2),
      mk(55, 102.2, 102.8, 102.0, 102.5),
    ];
    ZoneVoter.clearCache();
    const z1 = ZoneVoter.collect(hist[hist.length-1].close, hist, 'swing');
    console.log('T1 sup:', JSON.stringify(z1.support.map(z=>({lv:z.level,hw:z.halfWidth,src:z.sources,band:z.bookBand}))));
    console.log('T1 res:', JSON.stringify(z1.resistance.map(z=>({lv:z.level,hw:z.halfWidth,src:z.sources,band:z.bookBand}))));
    ZoneVoter.clearCache();
    const z2 = ZoneVoter.collect(h2[h2.length-1].close, h2, 'swing');
    console.log('T2 sup:', JSON.stringify(z2.support.map(z=>({lv:z.level,hw:z.halfWidth,src:z.sources,band:z.bookBand}))));
    console.log('T2 res:', JSON.stringify(z2.resistance.map(z=>({lv:z.level,hw:z.halfWidth,src:z.sources,band:z.bookBand}))));
  });
});
