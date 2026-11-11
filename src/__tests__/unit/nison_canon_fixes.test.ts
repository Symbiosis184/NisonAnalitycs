// Регрессии методологического канон-аудита (ЯС/ЗГ Стива Нисона).
// Каждый блок закрепляет исправление одной задачи P0/P1 отдельным тестом.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';
import {
  getPatternId, requiresNextCandleConfirmation, getPatternCandleCount, isReversalPatternName,
} from '../../utils/pattern_ids';

const cc = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: v });

/** Восходящий зигзаг (HH/HL) — аналог генератора из nison_trend_filter.test.ts. */
const zigUp = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    if (phase < 4) cl += step; else cl -= step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

/** Нисходящий зигзаг (LH/LL). */
const zigDown = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    if (phase < 4) cl -= step; else cl += step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

describe('P0-1: повешенный (гл. 4 ЯС, «Молот и повешенный»)', () => {
  // Повешенный имеет ту же форму, что молот: малое тело в ВЕРХНЕЙ части
  // диапазона, длинная нижняя тень; отличается только контекстом (после роста).
  // До фикса atLocalHigh (тело внизу) и close >= mid (тело вверху) взаимно
  // исключались — модель не детектировалась никогда при prev.length >= 5.
  const hangingShape = (lastClose: number): Candle =>
    cc(lastClose - 0.4, lastClose + 0.2, lastClose - 3.4, lastClose - 0.1);

  it('после подтверждённого роста детектится', () => {
    const prev = zigUp(30, 100, 0.6);
    const res = PatternDetector.isHangingMan(hangingShape(prev[prev.length - 1].close), prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('ПОВЕШЕННЫЙ');
  });

  it('та же свеча после спада НЕ детектится (нет контекста роста)', () => {
    const prev = zigDown(30, 150, 0.6);
    const res = PatternDetector.isHangingMan(hangingShape(prev[prev.length - 1].close), prev);
    expect(res.found).toBe(false);
  });
});

describe('P0-2: ниже шеи / на шее (гл. 4 ЯС, «Другие модели разворота»)', () => {
  // По книге: «ниже шеи» — белая свеча закрывается вблизи МИНИМУМА предыдущего
  // дня; «на шее» — ЧУТЬ ВЫШЕ ЦЕНЫ ЗАКРЫТИЯ предыдущего дня. До фикса привязки
  // были перепутаны (у медвежьей свечи low <= close).
  // getSwingTrend требует минимум 2 подтверждённых экстремума каждого типа,
  // поэтому зигзаг берём длиной 20 баров (12 баров дают только по одному HH/HL).
  const prevDecline = zigDown(20, 130, 1); // НИСХОДЯЩИЙ swing, финальный close ≈ 120.2
  const black = cc(110, 110.5, 99, 100); // длинная медвежья: тело 10, диапазон 11.5

  it('закрытие белой у минимума чёрной → НИЖЕ ШЕИ', () => {
    const white = cc(98.8, 99.4, 98.6, 99.3); // малое бычье тело, close ≈ c1.low (99)
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НИЖЕ ШЕИ');
  });

  it('закрытие белой чуть выше закрытия чёрной → НА ШЕЕ', () => {
    // По книге «на шее»: белая ОТКРЫВАЕТСЯ ниже минимума предыдущего дня,
    // но закрывается чуть выше его ЦЕНЫ ЗАКРЫТИЯ (гэп вниз на открытии).
    const white = cc(98.5, 100.6, 98.4, 100.4); // тело 1.9 ≤ 5, close в [99.425; 101.35]
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НА ШЕЕ');
  });
});

describe('P0-3: гэп смежных свечей (гл. 7 ЯС, «Окна»/продолжения)', () => {
  // По книге: бычья форма — гэп вверх и две БЕЛЫЕ свечи после роста;
  // медвежья — гэп вниз и две ЧЁРНЫЕ свечи после спада. Прежняя реализация
  // требовала белых свечей в обеих ветках (нисходящая называлась
  // «ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)»). Вариант B по решению владельца:
  // легаси-поведение сохранено методом isGappingSideBySideLegacy под прежним
  // именем, каноническая медвежья форма получила имя «ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ».
  const STOCKS = { market: 'stocks' as const };
  // getSwingTrend требует >=2 подтверждённых экстремумов каждого типа; при 12
  // барах истории после отсечения slice(0,-3) окно слишком короткое — берём 24.
  const declineHistory = zigDown(24, 130, 2); // финальный close ≈ 120 → далее свеча ~104
  const gapBlackPair = [
    ...declineHistory,
    cc(104, 104.3, 94, 94.5),   // длинная медвежья перед гэпом
    cc(92, 92.4, 83, 83.5),     // гэп вниз (high 92.4 < low 94), чёрная
    cc(91.9, 92.3, 83.2, 83.9), // близкое открытие/тело, чёрная
  ];

  it('гэп вниз + две чёрные свечи после спада → ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ', () => {
    const res = PatternDetector.isGappingSideBySide(gapBlackPair, STOCKS);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ');
  });

  it('та же фикстура с белыми свечами → не находится (канонический метод)', () => {
    const whitePair = [
      ...declineHistory,
      cc(104, 104.3, 94, 94.5),
      cc(92, 92.4, 83, 92.3),     // белая в гэпе вниз (high 92.4 < low 94)
      cc(92.1, 92.6, 83.1, 92.4), // белая, близкие открытия/тела (|Δopen|/92 ≈ 0.1% < 0.5%)
    ];
    expect(PatternDetector.isGappingSideBySide(whitePair, STOCKS).found).toBe(false);
    // Легаси-алиас сохраняет прежнее поведение ради неизменных тест-контрактов:
    expect(PatternDetector.isGappingSideBySideLegacy(whitePair, STOCKS).name)
      .toBe('ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)');
  });

  it('новый ID зарегистрирован: подтверждение следующей свечой, размерность 3', () => {
    expect(getPatternId('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe('SIDE_BY_SIDE_GAP_BLACK_DOWN');
    expect(requiresNextCandleConfirmation('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe(true);
    expect(getPatternCandleCount('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe(3);
    expect(isReversalPatternName('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe(false); // продолжение
  });
});
