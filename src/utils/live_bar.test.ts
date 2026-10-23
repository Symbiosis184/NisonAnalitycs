import { describe, it, expect } from 'vitest';
import { Candle } from './candle';
import { splitLiveBar, lastClosedOnly } from './live_bar';
import { getTrendContext } from './trend_detection';
import { detectRegime } from './regime';

const c = (time: number, high: number, low: number): Candle =>
  new Candle({ time, open: (high + low) / 2, high, low, close: (high + low) / 2, volume: 10 });

/**
 * Нисходящая лестница LH/LL с «мерцающим» последним незакрытым баром.
 * Закрытые бары образуют строгую медвежью структуру; живой бар — единственный
 * переменный. При liveLow=57 он не мешает подтверждению свинг-лоу предпоследнего
 * закрытого бара, при liveLow=30 — перебивает его (окно подтверждения ±3 достает
 * до хвоста), и структура на СЫРЫХ данных менялась бы между тикками.
 */
function descendingSeries(liveLow: number): Candle[] {
  const out: Candle[] = [];
  let t = 0;
  for (let i = 0; i < 30; i++) {
    const h = 130 - i * 2; // строго убывающие highs: 130..72
    out.push(c(t++, h, h - 4)); // строго убывающие lows: 126..68
  }
  out.push(c(t, 60, liveLow)); // живой незакрытый бар
  return out;
}

describe('splitLiveBar', () => {
  it('отбрасывает ровно один хвостовой бар и возвращает его close как livePrice', () => {
    const arr = [c(0, 2, 0), c(1, 4, 2), c(2, 6, 4)];
    const { closed, livePrice } = splitLiveBar(arr);
    expect(closed.map((x) => x.time)).toEqual([0, 1]);
    expect(livePrice).toBe(5);
  });
  it('на истории <2 не падает', () => {
    const one = [c(0, 6, 4)];
    expect(splitLiveBar(one).closed).toHaveLength(1);
    expect(splitLiveBar([]).livePrice).toBe(0);
  });
});

describe('структурный анализ по закрытым барам инвариантен к живому бару', () => {
  it('getTrendContext одинаков при разных low живого бара (расчёт по закрытым)', () => {
    const a = getTrendContext(lastClosedOnly(descendingSeries(57)));
    const b = getTrendContext(lastClosedOnly(descendingSeries(30)));
    expect(a).toBe(b);
    expect(a).toBe('НИСХОДЯЩИЙ');
  });
  it('detectRegime одинаков при разных low живого бара', () => {
    const r1 = detectRegime(lastClosedOnly(descendingSeries(57))).regime;
    const r2 = detectRegime(lastClosedOnly(descendingSeries(30))).regime;
    expect(r1).toBe(r2);
  });
  it('закрытая история стабильна при любом живом баре (защита от регрессии мерцания)', () => {
    // Ключевое свойство фикса: любые variations незакрытого хвостового бара
    // (low выше или ниже подтверждённого свинга) НЕ должны влиять на режим.
    const variants = [10, 30, 57, 59, 100].map((ll) =>
      getTrendContext(lastClosedOnly(descendingSeries(ll))),
    );
    expect(new Set(variants).size).toBe(1);
    expect(variants[0]).toBe('НИСХОДЯЩИЙ');
  });
});
