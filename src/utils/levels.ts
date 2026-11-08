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
 * Детектор свинг-экстремумов (окно ±span свечей, строгие сравнения).
 * Единая реализация для всех модулей анализа (SupportResistance, ZoneVoter).
 *
 * FIX ТФ-аудита: раньше окно было жёстко ±2 свечи — на младших ТФ такой критерий
 * ловил рыночный шум. Теперь глубина окна задаётся параметром `span` и подбирается
 * под временнóй масштаб (см. ZONE_PARAMS в zone_voter.ts): чем грубее ТФ, тем
 * крупнее локальные экстремумы считаются значимыми.
 */
export function findSwings(candles: Candle[], lookback: number = 50, span: number = 2): SwingPoint[] {
  const recent = candles.slice(-lookback);
  const offset = candles.length - recent.length;
  const swings: SwingPoint[] = [];

  for (let i = span; i < recent.length - span; i++) {
    const c = recent[i];

    let isLow = true;
    let isHigh = true;
    for (let k = 1; k <= span && (isLow || isHigh); k++) {
      if (isLow && !(c.low < recent[i - k].low && c.low < recent[i + k].low)) isLow = false;
      if (isHigh && !(c.high > recent[i - k].high && c.high > recent[i + k].high)) isHigh = false;
    }

    if (isLow) swings.push({ level: c.low, type: 'low', time: c.time, index: offset + i });
    if (isHigh) swings.push({ level: c.high, type: 'high', time: c.time, index: offset + i });
  }

  return swings;
}

export type ZoneSource =
  | 'swing' | 'polarity' | 'ma' | 'volume' | 'long-body'
  | 'round-number' | 'fibonacci' | 'window';

export interface ZoneClusterData {
  reasons: string[];
  touches: number;
  lastTouch: number;
  /** Независимые категории источников: сила не считается по текстам причин. */
  sources?: ZoneSource[];
  /** Фактическая полуширина источника, например половина диапазона окна. */
  halfWidth?: number;
  /** Время первоначального формирования, а не последнего касания. */
  formedAt?: number;
}

export interface ZoneClusterOptions {
  source?: ZoneSource;
  halfWidth?: number;
  formedAt?: number;
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
  tolerance: number,
  // Число касаний, вносимое этим источником. Для свинг-зон передаётся реальное
  // количество касаний всей зоны (иначе при слиянии источников в одну зону
  // счётчик касаний терялся и становился равен «1 голос»).
  touchesCount?: number,
  options: ZoneClusterOptions = {},
): boolean {
  const hit = findClusterZone(map, level, tolerance);
  if (hit !== undefined) {
    const data = map.get(hit)!;
    data.reasons.push(reason);
    data.touches += touchesCount ?? 1;
    data.lastTouch = Math.max(data.lastTouch, touchTime);
    if (options.source && !data.sources?.includes(options.source)) {
      data.sources = [...(data.sources ?? []), options.source];
    }
    if (options.halfWidth !== undefined) {
      data.halfWidth = Math.max(
        data.halfWidth ?? 0,
        Math.abs(level - hit) + options.halfWidth,
      );
    }
    if (options.formedAt !== undefined) {
      data.formedAt = Math.min(data.formedAt ?? options.formedAt, options.formedAt);
    }
    return true;
  }
  map.set(level, {
    reasons: [reason],
    touches: touchesCount ?? 1,
    lastTouch: touchTime,
    sources: options.source ? [options.source] : [],
    halfWidth: options.halfWidth,
    formedAt: options.formedAt ?? touchTime,
  });
  return false;
}

/**
 * Ищет в карте уже существующую зону, к которой относится уровень `level`
 * (двусторонний допуск: |Δ| <= tol ОТ ОБОИХ кандидатов — раньше сравнивали
 * только с существующей зоной, из-за чего уровни на границе допуска могли
 * не сливаться). Возвращает цену ближайшей подходящей зоны либо undefined.
 */
export function findClusterZone(
  map: Map<number, unknown>,
  level: number,
  tolerance: number
): number | undefined {
  let best: number | undefined;
  let bestDist = Infinity;
  for (const existing of map.keys()) {
    const dist = Math.abs(level - existing);
    if (dist / existing <= tolerance || dist / level <= tolerance) {
      if (dist < bestDist) {
        bestDist = dist;
        best = existing;
      }
    }
  }
  return best;
}

/**
 * ФИНАЛЬНАЯ дедупликация карты зон (FIX аудита №1 — «единый источник S/R»).
 * Инкрементальная кластеризация не транзитивна: A≈B, B≈C, но |A−C| > допуску —
 * и в результате одна реальная зона остаётся разрезанной на несколько
 * близких уровней. Здесь оставшиеся уровни сливаются по принципу
 * «транзитивного замыкания» (соседние по отсортированному списку), берётся
 * средняя цена кластера, суммируются касания, причины объединяются без дублей.
 * Изменяет map на месте.
 */
export function dedupeZones<T extends ZoneClusterData>(
  map: Map<number, T>,
  tolerance: number
): void {
  if (map.size < 2) return;
  const sorted = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const clusters: Array<{
    levels: number[];
    data: T;
    widths: Array<{ level: number; halfWidth?: number }>;
  }> = [];
  for (const [level, data] of sorted) {
    const last = clusters[clusters.length - 1];
    const anchor = last ? last.levels[last.levels.length - 1] : undefined;
    if (anchor !== undefined && Math.abs(level - anchor) / anchor <= tolerance) {
      last!.levels.push(level);
      last!.widths.push({ level, halfWidth: data.halfWidth });
      last!.data.reasons.push(...data.reasons);
      last!.data.touches += data.touches;
      last!.data.lastTouch = Math.max(last!.data.lastTouch, data.lastTouch);
      last!.data.sources = Array.from(new Set([
        ...(last!.data.sources ?? []),
        ...(data.sources ?? []),
      ]));
      if (data.halfWidth !== undefined) {
        last!.data.halfWidth = Math.max(last!.data.halfWidth ?? 0, data.halfWidth);
      }
      if (data.formedAt !== undefined) {
        last!.data.formedAt = Math.min(last!.data.formedAt ?? data.formedAt, data.formedAt);
      }
    } else {
      clusters.push({
        levels: [level],
        widths: [{ level, halfWidth: data.halfWidth }],
        data: {
          ...data,
          reasons: [...data.reasons],
          sources: [...(data.sources ?? [])],
        },
      });
    }
  }
  map.clear();
  for (const cluster of clusters) {
    const avg = cluster.levels.reduce((s, lv) => s + lv, 0) / cluster.levels.length;
    // После смещения центра зона обязана по-прежнему покрывать исходные
    // диапазоны (особенно фактические границы окна), а не только max(width).
    const coveringHalfWidth = Math.max(
      cluster.data.halfWidth ?? 0,
      ...cluster.widths.map((item) =>
        Math.abs(item.level - avg) + (item.halfWidth ?? 0)),
    );
    map.set(Math.round(avg * 1e8) / 1e8, {
      ...cluster.data,
      halfWidth: cluster.data.halfWidth === undefined && coveringHalfWidth === 0
        ? undefined
        : coveringHalfWidth,
      reasons: Array.from(new Set(cluster.data.reasons)),
    });
  }
}
