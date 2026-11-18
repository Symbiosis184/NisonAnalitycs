// ЗАДАЧА 7 (опциональная): климакс объёма — контекст тренда.
// Книга: ЯС гл. 15, глоссарий: «кульминация продаж — резкое падение цены на фоне
// большого объема торгов ПОСЛЕ периода длительного снижения»; «выпуск пара —
// разворот... после сильного и быстрого движения цены».
// ВАЖНО: правило «экстремум климакса = зона S/R» в книгах прямо не дано — это
// проектная операционализация; порог 2×avg(60) — настройка проекта, не из книг.
import { describe, it, expect, beforeEach } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

/** Восходящий тренд + кульминация покупок (большой объём, длинная белая свеча). */
const buyingClimaxHistory = (): Candle[] => {
  const h: Candle[] = [];
  // ралли: 60 баров вверх — предшествующее движение (ЯС гл. 15)
  for (let i = 0; i < 60; i++) {
    const t = i + 1;
    const low = 80 + i * 0.4 - 0.2;
    const high = 80 + i * 0.4 + 0.2;
    h.push(mk(t, low + 0.1, high, low, high - 0.1));
  }
  // climactic bar: резкий рост на большом объёме (белая свеча)
  h.push(mk(61, 104, 107.5, 103.8, 107.2, 500));
  // откат
  for (let i = 0; i < 5; i++) {
    const t = 62 + i;
    const high = 107.2 - i * 0.2;
    h.push(mk(t, high - 0.5, high, high - 0.6, high - 0.1));
  }
  return h;
};

describe('Задача 7: климакс объёма требует предшествующего движения (ЯС гл. 15)', () => {
  beforeEach(() => ZoneVoter.clearCache());

  it('климакс покупок ПОСЛЕ ралли → зона сопротивления с пометкой проектной операционализации', () => {
    // ЯС гл. 15: «выпуск пара — разворот... после сильного и быстрого движения
    // цены». Климакс ПОСЛЕ ралли (белая свеча, большой объём) = кульминация
    // покупок → медвежий контекст → зона на ВЕРШИНЕ свечи (c.high), в корзине
    // сопротивлений. Экстремум как зона и порог 2×avg(60) — проектные.
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addVolumeClimaxLevels(buyingClimaxHistory(), supMap, resMap, {
      tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3,
    });
    const resReasons = [...resMap.values()].flatMap((d: any) => d.reasons);
    expect(resReasons.some((r: string) => /климакс продаж/i.test(r))).toBe(true);
    // Пометка «проектная операционализация» обязательна: книги не говорят
    // «экстремум климакса = зона S/R».
    expect(resReasons.some((r: string) => /проект/i.test(r))).toBe(true);
    // И наоборот: без предшествующего спада бычьих климакс-зон нет.
    expect([...supMap.values()].flatMap((d: any) => d.reasons)
      .some((r: string) => /климакс/i.test(r))).toBe(false);
  });

  it('боковик без предшествующего движения → климакс-зон нет', () => {
    const flat: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      flat.push(mk(i + 1, 100, 100.3, 99.7, 100));
    }
    // большой объём, но НЕТ предшествующего тренда/импульса
    flat.push(mk(61, 100, 100.4, 99.6, 100.1, 600));
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addVolumeClimaxLevels(flat, supMap, resMap, {
      tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3,
    });
    expect(supMap.size + resMap.size).toBe(0);
  });
});
