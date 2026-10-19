// Аудит задержки анализа (канон Нисона, гл. 3-4): свежая формация на ПОСЛЕДНЕЙ
// закрытой свече должна попадать в выдачу сразу (как pending), а не через бар.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { detectPatterns } from '../../utils/patterns';

const mk = (t: number, o: number, h: number, l: number, c: number, v = 100): Candle =>
  new Candle({ time: t, open: o, high: h, low: l, close: c, volume: v });

describe('последняя закрытая свеча проверяется без задержки', () => {
  it('свежий паттерн на последнем баре возвращается как pending', () => {
    const candles: Candle[] = [];
    // нисходящий дрейф к зоне ~95 с отскоками (формируем зону поддержки)
    for (let i = 0; i < 60; i++) {
      const base = 120 - i * 0.4;
      candles.push(mk(i, base + 0.2, base + 0.8, base - 0.8, base - 0.3));
      if (i % 12 === 5) candles.push(mk(i + 1000, base - 0.3, base + 1.2, base - 1.0, base + 0.9));
    }
    // последний бар — молот у поддержки (малое тело вверху, длинная нижняя тень)
    candles.push(mk(9999, 96.5, 97.0, 93.5, 96.6, 220));
    const pats = detectPatterns(candles, 'D');
    const lastIdx = candles.length - 1;
    const onLastBar = pats.filter(p => p.candleIndex === lastIdx);
    expect(onLastBar.length).toBeGreaterThan(0);
    expect(onLastBar.every(p => p.status === 'pending')).toBe(true);
  });
});
