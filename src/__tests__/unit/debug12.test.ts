// Аудит №12: диагностика — почему поглощение не доходит до сигнала.
import { describe, it } from 'vitest';
import { PatternDetector } from '../../utils/pattern_engine';
import { nearestStructuralTarget } from '../../utils/nison_targets';
import { atr } from '../../utils/indicators';
import { signalGenerator } from '../../utils/signal_generator';
import { makeDowntrend, mkCandle } from '../helpers/trend_series';

describe('debug series', () => {
  it('why no engulfing signal', () => {
    const candles = [...makeDowntrend(70)];
    candles.push(mkCandle(162, 162.5, 159.5, 160, 50));
    candles.push(mkCandle(158, 168, 157.5, 167, 300));
    for (let k = 0; k < 10; k++) {
      const o = 167 - k * 2;
      candles.push(mkCandle(o, o + 0.5, o - 1.5, o - 2, 100));
    }
    candles.push(mkCandle(146, 146.5, 144.5, 145, 30));
    candles.push(mkCandle(144.5, 147.5, 144, 147, 60));

    //检测 на индексах 71 и 84
    for (const i of [71, 84]) {
      const prev = candles.slice(0, i - 1);
      const check = PatternDetector.isBullishEngulfing(candles[i - 1], candles[i], prev);
      console.log('ENGULF@' + i, JSON.stringify(check));
      if (check.found) {
        const closed = candles.slice(0, i + 1);
        const noiseFloor = Math.max(candles[i].close * 0.01, atr(closed, 14));
        const t = nearestStructuralTarget(candles[i].close, 'long', closed, { noiseFloor, maxReward: candles[i].close * 0.2 });
        console.log('TARGET@' + i, JSON.stringify(t), 'noise', noiseFloor.toFixed(2));
        const bounds = PatternDetector.getFormationBounds(check.name, candles, i);
        console.log('BOUNDS@' + i, JSON.stringify(bounds));
      }
    }
    console.log('SIGNALS', signalGenerator.findSignals(candles, 'D').length);
  });
});
