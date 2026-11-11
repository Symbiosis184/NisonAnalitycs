import { it } from 'vitest';
import { Candle } from './src/utils/candle';
import { PatternDetector } from './src/utils/pattern_engine';
const cc = (o:number,h:number,l:number,cl:number)=> new Candle({time:1,open:o,high:h,low:l,close:cl,volume:100});
const zigDown = (n:number,start:number,step:number)=>{const a:Candle[]=[];let cl=start;for(let i=0;i<n;i++){const p=i%6;if(p<4)cl-=step;else cl+=step*0.7;a.push(cc(cl,cl+1,cl-1,cl));}return a;};
it('dbg', () => {
  const prev = zigDown(40,130,1);
  console.log('prev last close', prev[prev.length-1].close, 'first', prev[0].close);
  const c0=cc(102,102.5,96,96.5), c1=cc(94,94.5,90,90.5), c2=cc(93.8,94.4,90.1,90.6);
  console.log('bull check', c1.isBullish, c2.isBullish);
  console.log('res', PatternDetector.isGappingSideBySide([...prev,c0,c1,c2],{market:'stocks'}));
});
