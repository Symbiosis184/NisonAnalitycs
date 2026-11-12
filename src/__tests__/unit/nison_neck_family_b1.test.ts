// B1 (follow-up к PR #40): семья шеи была недостижима из-за гейта
// `c2.open >= c1.low`: поскольку low₁ ≤ close₁, а на круглосуточном рынке
// open₂ ≈ close₁, условие «открытие белой ниже минимума чёрной» не выполнялось
// никогда (проверено численно: 100 000 из 100 000 пар). Канон ЯС гл. 4 задаёт
// привязки «ниже шеи / на шее / толчок» по ЦЕНЕ ЗАКРЫТИЯ и МИНИМУМУ предыдущего
// дня; допуск открытия от close₁ — проектная эвристика для рынков без сессий.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';

const cc = (o: number, h: number, l: number, cl: number): Candle =>
  new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: 100 });

/** Нисходящий зигзаг (LH/LL) — генератор из nison_trend_filter.test.ts. */
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

/** Восходящий зигзаг (HH/HL) — контекст роста блокирует медвежью семью шеи. */
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

describe('B1: семья шеи достижима при open₂ == close₁ (гл. 4 ЯС)', () => {
  // getSwingTrend требует >=2 подтверждённых экстремумов каждого типа → 30 баров.
  const prevDecline = zigDown(30, 150, 0.8); // финальный close ≈ 136
  const lastClose = prevDecline[prevDecline.length - 1].close;
  // Длинная чёрная: тело 10 ≥ 0.6·диапазона; low = close₁ − 9.
  const black = cc(lastClose + 10, lastClose + 10.5, lastClose + 1, lastClose);

  it('НИЖЕ ШЕИ: open₂ == close₁, close₂ вблизи минимума чёрной', () => {
    // tol = totalRange·0.05 = 0.575; close₂ = low₁ + 0.3 ∈ [low₁ ± tol];
    // малое бычье тело 0.5 ≤ 0.5·body₁.
    const white = cc(black.close, black.close + 0.4, black.low - 0.1, black.low + 0.3);
    expect(white.open === black.close).toBe(true); // фикстура гейта: гэпа нет
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НИЖЕ ШЕИ');
  });

  it('НА ШЕЕ: open₂ == close₁, close₂ чуть выше закрытия чёрной', () => {
    // close₂ = close₁ + 0.3 ∈ [close₁ − tol, close₁ + 2·tol]; малое бычье тело.
    const white = cc(black.close, black.close + 0.4, black.close - 0.1, black.close + 0.3);
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НА ШЕЕ');
  });

  it('ТОЛЧОК: open₂ == close₁, close₂ внутри тела чёрной ниже середины', () => {
    // По канону: закрытие внутри тела чёрной, но НИЖЕ её середины; тело белой
    // не обязано быть малым. bodyMid₁ = close₁ + 5; close₂ = close₁ + 4 ∈
    // (close₁, bodyMid₁). close₂ вне «шеи» ([close₁−tol, close₁+2tol], tol=0.575)
    // и вне low₁ → ветки НИЖЕ ШЕИ / НА ШЕЕ не срабатывают, остаётся ТОЛЧОК.
    const white = cc(black.close, black.close + 4.1, black.close - 0.1, black.close + 4);
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ТОЛЧОК');
  });

  it('open₂ выше close₁ более чем на допуск → found === false', () => {
    // Открытие сильно ВЫШЕ закрытия чёрной (значительный гэп вверх) — вне канона
    // семьи шеи (все три модели предполагают продолжение у уровней предыдущего дня).
    const white = cc(black.close + 20, black.close + 21, black.close + 19, black.close + 20.5);
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(false);
  });

  it('контекст роста → found === false (медвежья модель продолжения спада)', () => {
    const prevRally = zigUp(30, 100, 0.8);
    const lc = prevRally[prevRally.length - 1].close;
    const blackUp = cc(lc + 10, lc + 10.5, lc + 1, lc);
    const white = cc(blackUp.close, blackUp.close + 0.4, blackUp.low - 0.1, blackUp.low + 0.3);
    expect(PatternDetector.isNeckFamily(blackUp, white, prevRally).found).toBe(false);
  });

  it('боковик → found === false', () => {
    const flatish: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const up = i % 2 === 0;
      const cl = 100 + (up ? 2 : -2);
      const op = 100 + (up ? -2 : 2);
      flatish.push(cc(op, Math.max(op, cl) + 0.5, Math.min(op, cl) - 0.5, cl));
    }
    const lc = flatish[flatish.length - 1].close;
    const blackFlat = cc(lc + 10, lc + 10.5, lc + 1, lc);
    const white = cc(blackFlat.close, blackFlat.close + 0.4, blackFlat.low - 0.1, blackFlat.low + 0.3);
    expect(PatternDetector.isNeckFamily(blackFlat, white, flatish).found).toBe(false);
  });
});
