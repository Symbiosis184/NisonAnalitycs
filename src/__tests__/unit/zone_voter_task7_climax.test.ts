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

/** Ралли + кульминация ПРОДАЖ (большой объём, чёрная свеча) → сопротивление. */
const sellingClimaxHistory = (): Candle[] => {
  const h: Candle[] = [];
  // ралли: 60 баров вверх — предшествующее сильное движение цены (ЯС гл. 15)
  for (let i = 0; i < 60; i++) {
    const t = i + 1;
    const low = 80 + i * 0.4 - 0.2;
    const high = 80 + i * 0.4 + 0.2;
    h.push(mk(t, low + 0.1, high, low, high - 0.1));
  }
  // climactic bar: резкое падение на большом объёме (чёрная свеча) — выпуск пара
  h.push(mk(61, 107.2, 107.5, 103.8, 104, 500));
  // продолжение снижения
  for (let i = 0; i < 5; i++) {
    const t = 62 + i;
    const low = 104 - i * 0.2;
    h.push(mk(t, low + 0.5, low + 0.6, low, low + 0.1));
  }
  return h;
};

/** Спад + кульминация ПОКУПОК (большой объём, белая свеча) → поддержка. */
const buyingClimaxHistory = (): Candle[] => {
  const h: Candle[] = [];
  // спад: 60 баров вниз — «период длительного снижения» (ЯС гл. 15)
  for (let i = 0; i < 60; i++) {
    const t = i + 1;
    const high = 108 - i * 0.4 + 0.2;
    const low = 108 - i * 0.4 - 0.2;
    h.push(mk(t, high - 0.1, high, low, low + 0.1));
  }
  // climactic bar: резкий рост на большом объёме (белая свеча)
  h.push(mk(61, 84, 87.5, 83.8, 87.2, 500));
  // откат
  for (let i = 0; i < 5; i++) {
    const t = 62 + i;
    const high = 87.2 - i * 0.2;
    h.push(mk(t, high - 0.5, high, high - 0.6, high - 0.1));
  }
  return h;
};

describe('Задача 7: климакс объёма требует предшествующего движения (ЯС гл. 15)', () => {
  beforeEach(() => ZoneVoter.clearCache());

  it('климакс продаж ПОСЛЕ ралли → зона сопротивления (ЯС гл. 15)', () => {
    // ЯС гл. 15: «выпуск пара — разворот... после сильного и быстрого движения
    // цены». Климакс ПОСЛЕ ралли (чёрная свеча, большой объём) = кульминация
    // продаж → медвежий контекст → зона на ВЕРШИНЕ свечи (c.high), в корзине
    // сопротивлений. Экстремум как зона и порог 2×avg(60) — проектные.
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addVolumeClimaxLevels(sellingClimaxHistory(), supMap, resMap, 0.005);
    const resReasons = [...resMap.values()].flatMap((d: any) => d.reasons);
    expect(resReasons.some((r: string) => /климакс продаж/i.test(r))).toBe(true);
    // Пометка «проектная операционализация» обязательна: книги не говорят
    // «экстремум климакса = зона S/R».
    expect(resReasons.some((r: string) => /проект/i.test(r))).toBe(true);
    // И наоборот: без предшествующего спада бычьих климакс-зон нет.
    expect([...supMap.values()].flatMap((d: any) => d.reasons)
      .some((r: string) => /климакс/i.test(r))).toBe(false);
  });

  it('кульминация покупок ПОСЛЕ длительного спада → зона поддержки (ЯС гл. 15)', () => {
    // ЯС гл. 15/глоссарий: «кульминация продаж — резкое падение цены на фоне
    // большого объема торгов ПОСЛЕ периода длительного снижения» (для покупок
    // — зеркально). Белая свеча на большом объёме после спада → поддержка на
    // основании свечи (c.low).
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addVolumeClimaxLevels(buyingClimaxHistory(), supMap, resMap, 0.005);
    const supReasons = [...supMap.values()].flatMap((d: any) => d.reasons);
    expect(supReasons.some((r: string) => /климакс покупок/i.test(r))).toBe(true);
    expect([...resMap.values()].flatMap((d: any) => d.reasons)
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
    (ZoneVoter as any).addVolumeClimaxLevels(flat, supMap, resMap, 0.005);
    expect(supMap.size + resMap.size).toBe(0);
  });
});
