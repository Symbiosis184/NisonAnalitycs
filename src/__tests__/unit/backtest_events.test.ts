// Аудит бэктеста: one-at-a-time прогон должен собирать «свежие» события детектора
// (patternEndIdx === i). До фикса endIdx переиндексировался коротким срезом и
// совпадений было 0 → страница «Бэктест» всегда пустая.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { signalGenerator } from '../../utils/signal_generator';

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
