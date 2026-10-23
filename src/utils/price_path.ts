// «Путь цены» до цели (запрос пользователя: учёт пути, а не только формального R:R).
//
// Формальное RR = расстояние до цели / расстояние до стопа — это надценённая метрика:
// она игнорирует ТРАНЗИТ. Нисон и Вайкофф подчёркивают: пока цена идёт к цели, она
// неизбежно пересекает зоны интереса; сделка, у которой на пути стоит сильная
// S/R-зона или HVN-кластер профиля объёма, статистически чаще пробуксовывает,
// разворачивается раньше времени и выбивает стоп на ретесте.
//
// Модуль считает скорректированный («путь-осознанный») ожидаемый результат:
//   pathQuality ∈ [0..1] — доля дистанции до цели, свободная от значимых препятствий;
//   adjustedRR          — RR, уменьшенный на вероятность застревания в транзите.
// Только закрытые свечи + уже собранные зоны (без lookahead).

import type { Zone } from './zone_voter';

export interface PathObstacle {
  level: number;
  kind: 'zone' | 'hvn';
  /** Сила препятствия 0..1 (зоны: по голосам/касаниям; LVN: по ширине «дыры») */
  strength: number;
  detail: string;
}

export interface PricePathInfo {
  direction: 'long' | 'short';
  entry: number;
  target: number;
  distancePct: number;         // дистанция до цели в % от цены входа
  obstacles: PathObstacle[];   // всё значимое между входом и целью
  /** 0..1 — чем ближе к 1, тем «чище» путь */
  pathQuality: number;
  /** Ближайшее серьёзное препятствие (главный кандидат на частичную фиксацию) */
  firstObstacle: PathObstacle | null;
  /** Дистанция до первого препятствия в % */
  toFirstObstaclePct: number | null;
  /** Формальный RR */
  rr: number;
  /** RR, скорректированный с учётом пути (используется для фильтрации сигналов) */
  adjustedRR: number;
  description: string;
}

/** Порог силы зоны, ниже которого препятствие игнорируется (шумовые уровни). */
const MIN_ZONE_STRENGTH = 0.35;

/** Сила зоны 0..1 по голосам/касаниям (ZoneVoter: strong при votes>=3). */
function zoneStrength(z: Zone): number {
  const byVotes = Math.min(1, z.votes / 4);
  const byTouches = Math.min(1, z.touches / 6);
  return Math.round(Math.min(1, byVotes * 0.6 + byTouches * 0.4 + (z.strong ? 0.2 : 0)) * 100) / 100;
}

/**
 * LVN-разрывы как «магниты» продолжения движения НЕ считаем препятствием —
 * наоборот, прохождение через LVN облегчает путь. Здесь они вычитаются из
 * накопленного трения (в виде бонуса pathQuality), если лежат на пути.
 */
function lvnBonus(bands: Array<{ low: number; high: number; weight: number }>, lo: number, hi: number): number {
  let bonus = 0;
  for (const b of bands) {
    if (b.weight <= 0) continue;
    const overlapLo = Math.max(lo, b.low);
    const overlapHi = Math.min(hi, b.high);
    if (overlapHi > overlapLo) {
      // узкие низкообъёмные полосы: вес обратно пропорционален занятой доле диапазона
      const frac = (overlapHi - overlapLo) / Math.max(hi - lo, 1e-9);
      if (frac <= 0.25) bonus += 0.08 * Math.min(1, b.weight);
    }
  }
  return Math.min(0.2, bonus);
}

/**
 * Оценка пути цены до цели.
 * @param zonesSupport/zonesResistance — собранные ZoneVoter зоны
 * @param volumeBands — профиль объёма (volume_profile.ts): HVN как трение, LVN как бонус
 */
export function evaluatePricePath(params: {
  direction: 'long' | 'short';
  entry: number;
  target: number;
  stop: number;
  zones: { support: Zone[]; resistance: Zone[] };
  volumeBands?: Array<{ low: number; high: number; weight: number }>;
}): PricePathInfo {
  const { direction, entry, target, stop, zones, volumeBands = [] } = params;

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = risk > 0 ? reward / risk : 0;

  const lo = Math.min(entry, target);
  const hi = Math.max(entry, target);
  const distancePct = entry > 0 ? (reward / entry) * 100 : 0;

  // Препятствия: встречные зоны между входом и целью.
  // Для лонга — сопротивления выше входа; для шорта — поддержки ниже входа.
  const opposing = direction === 'long' ? zones.resistance : zones.support;
  const obstacles: PathObstacle[] = [];
  for (const z of opposing) {
    const inPath = direction === 'long'
      ? z.level > entry * 1.001 && z.level < target * 0.999
      : z.level < entry * 0.999 && z.level > target * 1.001;
    if (!inPath) continue;
    const s = zoneStrength(z);
    if (s < MIN_ZONE_STRENGTH) continue;
    obstacles.push({
      level: z.level,
      kind: 'zone',
      strength: s,
      detail: `${direction === 'long' ? 'сопротивление' : 'поддержка'} ${z.level}${z.strong ? ' (сильная)' : ''}, касаний: ${z.touches}`,
    });
  }

  // HVN на пути — зона «трения»: крупный объём означает множество игроков,
  // которых нужно «пройти» (поглощение ордеров → пробуксовка).
  if (volumeBands.length > 0) {
    const range = Math.max(hi - lo, 1e-9);
    const maxW = Math.max(...volumeBands.map((b) => b.weight), 1e-9);
    for (const b of volumeBands) {
      const relWeight = b.weight / maxW;
      if (relWeight < 0.7) continue; // только выраженные HVN
      const overlapLo = Math.max(lo, b.low);
      const overlapHi = Math.min(hi, b.high);
      if (overlapHi <= overlapLo) continue;
      const frac = (overlapHi - overlapLo) / range;
      const strength = Math.min(1, Math.round(relWeight * frac * 2 * 100) / 100);
      if (strength < MIN_ZONE_STRENGTH) continue;
      obstacles.push({
        level: (overlapLo + overlapHi) / 2,
        kind: 'hvn',
        strength,
        detail: `HVN-кластер профиля объёма (${(relWeight * 100).toFixed(0)}% пика) на ${(frac * 100).toFixed(0)}% пути`,
      });
    }
  }

  obstacles.sort((a, b) => (direction === 'long' ? a.level - b.level : b.level - a.level));

  // Накопленное «трение»: сумма сил, нормированная по длине пути
  // (короткий путь через ту же зону больнее, чем длинный).
  const friction = obstacles.reduce((s, o) => s + o.strength, 0);
  const normalizedFriction = Math.min(1.5, friction / Math.max(1, distancePct / 5));
  const bonus = lvnBonus(volumeBands, lo, hi);
  const pathQuality = Math.round(Math.min(1, Math.max(0.1, 1 - normalizedFriction * 0.45 + bonus)) * 100) / 100;

  const firstObstacle = obstacles.length > 0 ? obstacles[0] : null;
  const toFirstObstaclePct = firstObstacle && entry > 0
    ? (Math.abs(firstObstacle.level - entry) / entry) * 100
    : null;

  const adjustedRR = Math.round(rr * pathQuality * 100) / 100;

  const description = obstacles.length === 0
    ? `Путь чистый: значимых уровней между входом и целью нет (${distancePct.toFixed(1)}%)`
    : `На пути ${obstacles.length} препятств., первое −${(toFirstObstaclePct ?? 0).toFixed(1)}% (${firstObstacle?.detail ?? ''}); качество пути ${(pathQuality * 100).toFixed(0)}%`;

  return {
    direction, entry, target, distancePct: Math.round(distancePct * 100) / 100,
    obstacles, pathQuality, firstObstacle,
    toFirstObstaclePct: toFirstObstaclePct === null ? null : Math.round(toFirstObstaclePct * 100) / 100,
    rr: Math.round(rr * 100) / 100,
    adjustedRR,
    description,
  };
}
