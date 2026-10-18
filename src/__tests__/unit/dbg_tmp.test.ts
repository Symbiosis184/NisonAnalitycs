import { it } from 'vitest';
import { signalGenerator } from '/workspace/src/utils/signal_generator';
import { nearestStructuralTarget } from '/workspace/src/utils/nison_targets';
import { atr } from '/workspace/src/utils/indicators';
import { Candle } from '/workspace/src/utils/candle';

let t = 1_700_000_000;
const mk = (o: number, h: number, l: number, c: number, v = 100): Candle => new Candle({ time: ++t, open: o, high: h, low: l, close: c, volume: v });
const downtrend = (n: number, start = 120, step = 2): Candle[] => {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) { const o = start - i * step; out.push(mk(o, o + 0.5, o - 2 - 0.5, o - 2)); }
  return out;
};
it('dbg3', () => {
  const candles: Candle[] = [...downtrend(80)];
  const lc = candles[candles.length - 1].close; // 40
  candles.push(mk(lc + 0.5, lc + 1.5, lc - 1, lc + 1, 40));
  candles.push(mk(lc - 1, lc + 7, lc - 1.5, lc + 6.5, 300));
  console.log('lastClose=', candles[81].close);
  const sigs = signalGenerator.findSignals(candles, 'D');
  console.log('signals:', JSON.stringify(sigs.map(s => ({p: s.pattern, d: s.direction, rr: +s.rr.toFixed(2), q: s.quality, st: s.status}))));
  // прямой тест цели: вход 46.5, closed = всё кроме последней
  const closed = candles.slice(0, 82);
  const entry = 46.5;
  const nf = Math.max(entry * 0.01, atr(closed, 14));
  console.log('nf=', nf.toFixed(3), 'atr=', atr(closed,14).toFixed(3));
  console.log('target@entry:', JSON.stringify(nearestStructuralTarget(entry, 'long', closed, { noiseFloor: nf, maxReward: entry*0.2 })));
  // варианты входов
  for (const e of [41, 44, 46]) console.log(`target@${e}:`, JSON.stringify(nearestStructuralTarget(e, 'long', closed, { noiseFloor: 0.46, maxReward: e*0.2 })));
});
