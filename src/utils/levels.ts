// levels.ts — единый (канонический) источник логики уровней поддержки/сопротивления.
// П.7: дедупликация — и SupportResistance, и ZoneVoter используют один и тот же
// детектор свингов и одну и ту же кластеризацию зон, чтобы аналитика не расходилась.
// Методология Нисона: уровни — это ЗОНЫ; экстремум должен быть строго минимальным/
// максимальным в окне ±2 свечи; близкие уровни (<= tolerance) сливаются в одну зону.

import { Candle } from './candle';

export interface SwingPoint {
  level: number;
  type: 'high' | 'low';
  time: number;
  index: number;
}

/**
 * Детектор свинг-экстремумов (окно ±2 свечи, строгие сравнения).
 * Единая реализация для всех модулей анализа (SupportResistance, ZoneVoter).
 */
export function findSwings(candles: Candle[], lookback: number = 50): SwingPoint[] {
  const recent = candles.slice(-lookback);
  const offset = candles.length - recent.length;
  const swings: SwingPoint[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];

    if (c.low < recent[i - 1].low && c.low < recent[i - 2].low &&
        c.low < recent[i + 1].low && c.low < recent[i + 2].low) {
      swings.push({ level: c.low, type: 'low', time: c.time, index: offset + i });
    }

    if (c.high > recent[i - 1].high && c.high > recent[i - 2].high &&
        c.high > recent[i + 1].high && c.high > recent[i + 2].high) {
      swings.push({ level: c.high, type: 'high', time: c.time, index: offset + i });
    }
  }

  return swings;
}

export interface ZoneClusterData {
  reasons: string[];
  touches: number;
  lastTouch: number;
}

/**
 * Кластеризация уровней: если новый уровень попадает в зону уже существующего
 * (|Δ| / existing <= tolerance), он не создаёт новый уровень, а усиливает старый.
 * Изменяет map на месте. Возвращает true, если уровень был слит с существующим.
 */
export function addLevelToMap(
  map: Map<number, ZoneClusterData>,
  level: number,
  reason: string,
  touchTime: number,
  tolerance: number
): boolean {
  for (const [existingLevel, data] of map.entries()) {
    if (Math.abs(level - existingLevel) / existingLevel <= tolerance) {
      data.reasons.push(reason);
      data.touches++;
      data.lastTouch = Math.max(data.lastTouch, touchTime);
      return true;
    }
  }
  map.set(level, { reasons: [reason], touches: 1, lastTouch: touchTime });
  return false;
}
