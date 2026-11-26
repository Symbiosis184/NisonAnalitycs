import { it } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';
const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });
it('dbg2', () => {
  const hist = [
    ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 99.95, 100.3, 99.7, 100.05)),
    mk(26, 100, 103.4, 99.5, 103),
    mk(27, 103, 103.2, 102.5, 102.8), mk(28, 102.8, 103.0, 102.2, 102.5),
    mk(29, 102.5, 102.8, 102.0, 102.2), mk(30, 102.2, 102.5, 101.8, 102.0),
    mk(31, 102.0, 102.3, 101.5, 101.8), mk(32, 101.8, 102.0, 101.2, 101.5),
    mk(33, 101.5, 101.8, 101.0, 101.2), mk(34, 101.2, 101.5, 100.8, 101.0),
    mk(35, 101.0, 101.2, 100.5, 100.8), mk(36, 100.8, 101.0, 100.2, 100.5),
    mk(37, 100.5, 100.8, 100.0, 100.2), mk(38, 100.2, 100.5, 99.8, 100.0),
    mk(39, 100.0, 100.2, 99.5, 99.8), mk(40, 99.8, 100.0, 99.2, 99.5),
    mk(41, 99.5, 99.8, 99.0, 99.2), mk(42, 99.2, 99.5, 98.8, 99.0),
    mk(43, 99.0, 99.2, 98.5, 98.8), mk(44, 98.8, 99.0, 98.2, 98.5),
    mk(45, 98.5, 98.8, 98.0, 98.2), mk(46, 98.2, 98.5, 97.5, 98.0),
    mk(47, 98.0, 98.5, 97.8, 98.2), mk(48, 98.2, 98.8, 98.0, 98.5),
    mk(49, 98.5, 99.0, 98.2, 98.8), mk(50, 98.8, 99.5, 98.5, 99.2),
    mk(51, 99.2, 100.0, 99.0, 99.8), mk(52, 99.8, 102.0, 99.5, 101.8),
    mk(53, 101.8, 102.2, 101.5, 102.0), mk(54, 102.0, 102.5, 101.8, 102.2),
    mk(55, 102.2, 102.8, 102.0, 102.5),
  ];
  const zones = ZoneVoter.collect(102.5, hist, 'swing');
  for (const z of zones.resistance.filter(z=>z.sources.includes('long-body')))
    console.log('LB-RES', JSON.stringify({level:z.level,hw:z.halfWidth,band:z.bookBand,reasons:z.reasons.map(r=>r.slice(0,60))}));
  for (const z of zones.support.filter(z=>z.sources.includes('long-body')))
    console.log('LB-SUP', JSON.stringify({level:z.level,hw:z.halfWidth,band:z.bookBand,reasons:z.reasons.map(r=>r.slice(0,60))}));
});
