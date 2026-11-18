// ЗАДАЧА 6: Фибоначчи — строго гл. 12 ЯС.
// Книга: «Наиболее распространенными уровнями таких коррекций являются
// 50%-ный, а также 38%-ный и 62%-ный»; коррекция измеряется от КОНКРЕТНОГО
// движения A→B (рис. 12.1–12.7), а не от безымянного min/max окна.
import { describe, it, expect, beforeEach } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

describe('Задача 6: Fibonacci от направленного импульса (ЯС гл. 12)', () => {
  beforeEach(() => ZoneVoter.clearCache());

  // Направленный импульс high→low (ЯС гл. 12, рис. 12.1–12.7 — коррекция от
  // КОНКРЕТНОГО движения A→B): swing high = 100.6 на баре 21, swing low = 94.1
  // на баре 75, затем отскок вверх. Фикстура строго монотонна в импульсе и в
  // отскоке, чтобы findSwings(span=3) гарантированно нашёл оба экстремума
  // (строгие сравнения < / >; plateau из равных экстремумов не детектируется).
  const impulseHistory: any[] = [
    ...Array.from({ length: 20 }, (_, i) => mk(i + 1, 100, 100.3, 99.7, 100)),
    ...Array.from({ length: 55 }, (_, i) => {
      const t = 21 + i;
      const high = 100.6 - i * 0.1; // бар 21: high=100.6 (swing high), бар 75: 95.2
      const low = 99.6 - i * 0.1;   // бар 75: low=94.1 (swing low)
      return mk(t, high - 0.05, high, low, low + 0.05);
    }),
    ...Array.from({ length: 15 }, (_, i) => {
      const t = 76 + i;
      const low = 94.2 + i * 0.1;   // строго выше 94.1 — отскок вверх
      const high = 95.3 + i * 0.1;  // строго ниже 100.6 и монотонно растёт
      return mk(t, low + 0.05, high, low, high - 0.05);
    }),
  ];

  it('только книжные уровни 38/50/62%, без 23.6/78.6', () => {
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addFibonacciLevels(impulseHistory, supMap, resMap, {
      tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3,
    });
    const reasons = [...supMap.values(), ...resMap.values()].flatMap((d: any) => d.reasons);
    expect(reasons.some((r: string) => /23\.6/.test(r))).toBe(false);
    expect(reasons.some((r: string) => /78\.6/.test(r))).toBe(false);
    expect(reasons.some((r: string) => /38%/.test(r))).toBe(true);
    expect(reasons.some((r: string) => /50%/.test(r))).toBe(true);
    expect(reasons.some((r: string) => /62%/.test(r))).toBe(true);
  });

  it('нет псевдоцитаты «Нисон: "Уровни коррекции 38%, 50% и 62% часто выступают как зоны..."»', () => {
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addFibonacciLevels(impulseHistory, supMap, resMap, {
      tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3,
    });
    const reasons = [...supMap.values(), ...resMap.values()].flatMap((d: any) => d.reasons);
    expect(reasons.some((r: string) => /часто выступает как зон/i.test(r))).toBe(false);
  });
});
