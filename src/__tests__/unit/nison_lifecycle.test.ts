// Канон Нисона «ожидание → подтверждение»: неподтверждённая формация ОТМЕНЕНА
// и не должна попадать в выдачу; касание уровня считается ТЕНЬЮ свечи.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { detectPatterns } from '../../utils/patterns';
import { ZoneVoter } from '../../utils/zone_voter';

const cc = (o: number, h: number, l: number, cl: number, volume = 100) =>
  new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume });

describe('Жизненный цикл паттернов по Нисону', () => {
  it('неподтверждённая формация исключается из выдачи (cancelled не сигнализирyется)', () => {
    const candles: Candle[] = [];
    // Формируем зону поддержки ~97 с реальными отскоками
    for (let i = 0; i < 25; i++) {
      const close = 108 - i * 0.35;
      candles.push(new Candle({ time: 1000 + i, open: close + 0.05, high: close + 0.3, low: close - 0.3, close, volume: 200 }));
    }
    candles.push(cc(99.5, 100, 97, 99.6, 400));   // тест зоны 97
    candles.push(cc(99.6, 104, 99.5, 103.8));     // отскок
    candles.push(cc(103.8, 105, 97.2, 99));       // молот #1 (тень к зоне 97)
    candles.push(cc(99, 106, 98.8, 105.5));       // ПОДТВЕРЖДЕНИЕ: бычье, close > high паттерна
    candles.push(cc(105.5, 106, 102, 102.5));     // пауза
    candles.push(cc(102.5, 103, 97.4, 100));      // молот #2 (у той же зоны)
    candles.push(cc(100, 100.5, 96, 96.5));       // МЕДВЕЖЬЯ ниже low — НЕ подтверждает → cancel
    candles.push(cc(96.5, 99, 96, 98.5));

    const pats = detectPatterns(candles, 'D');
    // Индекс свечей-молотков: 27 и 30
    const at = (idx: number) => pats.filter(p => p.candleIndex === idx);
    expect(at(27).length).toBeGreaterThan(0);            // подтверждённый молот присутствует
    expect(at(27).every(p => p.confirmed)).toBe(true);
    expect(at(30).every(p => p.status !== 'cancelled')).toBe(true); // неподтверждённый ИСКЛЮЧЁН
    expect(pats.every(p => p.status !== 'cancelled')).toBe(true);
  });

  it('wick-касание: тень внутри зоны = уровень протестирован, даже если close выше края', () => {
    const prev: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      const close = 108 - i * 0.35;
      prev.push(new Candle({ time: 1000 + i, open: close + 0.05, high: close + 0.3, low: close - 0.3, close, volume: 200 }));
    }
    prev.push(cc(99.5, 100, 97, 99.6, 400));  // касание поддержки 97 (low в зоне)
    prev.push(cc(99.6, 104, 99.5, 103.8));    // отскок
    // Проверка для свечи с close=103 (выше зоны): по close — мимо, по wickLow=97.2 — касание
    const byClose = ZoneVoter.isNearSupport(103, prev, 0.015, 'swing');
    const byWick = ZoneVoter.isNearSupport(103, prev, 0.015, 'swing', 97.2);
    expect(byWick).toBe(true);
    void byClose; // close-проверка может быть false — это и есть суть фикса
  });
});
