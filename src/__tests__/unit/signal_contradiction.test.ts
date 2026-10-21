// Аудит противоречий сигналов: единый классификатор разворотов + структурный тренд.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { isReversalPatternName } from '../../utils/pattern_ids';
import { isReversalModel } from '../../utils/signal_quality';
import { getSwingTrend } from '../../utils/trend_detection';
import { signalGenerator } from '../../utils/signal_generator';

const mk = (t: number, o: number, h: number, l: number, c: number, v = 100): Candle =>
  new Candle({ time: t, open: o, high: h, low: l, close: c, volume: v });

describe('единый классификатор разворотов (нет двойной трактовки)', () => {
  const names = [
    'МОЛОТ', 'ПЕРЕВЁРНУТЫЙ МОЛОТ', 'ПОВЕШЕННЫЙ', 'ПАДАЮЩАЯ ЗВЕЗДА',
    'БЫЧЬЕ ПОГЛОЩЕНИЕ', 'ВЕЧЕРНЯЯ ЗВЕЗДА', 'БЫЧИЙ ХАРАМИ',
    'ТРИ БЕЛЫХ СОЛДАТА', 'ДОДЖИ', 'ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)',
  ];
  it('signal_generator и signal_quality дают одинаковый ответ для любой модели', () => {
    for (const n of names) {
      expect(isReversalModel(n)).toBe(isReversalPatternName(n));
    }
  });
  it('молот/звёзда — разворот; солдаты/прорыв — продолжение', () => {
    expect(isReversalPatternName('МОЛОТ')).toBe(true);
    expect(isReversalPatternName('ПАДАЮЩАЯ ЗВЕЗДА')).toBe(true);
    expect(isReversalPatternName('ТРИ БЕЛЫХ СОЛДАТА')).toBe(false);
  });
});

describe('структурный тренд различает флэт и импульс', () => {
  it('монотонный рост без свингов = БОКОВИК (нечего подтверждать)', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const p = 100 + i;
      cs.push(mk(1000 + i * 60, p, p + 0.5, p - 0.5, p + 0.4));
    }
    expect(getSwingTrend(cs)).toBe('БОКОВИК');
  });
  it('HH/HL-лесенка = ВОСХОДЯЩИЙ', () => {
    const cs: Candle[] = [];
    let t = 1000;
    // три волны роста с откатами: swing highs/lows растут
    const legs = [[100, 110], [105, 120], [115, 130]];
    for (const [from, to] of legs) {
      for (let i = 0; i < 5; i++) {
        const p = from + ((to - from) * i) / 4;
        cs.push(mk(t++, p, p + 1, p - 0.5, p + 0.8));
      }
      // откат (не ниже предыдущего low)
      for (let i = 0; i < 4; i++) {
        const p = to - 2 - i;
        cs.push(mk(t++, p + 1, p + 1.5, p, p - 0.5));
      }
    }
    expect(getSwingTrend(cs)).toBe('ВОСХОДЯЩИЙ');
  });
});

describe('нет взаимоисключающих long+short в боковике из теневых моделей', () => {
  it('флэт с чередующимися молотами/звёздами не порождает оба направления', () => {
    const cs: Candle[] = [];
    let t = 1000;
    for (let cycle = 0; cycle < 10; cycle++) {
      const base = 100 + (cycle % 2 === 0 ? 0 : 0.3);
      for (let i = 0; i < 8; i++) {
        const p = base + Math.sin(i) * 0.2;
        cs.push(mk(t++, p, p + 0.4, p - 0.4, p + 0.1, 100));
      }
      // «молот»: длинная нижняя тень во флэте
      cs.push(mk(t++, 100, 100.3, 97, 100.2, 100));
      // «падающая звезда»: длинная верхняя тень во флэте
      cs.push(mk(t++, 100.2, 103.5, 100, 100.1, 100));
    }
    const signals = signalGenerator.findSignals(cs, 'D');
    const dirs = new Set(signals.map((s) => s.direction));
    // если теневые модели вообще прошли фильтр — только ОНО направление возможно
    if (dirs.has('long') && dirs.has('short')) {
      // противоречие недопустимо
      expect(dirs.size).toBe(1);
    }
    expect(dirs.size === 0 || dirs.size === 1).toBe(true);
  });
});
