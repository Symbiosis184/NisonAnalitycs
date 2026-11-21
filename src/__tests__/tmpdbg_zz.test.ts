import { it } from 'vitest';
import { getSwingTrend } from '../utils/trend_detection';
import { Candle } from '../utils/candle';

const mk = (o: number, h: number, l: number, c: number, v = 100) =>
  new Candle({ time: 0, open: o, high: h, low: l, close: c, volume: v });

it('zz', () => {
  const rally6 = Array.from({ length: 6 }, (_, i) => { const open = 80 + i*2; return mk(open, open+2.3, open-0.3, open+2); });
  const risingThree = [
    mk(100,111,99,110), mk(109.8,110.2,108.8,109.4), mk(109.4,109.8,108.2,109), mk(109,109.5,108,108.6), mk(109,112.5,108.5,112),
  ];
  console.log('ZZ prev(-4):', getSwingTrend([...rally6, ...risingThree].slice(0, -4)));
});
