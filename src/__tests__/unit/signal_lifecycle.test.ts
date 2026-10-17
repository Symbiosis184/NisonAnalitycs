// Аудит №11: жизненный цикл сигнала по Нисону (pending → confirmed/invalidated/expired)
import { describe, it, expect } from 'vitest';
import { stepSignal, resolveSignalStatus } from '../../utils/signal_lifecycle';
import { c, flat } from '../helpers/candles';

const bounds = { patternLow: 95, patternHigh: 105 };

describe('stepSignal — long', () => {
  it('подтверждение: бычья закрытая свеча выше close сигнала', () => {
    const candle = c(100, 103, 99.5, 102); // bullish, close > signalClose(100)
    expect(stepSignal('pending', 'long', 100, bounds, candle)).toBe('confirmed');
  });

  it('пробой верха формации подтверждает даже без бычьего тела?', () => {
    const candle = c(106.5, 107, 106, 106.2); // small body but close > patternHigh
    expect(stepSignal('pending', 'long', 100, bounds, candle)).toBe('confirmed');
  });

  it('отмена: пробой стопа формации приоритетнее прогресса внутри свечи', () => {
    // бычья свеча с close > signalClose, но low <= patternLow → сначала проверка стопа
    const candle = c(98, 104, 94, 103);
    expect(stepSignal('pending', 'long', 100, bounds, candle)).toBe('invalidated');
  });

  it('нейтральная свеча оставляет pending', () => {
    const candle = c(100, 101, 99, 99.5); // bearish, close < signalClose, стоп цел
    expect(stepSignal('pending', 'long', 100, bounds, candle)).toBe('pending');
  });

  it('терминальные состояния необратимы', () => {
    const candle = c(120, 121, 119, 120.5);
    expect(stepSignal('invalidated', 'long', 100, bounds, candle)).toBe('invalidated');
    expect(stepSignal('confirmed', 'long', 100, bounds, candle)).toBe('confirmed');
  });
});

describe('stepSignal — short (зеркальность)', () => {
  it('медвежья свеча ниже close сигнала → confirmed', () => {
    const candle = c(100, 100.5, 97, 98); // bearish close < signalClose(100), high < patternHigh
    expect(stepSignal('pending', 'short', 100, bounds, candle)).toBe('confirmed');
  });

  it('пробой верха формации отменяет шорт', () => {
    const candle = c(104, 106, 103.5, 105.5);
    expect(stepSignal('pending', 'short', 100, bounds, candle)).toBe('invalidated');
  });
});

describe('resolveSignalStatus — только закрытые свечи', () => {
  it('формирующаяся последняя свеча НЕ участвует в подтверждении', () => {
    // idx=0 сигнал (close 100); candles[1] — «закрытая» отмена; candles[2] незакрытая
    const arr = [c(100, 101, 99, 100), c(99, 100, 98.5, 99.2), c(99.5, 104, 99, 103.5)];
    // closedCount=2: учли только свечу [1] (не подтвердила, не отменила) → pending
    expect(resolveSignalStatus(arr, 0, 'long', 100, bounds, 2)).toBe('pending');
    // closedCount=3: свеча [2] бычья выше close сигнала → confirmed
    expect(resolveSignalStatus(arr, 0, 'long', 100, bounds, 3)).toBe('confirmed');
  });

  it('окно ожидания: без подтверждения за timeoutBars → expired', () => {
    const arr = [c(100, 101, 99, 100), ...flat(5, 100)];
    // нейтральные плоские свечи не дают прогресса (flat: close чуть выше open → бычья!)
    // используем явно медвежьи нейтральные: below signalClose
    const neutral = [c(100, 101, 99, 100)];
    for (let i = 0; i < 5; i++) neutral.push(c(99.8, 100.2, 99.6, 99.7)); // bearish, стоп цел
    expect(resolveSignalStatus(neutral, 0, 'long', 100, bounds, neutral.length, 3)).toBe('expired');
    expect(arr.length).toBeGreaterThan(0);
  });

  it('отмена раньше окна ожидания фиксируется немедленно', () => {
    const arr = [c(100, 101, 99, 100), c(99.5, 100, 94.5, 99.8)]; // low <= 95
    expect(resolveSignalStatus(arr, 0, 'long', 100, bounds, arr.length, 3)).toBe('invalidated');
  });

  it('инвариант согласованности: пошаговое вычисление == мгновенное', () => {
    // свойство: статус на N закрытых свечах = редукция шагов; подтверждённый статус
    // не меняется при добавлении последующих свечей (монотонность терминальных состояний)
    const arr = [c(100, 101, 99, 100), c(100.2, 103, 100, 102.5), ...flat(4, 103)];
    const s3 = resolveSignalStatus(arr.slice(0, 2), 0, 'long', 100, bounds, 2);
    expect(s3).toBe('confirmed');
    // добавили ещё свечи — статус остался confirmed (по полному массиву)
    const sFull = resolveSignalStatus(arr, 0, 'long', 100, bounds, arr.length);
    expect(sFull).toBe('confirmed');
  });
});
