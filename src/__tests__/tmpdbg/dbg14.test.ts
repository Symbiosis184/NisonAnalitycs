import { it, expect } from 'vitest';
import { PatternDetector } from '../../utils/pattern_engine';
import { Candle } from '../../utils/candle';
const mk = (o:number,h:number,l:number,c:number,v=100)=>new Candle({time:0,open:o,high:h,low:l,close:c,volume:v});
it('dbg', () => {
  const warmup = () => Array.from({length:20},()=>mk(90,91,89,90));
  const rising = [...warmup(), mk(90,96.2,89.8,96,300), mk(95.8,96,94.2,94.4), mk(94.4,94.6,93,93.2), mk(93.2,93.4,91.8,92), mk(92,98.6,91.8,98,400)];
  console.log('bugfix rising:', JSON.stringify((PatternDetector as any).isRisingThree(rising)));
  const falling = [...warmup(), mk(110.2,110.4,103.8,104,300), mk(104.2,105.8,104,105.6), mk(105.6,107.2,105.4,107), mk(107,108.4,106.8,108.2), mk(108.2,108.4,101.6,102,400)];
  console.log('bugfix falling:', JSON.stringify((PatternDetector as any).isFallingThree(falling)));
  const rally = Array.from({length:6},(_,i)=>{const open=100+i*2;return mk(open,open+0.3,open-2.3,open-2);});
  const rt = [mk(100,111,99,110),mk(109.8,110.2,108.8,109.4),mk(109.4,109.8,108.2,109),mk(109,109.5,108,108.6),mk(109,112.5,108.5,112)];
  console.log('audit rising:', JSON.stringify((PatternDetector as any).isRisingThree([...rally, ...rt])));
  const f = rt[0], l = rt[4];
  console.log('flags f.isBullish', f.isBullish, 'f.isLongCandle', f.isLongCandle, 'body', f.body, 'range', f.totalRange, 'l.isLongCandle', l.isLongCandle, 'lbody', l.body, 'lrange', l.totalRange);
  expect(1).toBe(1);
});
