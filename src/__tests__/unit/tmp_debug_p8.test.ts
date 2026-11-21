import { it } from 'vitest';
import { c } from '../helpers/candles';

it('dbg', () => {
  const risingThree = [c(100,111,99,110),c(109.8,110.2,108.8,109.4),c(109.4,109.8,108.2,109),c(109,109.5,108,108.6),c(109,112.5,108.5,112)];
  for (const n of [3,6,9]) {
    const rally = Array.from({length:n},(_,i)=>{const o=80+i*2;return c(o,o+2.3,o-0.3,o+2);});
    const prev=[...rally];
    const f=risingThree[0], l=risingThree[4], small=risingThree.slice(1,4);
    console.log(`CHECK N=${n}: len=${prev.length} bullF=${f.isBullish} longF=${f.isLongCandle} bullL=${l.isBullish} longL=${l.isLongCandle} lClose<=fClose? ${l.close<=f.close}`);
    for (const s of small) console.log('  small chk', s.high>f.high, s.low<f.low, s.body>f.body*0.5);
    console.log('  drift fail?', small[2].close >= small[0].close*0.98);
  }
});
