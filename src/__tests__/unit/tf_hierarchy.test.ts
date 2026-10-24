// Иерархия таймфреймов по канону Нисона (гл. 8 «Магические дожи»):
// свечной анализ не работает на внутридневных ТФ <30 минут — ложные «дожи»
// и шум. Приложение использует только 30m/1H/4H/D/W; 15m выведен из UI,
// мульти-ТФ зон и HTF-каскадов. Числовые формы Bybit ('30','60') принимаютcя
// валидатором как канон приложения.
import { describe, it, expect } from 'vitest';
import { higherTimeframe, timeframeCascade } from '../../api/client';
import { isValidTimeframe } from '../../utils/validation';
import { timeframeKey } from '../../utils/zone_voter';

describe('Иерархия ТФ по Нисону (минимум 30m)', () => {
  it('мульти-ТФ список и UI больше не содержат 15m', () => {
    // Канон приложения: 30m обязано быть валидным ТФ
    expect(isValidTimeframe('30m')).toBe(true);
    expect(isValidTimeframe('30')).toBe(true);
  });

  it('higherTimeframe: 30m → 1H → 4H → D → W (без суб-30m ступеней)', () => {
    expect(higherTimeframe('30m')).toBe('1H');
    expect(higherTimeframe('30')).toBe('1H');
    expect(higherTimeframe('1H')).toBe('4H');
    expect(higherTimeframe('4H')).toBe('D');
    expect(higherTimeframe('D')).toBe('W');
    expect(higherTimeframe('W')).toBeNull();
    // шумовые ТФ (<30m, запрет Нисона гл. 8) выведены из иерархии: HTF-слой не строится
    expect(higherTimeframe('15m')).toBeNull();
    expect(higherTimeframe('5')).toBeNull();
  });

  it('timeframeCascade включает недельный макро-ТФ и никогда — суб-30m', () => {
    const forD = timeframeCascade('D');
    expect(forD).toEqual(['W']);
    const for1H = timeframeCascade('1H');
    expect(for1H).toEqual(['W', 'D', '4H']); // максимум 3 ступени, от старшего к младшему
    // каскад для 30m: все старшие ['1H','4H','D','W'] → последние 3 → ['4H','D','W'] → реверс
    expect(timeframeCascade('30m')).toEqual(['W', 'D', '4H']);
    expect(timeframeCascade('30')).toEqual(['W', 'D', '4H']);
    expect(timeframeCascade('4H')).toEqual(['W', 'D']);
    for (const chain of [forD, for1H, timeframeCascade('30'), timeframeCascade('4H')]) {
      for (const tf of chain) expect(['30', '1H', '4H', 'D', 'W']).toContain(tf);
    }
    expect(timeframeCascade('W')).toEqual([]);
  });

  it('timeframeKey: 30m — intraday (самый младший разрешённый масштаб), а не scalp', () => {
    expect(timeframeKey('30m')).toBe('intraday');
    expect(timeframeKey('30')).toBe('intraday');
    expect(timeframeKey('1H')).toBe('intraday');
    expect(timeframeKey('4H')).toBe('intraday');
    expect(timeframeKey('D')).toBe('swing');
    expect(timeframeKey('W')).toBe('position');
    // канон UI/валидатора: '1W' — та же ступень, что 'W' (не '1'-scalp!)
    expect(timeframeKey('1W')).toBe('position');
    expect(timeframeKey('w')).toBe('position');
    expect(timeframeKey('1M')).toBe('position'); // месячный — макро
    // техническая категория scalp сохранена только для сырых суб-30m форм
    expect(timeframeKey('15m')).toBe('scalp');
    expect(timeframeKey('5')).toBe('scalp');
  });
});
