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
  | 'round-number' | 'fibonacci' | 'window' | 'doji';

/** Роль книжной полосы (закрытая граница, за которой зона инвалидируется). */
export type BookBandRole = 'support' | 'resistance';

/**
 * Явная книжная геометрия полосы [lo … hi] (ЗГ гл. 2 — длинные тела,
 * ЗГ гл. 3 / ЯС гл. 7 — окна). level=середина, halfWidth=полуширина.
 * role задаётся источником (белое тело → поддержка), а не позицией цены
 * (см. задачу 3); при пробое по закрытию за ДАЛЬНЕЙ границей роль меняется
 * на полярную (ЯС гл. 11), а не «зона удаляется» (см. задачу 2).
 */
export interface BookBandGeom { lo: number; hi: number; role: BookBandRole }

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
  /** Индекс бара, СЛЕДУЮЩИЙ за сформировавшим зону (для проверки пробоя). */
  startCheckIndex?: number;
  /** Книжная геометрия полосы (long-body/window) + изначальная роль. */
  bookBand?: BookBandGeom;
  /**
   * ЗАДАЧА 9 (ЯС гл. 11): «значимость … зависит от того, сколько раз рынок
   * безуспешно пытается ее пробить и каковы объемы торгов во время этих
   * попыток». Суммарный относительный объём баров-касаний (v/avgVolume lookback).
   * Принцип книжный; КОНКРЕТНАЯ ФОРМУЛА накопления — настройка проекта, не из книг.
   */
  touchVolumeSum?: number;
  /**
   * Флаг «только для себя»: источник задал точную книжную геометрию и НЕ хочет
   * сливаться с другими уровнями (защита от поглощения длинного тела свинг-кластером).
   * Проектное решение: при кластеризации такой уровень образует отдельный кластер.
   */
  keepSeparate?: boolean;
}

export interface ZoneClusterOptions {
  source?: ZoneSource;
  halfWidth?: number;
  formedAt?: number;
  /** Индекс бара начала проверки пробоя (для книжных зон, задачи 2/4). */
  startCheckIndex?: number;
  /** Явная книжная полоса [lo … hi] с ролью (long-body/window). */
  bookBand?: BookBandGeom;
  /** Не сливать с другими уровнями (см. ZoneClusterData.keepSeparate). */
  keepSeparate?: boolean;
  /**
   * F2 (аудит): при совпадении центра с существующим кластером уровень НЕ
   * вливается в него, а объединяет книжные полосы: band = покрытие
   * [min(lo) … max(hi)] (для полос одной роли — это точная книжная зона
   * «от середины длинного тела до основания свечи, включая нижнюю тень»,
   * ЗГ гл. 2: поддержка на середине ИЛИ в основании — одна полоса между ними).
   * Проектное решение о представлении двух уровней одним кластером, не из книг.
   */
  mergeIntoExact?: boolean;
  /** ЗАДАЧА 9: суммарный относительный объём касаний (формула — проектная). */
  touchVolumeSum?: number;
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
  // F6 (аудит): keepSeparate защищает книжную геометрию В ОБЕ СТОРОНЫ.
  // Раньше findClusterZone пропускал кластеры-цели с keepSeparate, но входящий
  // книжный уровень всё равно сливался в уже существующий (например, свинг-)
  // кластер: центр смещался, halfWidth разбухала до покрывающей — отображаемая
  // полоса становилась шире книжной. Теперь уровень с keepSeparate никогда не
  // вливается в чужой кластер и всегда создаёт собственный (точное соответствие
  // геометрии источника; проектное решение о кластеризации, не из книг).
  const hit = options.keepSeparate ? undefined : findClusterZone(map, level, tolerance);
  // F2 (аудит): mergeIntoExact — уровень с точной книжной геометрией. При
  // совпадении ЦЕНТРА с существующим кластером полосы объединяются покрытием
  // [min(lo) … max(hi)] вместо «первая полоса остаётся, вторая теряется»
  // (старый инкрементальный путь bookBand === undefined → присвоить). Это
  // нужно, когда одна и та же бар-формация порождает два уровня в один центр
  // (например, long-body зона и полярный flip того же тела) — иначе вторая
  // полоса молча отбрасывалась и последующая маршрутизация F2 работала с
  // неполной геометрией. Проектное решение о представлении, не из книг.
  if (hit === undefined && options.mergeIntoExact && options.bookBand) {
    const exact = map.get(level);
    if (exact !== undefined) {
      const data = exact;
      data.reasons.push(reason);
      data.touches += touchesCount ?? 1;
      data.lastTouch = Math.max(data.lastTouch, touchTime);
      if (options.source && !data.sources?.includes(options.source)) {
        data.sources = [...(data.sources ?? []), options.source];
      }
      if (options.startCheckIndex !== undefined) {
        data.startCheckIndex = Math.min(
          data.startCheckIndex ?? options.startCheckIndex, options.startCheckIndex);
      }
      if (data.bookBand) {
        // Объединение полос: покрытие. Роли у объединяемых полос одинаковы
        // (вызовы идут в корзину одной роли); при неожиданном конфликте
        // сохраняем роль существующей полосы (проектное решение).
        data.bookBand = {
          lo: Math.min(data.bookBand.lo, options.bookBand.lo),
          hi: Math.max(data.bookBand.hi, options.bookBand.hi),
          role: data.bookBand.role,
        };
        data.halfWidth = (data.bookBand.hi - data.bookBand.lo) / 2;
      } else {
        data.bookBand = options.bookBand;
        if (options.halfWidth !== undefined) {
          data.halfWidth = Math.max(data.halfWidth ?? 0, options.halfWidth);
        }
      }
      if (options.formedAt !== undefined) {
        data.formedAt = Math.min(data.formedAt ?? options.formedAt, options.formedAt);
      }
      if (options.touchVolumeSum !== undefined) {
        data.touchVolumeSum = (data.touchVolumeSum ?? 0) + options.touchVolumeSum;
      }
      if (options.keepSeparate) data.keepSeparate = true;
      return true;
    }
  }
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
    if (options.startCheckIndex !== undefined) {
      data.startCheckIndex = Math.min(data.startCheckIndex ?? options.startCheckIndex, options.startCheckIndex);
    }
    // bookBand НЕ объединяется при слиянии кластеров: геометрия принадлежит
    // конкретному источнику; при слиянии разных книжных полос сохраняем первую
    // (проектное решение: смешивать геометрические полосы разных свечей нельзя).
    if (options.bookBand !== undefined && data.bookBand === undefined) {
      data.bookBand = options.bookBand;
    }
    // ЗАДАЧА 9: накопление относительного объёма касаний (формула — проектная).
    if (options.touchVolumeSum !== undefined) {
      data.touchVolumeSum = (data.touchVolumeSum ?? 0) + options.touchVolumeSum;
    }
    if (options.keepSeparate) data.keepSeparate = true;
    return true;
  }
  map.set(level, {
    reasons: [reason],
    touches: touchesCount ?? 1,
    lastTouch: touchTime,
    sources: options.source ? [options.source] : [],
    halfWidth: options.halfWidth,
    formedAt: options.formedAt ?? touchTime,
    startCheckIndex: options.startCheckIndex,
    bookBand: options.bookBand,
    keepSeparate: options.keepSeparate,
    touchVolumeSum: options.touchVolumeSum,
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
  map: Map<number, ZoneClusterData>,
  level: number,
  tolerance: number
): number | undefined {
  let best: number | undefined;
  let bestDist = Infinity;
  for (const [existing, data] of map.entries()) {
    // Проектное решение: уровни с keepSeparate (книжные long-body-полосы) не
    // притягивают к себе другие уровни и сами не сливаются инкрементально.
    if (data.keepSeparate) continue;
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
    bands: Array<{ level: number; band: BookBandGeom }>;
  }> = [];
  for (const [level, data] of sorted) {
    const last = clusters[clusters.length - 1];
    // Проектное решение: книжная long-body-полоса (keepSeparate) не сливается с
    // соседними кластерами — иначе её точная геометрия и роль теряются при
    // поглощении свинг-кластером (см. задачу 1: «одна зона, а не две точки»).
    if (data.keepSeparate || last?.data.keepSeparate) {
      clusters.push({
        levels: [level],
        widths: [{ level, halfWidth: data.halfWidth }],
        bands: data.bookBand ? [{ level, band: data.bookBand }] : [],
        data: {
          ...data,
          reasons: [...data.reasons],
          sources: [...(data.sources ?? [])],
        },
      });
      continue;
    }
    // При кластеризации сравниваем ПОЛНЫЕ ДИАПАЗОНЫ зон: книжная полоса
    // (long-body/window) может быть шире tolerance-окрестности её центра, и
    // соседний уровень обязан перекрываться с зоной, а не только лежать в
    // допуске от средней линии (ЯС гл. 11: уровень — это зона, а не линия).
    const reachOf = (lv: number, d: T): number =>
      Math.max(d.halfWidth ?? 0, d.bookBand ? Math.max(lv - d.bookBand.lo, d.bookBand.hi - lv) : 0);
    const overlapsPrevCluster = (cluster: NonNullable<typeof last>, lv: number, d: T): boolean => {
      const loNew = lv - reachOf(lv, d);
      const hiNew = lv + reachOf(lv, d);
      return cluster.levels.some((l) => {
        const r = reachOf(l, cluster.data);
        return l - r <= hiNew && loNew <= l + r;
      });
    };
    const anchor = last ? last.levels[last.levels.length - 1] : undefined;
    if (anchor !== undefined &&
        (Math.abs(level - anchor) / anchor <= tolerance || overlapsPrevCluster(last!, level, data))) {
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
      if (data.startCheckIndex !== undefined) {
        last!.data.startCheckIndex = Math.min(
          last!.data.startCheckIndex ?? data.startCheckIndex, data.startCheckIndex);
      }
      if (data.bookBand) last!.bands.push({ level, band: data.bookBand });
      // ЗАДАЧА 9: суммарный относительный объём касаний при слиянии кластеров.
      if (data.touchVolumeSum !== undefined) {
        last!.data.touchVolumeSum =
          (last!.data.touchVolumeSum ?? 0) + data.touchVolumeSum;
      }
    } else {
      clusters.push({
        levels: [level],
        widths: [{ level, halfWidth: data.halfWidth }],
        bands: data.bookBand ? [{ level, band: data.bookBand }] : [],
        data: {
          ...data,
          reasons: [...data.reasons],
          sources: [...(data.sources ?? [])],
        },
      });
    }
  }
  map.clear();
  // F6 (аудит): книжные полосы (bookBand) никогда не сливаются между собой —
  // каждая сохраняет СВОЮ точную геометрию [lo … hi] и halfWidth=(hi−lo)/2.
  // Если в один кластер попали несколько разных полос, они разделяются на
  // отдельные кластеры по исходным уровням (проектное решение о кластеризации;
  // приоритет — точная книжная геометрия, confluence-голосование при этом может
  // уменьшиться — это приемлемо).
  const splitMultiBand = (cluster: (typeof clusters)[number]): Array<(typeof clusters)[number]> => {
    if (cluster.bands.length <= 1) return [cluster];
    return cluster.levels.map((lv) => {
      const band = cluster.bands.find((b) => b.level === lv);
      const data: T = { ...cluster.data };
      if (band) {
        data.bookBand = band.band as T['bookBand'];
        data.halfWidth = (band.band.hi - band.band.lo) / 2;
      } else {
        data.bookBand = undefined as T['bookBand'];
        const w = cluster.widths.find((x) => x.level === lv);
        data.halfWidth = w ? w.halfWidth : undefined as T['halfWidth'];
      }
      return { levels: [lv], widths: [{ level: lv, halfWidth: data.halfWidth }], bands: band ? [band] : [], data };
    });
  };
  const finalClusters = clusters.flatMap(splitMultiBand);
  for (const cluster of finalClusters) {
    const avg = cluster.levels.reduce((s, lv) => s + lv, 0) / cluster.levels.length;
    // После смещения центра зона обязана по-прежнему покрывать исходные
    // диапазоны (особенно фактические границы окна), а не только max(width).
    const coveringHalfWidth = Math.max(
      cluster.data.halfWidth ?? 0,
      ...cluster.widths.map((item) =>
        Math.abs(item.level - avg) + (item.halfWidth ?? 0)),
    );
    // Объединённая книжная полоса кластера: покрытие всех исходных полос.
    let mergedBand: BookBandGeom | undefined;
    if (cluster.bands.length > 0) {
      const lo = Math.min(...cluster.bands.map((b) => b.band.lo));
      const hi = Math.max(...cluster.bands.map((b) => b.band.hi));
      const roles = new Set(cluster.bands.map((b) => b.band.role));
      // Проектное решение: при конфликте ролей разных полос в одном кластере
      // роль выбирается по ближайшей к центру кластера исходной полосе.
      const role = roles.size === 1
        ? cluster.bands[0].band.role
        : cluster.bands.sort((a, b) =>
            Math.abs((a.band.lo + a.band.hi) / 2 - avg) - Math.abs((b.band.lo + b.band.hi) / 2 - avg),
          )[0].band.role;
      mergedBand = { lo, hi, role };
    }
    map.set(Math.round(avg * 1e8) / 1e8, {
      ...cluster.data,
      halfWidth: cluster.data.halfWidth === undefined && coveringHalfWidth === 0
        ? undefined
        : coveringHalfWidth,
      bookBand: mergedBand,
      reasons: Array.from(new Set(cluster.data.reasons)),
    });
  }
}
