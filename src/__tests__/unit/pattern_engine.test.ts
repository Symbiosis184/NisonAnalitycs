import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector, VolumeAnalyzer, SupportResistance } from '../../utils/pattern_engine';
import { c, flat } from '../helpers/candles';

describe('Candle — базовые геттеры', () => {
  it('body/bodyTop/bodyBottom/totalRange/направление', () => {
    const bull = c(100, 105, 98, 104);
    expect(bull.body).toBe(4);
    expect(bull.bodyTop).toBe(104);
    expect(bull.bodyBottom).toBe(100);
    expect(bull.totalRange).toBe(7);
    expect(bull.isBullish).toBe(true);
    expect(bull.isBearish).toBe(false);

    const bear = c(104, 105, 98, 100);
    expect(bear.isBearish).toBe(true);

    const doji = c(100, 103, 97, 100.001);
    expect(doji.isDoji).toBe(true);
  });
});

describe('PatternDetector.isHammer', () => {
  const prev = flat(25, 100);
  // Молот: маленькое тело вверху, длинная нижняя тень
  const hammer = c(100, 100.6, 94, 100.5);

  it('детектит корректную форму', () => {
    const res = PatternDetector.isHammer(hammer, prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('МОЛОТ');
  });

  it('не детектит молот при большом теле', () => {
    const fatBody = c(95, 100.5, 94, 100); // тело 5 из диапазона 6.5 > 45%
    expect(PatternDetector.isHammer(fatBody, prev).found).toBe(false);
  });

  it('не детектит при нулевом диапазоне', () => {
    const flatDoji = new Candle({ time: 999, open: 100, high: 100, low: 100, close: 100, volume: 1 });
    expect(PatternDetector.isHammer(flatDoji, prev).found).toBe(false);
  });

  it('тень сверху не должна быть длинной', () => {
    const starLike = c(100, 108, 94, 100.5); // верхняя тень огромная → это не молот
    expect(PatternDetector.isHammer(starLike, prev).found).toBe(false);
  });
});

describe('PatternDetector.isBullishEngulfing / isBearishEngulfing', () => {
  const prev = flat(25, 100);

  it('бычье поглощение: медвежья -> бычья, перекрывающая тело', () => {
    const c1 = c(100, 100.5, 97, 97.5); // bearish
    const c2 = c(97, 101, 96.8, 100.8); // bullish, engulfing
    const res = PatternDetector.isBullishEngulfing(c1, c2, prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('БЫЧЬЕ ПОГЛОЩЕНИЕ');
  });

  it('не срабатывает без реального поглощения', () => {
    const c1 = c(100, 100.5, 97, 97.5);
    const c2 = c(97.6, 98.5, 97.2, 98.2); // бычья, но меньше тела c1
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(false);
  });

  it('медвежье поглощение', () => {
    const c1 = c(100, 103, 99.5, 102.5); // bullish
    const c2 = c(103, 103.2, 98.8, 99.2); // bearish engulfing
    const res = PatternDetector.isBearishEngulfing(c1, c2, prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ');
  });

  it('первое тело должно быть противоположного направления', () => {
    const c1 = c(97, 100.5, 96.5, 100); // bullish
    const c2 = c(97, 101, 96.8, 100.8); // bullish
    expect(PatternDetector.isBullishEngulfing(c1, c2, prev).found).toBe(false);
  });
});

describe('PatternDetector.isThreeWhiteSoldiers / isThreeBlackCrows', () => {
  it('три белых солдата: три бычьих длинных свечи с ростом close', () => {
    const candles = [c(100, 103, 99.5, 102.5), c(102.5, 105.5, 102, 105), c(105, 108, 104.5, 107.5)];
    const res = PatternDetector.isThreeWhiteSoldiers(candles);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ТРИ БЕЛЫХ СОЛДАТА');
  });

  it('не срабатывает без роста close', () => {
    const candles = [c(100, 103, 99.5, 102.5), c(102.5, 105.5, 102, 105), c(105, 108, 104.5, 104.8)];
    expect(PatternDetector.isThreeWhiteSoldiers(candles).found).toBe(false);
  });

  it('три чёрных ворона', () => {
    const candles = [c(108, 108.5, 105, 105.5), c(105.5, 106, 102.5, 103), c(103, 103.5, 100, 100.5)];
    const res = PatternDetector.isThreeBlackCrows(candles);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ТРИ ЧЁРНЫХ ВОРОНЫ');
  });

  it('меньше трёх свечей — false', () => {
    expect(PatternDetector.isThreeWhiteSoldiers([c(100, 103, 99, 102)]).found).toBe(false);
  });
});

describe('PatternDetector.isMorningStar / isEveningStar', () => {
  it('утренняя звезда: длинная медвежья + короткая + длинная бычья выше середины первого тела', () => {
    const candles = [
      c(110, 110.5, 100, 100.5), // long bearish (body/range 0.905)
      c(100, 100.4, 98.6, 99.5), // short: body/range = 0.167 < 0.3 (почти доджи)
      c(99.5, 110, 99, 109),     // long bullish, close > bodyMid(105.25)
    ];
    const res = PatternDetector.isMorningStar(candles);
    expect(res.found).toBe(true);
    expect(res.name).toContain('УТРЕННЯЯ');
  });

  it('вечерняя звезда', () => {
    const candles = [
      c(100, 109.5, 99.5, 109), // long bullish
      c(109.2, 111, 108.5, 109.5), // short: body/range = 0.14 < 0.3 (почти доджи)
      c(110, 110.5, 100, 100.5), // long bearish, close < bodyMid(104.5)
    ];
    const res = PatternDetector.isEveningStar(candles);
    expect(res.found).toBe(true);
    expect(res.name).toContain('ВЕЧЕРНЯЯ');
  });

  it('недостаточно свечей — false', () => {
    expect(PatternDetector.isMorningStar([c(100, 101, 99, 100.5)]).found).toBe(false);
  });
});

describe('PatternDetector.getFormationBounds', () => {
  const candles = [
    c(100, 101, 99, 100.5),
    c(101, 103, 100, 98.5),
    c(98, 105, 97, 104),
  ];

  it('односвечный паттерн (МОЛОТ) — границы одной свечи', () => {
    const b = PatternDetector.getFormationBounds('МОЛОТ', candles, 2);
    expect(b.patternCandlesCount).toBe(1);
    expect(b.patternStartIdx).toBe(2);
    expect(b.patternLow).toBe(97);
    expect(b.patternHigh).toBe(105);
  });

  it('двухсвечный (ПОГЛОЩЕНИЕ) — min/max двух свечей', () => {
    const b = PatternDetector.getFormationBounds('БЫЧЬЕ ПОГЛОЩЕНИЕ', candles, 2);
    expect(b.patternCandlesCount).toBe(2);
    expect(b.patternStartIdx).toBe(1);
    expect(b.patternLow).toBe(Math.min(100, 97));
    expect(b.patternHigh).toBe(Math.max(103, 105));
  });

  it('трёхсвечный (СОЛДАТА) — все три свечи', () => {
    const b = PatternDetector.getFormationBounds('ТРИ БЕЛЫХ СОЛДАТА', candles, 2);
    expect(b.patternCandlesCount).toBe(3);
    expect(b.patternStartIdx).toBe(0);
    expect(b.patternLow).toBe(97);
    expect(b.patternHigh).toBe(105);
  });

  it('неизвестный паттерн — фолбэк на последнюю свечу', () => {
    const b = PatternDetector.getFormationBounds('НЕСУЩЕСТВУЮЩИЙ', candles, 2);
    expect(b.patternCandlesCount).toBe(1);
  });
});

describe('VolumeAnalyzer', () => {
  it('средний объём по периоду', () => {
    const candles = [c(1, 2, 0.5, 1.5, 10), c(1, 2, 0.5, 1.5, 20), c(1, 2, 0.5, 1.5, 30)];
    expect(VolumeAnalyzer.getAverageVolume(candles, 3)).toBeCloseTo(20);
  });

  it('isHighVolume: >1.3x среднего', () => {
    // isHighVolume усредняет candles.slice(0,-1) — нужно >=20 свечей в истории
    const prev = Array.from({ length: 21 }, () => c(1, 2, 0.5, 1.5, 100));
    expect(VolumeAnalyzer.isHighVolume(c(1, 2, 0.5, 1.5, 200), prev, 1.3)).toBe(true);
    expect(VolumeAnalyzer.isHighVolume(c(1, 2, 0.5, 1.5, 110), prev, 1.3)).toBe(false);
  });
});

describe('SupportResistance.findLevels', () => {
  it('возвращает support ниже/на уровне цены и resistance выше', () => {
    // синусоида-подобная серия с явными экстремумами
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      const mid = 100 + 10 * Math.sin(i / 6);
      candles.push(c(mid - 0.2, mid + 1, mid - 1, mid + 0.2));
    }
    const { support, resistance } = SupportResistance.findLevels(candles, 60);
    expect(support.length).toBeGreaterThan(0);
    expect(resistance.length).toBeGreaterThan(0);
    const lastClose = candles[candles.length - 1].close;
    for (const s of support) expect(s).toBeLessThanOrEqual(lastClose + 1e-6);
    for (const r of resistance) expect(r).toBeGreaterThanOrEqual(lastClose - 1e-6);
  });
});
