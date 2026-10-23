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
    // последний бар — чистый молот у поддержки: малое тело В ВЕРХНЕЙ части диапазона,
    // длинная нижняя тень, закрытие на уровне предыдущих тел (96.4→96.6, low 93.5)
    candles.push(mk(9999, 96.4, 96.7, 93.5, 96.6, 220));
    const pats = detectPatterns(candles, 'D');
    const lastIdx = candles.length - 1;
    // Строго по книгам Нисона (гл. 3–6) проверяем только модели из класса
    // «ждущих следующую закрытую свечу» (CONFIRMATION_REQUIRED_IDS): они обязаны
    // появляться на последнем баре сразу (без задержки в бар) со статусом pending.
    // Завершённые формации (поглощения, звёзды, солдаты/вороны) подтверждаются
    // внутри себя и имеют status='confirmed' — это тоже соответствие канону.
    const CONFIRM_CLASSES = ['МОЛОТ', 'ПОВЕШЕННЫЙ', 'ПАДАЮЩАЯ ЗВЕЗДА', 'ДОДЖИ', 'ХАРАМИ', 'ПИНЦЕТ'];
    const onLastBar = pats.filter(p => p.candleIndex === lastIdx && CONFIRM_CLASSES.some(k => p.name.includes(k)));
    expect(onLastBar.length).toBeGreaterThan(0);
    expect(onLastBar.every(p => p.status === 'pending')).toBe(true);
  });
});
