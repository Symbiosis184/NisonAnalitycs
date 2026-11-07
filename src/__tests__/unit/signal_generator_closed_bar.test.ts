import { afterEach, describe, expect, it, vi } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';
import { signalGenerator } from '../../utils/signal_generator';

function mkCandles(): Candle[] {
  return Array.from({ length: 8 }, (_, i) => {
    const open = 100 + i;
    return new Candle({
      time: 1_700_000_000 + i * 60_000,
      open,
      high: open + 1,
      low: open - 1,
      close: open + 0.5,
      volume: 100,
    });
  });
}

afterEach(() => vi.restoreAllMocks());

describe('SignalGenerator — граница закрытых баров', () => {
  it('проверяет последнюю свечу, если она уже закрыта', () => {
    const candles = mkCandles();
    const last = candles[candles.length - 1];
    const spy = vi.spyOn(PatternDetector, 'isHammer');

    signalGenerator.findSignals(candles, 'D');

    expect(spy.mock.calls.some(([candle]) => candle === last)).toBe(true);
  });

  it('не проверяет последнюю свечу, пока она формируется', () => {
    const candles = mkCandles();
    const last = candles[candles.length - 1];
    Object.assign(last, { isForming: true });
    const spy = vi.spyOn(PatternDetector, 'isHammer');

    signalGenerator.findSignals(candles, 'D');

    expect(spy.mock.calls.some(([candle]) => candle === last)).toBe(false);
  });
});
