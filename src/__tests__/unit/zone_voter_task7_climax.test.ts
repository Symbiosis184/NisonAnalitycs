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

/** Нисходящий тренд + кульминация продаж (большой объём, длинная чёрная свеча). */
const sellingClimaxHistory = (): Candle[] => {
  const h: Candle[] = [];
  // длительное снижение: 60 баров вниз (проектный контекст-фильтр требует спад)
  for (let i = 0; i < 60; i++) {
    const t = i + 1;
    const high = 120 - i * 0.4 + 0.2;
    const low = 120 - i * 0.4 - 0.2;
    h.push(mk(t, high - 0.1, high, low, low + 0.1));
  }
  // climactic bar: резкое падение на большом объёме
  h.push(mk(61, 96, 96.2, 93.5, 93.8, 500));
  // восстановление
  for (let i = 0; i < 5; i++) {
    const t = 62 + i;
    const low = 93.8 + i * 0.2;
    h.push(mk(t, low + 0.1, low + 0.6, low, low + 0.5));
  }
  return h;
};

describe('Задача 7: климакс объёма требует предшествующего движения (ЯС гл. 15)', () => {
  beforeEach(() => ZoneVoter.clearCache());

  it('климакс продаж ПОСЛЕ спада → зона поддержки с пометкой проектной операционализации', () => {
    const supMap = new Map(); const resMap = new Map();
    (ZoneVoter as any).addVolumeClimaxLevels(sellingClimaxHistory(), supMap, resMap, {
      tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3,
    });
    const supReasons = [...supMap.values()].flatMap((d: any) => d.reasons);
    expect(supReasons.some((r: string) => /климакс покупок|кульминация покупок/i.test(r))).toBe(true);
    // Пометка «проектная операционализация» обязательна: книги не говорят
    // «экстремум климакса = зона S/R».
    expect(supReasons.some((r: string) => /проект/i.test(r))).toBe(true);
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
