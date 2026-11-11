import { it } from 'vitest';
import { Candle } from '../../utils/candle';
import { nearestStructuralTarget } from '../../utils/nison_targets';
const c = (o:number,h:number,l:number,cl:number)=> new Candle({time:0,open:o,high:h,low:l,close:cl,volume:100});
it('probe', () => {
  const mk = (n:number): Candle[] => {
    const a: Candle[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 8 === 0) a.push(c(55, 60, 54.9, 59.5));
      else a.push(c(55, 55.3, 54.7, 55.2));
    }
    return a;
  };
  console.log('BEG');
  for (const tf of ['D','W']) for (const mkt of ['crypto','stock'] as const) {
    console.log(tf+mkt, JSON.stringify(nearestStructuralTarget(55,'long',mk(80),{noiseFloor:0.5,maxReward:20,timeframe:tf,market:mkt})));
  }
  console.log('END');
});
