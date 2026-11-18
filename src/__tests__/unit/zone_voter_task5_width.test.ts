// ЗАДАЧА 5: не перезаписывать книжную ширину окна ATR-полосой (mapToZones).
// Книга: ЗГ гл. 3 / ЯС гл. 7 — окно есть зона между экстремумами теней; прорыв —
// только по закрытию (реализовано в gaps.ts, не трогаем). ATR в книгах нет — это
// проектная настройка, поэтому для источников с явной книжной геометрией
// (window, long-body) halfWidth берётся из книги как есть и НЕ расширяется/
// обрезается ATR-полосой проекта.
import { describe, it, expect } from 'vitest';
import { ZoneVoter } from '../../utils/zone_voter';
import type { ZoneClusterData } from '../../utils/levels';

const zoneHalfWidthStub = (level: number) => Math.max(0.25 * level, 0.1); // грубая заглушка ATR-полосы

describe('Задача 5: mapToZones сохраняет книжную halfWidth без ATR-расширения', () => {
  it('окно с книжной полосой [99.9 … 100.1] → halfWidth=высота/2 (не ≥0.25×ATR)', () => {
    const map = new Map<number, ZoneClusterData>();
    // Узкое окно 0.2% ширины: bookBand lo=99.9, hi=100.1 → halfWidth=0.1.
    map.set(100, {
      reasons: ['окно вверх'], touches: 0, lastTouch: undefined, sources: ['window'], formedAt: 1,
      halfWidth: 0.1,
      bookBand: { lo: 99.9, hi: 100.1, role: 'support' },
      startCheckIndex: 0,
    });
    const zones = (ZoneVoter as any).mapToZones(map, zoneHalfWidthStub, [], true) as Array<{ level: number; halfWidth: number }>;
    expect(zones.length).toBe(1);
    // Старое поведение: Math.max(halfWidthOf(level), data.halfWidth) дало бы 25 (0.25*100).
    expect(zones[0].halfWidth).toBeCloseTo(0.1, 8);
  });

  it('окно 5×ATR (широкое) не обрезается потолком 2×ATR', () => {
    const map = new Map<number, ZoneClusterData>();
    // Очень широкое окно: lo=90, hi=110 → halfWidth=10.
    map.set(100, {
      reasons: ['окно вниз'], touches: 0, lastTouch: undefined, sources: ['window'], formedAt: 1,
      halfWidth: 10,
      bookBand: { lo: 90, hi: 110, role: 'resistance' },
      startCheckIndex: 0,
    });
    const zones = (ZoneVoter as any).mapToZones(map, zoneHalfWidthStub, [], true) as Array<{ level: number; halfWidth: number }>;
    expect(zones.length).toBe(1);
    // Старое поведение: Math.min(base, atrVal*2) могло обрезать; новое — книга как есть.
    expect(zones[0].halfWidth).toBeCloseTo(10, 8);
  });

  it('ненижная (swing) зона получает ATR-полосу проекта, если её собственная уже', () => {
    const map = new Map<number, ZoneClusterData>();
    map.set(100, {
      reasons: ['свинг'], touches: 2, lastTouch: 5, sources: ['swing'], formedAt: 1,
      halfWidth: 0.05, // узкая кластерная ширина
    });
    const zones = (ZoneVoter as any).mapToZones(map, zoneHalfWidthStub, [], false) as Array<{ level: number; halfWidth: number }>;
    expect(zones.length).toBe(1);
    // Для swing применяется max(ATR-полоса, data.halfWidth): ATR-полоса шире.
    expect(zones[0].halfWidth).toBeCloseTo(Math.max(zoneHalfWidthStub(100), 0.05), 8);
  });
});
