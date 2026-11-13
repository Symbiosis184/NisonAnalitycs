import { describe, expect, it } from 'vitest';
import {
  disparityIndex,
  kagi,
  renko,
  threeLineBreak,
  type ClosePoint,
} from '../../utils/beyond_candlesticks';

const points = (closes: number[]): ClosePoint[] => closes.map((close, time) => ({ time, close }));

describe('индекс разницы', () => {
  it('считает процентное отклонение закрытия от SMA и ждёт полное окно', () => {
    const out = disparityIndex(points([10, 20, 30, 40]), 2);
    expect(out[0].disparity).toBeNaN();
    expect(out[1].movingAverage).toBe(15);
    expect(out[1].disparity).toBeCloseTo((20 - 15) / 15 * 100);
    expect(out[3].movingAverage).toBe(35);
    expect(out[3].disparity).toBeCloseTo((40 - 35) / 35 * 100);
  });
});

describe('three-line break', () => {
  it('строит первые линии только при выходе за базовую цену и диапазон первой', () => {
    const out = threeLineBreak(points([100, 100, 102, 101, 103, 102, 99]));
    expect(out.map(l => [l.startPrice, l.endPrice, l.direction])).toEqual([
      [100, 102, 'up'],
      [102, 103, 'up'],
      [103, 99, 'down'],
    ]);
    expect(out[2].reversal).toBe(true);
  });

  it('для разворота после трёх белых линий требует закрытие ниже их минимума', () => {
    const data = points([100, 101, 102, 103, 102, 100.5, 100, 99]);
    const out = threeLineBreak(data);
    expect(out.slice(0, 3).every(l => l.direction === 'up')).toBe(true);
    expect(out).toHaveLength(4); // 100.5 и 100 — касания/внутри диапазона, 99 — разворот
    expect(out[3]).toMatchObject({ direction: 'down', startPrice: 103, endPrice: 99, reversal: true });
  });

  it('разворотная линия начинается от экстремума последней чёрной линии', () => {
    const out = threeLineBreak(points([100, 99, 98, 99, 101]));
    expect(out[out.length - 1]).toMatchObject({ direction: 'up', startPrice: 98, endPrice: 101 });
  });
});

describe('Renko', () => {
  it('не рисует кирпич до порога и строит несколько кирпичей на одном закрытии', () => {
    const out = renko(points([100, 100.9, 103.2]), 1);
    expect(out).toHaveLength(3);
    expect(out.map(b => [b.open, b.close])).toEqual([[100, 101], [101, 102], [102, 103]]);
    expect(out.every(b => b.endTime === 2)).toBe(true);
  });

  // C2 (ЗГ гл.7, правила 4–5): «Новый кирпич начинается с максимума предыдущего
  // кирпича» (правило 4) / от основания предыдущего кирпича (правило 5). Прежний
  // тест закреплял разворотные кирпичи [102→101], [101→100], перекрывающие
  // последний белый [101→102], — это отклонение от правил 4–5. Теперь первый
  // разворотный кирпич начинается от противоположной границы последнего кирпича:
  // для белого [101→102] чёрный стартует от 101.
  it('требует двух кирпичей для смены направления и сохраняет геометрию разворота', () => {
    const out = renko(points([100, 102, 100.5, 99, 98]), 1);
    expect(out.slice(0, 2).map(b => b.direction)).toEqual(['up', 'up']);
    expect(out).toHaveLength(4);
    expect(out.slice(2).map(b => [b.open, b.close, b.direction])).toEqual([
      [101, 100, 'down'], [100, 99, 'down'],
    ]);
    expect(out[2].reversal).toBe(true);
  });

  it('отклоняет неположительный размер кирпича', () => {
    expect(() => renko(points([1, 2]), 0)).toThrow(RangeError);
  });

  // P2-3: разворотный кирпич не должен иметь нулевую длительность
  // (startTime === endTime при j>=0 и reversal===true).
  it('разворотный кирпич имеет ненулевую длительность (P2-3)', () => {
    const out = renko(points([100, 102, 100.5, 99, 98]), 1);
    const rev = out.find((b) => b.reversal);
    expect(rev).toBeDefined();
    expect(rev!.startTime).not.toBe(rev!.endTime);
    // Все кирпичи одного построившего бара относятся к его времени закрытия.
    for (const b of out) {
      expect(b.endTime).toBeGreaterThanOrEqual(b.startTime);
    }
  });
});

describe('Kagi', () => {
  it('продлевает линию на любую величину, но разворачивает только по порогу', () => {
    const out = kagi(points([100, 100.2, 101, 100.8, 99.5, 100.6]), {
      type: 'fixed', value: 1,
    });
    expect(out.map(s => [s.startPrice, s.endPrice, s.direction])).toEqual([
      [100, 101, 'up'], [101, 99.5, 'down'], [99.5, 100.6, 'up'],
    ]);
    expect(out[1].reversal).toBe(true);
  });

  it('поддерживает процентный порог', () => {
    const out = kagi(points([100, 103, 101.9, 100]), { type: 'percent', value: 2 });
    expect(out.map(s => s.direction)).toEqual(['up', 'down']);
    expect(out[1].endPrice).toBe(100);
  });

  it('меняет инь/ян при превышении предыдущего плеча и падении ниже талии', () => {
    const out = kagi(points([100, 105, 102, 104, 106, 103, 101]), {
      type: 'fixed', value: 2,
    });
    // Плечо 105 превышено на 106 -> ян; талия 102 пробита на 101 -> инь.
    expect(out.find(s => s.endPrice === 106)?.style).toBe('yang');
    expect(out[out.length - 1]).toMatchObject({ endPrice: 101, style: 'yin' });
  });
});
