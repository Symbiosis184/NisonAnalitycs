// ЗАДАЧА 3: классификация в collect(): роль зоны задаётся источником и
// полярностью, а не позицией live-цены относительно средней линии.
// Книга (ЗГ гл. 2): «пока цены закрытия держатся выше поддержки, она остается
// в силе» — то есть цена внутри полосы — это момент теста, зона жива.
import { describe, it, expect, beforeEach } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

describe('Задача 3: цена внутри полосы не удаляет зону и не меняет её роль', () => {
  beforeEach(() => ZoneVoter.clearCache());

  // Синтетическая история с длинным белым телом: зона [99.5 … 101.5] → level=100.5, halfWidth=1.
  // Последняя закрытая цена = 99.5 (ровно нижняя граница полосы) — старая логика
  // `.filter(z => z.level <= price)` отбрасывала такую поддержку (100.5 > 99.5).
  const histInsideBand = [
    ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 99.95, 100.3, 99.7, 100.05)),
    mk(26, 100, 103.4, 99.5, 103),                       // длинная белая: mid=101.5, low=99.5
    mk(27, 103, 103.2, 102.8, 103),                      // над зоной
    mk(28, 103, 103.1, 102.5, 102.8),                    // над зоной
    mk(29, 102.8, 103.0, 102.2, 102.5),                  // над зоной
    mk(30, 102.5, 102.8, 102.0, 102.2),                  // над зоной
    mk(31, 102.2, 102.5, 101.8, 102.0),                  // над зоной
    mk(32, 102.0, 102.2, 101.5, 101.8),                  // над зоной
    mk(33, 101.8, 102.0, 101.2, 101.5),                  // над зоной
    mk(34, 101.5, 101.8, 101.0, 101.2),                  // касание верхней границы полосы
    mk(35, 101.2, 101.5, 100.8, 101.0),                  // внутри полосы
    mk(36, 101.0, 101.2, 100.5, 100.8),                  // внутри полосы
    mk(37, 100.8, 101.0, 100.2, 100.5),                  // внутри полосы
    mk(38, 100.5, 100.8, 100.0, 100.2),                  // внутри полосы
    mk(39, 100.2, 100.5, 99.8, 100.0),                   // внутри полосы
    mk(40, 100.0, 100.2, 99.6, 99.8),                    // близко к нижней границе
    mk(41, 99.8, 100.0, 99.5, 99.6),                     // ровно на нижней границе
    mk(42, 99.6, 99.8, 99.5, 99.5),                      // close = 99.5 — ВНИТРИ полосы [99.5..101.5]
  ];

  it('close внутри полосы (level=100.5, halfWidth=1, lastClose=99.5) → зона остаётся поддержкой', () => {
    const lastClose = histInsideBand[histInsideBand.length - 1].close;
    const zones = ZoneVoter.collect(lastClose, histInsideBand, 'swing');
    const lb = zones.support.filter((z) => z.sources.includes('long-body'));
    expect(lb.length).toBe(1);
    expect(lb[0].level).toBeCloseTo(100.5, 6);
    expect(lb[0].halfWidth).toBeCloseTo(1, 6);
    // Старое поведение: zone.level (100.5) <= price (99.5) → false → зона исчезала.
    // Новое поведение: роль из источника + lastClose >= lo (99.5 >= 99.5) → жива.
  });

  it('isNearSupport возвращает true для цены внутри полосы', () => {
    const lastClose = histInsideBand[histInsideBand.length - 1].close;
    expect(ZoneVoter.isNearSupport(lastClose, histInsideBand, 0.015, 'swing')).toBe(true);
    // Точка ровно между бывшими точками mid=101.5 и low=99.5:
    expect(ZoneVoter.isNearSupport(100.5, histInsideBand, 0.015, 'swing')).toBe(true);
  });
});
