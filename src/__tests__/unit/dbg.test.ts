import { describe, it } from 'vitest';
import { findSwings, addLevelToMap, dedupeZones, type ZoneClusterData } from '../../utils/levels';
import { Candle } from '../../utils/candle';

function mkCandles(n: number): any[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const mid = 100 + 8 * Math.sin(i / 5) + 3 * Math.sin(i / 2.1);
    out.push(new Candle({ time: 1700000000000 + i * 60000, open: mid - 0.3, high: mid + 1.2, low: mid - 1.2, close: mid + 0.3, volume: 100 + (i % 7) * 10 }));
  }
  return out;
}

describe('dbg', () => {
  it('repro cluster', () => {
    const candles = mkCandles(200);
    const price = candles[candles.length - 1].close;
    const atrVal = 2.6343; // approx from zoneHalfWidth output
    const hwOf = (lv: number, tol: number) => Math.min(Math.max(tol * lv, atrVal * 0.25), atrVal * 2);
    for (const [tf, tol] of [['scalp', 0.002], ['position', 0.008]] as Array<[string, number]>) {
      const span = tf === 'scalp' ? 2 : 4;
      const map = new Map<number, ZoneClusterData>();
      const swings = findSwings(candles, 200, span).filter(s => s.type === 'high');
      for (const s of swings) {
        addLevelToMap(map, s.level, 'sw', s.time, tol, 1, { source: 'swing', halfWidth: hwOf(s.level, tol) });
      }
      addLevelToMap(map, 110, 'round', Date.now(), tol, 1, { source: 'round-number', halfWidth: hwOf(110, tol) });
      dedupeZones(map, tol);
      for (const [lv, d] of map.entries()) {
        if (lv > 109) console.log(tf, 'cluster lvl=', lv.toFixed(4), 'hw=', d.halfWidth?.toFixed(4), 'src=', d.sources?.join(','));
      }
    }
  });
});
