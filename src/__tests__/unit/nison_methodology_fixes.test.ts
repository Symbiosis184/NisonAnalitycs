// Регрессии методологического аудита по канону Стива Нисона (P0/P1).
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';
import { nearestStructuralTarget } from '../../utils/nison_targets';

/** Восходящий зигзаг (аналог zigUp из nison_trend_filter.test.ts): HH/HL структура. */
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

/** Нисходящий зигзаг (аналог zigDown): LH/LL структура. */
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

const c = (o: number, h: number, l: number, cl: number): Candle =>
  new Candle({ time: 9999, open: o, high: h, low: l, close: cl, volume: 100 });

describe('P0-1: повешенный (ЯС гл. «Молот и повешенный»), тело вверху диапазона', () => {
  // Малое тело ВВЕРХУ диапазона, нижняя тень >= 2 тел — форма молота/повешенного.
  const hm = c(158, 160, 150, 159);

  it('после подтверждённого роста детектируется (found === true)', () => {
    const prev = zigUp(80, 100, 0.6); // ~+10% за окно SMA65 — тренд вверх
    const res = PatternDetector.isHangingMan(hm, prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('ПОВЕШЕННЫЙ');
  });

  it('та же свеча после спада НЕ детектируется (контекст решает)', () => {
    const prev = zigDown(80, 200, 0.6);
    expect(PatternDetector.isHangingMan(hm, prev).found).toBe(false);
  });
});

describe('P0-2: «ниже шеи» / «на шее» (ЯС гл. 4, «Другие модели разворота»)', () => {
  const prev = zigDown(80, 200, 0.6); // подтверждённый спад — контекст модели
  // Медвежья свеча: тело 100→90, low 89 (шея = район минимума/закрытия).
  // Тело 12 > 0.6*диапазона (14) — требуется гейтом isLongCandle модели.
  const black = c(102, 103.5, 88.5, 90);

  it('закрытие белой ВБЛИЗИ МИНИМУМА чёрной → НИЖЕ ШЕИ', () => {
    const white = c(88.2, 89.5, 88.0, 89.1); // close≈low чёрной (tol=0.75)
    const res = PatternDetector.isNeckFamily(black, white, prev);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НИЖЕ ШЕИ');
  });

  it('закрытие белой ЧУТЬ ВЫШЕ ЗАКРЫТИЯ чёрной → НА ШЕЕ', () => {
    const white = c(88.2, 90.9, 88.0, 90.4); // close чуть выше закрытия чёрной: [89.25, 91.5]
    const res = PatternDetector.isNeckFamily(black, white, prev);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НА ШЕЕ');
  });
});

describe('P0-3: гэп смежных свечей (ЯС гл. «Окна» / продолжения)', () => {
  const cc = (o: number, h: number, l: number, cl: number): Candle =>
    new Candle({ time: 1, open: o, high: h, low: l, close: cl, volume: 100 });
  const STOCKS = { market: 'stocks' as const };

  it('нисходящий гэп + две чёрные свечи после спада → ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ (ВНИЗ)', () => {
    const candles = [
      ...zigDown(40, 130, 1),
      cc(102, 102.5, 96, 96.5),            // c0 — длинная чёрная со спадом
      cc(94, 94.5, 90, 90.5),              // c1 — чёрная, гэп вниз (high < c0.low)
      cc(93.8, 94.4, 90.1, 90.6),          // c2 — чёрная, близкое открытие и тело к c1
    ];
    const res = PatternDetector.isGappingSideBySide(candles, STOCKS);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ (ВНИЗ)');
  });

  it('та же фикстура с белыми свечами в нисходящей ветке → found === false', () => {
    const candles = [
      ...zigDown(40, 130, 1),
      cc(102, 102.5, 96, 96.5),
      cc(90, 94.5, 89.8, 94.3),            // бычья вместо медвежьей
      cc(90.2, 94.7, 90, 94.5),            // бычья вместо медвежьей
    ];
    expect(PatternDetector.isGappingSideBySide(candles, STOCKS).found).toBe(false);
  });

  it('старое имя закреплено за тем же ID SIDE_BY_SIDE_GAP_DOWN (алиас для журналов)', async () => {
    const { getPatternId } = await import('../../utils/pattern_ids');
    expect(getPatternId('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ (ВНИЗ)')).toBe('SIDE_BY_SIDE_GAP_DOWN');
    expect(getPatternId('ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)')).toBe('SIDE_BY_SIDE_GAP_DOWN');
  });
});

describe('P1-1: завеса/просвет на непрерывном рынке (ЯС гл. 4, вариант A)', () => {
  // Крипта: open ≈ prevClose (нет разрыва), глубокое проникновение в тело.
  it('завеса срабатывает при open == close предыдущей (без гэпа) и глубоком проникновении', () => {
    const prev = zigUp(80, 100, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 5, lastClose - 0.2, lastClose + 4.8); // длинная белая
    const c2 = c(lastClose + 4.8, lastClose + 5.2, lastClose + 0.5, lastClose + 1.5); // чёрная, close < bodyMid
    const res = PatternDetector.isDarkCloudCover(c1, c2, prev);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ'); // без гэп-метки: нет настоящего разрыва
  });

  it('просвет срабатывает при open == close предыдущей и закрытии выше середины тела', () => {
    const prev = zigDown(80, 200, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose + 4.8, lastClose + 5, lastClose, lastClose + 0.2); // длинная чёрная
    const c2 = c(lastClose + 0.2, lastClose + 3.5, lastClose - 0.2, lastClose + 3.3); // белая, close > bodyMid
    const res = PatternDetector.isPiercingPattern(c1, c2, prev);
    expect(res.found).toBe(true);
    // close == open c1 ⇒ формальный гэп-тест `open < close` проходит (граница допуска);
    // на практике это «открытие по закрытию» — модель без гэпа, но метка остаётся
    // (проектное поведение: допуск не переопределяет существующие ветки маркировки).
    expect(res.name).toContain('ПРОСВЕТ В ОБЛАКАХ');
  });

  it('открытие сильно НИЖЕ закрытия белой по-прежнему отклоняется (завеса)', () => {
    const prev = zigUp(80, 100, 0.6);
    const lastClose = prev[prev.length - 1].close;
    const c1 = c(lastClose, lastClose + 5, lastClose - 0.2, lastClose + 4.8);
    const c2 = c(lastClose - 6, lastClose + 4.9, lastClose - 6.2, lastClose + 1.5);
    expect(PatternDetector.isDarkCloudCover(c1, c2, prev).found).toBe(false);
  });
});
