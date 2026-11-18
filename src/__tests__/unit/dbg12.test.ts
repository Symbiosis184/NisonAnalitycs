import { describe, it } from 'vitest';
import { Candle } from '../../utils/candle';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

describe('dbg12', () => {
  it('swings manual', () => {
    const candles: Candle[] = [
      ...Array.from({ length: 20 }, (_, i) => mk(i + 1, 100, 100.3, 99.7, 100)),
      mk(25, 100.4, 100.6, 100.2, 100.5),
    ];
    for (let t = 26; t <= 80; t++) {
      const p = 100.6 - (t - 25) * 0.07;
      candles.push(mk(t, p + 0.1, p + 0.2, p - 0.2, p));
    }
    const span = 3;
    let highs = 0, lows = 0;
    for (let i = span; i < candles.length - span; i++) {
      const c = candles[i];
      let isLow = true, isHigh = true;
      for (let k = 1; k <= span && (isLow || isHigh); k++) {
        if (isLow && !(c.low < candles[i - k].low && c.low < candles[i + k].low)) isLow = false;
        if (isHigh && !(c.high > candles[i - k].high && c.high > candles[i + k].high)) isHigh = false;
      }
      if (isLow) lows++;
      if (isHigh) highs++;
    }
    console.log(`DBG12 highs=${highs} lows=${lows} len=${candles.length}`);
  });
});
