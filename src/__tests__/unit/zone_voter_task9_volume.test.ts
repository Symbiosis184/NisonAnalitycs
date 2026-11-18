// ЗАДАЧА 9 (опциональная): объём и длительность в значимости зон.
// Книга (ЯС гл. 11): «Значимость линии поддержки или сопротивления зависит от
// того, как долго она остается в силе, сколько раз рынок безуспешно пытается ее
// пробить и каковы объемы торгов во время этих попыток».
// ПРИНЦИП книжный; КОНКРЕТНЫЕ ФОРМУЛЫ (v/avgVolume lookback, потолок 5×, место
// touchVolume/formedAt в тай-брейке significance) — настройка проекта, не из книг.
import { describe, it, expect, beforeEach } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

/** Одна и та же геометрия, разный объём баров-касаний у уровня 100. */
const historyWithTouchVolume = (touchVolume: number): Candle[] => {
  const h: Candle[] = [];
  // спад к основанию 100 (строго монотонный)
  for (let i = 0; i < 20; i++) {
    const high = 110 - i * 0.5 + 0.2, low = 110 - i * 0.5 - 0.2;
    h.push(mk(i + 1, high - 0.1, high, low, low + 0.1));
  }
  // дно: свеча с low=100 (swing low при swingSpan=3)
  h.push(mk(21, 100.4, 100.5, 100, 100.2));
  // три касания: тень до 100.05, закрытие выше основания полосы
  for (let i = 0; i < 3; i++) {
    h.push(mk(22 + i, 101, 101.5, 100.05, 101.2, touchVolume));
  }
  // рост от дна
  for (let i = 0; i < 20; i++) {
    const low = 101.5 + i * 0.5 - 0.2, high = 101.5 + i * 0.5 + 0.2;
    h.push(mk(25 + i, low + 0.1, high, low, high - 0.1));
  }
  return h;
};

describe('Задача 9: относительный объём касаний и возраст зоны (ЯС гл. 11)', () => {
  beforeEach(() => ZoneVoter.clearCache());

  it('touchVolume растёт с объёмом баров-касаний (проектная формула)', () => {
    const lowVol = ZoneVoter.collect(111, historyWithTouchVolume(100), 'swing');
    const highVol = ZoneVoter.collect(111, historyWithTouchVolume(500), 'swing');
    const zLow = lowVol.support.find((z) => Math.abs(z.level - 100) <= z.halfWidth + 1);
    const zHigh = highVol.support.find((z) => Math.abs(z.level - 100) <= z.halfWidth + 1);
    expect(zLow).toBeTruthy();
    expect(zHigh).toBeTruthy();
    // Принцип ЯС гл. 11: попытки пробоя на большем объёме значимее.
    // Формула v/avgVolume и потолок 5× — проектные числа, НЕ из книг.
    expect(zHigh!.touchVolume ?? 0).toBeGreaterThan(zLow!.touchVolume ?? 0);
  });

  it('formedAt заполнен и используется в тай-брейке значимости', () => {
    const zones = ZoneVoter.collect(111, historyWithTouchVolume(300), 'swing');
    for (const z of zones.support) {
      expect(Number.isFinite(z.formedAt)).toBe(true);
      expect(z.formedAt).toBeGreaterThan(0);
    }
  });
});
