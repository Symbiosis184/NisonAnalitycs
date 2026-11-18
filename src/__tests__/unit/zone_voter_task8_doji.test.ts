// ЗАДАЧА 8 (опциональная, за флагом): дожи как книжный источник зон.
// Книга (ЯС гл. 8): «Дожи иногда задают зоны поддержки и сопротивления,
// особенно если образуются в районе значимых вершин и оснований» (рис. 8.17–8.18).
// ЗГ гл. 2, рис. 2.37: максимум дожи (конец верхней тени) нередко становится
// сопротивлением. В боковике дожи сигнала не даёт (ЗГ гл. 2) — не формировать.
// Операционализации («район значимой вершины», flat-фильтр) — проектные, не из книг.
import { describe, it, expect, beforeEach } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

/** Нисходящее движение → дожи у значимого основания → восходящее движение. */
const dojiAtSwingLowHistory = (): Candle[] => {
  const h: Candle[] = [];
  let t = 1;
  for (let i = 0; i < 30; i++) { // спад: обеспечивает ATR-диапазон окна (не боковик)
    const high = 115 - i * 0.5 + 0.2, low = 115 - i * 0.5 - 0.2;
    h.push(mk(t++, high - 0.1, high, low, low + 0.1));
  }
  // дно около 100: свеча с минимумом 99.6 (swing low при swingSpan=3)
  h.push(mk(t++, 100.4, 100.5, 99.6, 100.0));
  // дожи в районе дна: тело ≈ 100.0, верхняя тень до 100.6, нижняя до 99.7
  h.push(mk(t++, 100.0, 100.6, 99.7, 100.02));
  // рост после дна
  for (let i = 0; i < 30; i++) {
    const low = 100.5 + i * 0.5 - 0.2, high = 100.5 + i * 0.5 + 0.2;
    h.push(mk(t++, low + 0.1, high, low, high - 0.1));
  }
  return h;
};

describe('Задача 8: дожи как зоны S/R (флаг dojiZones, по умолчанию выключен)', () => {
  beforeEach(() => ZoneVoter.clearCache());

  it('по умолчанию (без флага) source doji отсутствует', () => {
    const res = ZoneVoter.collect(115, dojiAtSwingLowHistory(), 'swing');
    const all = [...res.support, ...res.resistance];
    expect(all.some((z) => (z as any).source === 'doji')).toBe(false);
  });

  it('с флагом: дожи у значимого основания → поддержка [low…тело] (ЯС гл. 8)', () => {
    // Тест проверяет ГЕОМЕТРИЮ источника дожи напрямую (задача 8); в полный
    // collect() зона может не попадать из-за проектных порогов значимости
    // (minTouches/votes) и лимита MAX_ZONES_PER_SIDE — это не книжное правило.
    const supMap = new Map(); const resMap = new Map();
    const hist = dojiAtSwingLowHistory();
    (ZoneVoter as any).addDojiLevels(hist, supMap, resMap, {
      tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3,
    }, 0.6); // atrVal фикстуры ~0.6 (бары 0.4 тела + тени)
    const hit = [...supMap.entries()].find(([, d]: any) => (d.sources ?? []).includes('doji'));
    expect(hit).toBeTruthy();
    const [level, data] = hit as any;
    // Геометрия полосы: mid=(99.7+100.01)/2≈99.855, halfWidth=(hi-lo)/2≈0.155
    expect(level).toBeCloseTo(99.855, 2);
    expect(data.bookBand.lo).toBeCloseTo(99.7, 2);
    expect(data.bookBand.hi).toBeCloseTo(100.01, 2);
    // Дальняя граница поддержки — минимум тени дожи (c.low=99.7), ЯС гл. 8
    expect(data.bookBand.role).toBe('support');
  });

  it('боковик: дожи-зон нет (ЗГ гл. 2 — в боковике дожи сигнала не даёт)', () => {
    const flat: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      flat.push(mk(i + 1, 100, 100.3, 99.7, 100));
    }
    // дожи в боковике
    flat.push(mk(61, 100, 100.5, 99.5, 100.02));
    for (let i = 0; i < 10; i++) {
      flat.push(mk(62 + i, 100, 100.3, 99.7, 100));
    }
    const res = ZoneVoter.collect(100, flat, 'swing', 'crypto', { dojiZones: true });
    const all = [...res.support, ...res.resistance];
    expect(all.some((z) => (z as any).source === 'doji')).toBe(false);
  });
});
