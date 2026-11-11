// Регресс-тесты блока P3 (методологический аудит-фикс по канону Нисона).
// P3 — минимальные правки/документирование: фикстуры закрепляют зафиксированное
// поведение, чтобы последующие рефакторинги не изменили его молча.
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { detectGaps } from '../../utils/gaps';
import { collectSwingLevels } from '../../utils/nison_targets';
import { PatternDetector } from '../../utils/pattern_engine';

const cc = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: v });

describe('P3-1: candle.isDoji — нулевой диапазон (O=H=L=C) НЕ дожи', () => {
  it('flat-свеча без диапазона — неликвидность, а не модель нерешительности → false', () => {
    expect(cc(100, 100, 100, 100).isDoji).toBe(false);
  });
  it('обычное дожи (малое тело при ненулевом диапазоне) → true (поведение сохранено)', () => {
    expect(cc(100, 102, 98, 100.05).isDoji).toBe(true);
  });
});

describe('P3-2: candle.isEngulfing — проектное ужесточение (строгие неравенства)', () => {
  it('полное поглощение телом → true', () => {
    expect(cc(99, 104, 98, 103).isEngulfing(cc(100, 102, 100.5, 101))).toBe(true);
  });
  it('равенство границ тел — НЕ поглощение (зафиксированное ограничение реализации)', () => {
    // bodyTop совпадает: max(101,102)=102 === max(100,102)=102 → строгое > нарушено
    expect(cc(101, 103, 100.5, 102).isEngulfing(cc(100, 102, 99.5, 101))).toBe(false);
  });
});

describe('P3-4: gaps.mkGap — prevClose содержит РЕАЛЬНОЕ закрытие предыдущего бара', () => {
  it('prevClose === close предыдущей свечи (не нижняя граница зоны)', () => {
    const candles = [
      { time: 1, open: 100, high: 101, low: 99, close: 100.7 }, // prevClose = 100.7 ≠ bottom = 101? нет: bottom=high=101
      { time: 2, open: 104, high: 105, low: 103, close: 104 },  // гэп вверх: low 103 > high 101 (2%)
    ];
    const gaps = detectGaps(candles, 'stock');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].bottom).toBe(101);
    expect(gaps[0].top).toBe(103);
    expect(gaps[0].prevClose).toBe(100.7); // настоящее закрытие предыдущего бара
  });
});

describe('P3-5: detectGaps — однопроходная раскладка статусов (эквивалентна прежней)', () => {
  it('заполнение/прорыв считается по барам ПОСЛЕ открывшего бара каждого окна', () => {
    const candles = [
      // i=1 открывает гэп вверх: bottom=101 (high i=0), top=103 (low i=1), ~2%
      { time: 1, open: 100, high: 101, low: 99, close: 100 },
      { time: 2, open: 104, high: 105, low: 103, close: 104 },
      // касание нижней границы (low <= 101) = заполнение; закрытий НИЖЕ 101 нет → не пробито
      { time: 3, open: 102.5, high: 103, low: 101, close: 102 },
      // i=4 открывает гэп вниз: bottom=100 (high i=4), top=101 (low i=3), ровно 1%
      { time: 4, open: 100.5, high: 100, low: 98.5, close: 101.5 }, // close НЕ ниже 101 → сам бар up не пробивает
      // high 100.5 < top(101) → второе окно НЕ заполнено; close 101.5 не > top → не пробито.
      // i=5: close 100.5 СТРОГО ниже основания up-окна (101) → по канону прорыв up-окна.
      { time: 5, open: 100, high: 100.5, low: 99.5, close: 100.5 },
    ];
    const gaps = detectGaps(candles, 'stock');
    expect(gaps).toHaveLength(2);
    const [up, down] = gaps;
    expect(up.direction).toBe('up');
    expect(up.bottom).toBe(101);
    expect(up.filled).toBe(true);   // bar i=3 коснулся 101
    expect(up.broken).toBe(true);   // bar i=5 закрылся ниже 101 → окончательный прорыв окна
    expect(down.direction).toBe('down');
    expect(down.top).toBe(101);
    expect(down.filled).toBe(false); // high после i=4 максимальны 100.5 < 101
    expect(down.broken).toBe(false); // close > 101 после i=4 отсутствует
    expect(down.unfilled).toBe(true);
  });
});

describe('P3-6: collectSwingLevels — дедупликация уровней на плато', () => {
  it('плато из одинаковых high подряд даёт ОДИН уровень (раньше — дубликаты)', () => {
    // highs: 100, затем плато 110,110,110 (первый макс после роста, остальные
    // тоже проходили старый критерий из-за `>= next`), спад, ещё один пик 110
    const c: Candle[] = [
      cc(99, 100, 98, 99),
      cc(105, 110, 104, 109),   // i=1: high 110 > prev 100, >= next 110 → уровень
      cc(108, 110, 107, 109),   // i=2: high 110 > prev? НЕТ (110 !> 110) — не уровень
      cc(107, 110, 106, 108),   // i=3: тоже не уровень
      cc(104, 105, 103, 104),   // спад
      cc(106, 110, 105, 109),   // i=5: high 110 > prev 105, >= next 100 → тот же уровень 110
      cc(100, 100, 99, 99.5),
      cc(98, 99, 97, 98),       // хвост (n>=5)
    ];
    const highs = collectSwingLevels(c, 'long');
    expect(highs.filter((x) => x === 110)).toHaveLength(1);
  });

  it('разные уровни сохраняются (дедупликация не съедает полезные цели)', () => {
    const c: Candle[] = [
      cc(99, 100, 98, 99),
      cc(105, 110, 104, 109),  // пик 110
      cc(104, 105, 103, 104),
      cc(100, 101, 99, 100),
      cc(103, 108, 102, 107),  // пик 108
      cc(99, 100, 98, 99),
      cc(98, 99, 97, 98),
    ];
    const highs = collectSwingLevels(c, 'long');
    expect(highs).toEqual([110, 108]);
  });
});

// P2-6 (регресс): «Лестничное дно» — разворотная модель основания, требует
// нисходящего контекста (гл. 6 ЯС). Фикстура с flat-базой на 110 и лестницей
// на 94..99 не должна детектироваться: формация начинается не от дна базы.
describe('P2-6 regression: ladder bottom trend context', () => {
  const cc = (o: number, h: number, l: number, cl: number) => new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: 100 });
  it('не детектирует лестничное дно при восходящем/боковом предшествующем тренде', () => {
    let seq = 0;
    const remap = (arr: Candle[]) => arr.map(x => new Candle({ ...x, time: ++seq }));
    const upBase = Array.from({ length: 20 }, (_, i) => cc(100 + i, 101 + i, 99.5 + i, 100.5 + i));
    const ladder = [cc(120, 120.5, 117.5, 118), cc(118, 118.5, 115.5, 116), cc(116, 116.5, 113.5, 114), cc(114, 115.5, 113.5, 114.5), cc(114.5, 119.5, 114, 119)];
    const res = PatternDetector.isLadderBottom(remap([...upBase, ...ladder]));
    expect(res.found).toBe(false);
  });
  it('детектирует при подтверждённом предшествующем спаде', () => {
    let seq = 0;
    const remap = (arr: Candle[]) => arr.map(x => new Candle({ ...x, time: ++seq }));
    const downBase = Array.from({ length: 20 }, (_, i) => cc(140 - i, 140.5 - i, 138.5 - i, 139 - i));
    const ladder = [cc(120, 120.5, 117.5, 118), cc(118, 118.5, 115.5, 116), cc(116, 116.5, 113.5, 114), cc(114, 115.5, 113.5, 114.5), cc(114.5, 119.5, 114, 119)];
    const res = PatternDetector.isLadderBottom(remap([...downBase, ...ladder]));
    expect(res.found).toBe(true);
  });
});
