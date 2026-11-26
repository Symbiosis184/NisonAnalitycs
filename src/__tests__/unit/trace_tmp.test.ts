import { it } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';
const c = (open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time: Date.now() + Math.random()*1e9, open, high, low, close, volume });
const flat = (n: number, p: number) => Array.from({length:n},(_,i)=>c(p, p+0.5, p-0.5, p));

it('trace window', () => {
  const candles = [
    ...flat(20, 103),
    c(103, 104, 102, 103),
    c(100, 100.5, 98, 99),
    c(99, 100, 97.5, 98),
  ];
  ZoneVoter.clearCache();
  const zones = ZoneVoter.collect(98, candles, 'swing', 'stock');
  console.log('WIN_RES');
  for (const z of zones.resistance) console.log(JSON.stringify({lvl:z.level,hw:z.halfWidth,src:z.sources,band:z.bookBand,touches:z.touches,votes:z.votes,r:z.reasons.slice(0,2)}));
  console.log('WIN_SUP');
  for (const z of zones.support) console.log(JSON.stringify({lvl:z.level,hw:z.halfWidth,src:z.sources,band:z.bookBand}));
});
