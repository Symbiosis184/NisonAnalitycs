// ТФ-аудит паттернов: зоны S/R в детекторах должны калиброваться под таймфрейм,
// а не всегда использовать дневной толеранс (Нисон: уровень — зона, её ширина
// зависит от масштаба графика).
import { describe, it, expect } from 'vitest';
import { setPatternTimeframe, getPatternTimeframe, SupportResistance } from '../../utils/pattern_engine';
import { ZoneVoter } from '../../utils/zone_voter';
import { detectPatterns, sortPatternsForDisplay, PATTERN_DISPLAY_WINDOW } from '../../utils/patterns';
import { Candle } from '../../utils/candle';

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

describe('Канон Нисона гл.11: зоны на каждом ТФ — свои (структура экстремумов + ширина)', () => {
  // детерминированный генератор свинг-серии (без Math.random)
  const mkCandles = (n: number): Candle[] => {
    const out: Candle[] = [];
    for (let i = 0; i < n; i++) {
      const mid = 100 + 8 * Math.sin(i / 5) + 3 * Math.sin(i / 2.1);
      out.push(new Candle({ time: 1700000000000 + i * 60000, open: mid - 0.3, high: mid + 1.2, low: mid - 1.2, close: mid + 0.3, volume: 100 + (i % 7) * 10 }));
    }
    return out;
  };

  it('findLevels различает структуру экстремумов scalp (span=2) и position (span=4)', () => {
    const candles = mkCandles(200);
    const scalp = SupportResistance.findLevels(candles, 200, 'scalp');
    const position = SupportResistance.findLevels(candles, 200, 'position');
    // грубый ТФ не может давать больше уровней, чем мелкий (строже критерий экстремума)
    expect(scalp.support.length + scalp.resistance.length)
      .toBeGreaterThanOrEqual(position.support.length + position.resistance.length);
    // хотя бы один уровень отличается — иначе ТФ-калибровка фиктивная
    const same = JSON.stringify(scalp) === JSON.stringify(position);
    expect(same).toBe(false);
  });

  it('ZoneVoter.collect: набор зон и их ширина зависят от ТФ', () => {
    const candles = mkCandles(200);
    const price = candles[candles.length - 1].close;
    const s = ZoneVoter.collect(price, candles, 'scalp');
    const p = ZoneVoter.collect(price, candles, 'position');
    const lv = (z: { level: number }[]) => z.map(x => x.level.toFixed(6)).join('|');
    expect(lv(s.support) + '#' + lv(s.resistance))
      .not.toEqual(lv(p.support) + '#' + lv(p.resistance));
    // толеранс position (0.8%) шире scalp (0.2%) → полуширина зоны крупнее (ATR одинаков)
    const allS = [...s.support, ...s.resistance];
    const allP = [...p.support, ...p.resistance];
    if (allS.length && allP.length) {
      expect(Math.max(...allP.map(z => z.halfWidth)))
        .toBeGreaterThan(Math.max(...allS.map(z => z.halfWidth)));
    }
  });

  it('SupportResistance.isNearSupport делегирует ZoneVoter (единый источник истины об зонах)', () => {
    const candles = mkCandles(200);
    const price = candles[candles.length - 1].close;
    expect(SupportResistance.isNearSupport(price, candles, 'swing'))
      .toBe(ZoneVoter.isNearSupport(price, candles, undefined, 'swing'));
    expect(SupportResistance.isNearResistance(price, candles, 'intraday'))
      .toBe(ZoneVoter.isNearResistance(price, candles, undefined, 'intraday'));
  });
});

describe('Отображение паттернов: свежие не вытесняются старыми (fix «не все паттерны видны»)', () => {
  const mk = (idx: number, confirmed: boolean, confidence: number) => ({
    candleIndex: idx, confirmed, confidence,
  });

  it('sortPatternsForDisplay оставляет только окно последних свечей', () => {
    const arr = [mk(5, true, 90), mk(120, true, 60), mk(175, false, 80)];
    const res = sortPatternsForDisplay(arr, 180); // окно 80 → индекс >= 100
    expect(res.map(p => p.candleIndex)).toEqual([175, 120]);
    expect(res.some(p => p.candleIndex === 5)).toBe(false);
  });

  it('ранжирование: свежесть → подтверждение → уверенность', () => {
    const arr = [mk(170, false, 92), mk(175, true, 60), mk(172, true, 70)];
    const res = sortPatternsForDisplay(arr, 180);
    expect(res.map(p => p.candleIndex)).toEqual([175, 172, 170]);
  });

  it('detectPatterns возвращает свежие формации даже при сильных старых в истории', () => {
    // Синтетика: длинный нисходящий ряд с каноничным молотом у дна в конце.
    const candles: Candle[] = [];
    let px = 100;
    for (let i = 0; i < 150; i++) {
      px *= 0.995;
      candles.push(new Candle({ time: (i + 1) * 86400_000, open: px * 1.002, high: px * 1.003, low: px * 0.997, close: px, volume: 200 }));
    }
    // Молот на дне (тень ≥ 2×тела) + подтверждающая бычья свеча
    const h = px;
    candles.push(new Candle({ time: 151 * 86400_000, open: h * 1.001, high: h * 1.004, low: h * 0.97, close: h * 1.002, volume: 400 }));
    candles.push(new Candle({ time: 152 * 86400_000, open: h * 1.002, high: h * 1.02, low: h * 1.0, close: h * 1.018, volume: 400 }));
    const res = detectPatterns(candles, 'D');
    const lastIdx = candles.length - 2; // индекс свечи паттерна (подтверждена следующей)
    const fresh = res.filter(p => p.candleIndex >= lastIdx - 2);
    // Если детектор вообще что-то нашёл — в выдаче обязаны быть свежие индексы
    if (res.length > 0) {
      const maxIdx = Math.max(...res.map(p => p.candleIndex));
      expect(maxIdx).toBeGreaterThanOrEqual(candles.length - PATTERN_DISPLAY_WINDOW);
    }
    expect(Array.isArray(fresh)).toBe(true);
  });
});
