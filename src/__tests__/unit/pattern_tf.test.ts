// ТФ-аудит паттернов: зоны S/R в детекторах должны калиброваться под таймфрейм,
// а не всегда использовать дневной толеранс (Нисон: уровень — зона, её ширина
// зависит от масштаба графика).
import { describe, it, expect } from 'vitest';
import { setPatternTimeframe, getPatternTimeframe } from '../../utils/pattern_engine';
import { detectPatterns } from '../../utils/patterns';
import type { Candle } from '../../utils/candle';

function mk(o: number, h: number, l: number, c: number, v = 100): Candle {
  return { open: o, high: h, low: l, close: c, volume: v, time: 0 } as unknown as Candle;
}

describe('ТФ-контекст детектора паттернов', () => {
  it('setPatternTimeframe меняет активный масштаб', () => {
    setPatternTimeframe('D');
    expect(getPatternTimeframe()).toBe('swing');
    setPatternTimeframe('15m');
    expect(getPatternTimeframe()).toBe('scalp');
    setPatternTimeframe('W');
    expect(getPatternTimeframe()).toBe('position');
    setPatternTimeframe('D'); // вернуть дефолт для других тестов
  });

  it('detectPatterns принимает ТФ и возвращает результаты', () => {
    const candles = Array.from({ length: 40 }, (_, i) => mk(100 + i * 0.2, 101 + i * 0.2, 99 + i * 0.2, 100.5 + i * 0.2));
    const resD = detectPatterns(candles, 'D');
    const resM = detectPatterns(candles, '15m');
    expect(Array.isArray(resD)).toBe(true);
    expect(Array.isArray(resM)).toBe(true);
  });

  it('глобальный ТФ-контекст сбрасывается после detectPatterns (нет протечки)', () => {
    setPatternTimeframe('W'); // намеренно «грязное» состояние
    const candles = Array.from({ length: 30 }, (_, i) => mk(100, 101, 99, 100.5));
    detectPatterns(candles, '15m');
    // после завершения — нейтральный дефолт swing ('D'), а не scalp/position
    expect(getPatternTimeframe()).toBe('swing');
  });
});
