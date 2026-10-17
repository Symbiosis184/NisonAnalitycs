// Канон Нисона: цели — структурные уровни, а не индикаторы (гл. 4–6).
import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { collectSwingLevels, nearestStructuralTarget } from '../../utils/nison_targets';

function c(o: number, h: number, l: number, cl: number, v = 100): Candle {
  return new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: v });
}

// Плоский «коридор» с явным максимумом на 50 и минимумом на 30 вокруг цены 40
const series: Candle[] = [];
for (let i = 0; i < 40; i++) series.push(c(40, 41, 39, 40));
series.push(c(40, 50, 40, 48)); // swing high = 50
series.push(c(48, 49, 47, 48));
series.push(c(48, 49, 47, 48));
series.push(c(48, 49, 30, 32)); // swing low = 30
series.push(c(32, 33, 31, 32));
series.push(c(32, 33, 31, 32));
series.push(c(32, 42, 32, 40)); // swing high = 42 (ближайший для лонга от 40)

describe('collectSwingLevels (структурные ориентиры по Нисону)', () => {
  it('находит локальные максимумы для лонга', () => {
    const highs = collectSwingLevels(series.slice(0, -1), 'long');
    expect(highs).toContain(50);
  });
  it('находит локальные минимумы для шорта', () => {
    const lows = collectSwingLevels(series.slice(0, -1), 'short');
    expect(lows).toContain(30);
  });
  it('пустая/короткая серия -> []', () => {
    expect(collectSwingLevels([], 'long')).toEqual([]);
    expect(collectSwingLevels(series.slice(0, 3), 'long')).toEqual([]);
  });
});

describe('nearestStructuralTarget', () => {
  it('лонг: цель — ближайший свинг-максимум выше шума', () => {
    const t = nearestStructuralTarget(40, 'long', series.slice(0, -1), { noiseFloor: 0.5, maxReward: 20 });
    expect(t).not.toBeNull();
    expect(t!.level).toBeGreaterThan(40);
    expect(['zone', 'swing']).toContain(t!.kind);
  });
  it('шорт: цель — ближайший свинг-минимум ниже входа', () => {
    const t = nearestStructuralTarget(40, 'short', series.slice(0, -1), { noiseFloor: 0.5, maxReward: 20 });
    expect(t).not.toBeNull();
    expect(t!.level).toBeLessThan(40);
  });
  it('нет уровня в диапазоне -> null (сигнал не генерируется, Нисон: ждём)', () => {
    const flat: Candle[] = [];
    for (let i = 0; i < 30; i++) flat.push(c(40, 40.2, 39.8, 40));
    const t = nearestStructuralTarget(40, 'long', flat, { noiseFloor: 1, maxReward: 100 });
    expect(t).toBeNull();
  });
  it('не использует ATR-подмену: уровень всегда из данных серии', () => {
    const t = nearestStructuralTarget(40, 'long', series.slice(0, -1), { noiseFloor: 0.5, maxReward: 20 });
    if (!t) return; // допустимо: нет значимого уровня
    const allLevels = [...series.map((x) => x.high), ...series.map((x) => x.low)];
    expect(allLevels).toContain(t.level);
  });
});
