// Zone Voter — книжные ориентиры S/R плюс явно числовые эвристики проекта.
// Источник истины по книжным правилам: С. Нисон «Японские свечи» (ЯС) и
// «За гранью японских свечей» (ЗГ). Свинги, полярность, длинные тела и окна
// связаны с книгами; допуски, ATR-ширина, круглые числа, лимиты и баллы
// являются настройками реализации, а не цитатами.
// Ключевые принципы:
// 1. Уровни - это ЗОНЫ, а не точные цены (ЯС гл. 11)
// 2. Количество касаний определяет силу (ЯС гл. 11)
// 3. Объём подтверждает значимость (ЯС гл. 11)
// 4. Полярность: пробитое ПО ЗАКРЫТИЮ сопротивление становится поддержкой
//    (ЯС гл. 11, ЗГ гл. 2)
// 5. Кластеризация близких уровней (настройка проекта)
// 6. Уровни коррекции 38%, 50% и 62% от направленного движения (ЯС гл. 12)

import { Candle } from './candle';
import { sma } from './indicators';
import { findSwings, addLevelToMap, dedupeZones, type ZoneClusterData, type ZoneSource } from './levels';
import { detectGaps } from './gaps';

export type ZoneMarket = 'stock' | 'crypto';

/**
 * Книжная геометрия зоны (ЗГ гл. 2 — длинные тела; ЗГ гл. 3 / ЯС гл. 7 — окна):
 * у этих источников полоса [lo..hi] задана самой свечой/окном, поэтому в
 * mapToZones её полуширина используется как есть, без расширения ATR-полом
 * (см. задачу «не перезаписывать книжную ширину окна ATR-полосой»).
 */
const BOOK_GEOMETRY_SOURCES: ReadonlySet<ZoneSource> = new Set(['long-body', 'window']);

/**
 * Настройка проекта (НЕ из книг): минимальная полуширина для источников без
 * собственной книжной геометрии (свинг-кластеры, MA, круглые числа, Fib),
 * чтобы зона не вырождалась в точку на младших ТФ.
 */
const MIN_HALF_WIDTH_ATR_MULT = 0.25;
/** Настройка проекта (НЕ из книг): потолок полуширины в единицах ATR. */
const MAX_HALF_WIDTH_ATR_MULT = 2;
/** Настройка проекта (НЕ из книг): окно среднего тела при поиске длинных тел. */
const BODY_AVG_LOOKBACK = 60;
/** Настройка проекта (НЕ из книг): окно поиска импульсов для уровней Фибоначчи. */
const FIB_LOOKBACK = 50;

/**
 * Книжный критерий пробоя зоны ПО ЗАКРЫТИЮ (ЗГ гл. 2):
 * «пока цены закрытия держатся выше поддержки, она остается в силе».
 * Поддержка мертва только если close закрылся ниже ДАЛЬНЕЙ (нижней) границы;
 * сопротивление мертво только если close закрылся выше ДАЛЬНЕЙ (верхней) границы.
 * Внутрибарные проколы не считаются (реализовано через строгое неравенство
 * по close относительно lo/hi полосы).
 */
function closesBeyondZone(
  c: Candle,
  role: 'support' | 'resistance',
  lo: number,
  hi: number,
): boolean {
  return role === 'support' ? c.close < lo : c.close > hi;
}

/**
 * Полоса книжной зоны (ЗГ гл. 2 — длинные тела; ЯС гл. 7 / ЗГ гл. 3 — окна):
 * [lo … hi] с исходной ролью. Кандидаты собираются до проверки пробоя, чтобы
 * инвалидация «по закрытию за дальней границей» и последующая полярность
 * применялись к ним единообразно (applyBookZoneBreakAndPolarity).
 */
interface BookZoneCandidate {
  source: ZoneSource;
  role: 'support' | 'resistance';
  lo: number;
  hi: number;
  /** Индекс бара, формирующего зону; проверка пробоя — только по барам после него. */
  index: number;
  formedAt: number;
  reason: string;
}

/** Добавляет кандидата, пропуская вырожденные (нулевой высоты) полосы. */
function pushBookCandidate(out: BookZoneCandidate[], cand: BookZoneCandidate): void {
  if (!(cand.hi > cand.lo)) return; // инженерная защита (не из книг)
  out.push(cand);
}

/**
 * Направленный импульс A→B для уровней коррекции (ЯС гл. 12).
 * ОПЕРАЦИОНАЛИЗАЦИЯ ПРОЕКТА (в книге пара A/B задаётся визуально): среди
 * свингов findSwings за lookback берётся самая выраженная направленная пара
 * «минимум → максимум» (для подъёма) или «максимум → минимум» (для спада),
 * причём точка A предшествует точке B.
 */
function findImpulse(
  candles: Candle[],
  lookback: number,
  swingSpan: number,
): { direction: 'up' | 'down'; aLevel: number; bLevel: number } | null {
  const swings = findSwings(candles, Math.min(lookback, candles.length), swingSpan);
  let bestUp: { a: number; spread: number } | null = null;
  let bestDown: { a: number; spread: number } | null = null;
  for (const low of swings) {
    if (low.type !== 'low') continue;
    for (const high of swings) {
      if (high.type !== 'high' || high.index <= low.index) continue;
      if (!bestUp || high.level - low.level > bestUp.spread) {
        bestUp = { a: low.level, spread: high.level - low.level };
      }
    }
  }
  for (const high of swings) {
    if (high.type !== 'high') continue;
    for (const low of swings) {
      if (low.type !== 'low' || low.index <= high.index) continue;
      if (!bestDown || high.level - low.level > bestDown.spread) {
        bestDown = { a: high.level, spread: high.level - low.level };
      }
    }
  }
  if (!bestUp && !bestDown) return null;
  if (bestUp && (!bestDown || bestUp.spread >= bestDown.spread)) {
    return { direction: 'up', aLevel: bestUp.a + bestUp.spread, bLevel: bestUp.a };
  }
  return { direction: 'down', aLevel: bestDown!.a - bestDown!.spread, bLevel: bestDown!.a };
}

/** Wilder ATR (последнее значение) по закрытым свечам; 0 при нехватке данных. */
function atrWilder(candles: Candle[], period = 14): number {
  if (candles.length <= period) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i], p = candles[i - 1];
    atr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

export interface Zone {
  level: number;
  votes: number;
  strong: boolean;
  reasons: string[];
  /** Независимые книжные/проектные источники; один источник даёт один голос. */
  sources: ZoneSource[];
  touches: number;
  lastTouch?: number;
  /**
   * Ширина ЗОНЫ (по Нисону уровень — это зона, а не линия): ±halfWidth вокруг level.
   * Равна толерансу кластеризации этого ТФ (0.5%), но НЕ меньше 0.25×ATR(14) и
   * не больше 2×ATR — иначе на младших ТФ зона вырождается в точку, а на старых
   * данных перекрывает половину диапазона.
   */
  halfWidth: number;
  /** Время формирования зоны (для учёта "свежести"). */
  formedAt: number;
}

/** Ключ временнóго масштаба для кэша результатов collect (см. timeframeKey). */
export type TimeframeKey = 'scalp' | 'intraday' | 'swing' | 'position';

/**
 * Группировка интервалов Bybit по временнóму масштабу.
 * ИСПРАВЛЕНО: правильная иерархия проверки — месячные/недельные проверяются ДО минутных,
 * чтобы '1M' (месяц) не попадал в 'scalp'.
 */
export function timeframeKey(tf: string): TimeframeKey {
  const raw = tf.trim();
  const upper = raw.toUpperCase();

  // 1. POSITION: Месячные и Недельные ТФ (Макро-масштаб)
  // Проверяем ДО скальп-логики, чтобы '1M' (месяц) не попал в 'scalp'
  if (/^([123]?MO?|M|W|1W)$/i.test(upper)) return 'position';

  // 2. SWING: Дневные ТФ (Классический масштаб)
  if (/^(D|1D)$/i.test(upper)) return 'swing';

  // 3. INTRADAY: Часовые и 30-минутные ТФ
  if (/^(30|60|120|240)(M|MIN)?$/i.test(upper)) return 'intraday';
  if (/^[124]H$/i.test(upper)) return 'intraday';
  if (['60', '1H', '2H', '4H'].includes(upper)) return 'intraday';

  // 4. SCALP: Минутные ТФ (1м, 3м, 5м, 15м)
  if (/^(1|3|5|15)(M|MIN)?$/i.test(upper)) return 'scalp';
  if (['1', '3', '5', '15'].includes(raw)) return 'scalp';

  // Fallback: безопасное отнесение к макро-масштабу
  console.warn(`[Nison Engine] Неизвестный таймфрейм "${tf}". Применен fallback: position.`);
  return 'position';
}

interface ZoneParams {
  tolerance: number;
  breakPct: number;
  lookback: number;
  /** Глубина окна свинг-детектора (±span свечей): на грубее ТФ — крупнее экстремумы */
  swingSpan: number;
}

const ZONE_PARAMS: Record<TimeframeKey, ZoneParams> = {
  scalp:    { tolerance: 0.002, breakPct: 0.002, lookback: 200, swingSpan: 2 },
  intraday: { tolerance: 0.003, breakPct: 0.003, lookback: 180, swingSpan: 3 },
  swing:    { tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3 },
  position: { tolerance: 0.008, breakPct: 0.004, lookback: 150, swingSpan: 4 },
};

export class ZoneVoter {
  // Толеранс по умолчанию (дневной ТФ, историческая совместимость)
  private static readonly CLUSTER_TOLERANCE = 0.005;

  // Минимум голосов для сильной зоны
  private static readonly STRONG_ZONE_MIN_VOTES = 3;

  // FIX ТФ-канона: значимых зон не больше MAX_ZONES_PER_SIDE с каждой стороны
  private static readonly MAX_ZONES_PER_SIDE = 8;

  /** Кэш зависит от цены, масштаба и содержимого истории, не только от её длины. */
  private static collectCache = new Map<string, { support: Zone[]; resistance: Zone[] }>();
  private static readonly CACHE_MAX_SIZE = 10;

  private static historyFingerprint(candles: Candle[]): string {
    let hash = 2166136261;
    const mix = (value: number) => {
      hash ^= Math.round((Number.isFinite(value) ? value : 0) * 1e6);
      hash = Math.imul(hash, 16777619);
    };
    for (const candle of candles) {
      mix(candle.time);
      mix(candle.open);
      mix(candle.high);
      mix(candle.low);
      mix(candle.close);
      mix(candle.volume);
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * Сбор всех зон с голосованием.
   * FIX: добавлена мемоизация для производительности.
   */
  static collect(
    price: number,
    candles: Candle[],
    tfKey: TimeframeKey = 'swing',
    market: ZoneMarket = 'crypto',
  ): { support: Zone[]; resistance: Zone[] } {
    const lastCandle = candles[candles.length - 1];
    const cacheKey = [
      price,
      tfKey,
      market,
      candles.length,
      this.historyFingerprint(candles),
    ].join('_');
    const cached = this.collectCache.get(cacheKey);
    if (cached) return cached;

    const params = ZONE_PARAMS[tfKey];
    const supMap = new Map<number, ZoneClusterData>();
    const resMap = new Map<number, ZoneClusterData>();
    // Кандидаты книжных зон ДО фильтрации по пробою (задача «инвалидация по
    // закрытию + полярность»). Из них после проверки «нет закрытия за дальней
    // границей» и хронологии «пробой → возврат → удержание» добавляются
    // полярные роли.
    const bookCandidates: BookZoneCandidate[] = [];

    // 1. Касательная классификация: уровень + число касаний ценой после его образования
    this.addTouchBasedLevels(price, candles, supMap, resMap, params);

    // 2. Полярность свинг-уровней: пробитые уровни меняют роль
    this.addPolarityLevels(price, candles, supMap, resMap, params);

    // 3. Скользящие средние как динамические уровни
    this.addMALevels(price, candles, supMap, resMap, params.tolerance);

    // 4. Объёмные климасы (ЯС гл. 15)
    this.addVolumeClimaxLevels(candles, supMap, resMap, params.tolerance);

    // 5. Зоны длинных тел (ЗГ гл. 2, рис. 2.11): собираются кандидатами,
    // инвалидация по закрытию и полярность — на шаге 5b.
    this.collectLongBodyCandidates(candles, bookCandidates, params);

    // 6. Психологические круглые числа
    this.addRoundNumbers(price, supMap, resMap, params.tolerance, lastCandle?.time ?? 0);

    // 7. Уровни коррекции Фибоначчи (ЯС гл. 12)
    this.addFibonacciLevels(candles, supMap, resMap, params);

    // 8. Нисон: окно — будущая зона поддержки/сопротивления. Сохраняем его
    // фактические границы; закрытие за дальней границей отменяет сценарий
    // (кандидат с той же проверкой инвалидации, что и длинные тела).
    this.collectWindowCandidates(candles, bookCandidates, market);

    // 5b/8b. Инвалидация книжных зон по закрытию + полярность (ЯС гл. 11).
    this.applyBookZoneBreakAndPolarity(candles, supMap, resMap, bookCandidates, params);

    // Финальная транзитивная дедупликация
    dedupeZones(supMap, params.tolerance);
    dedupeZones(resMap, params.tolerance);

    // Ширина зоны для источников БЕЗ книжной геометрии привязана к
    // волатильности ТФ (ATR — настройка проекта, в книгах ATR нет).
    const atrWindow = candles.length > 74 ? candles.slice(-60) : candles;
    const atrVal = atrWilder(atrWindow, 14);
    const zoneHalfWidth = (level: number) => {
      // Настройки проекта: пол 0.25×ATR и потолок 2×ATR (см. константы выше).
      const base = Math.max(params.tolerance * level, atrVal * MIN_HALF_WIDTH_ATR_MULT);
      return atrVal > 0 ? Math.min(base, atrVal * MAX_HALF_WIDTH_ATR_MULT) : base;
    };

    // FIX: значимость определяется в первую очередь votes (независимые источники),
    // затем touches (касания), затем расстояние до цены.
    // По ЯС гл. 11: "Чем больше технических индикаторов сходятся в одной зоне,
    // тем выше вероятность того, что эта зона окажется значимой".
    const significance = (a: Zone, b: Zone) =>
      (b.votes - a.votes) || (b.touches - a.touches) ||
      Math.abs(a.level - price) - Math.abs(b.level - price);

    // Порог значимости адаптивен к ТФ
    const minTouches = tfKey === 'intraday' || tfKey === 'scalp' ? 2 : 1;
    const significant = (z: Zone) =>
      z.sources.includes('window') || z.touches >= minTouches ||
      z.votes >= this.STRONG_ZONE_MIN_VOTES;

    // Задача «классификация по закрытию, а не midline vs live-price»:
    // роль зоны задаётся ИСТОЧНИКОМ и полярностью (белое тело → поддержка),
    // а не позицией цены относительно средней линии. Книжная цитата (ЗГ гл. 2):
    // «пока цены закрытия держатся выше поддержки, она остается в силе» —
    // т.е. зона жива, пока нет ЗАКРЫТИЯ за дальней границей; цена внутри
    // полосы [level ± halfWidth] — это момент теста, а не отмена зоны.
    // Поэтому фильтр «support: level <= price / resistance: level >= price»
    // из старой реализации удалён; вместо него — проверка последней свечи
    // против БЛИЖНЕЙ границы полосы.
    const lastClose = lastCandle?.close ?? price;
    // Настройка проекта (НЕ из книг): при нехватке свечей классификация
    // откатывается к прежней логике средней линии против переданной цены.
    const fallbackToMidline = !lastCandle;

    const support = this.mapToZones(supMap, zoneHalfWidth, candles)
      .filter((z) => fallbackToMidline
        ? z.level <= price
        : lastClose > z.level - z.halfWidth)
      .filter(significant)
      .sort(significance)
      .slice(0, this.MAX_ZONES_PER_SIDE)
      .sort((a, b) => b.level - a.level);

    const resistance = this.mapToZones(resMap, zoneHalfWidth, candles)
      .filter((z) => fallbackToMidline
        ? z.level >= price
        : lastClose < z.level + z.halfWidth)
      .filter(significant)
      .sort(significance)
      .slice(0, this.MAX_ZONES_PER_SIDE)
      .sort((a, b) => a.level - b.level);

    const result = { support, resistance };

    // Сохраняем в кэш
    this.collectCache.set(cacheKey, result);
    // Ограничиваем размер кэша
    if (this.collectCache.size > this.CACHE_MAX_SIZE) {
      const firstKey = this.collectCache.keys().next().value;
      if (firstKey) this.collectCache.delete(firstKey);
    }

    return result;
  }

  /** Очистка кэша (для тестов). */
  static clearCache(): void {
    this.collectCache.clear();
  }

  /**
   * 1. Касательная классификация свинг-уровней
   * FIX: используем halfWidth вместо tolerance для проверки касаний.
   */
  private static addTouchBasedLevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams
  ) {
    const lookback = Math.min(params.lookback, candles.length);
    const tol = params.tolerance;

    // Группируем свинги в зоны (кластеризация)
    const zoneDefs: Array<{ level: number; firstIndex: number; members: number[]; formedAt: number }> = [];
    for (const swing of findSwings(candles, lookback, params.swingSpan)) {
      const hit = zoneDefs.find((z) =>
        z.members.some((m) => Math.abs(swing.level - m) / m <= tol));
      if (hit) {
        hit.firstIndex = Math.min(hit.firstIndex, swing.index);
        hit.formedAt = Math.min(hit.formedAt, candles[swing.index]?.time ?? 0);
        if (!hit.members.includes(swing.level)) hit.members.push(swing.level);
      } else {
        zoneDefs.push({ 
          level: swing.level, 
          firstIndex: swing.index, 
          members: [swing.level],
          formedAt: candles[swing.index]?.time ?? 0
        });
      }
    }

    // Вычисляем среднюю ширину зоны для проверки касаний
    const atrWindow = candles.length > 74 ? candles.slice(-60) : candles;
    const atrVal = atrWilder(atrWindow, 14);
    const halfWidth = Math.max(tol * price, atrVal * 0.25);

    for (const zone of zoneDefs) {
      let supTouches = 0;
      let resTouches = 0;
      let lastSupTime = 0;
      let lastResTime = 0;

      for (let j = zone.firstIndex + 1; j < candles.length; j++) {
        const c = candles[j];
        // Одна закрытая свеча — не больше одного касания зоны. При нескольких
        // близких членах кластера старый вложенный цикл считал один тест 2–3 раза.
        // Касание поддержки (ЗГ гл. 2): «Прорывы этих зон поддержки могут
        // происходить неоднократно в течение сессии, но пока цены закрытия
        // держатся выше поддержки, она остается в силе». Значит глубокий
        // внутрибарный прокол (низ тени ниже нижней границы полосы) при
        // ЗАКРЫТИИ, удержанном над полосой, — это полноценный тест поддержки,
        // а не «нет касания». Прежняя проверка требовала low СТРОГО внутри
        // полосы и такие тесты теряла. Сопротивление — зеркально.
        const hitSupport = zone.members.some((m) =>
          c.low <= m + halfWidth && c.close >= m - halfWidth);
        const hitResistance = zone.members.some((m) =>
          c.high >= m - halfWidth && c.close <= m + halfWidth);
        if (hitSupport) {
          supTouches++;
          lastSupTime = c.time;
        }
        if (hitResistance) {
          resTouches++;
          lastResTime = c.time;
        }
      }

      const asSupport = supTouches > 0 && zone.level <= price;
      const asResistance = resTouches > 0 && zone.level >= price;

      if (asSupport) {
        addLevelToMap(
          supMap, zone.level, `свинг-зона: ${supTouches} касание(й) поддержки`,
          lastSupTime, tol, supTouches,
          { source: 'swing', halfWidth, formedAt: zone.formedAt },
        );
      }
      if (asResistance) {
        addLevelToMap(
          resMap, zone.level, `свинг-зона: ${resTouches} касание(й) сопротивления`,
          lastResTime, tol, resTouches,
          { source: 'swing', halfWidth, formedAt: zone.formedAt },
        );
      }
    }
  }

  /**
   * 2. Полярность: пробитые уровни меняют роль
   * FIX: добавлена проверка возврата к пробитому уровню (гл. 11).
   */
  private static addPolarityLevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams
  ) {
    if (candles.length < 6) return;
    const lookback = Math.min(params.lookback, candles.length);
    const swings = findSwings(candles, lookback, params.swingSpan);
    const last = candles[candles.length - 1];
    const BREAK_PCT = params.breakPct;

    for (const swing of swings) {
      const fromIdx = Math.max(swing.index + 1, candles.length - 40);
      const formedAt = candles[swing.index]?.time ?? swing.time;
      if (swing.type === 'high') {
        // Строгая хронология Нисона: сначала закрытие выше сопротивления,
        // затем (не раньше) возврат и удержание его как поддержки.
        const breakIndex = candles.findIndex((c, index) =>
          index >= fromIdx && c.close > swing.level * (1 + BREAK_PCT));
        if (breakIndex < 0) continue;
        const returnIndex = candles.findIndex((c, index) =>
          index > breakIndex &&
          c.high >= swing.level * (1 - BREAK_PCT) &&
          c.low <= swing.level * (1 + BREAK_PCT) &&
          c.close > swing.level);
        if (returnIndex >= 0 && last.close > swing.level) {
          addLevelToMap(
            supMap, swing.level, 'полярность: пробитое сопротивление → поддержка',
            candles[returnIndex].time, params.tolerance, 1,
            { source: 'polarity', formedAt },
          );
        }
      } else {
        const breakIndex = candles.findIndex((c, index) =>
          index >= fromIdx && c.close < swing.level * (1 - BREAK_PCT));
        if (breakIndex < 0) continue;
        const returnIndex = candles.findIndex((c, index) =>
          index > breakIndex &&
          c.low <= swing.level * (1 + BREAK_PCT) &&
          c.high >= swing.level * (1 - BREAK_PCT) &&
          c.close < swing.level);
        if (returnIndex >= 0 && last.close < swing.level) {
          addLevelToMap(
            resMap, swing.level, 'полярность: пробитая поддержка → сопротивление',
            candles[returnIndex].time, params.tolerance, 1,
            { source: 'polarity', formedAt },
          );
        }
      }
    }
  }

  /**
   * 3. Скользящие средние как динамические уровни
   */
  private static addMALevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number
  ) {
    const closes = candles.map(c => c.close);
    const periods = [50, 65, 200];
    const lastTime = candles[candles.length - 1]?.time ?? 0;

    for (const period of periods) {
      if (candles.length >= period) {
        const ma = sma(closes, period);
        const maVal = ma[ma.length - 1];
        if (Number.isNaN(maVal)) continue;

        if (maVal <= price) {
          addLevelToMap(supMap, maVal, `MA${period}`, lastTime, tolerance, 1, { source: 'ma' });
        } else {
          addLevelToMap(resMap, maVal, `MA${period}`, lastTime, tolerance, 1, { source: 'ma' });
        }
      }
    }
  }

  /**
   * 4. Объёмные климасы
   */
  private static addVolumeClimaxLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number
  ) {
    const lookback = Math.min(60, candles.length);
    const recent = candles.slice(-lookback);
    const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;

    for (const c of recent) {
      if (c.volume > avgVolume * 2) {
        const level = c.isBullish ? c.low : c.high;
        if (c.isBullish) {
          addLevelToMap(supMap, level, 'объёмный климакс (гл. 15)', c.time, tolerance, 1, { source: 'volume', formedAt: c.time });
        } else {
          addLevelToMap(resMap, level, 'объёмный климакс (гл. 15)', c.time, tolerance, 1, { source: 'volume', formedAt: c.time });
        }
      }
    }
  }

  /**
   * 5. Зоны длинных тел — ОДНА зона, а не две точки (задача 1)
   *
   * ЗГ гл. 2, рис. 2.11: «Откат цен должен встретить поддержку либо на уровне
   * середины длинного белого тела, либо в основании всей белой свечи, включая
   * и нижнюю тень». Глоссарий ЗГ: поддержка — «от середины до основания белой
   * свечи (включая и минимум нижней тени)»; для чёрной свечи сопротивление —
   * «от середины до вершины свечи (включая верхнюю тень)».
   * Поэтому белая свеча даёт ОДНУ зону [c.low … mid], чёрная — [mid … c.high]
   * (по образцу addWindowLevels): level = (lo+hi)/2, halfWidth = (hi−lo)/2.
   * Прежняя реализация добавляла две ТОЧКИ (mid и low/high), из-за чего между
   * ними образовывалась «дыра»: откат в середину книжной зоны не распознавался.
   *
   * Критерий «длинного тела» — книжный ориентир ЗГ гл. 2: тело >= 3× тела
   * ПРЕДЫДУЩЕЙ свечи. Бывший проектный фильтр `isLongCandle && body > 1.5×avgBody(60)`
   * из книжного критерия УБРАН; он оставлен только как дополнительный проектный
   * фильтр (помечен ниже). Инвалидация по закрытию и полярность — в
   * applyBookZoneBreakAndPolarity (шаг 5b collect).
   */
  private static collectLongBodyCandidates(
    candles: Candle[],
    out: BookZoneCandidate[],
    params: ZoneParams,
  ): void {
    const lookback = Math.min(BODY_AVG_LOOKBACK, candles.length); // окно avgBody — настройка проекта
    const start = candles.length - lookback;
    let avgBody = 0;
    for (let i = start; i < candles.length; i++) avgBody += candles[i].body;
    avgBody /= Math.max(lookback, 1);

    for (let i = Math.max(start, 1); i < candles.length; i++) {
      const c = candles[i];
      const prevBody = candles[i - 1].body;
      // Инженерная защита (НЕ из книг): при нулевом теле предыдущей свечи
      // отношение тел неопределено — зону не формируем.
      if (!(prevBody > 0)) continue;
      // Книжный критерий (ЗГ гл. 2): тело не меньше 3× тела предыдущей свечи.
      if (!(c.body >= prevBody * 3)) continue;
      // ПРОЕКТНОЕ ОТКЛОНЕНИЕ (не из книг): дополнительный фильтр прежней
      // реализации — свеча «длинная» по форме и телу относительно среднего.
      if (!c.isLongCandle || !(c.body > avgBody * 1.5)) continue;

      const mid = (c.open + c.close) / 2;
      if (c.isBullish) {
        // Метки исправлены: раньше было «основание длинного белого тела», хотя
        // код использует c.low — это ОСНОВАНИЕ СВЕЧИ ВКЛЮЧАЯ НИЖНЮЮ ТЕНЬ (ЗГ гл. 2).
        pushBookCandidate(out, {
          source: 'long-body',
          role: 'support',
          lo: c.low,
          hi: mid,
          index: i,
          formedAt: c.time,
          reason: 'зона длинного белого тела: от середины тела до основания свечи, включая нижнюю тень (ЗГ гл. 2, рис. 2.11)',
        });
      } else if (c.isBearish) {
        // Зеркально: «вершина длинного чёрного тела» → «вершина свечи, включая верхнюю тень».
        pushBookCandidate(out, {
          source: 'long-body',
          role: 'resistance',
          lo: mid,
          hi: c.high,
          index: i,
          formedAt: c.time,
          reason: 'зона длинного чёрного тела: от середины тела до вершины свечи, включая верхнюю тень (ЗГ гл. 2, рис. 2.11)',
        });
      }
    }
  }

  /**
   * 5b/8b. Инвалидация книжных зон по ЗАКРЫТИЮ + полярность (задача 2)
   *
   * ЗГ гл. 2: «Если нижняя граница зоны поддержки (т.е. минимум высокой белой
   * свечи) затем будет пробита ценой закрытия, то длинную позицию следует
   * закрыть. Прорывы этих зон поддержки могут происходить неоднократно в
   * течение сессии, но пока цены закрытия держатся выше поддержки, она
   * остается в силе».
   * ЯС гл. 11: прежняя поддержка становится сопротивлением и наоборот.
   *
   * Реализация (строго по закрытым свечам, без look-ahead):
   * - зона жива в исходной роли, пока нет закрытия за ДАЛЬНЕЙ границей
   *   (поддержка: close < lo; сопротивление: close > hi); внутрибарные проколы
   *   роль не меняют (см. также addTouchBasedLevels);
   * - после пробоя по закрытию зона НЕ удаляется: по той же хронологии, что и
   *   для свингов в addPolarityLevels («пробой по закрытию → возврат →
   *   удержание»), она передаётся в полярный механизм с зеркальной ролью.
   */
  private static applyBookZoneBreakAndPolarity(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    candidates: BookZoneCandidate[],
    params: ZoneParams,
  ): void {
    const last = candles[candles.length - 1];
    if (!last) return;

    for (const cand of candidates) {
      let breakIndex = -1;
      for (let j = cand.index + 1; j < candles.length; j++) {
        if (closesBeyondZone(candles[j], cand.role, cand.lo, cand.hi)) {
          breakIndex = j;
          break;
        }
      }

      if (breakIndex < 0) {
        // Пробоя по закрытию не было — зона активна в исходной роли.
        const target = cand.role === 'support' ? supMap : resMap;
        addLevelToMap(
          target, (cand.lo + cand.hi) / 2, cand.reason, cand.formedAt,
          params.tolerance, 0,
          { source: cand.source, halfWidth: (cand.hi - cand.lo) / 2, formedAt: cand.formedAt },
        );
        continue;
      }

      // Строгая хронология (образцовая, как в addPolarityLevels): сначала
      // закрытие за дальней границей, затем возврат к зоне и удержание по ту
      // её сторону, где находится цена сейчас.
      const polarityRole: 'support' | 'resistance' =
        cand.role === 'support' ? 'resistance' : 'support';
      const returned = candles.findIndex((c, index) =>
        index > breakIndex &&
        (polarityRole === 'support'
          ? c.low <= cand.hi && c.close > cand.hi
          : c.high >= cand.lo && c.close < cand.lo));
      const holdsNow = polarityRole === 'support'
        ? last.close > cand.hi
        : last.close < cand.lo;
      if (returned < 0 || !holdsNow) continue;

      const target = polarityRole === 'support' ? supMap : resMap;
      addLevelToMap(
        target, (cand.lo + cand.hi) / 2,
        `полярность: ${cand.reason} после пробоя по закрытию`,
        candles[returned].time, params.tolerance, 1,
        { source: 'polarity', halfWidth: (cand.hi - cand.lo) / 2, formedAt: cand.formedAt },
      );
    }
  }

  /**
   * 6. Психологические круглые числа
   * FIX: исправлен тавтологический фильтр — теперь проверяем реальную близость.
   */
  private static addRoundNumbers(
    price: number,
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number,
    formedAt: number,
  ) {
    let step: number;
    if (price >= 10000) step = 1000;
    else if (price >= 1000) step = 100;
    else if (price >= 100) step = 10;
    else if (price >= 10) step = 1;
    else if (price >= 1) step = 0.1;
    else step = 0.01;

    const lower = Math.floor(price / step) * step;
    const upper = Math.ceil(price / step) * step;

    // FIX: добавляем только если цена реально близко (в пределах 20% шага)
    // Это отсекает фантомные уровни, которые были бы слишком далеко
    const proximityThreshold = step * 0.2;

    if (price - lower <= proximityThreshold && lower > 0) {
      addLevelToMap(supMap, lower, 'психологический уровень (круглое число)', formedAt, tolerance, 1, { source: 'round-number', formedAt });
    }
    if (upper - price <= proximityThreshold && upper > 0) {
      addLevelToMap(resMap, upper, 'психологический уровень (круглое число)', formedAt, tolerance, 1, { source: 'round-number', formedAt });
    }
  }

  /**
   * 7. Уровни коррекции Фибоначчи — строго ЯС гл. 12 (задача 6)
   *
   * Нисон (ЯС гл. 12): «Наиболее распространенными уровнями таких коррекций
   * являются 50%-ный, а также 38%-ный и 62%-ный». Коррекция измеряется от
   * КОНКРЕТНОГО направленного движения A→B (рис. 12.1–12.7), а не от
   * безымянного min/max окна:
   * - подъём low→high: коррекция вниз — поддержка на high − ratio×range;
   * - спад high→low: отскок вверх — сопротивление на low + ratio×range.
   *
   * Операционализация проекта (НЕ из книг): выбор пары A/B по свингам
   * findSwings за окно FIB_LOOKBACK (самый выраженный направленный импульс).
   * 23.6% и 78.6% из книжного источника УДАЛЕНЫ: в ЯС гл. 12 их нет (раньше
   * они шли с ложной атрибуцией «гл. 12»). Псевдоцитата в прежнем комментарии
   * («Нисон: "Уровни коррекции 38%, 50% и 62% часто выступают как зоны..."»)
   * заменена реальной цитатой выше.
   */
  private static addFibonacciLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams,
  ) {
    if (candles.length < 20) return;

    const impulse = findImpulse(candles, FIB_LOOKBACK, params.swingSpan);
    if (!impulse) return;

    const range = Math.abs(impulse.bLevel - impulse.aLevel);
    if (range <= 0) return;

    const lastTime = candles[candles.length - 1]?.time ?? 0;

    // Книжные уровни коррекции (ЯС гл. 12): 38%, 50%, 62%
    // (округления 38.2/61.8 допустимы).
    const fibLevels = [
      { ratio: 0.382, name: 'Фибоначчи 38.2%' },
      { ratio: 0.500, name: 'Фибоначчи 50%' },
      { ratio: 0.618, name: 'Фибоначчи 61.8%' },
    ];

    for (const fib of fibLevels) {
      const level = impulse.direction === 'up'
        ? impulse.aLevel + range * fib.ratio   // high − ratio×range, коррекция вниз
        : impulse.aLevel - range * fib.ratio;  // low + ratio×range, отскок вверх
      const reason = `${fib.name} (коррекция ${Math.round(fib.ratio * 100)}% ` +
        `движения ${impulse.direction === 'up' ? 'A→B вверх' : 'A→B вниз'}, ЯС гл. 12)`;

      if (impulse.direction === 'up') {
        addLevelToMap(supMap, level, reason, lastTime, params.tolerance, 1, { source: 'fibonacci', formedAt: lastTime });
      } else {
        addLevelToMap(resMap, level, reason, lastTime, params.tolerance, 1, { source: 'fibonacci', formedAt: lastTime });
      }
    }
  }

  /**
   * 8. Окна Нисона — кандидаты с книжной геометрией (задачи 2 и 5)
   * ЗГ гл. 3 / ЯС гл. 7: окно есть зона между экстремумами теней; прорыв —
   * только по закрытию (детекция — в gaps.ts, не трогаем). Границы окна
   * сохраняются как есть (book halfWidth); инвалидация по закрытию и
   * полярность — в applyBookZoneBreakAndPolarity. Минимальная ширина окна 1%
   * и лимит отображаемых окон — фильтры проекта (gaps.ts); для крипт окна
   * отключены настройкой проекта.
   */
  private static collectWindowCandidates(
    candles: Candle[],
    out: BookZoneCandidate[],
    market: ZoneMarket,
  ): void {
    for (const gap of detectGaps(candles, market)) {
      // Индекс открывающего бара восстанавливаем по времени (GapDTO.time —
      // время этого бара); проверка пробоя идёт только по барам ПОСЛЕ него —
      // зона строится по истории до момента теста (без look-ahead).
      const index = candles.findIndex((cd) => cd.time === gap.time);
      if (index < 0) continue;
      pushBookCandidate(out, {
        source: 'window',
        role: gap.direction === 'up' ? 'support' : 'resistance',
        lo: gap.bottom,
        hi: gap.top,
        index,
        formedAt: gap.time,
        reason: `окно ${gap.direction === 'up' ? 'вверх → поддержка' : 'вниз → сопротивление'} (ЯС гл. 7, ЗГ гл. 3)`,
      });
    }
  }

  /**
   * Преобразование Map в массив Zone
   * FIX: добавлено поле formedAt для учёта времени жизни зоны.
   *
   * Ширина зоны (задача 5): если источник задал КНИЖНУЮ halfWidth (окно —
   * половина диапазона теней, длинное тело — полоса «от середины до
   * основания/вершины»), она используется КАК ЕСТЬ: не расширяется ATR-полом
   * и не режется ATR-потолком (ATR в книгах нет — это проектная настройка).
   * ATR-пол/потолок применяются только к источникам без книжной геометрии
   * (свинг-кластеры, MA, круглые числа, fibonacci).
   */
  private static mapToZones(
    map: Map<number, ZoneClusterData>,
    halfWidthOf: (level: number) => number,
    candles: Candle[]
  ): Zone[] {
    const zones: Zone[] = [];
    const lastTime = candles[candles.length - 1]?.time ?? 0;

    for (const [level, data] of map.entries()) {
      const uniqueReasons = Array.from(new Set(data.reasons));
      const sources = Array.from(new Set(data.sources ?? []));
      const votes = sources.length || (uniqueReasons.length > 0 ? 1 : 0);
      const bookWidth = sources.some((s) => BOOK_GEOMETRY_SOURCES.has(s)) &&
        data.halfWidth !== undefined;
      zones.push({
        level,
        votes,
        strong: votes >= this.STRONG_ZONE_MIN_VOTES,
        reasons: uniqueReasons,
        sources,
        touches: data.touches,
        lastTouch: data.lastTouch,
        halfWidth: bookWidth ? data.halfWidth! : Math.max(halfWidthOf(level), data.halfWidth ?? 0),
        formedAt: data.formedAt ?? data.lastTouch ?? lastTime,
      });
    }

    return zones;
  }

  /**
   * Проверка близости к поддержке.
   */
  static isNearSupport(
    price: number,
    candles: Candle[],
    _tolerance: number = 0.015,
    tfKey: TimeframeKey = 'swing',
    wickLow?: number,
    market: ZoneMarket = 'crypto',
  ): boolean {
    const { support } = this.collect(price, candles, tfKey, market);
    return support.some(zone =>
      this.inBand(price, zone) ||
      (wickLow !== undefined &&
        wickLow <= zone.level + zone.halfWidth &&
        price >= zone.level - zone.halfWidth)
    );
  }

  /** Цена внутри ATR-полосы зоны [level ± halfWidth]. */
  private static inBand(price: number, zone: Zone): boolean {
    return price <= zone.level + zone.halfWidth && price >= zone.level - zone.halfWidth;
  }

  /**
   * Проверка близости к сопротивлению.
   */
  static isNearResistance(
    price: number,
    candles: Candle[],
    _tolerance: number = 0.015,
    tfKey: TimeframeKey = 'swing',
    wickHigh?: number,
    market: ZoneMarket = 'crypto',
  ): boolean {
    const { resistance } = this.collect(price, candles, tfKey, market);
    return resistance.some(zone =>
      this.inBand(price, zone) ||
      (wickHigh !== undefined &&
        wickHigh >= zone.level - zone.halfWidth &&
        price <= zone.level + zone.halfWidth)
    );
  }
}
