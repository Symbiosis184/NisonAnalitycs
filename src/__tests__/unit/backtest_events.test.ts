// Аудит бэктеста: one-at-a-time прогон должен собирать «свежие» события детектора
// (patternEndIdx === i). До фикса endIdx переиндексировался коротким срезом и
// совпадений было 0 → страница «Бэктест» всегда пустая.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { signalGenerator } from '../../utils/signal_generator';
import { runBacktest } from '../../utils/backtest';

function mkCandles(n: number): Candle[] {
  // Детерминированная синтетика по канону Нисона: устойчивый нисходящий тренд
  // (разрешающий контекст для разворотных формаций) с периодическими отскоками
  // у кластера поддержки. Молоты/поглощения формируются на дне отскока.
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const phase = i % 14;
    let o = price, c: number, hi: number, lo: number;
    if (phase === 12) {
      // молот: малое тело вверху диапазона, длинная нижняя тень тестирует поддержку
      c = price * 1.004;
      o = price * 0.997;
      lo = Math.min(o, c) * 0.955;   // тень ~8× тела
      hi = Math.max(o, c) * 1.002;
    } else if (phase === 13) {
      // подтверждающая бычья свеча выше максимума молота
      c = price * 1.03;
      o = price * 1.001;
      hi = c * 1.002;
      lo = o * 0.999;
    } else {
      // спад: медвежьи свечи с небольшими тенями
      c = price * 0.986;
      o = price * 1.001;
      hi = o * 1.003;
      lo = c * 0.998;
    }
    out.push(new Candle({ time: 1_700_000_000 + i * 86400, open: o, high: hi, low: lo, close: c, volume: 1000 + (i % 5) * 120 }));
    price = c;
  }
  return out;
}

describe('backtest event collection (no lookahead, fresh events)', () => {
  it('fresh signals match patternEndIdx === current bar', () => {
    const candles = mkCandles(240);
    // sanity: детектор вообще находит формации на синтетике
    const anySigs = signalGenerator.findSignals(candles, 'D');
    expect(anySigs.length).toBeGreaterThan(0);
    // ключевое свойство: endIdx сигнала — абсолютный индекс бара на переданном массиве
    for (const s of anySigs) {
      expect(s.meta.patternEndIdx).toBeLessThan(candles.length);
      expect(s.meta.patternEndIdx).toBeGreaterThanOrEqual(candles.length - 21);
    }
    // one-at-a-time прогон собирает события «первого наблюдения» формации
    // (флаг isFreshEvent): вход сразу после подтверждения, без lookahead.
    let events = 0;
    for (let i = 60; i < candles.length; i++) {
      const sigs = signalGenerator.findSignals(candles.slice(0, i + 1), 'D');
      for (const s of sigs) if ((s as typeof s & { isFreshEvent?: boolean }).isFreshEvent) events++;
    }
    expect(events).toBeGreaterThan(0);
    // событие не может ссылаться на бар из будущего относительно прогона
    // и формация подтверждается не позже чем через 20 баров после своего endIdx
    for (let i = 60; i < candles.length; i++) {
      const sigs = signalGenerator.findSignals(candles.slice(0, i + 1), 'D');
      for (const s of sigs) {
        if (!(s as typeof s & { isFreshEvent?: boolean }).isFreshEvent) continue;
        expect(s.meta.patternEndIdx).toBeLessThanOrEqual(i);
        expect(i - s.meta.patternEndIdx).toBeLessThanOrEqual(20);
      }
    }
  });

  it('dedup: same formation returned once per scan call', () => {
    const candles = mkCandles(120);
    const sigs = signalGenerator.findSignals(candles, 'D');
    const keys = sigs.map((s) => `${s.pattern}|${s.direction}|${s.meta.patternEndIdx}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('one-at-a-time: each formation counted exactly once across the run', () => {
    const candles = mkCandles(240);
    const seenKeys = new Map<string, number>();
    for (let i = 60; i < candles.length; i++) {
      const sigs = signalGenerator.findSignals(candles.slice(0, i + 1), 'D');
      for (const s of sigs) {
        if (!(s as typeof s & { isFreshEvent?: boolean }).isFreshEvent) continue;
        const key = `${s.pattern}|${s.direction}|${s.meta.patternEndIdx}`;
        seenKeys.set(key, (seenKeys.get(key) ?? 0) + 1);
      }
    }
    // каждая формация — ровно одно событие за весь прогон
    for (const [, count] of seenKeys) expect(count).toBe(1);
    expect(seenKeys.size).toBeGreaterThan(0);
  });
});

// === Сигнальный режим (signalManagement): проверка ТЕКУЩЕЙ стратегии целиком ===
describe('runBacktest signalManagement (структурная цель вместо 2R)', () => {
  const mk = (n: number, fn: (i: number) => [number, number, number, number]): Candle[] =>
    Array.from({ length: n }, (_, i) => { const [o, h, l, c] = fn(i); return new Candle({ time: 1000 + i, open: o, high: h, low: l, close: c, volume: 100 }); });

  it('цель ниже механического 2R достигается раньше — исход target по структурному уровню', () => {
    // Паттерн на баре 0: вход close=100, стоп patternLow=98 (risk=2).
    // Механика 2R => тейк 104. Структурная цель живой стратегии => 106 (rr=3 >= minRR=2).
    const candles = mk(5, (i) => (i === 0 ? [99, 101, 97.5, 100] : i === 1 ? [100, 106.1, 98.5, 101] : [101, 101.5, 100.5, 101.2]));
    const detect = (_h: Candle[], idx: number) => idx === 0
      ? { patternLow: 98, patternHigh: 101, target: { targetPrice: 106, minRR: 2 } }
      : null;
    const res = runBacktest(candles, { detect, direction: 'long', signalManagement: true, costs: { feeRate: 0, slippageRate: 0 } });
    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].targetPrice).toBeCloseTo(106);
    expect(res.trades[0].outcome).toBe('target');
    expect(res.trades[0].exitIndex).toBe(1); // достигнута на баре с high=106.1
    expect(res.trades[0].grossR).toBeCloseTo(3); // (106-100)/2, а не механические 2R
  });

  it('вход с RR < minRR отсекается (согласованность с порогом генератора >= 2)', () => {
    const candles = mk(5, () => [100, 101.5, 99, 100.5]);
    const detect = (_h: Candle[], idx: number) => idx === 0
      ? { patternLow: 98, patternHigh: 101, target: { targetPrice: 101.5, minRR: 2 } } // rr = 1.5/2 < 2
      : null;
    const res = runBacktest(candles, { detect, direction: 'long', signalManagement: true });
    expect(res.trades).toHaveLength(0);
  });

  it('цель против направления сделки — сигнал не торгуется', () => {
    const candles = mk(5, () => [100, 101, 99, 100]);
    const detect = (_h: Candle[], idx: number) => idx === 0
      ? { patternLow: 98, patternHigh: 101, target: { targetPrice: 90, minRR: 2 } } // лонг, цель ниже входа
      : null;
    const res = runBacktest(candles, { detect, direction: 'long', signalManagement: true });
    expect(res.trades).toHaveLength(0);
  });

  it('без signalManagement поведение прежнее — механический 2R-тейк', () => {
    const candles = mk(5, (i) => (i === 0 ? [99, 101, 97.5, 100] : [100, 102.1, 99.5, 101]));
    const detect = (_h: Candle[], idx: number) => idx === 0
      ? { patternLow: 98, patternHigh: 101, target: { targetPrice: 102, minRR: 2 } }
      : null;
    const res = runBacktest(candles, { detect, direction: 'long', costs: { feeRate: 0, slippageRate: 0 } });
    expect(res.trades[0].targetPrice).toBeCloseTo(104); // 2R, структурная цель проигнорирована
  });
});
