// Zone Voter — книжные ориентиры S/R плюс явно числовые эвристики проекта.
// Свинги, полярность, длинные тела и окна связаны с книгами; допуски, ATR-ширина,
// круглые числа, лимиты и баллы являются настройками реализации, а не цитатами.
// Ключевые принципы:
// 1. Уровни - это ЗОНЫ, а не точные цены
// 2. Количество касаний определяет силу
// 3. Объём подтверждает значимость
// 4. Полярность: пробитое сопротивление становится поддержкой
// 5. Кластеризация близких уровней
// 6. Уровни Фибоначчи (гл. 12)

import { Candle } from './candle';
import { sma } from './indicators';
import {
  findSwings, addLevelToMap, dedupeZones,
  type BookBandGeom, type BookBandRole, type ZoneClusterData, type ZoneSource,
} from './levels';
import { detectGaps } from './gaps';

export type ZoneMarket = 'stock' | 'crypto';

/**
 * Геометрия книжных зон: [lo … hi] вокруг level=середина, halfWidth=половина ширины.
 * Используется источниками с явной книжной геометрией (long-body, window).
 */
type BookBand = BookBandGeom;

/** Полоса зоны как [level ± halfWidth] с ролью по умолчанию 'support'. */
function bandOf(b: { level: number; halfWidth: number; role?: BookBandRole }): BookBand {
  return { lo: b.level - b.halfWidth, hi: b.level + b.halfWidth, role: b.role ?? 'support' };
}

/**
 * Источники с ЯВНОЙ книжной геометрией полосы (ЗГ гл. 2 — длинные тела,
 * ЗГ гл. 3 / ЯС гл. 7 — окна). Для них halfWidth НЕ расширяется ATR-полосой
 * проекта (см. mapToZones) и применяется инвалидация по закрытию за дальней
 * границей (см. closedBeyondFarEdge).
 */
const BOOK_GEOMETRY_SOURCES: ReadonlySet<ZoneSource> = new Set(['long-body', 'window']);

/** Есть ли у кластера источник с книжной геометрией. */
function hasBookGeometry(data: ZoneClusterData): boolean {
  return (data.sources ?? []).some((s) => BOOK_GEOMETRY_SOURCES.has(s));
}

/**
 * Инвалидация книжной зоны по ЗАКРЫТИЮ (ЗГ гл. 2): «прорывы этих зон поддержки
 * могут происходить неоднократно в течение сессии, но пока цены закрытия
 * держатся выше поддержки, она остается в силе». То есть зона жива, пока нет
 * закрытия за ДАЛЬНЕЙ границей полосы: поддержка пробивается закрытием ниже
 * нижней границы, сопротивление — закрытием выше верхней.
 * Настройка проекта: порог breakPct (книга числового порога не задаёт).
 */
function closedBeyondFarEdge(
  candles: Candle[],
  fromIdx: number,
  band: BookBand,
  role: 'support' | 'resistance',
  breakPct: number,
): boolean {
  for (let i = Math.max(0, fromIdx); i < candles.length; i++) {
    const c = candles[i];
    if (role === 'support' && c.close < band.lo * (1 - breakPct)) return true;
    if (role === 'resistance' && c.close > band.hi * (1 + breakPct)) return true;
  }
  return false;
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
   * Для источников с явной книжной геометрией (long-body, window) halfWidth равна
   * половине высоты книги-полосы и НЕ расширяется ATR-допуском проекта (см. задачу 5).
   * Для остальных источников halfWidth = max(толеранс ТФ × level, 0.25×ATR(14))
   * с потолком 2×ATR — это проектная эвристика, в книгах такого числа нет.
   */
  halfWidth: number;
  /** Время формирования зоны (для учёта "свежести"). */
  formedAt: number;
  /**
   * Внутреннее поле: явная книжная полоса [lo … hi] с ролью (long-body/window).
   * Используется для маршрутизации по пробитию/полярности в collect().
   */
  bookBand?: BookBandGeom & { startCheckIndex?: number };
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

    // Ширина зоны привязана к волатильности ТФ (ATR). Вычисляется ДО источников,
    // чтобы свинг-зоны (addTouchBasedLevels) использовали ту же проекную ATR-полосу,
    // что и финальная карта halfWidth в mapToZones (задача 5).
    const atrWindow = candles.length > 74 ? candles.slice(-60) : candles;
    const atrVal = atrWilder(atrWindow, 14);
    const zoneHalfWidth = (level: number) => {
      const base = Math.max(params.tolerance * level, atrVal * 0.25);
      return atrVal > 0 ? Math.min(base, atrVal * 2) : base;
    };

    // 1. Касательная классификация: уровень + число касаний ценой после его образования
    this.addTouchBasedLevels(price, candles, supMap, resMap, params, zoneHalfWidth);

    // 2. Полярность: пробитые уровни меняют роль
    this.addPolarityLevels(price, candles, supMap, resMap, params);

    // 3. Скользящие средние как динамические уровни
    this.addMALevels(price, candles, supMap, resMap, params.tolerance);

    // 4. Объёмные климасы (главы 15)
    this.addVolumeClimaxLevels(candles, supMap, resMap, params.tolerance);

    // 5. Длинное тело — одна зона [середина … основание/вершина свечи] (ЗГ гл. 2)
    this.addLongBodyLevels(candles, supMap, resMap, params);

    // 6. Психологические круглые числа
    this.addRoundNumbers(price, supMap, resMap, params.tolerance, lastCandle?.time ?? 0);

    // 7. Уровни Фибоначчи (гл. 12)
    this.addFibonacciLevels(candles, supMap, resMap, params);

    // 8. Нисон: окно — будущая зона поддержки/сопротивления. Сохраняем его
    // фактические границы; закрытие за дальней границей отменяет сценарий.
    this.addWindowLevels(candles, supMap, resMap, params.tolerance, market);

    // Финальная транзитивная дедупликация
    dedupeZones(supMap, params.tolerance);
    dedupeZones(resMap, params.tolerance);

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

    const lastClose = lastCandle?.close ?? price;

    // ЗАДАЧА 2/3: книжные полосы (long-body/window) маршрутизируются по СВОЕЙ
    // роли и статусу пробоя по закрытию, а не по позиции live-цены относительно
    // средней линии. Не пробитые → в свою корзину; пробитые → НЕ удаляются, а
    // передаются в ПОЛЯРНЫЙ МЕХАНИЗМ (ЯС гл. 11: «прежняя поддержка становится
    // сопротивлением и наоборот») — строго та же хронология «пробой по закрытию
    // → возврат → удержание», что и в addPolarityLevels для свингов (образцовая).
    const bookSupRaw = this.mapToZones(supMap, zoneHalfWidth, candles, true);
    const bookResRaw = this.mapToZones(resMap, zoneHalfWidth, candles, true);
    const nonBookSup = this.mapToZones(supMap, zoneHalfWidth, candles, false);
    const nonBookRes = this.mapToZones(resMap, zoneHalfWidth, candles, false);

    /**
     * Хронология полярности для книжной полосы: после индекса пробоя нужен
     * возврат к полосе и удержание её с той стороны (для пробитой поддержки —
     * цена сверху: high касается зоны, close остаётся выше дальней границы;
     * зеркально для сопротивления). lastClose также должен быть за полосой.
     */
    const polarityReturnHeld = (
      band: BookBand, breakIdx: number, polRole: 'support' | 'resistance',
    ): boolean => {
      if (lastCandle === undefined) return false;
      for (let i = breakIdx + 1; i < candles.length; i++) {
        const c = candles[i];
        if (polRole === 'support') {
          if (c.high >= band.lo && c.low <= band.hi && c.close > band.hi) return true;
        } else {
          if (c.high >= band.lo && c.low <= band.hi && c.close < band.lo) return true;
        }
      }
      return false;
    };

    const routeBookZones = (
      raw: Zone[], origRole: 'support' | 'resistance',
      alive: Zone[], flipped: Zone[],
    ) => {
      for (const z of raw) {
        if (!z.bookBand) continue;
        const { startCheckIndex, ...band } = z.bookBand;
        // Индекс ПЕРВОГО закрытия за дальней границей (чтобы требовать
        // возврата именно ПОСЛЕ пробоя):
        let breakIdx = -1;
        for (let i = Math.max(0, startCheckIndex ?? 0); i < candles.length; i++) {
          const c = candles[i];
          if (origRole === 'support' && c.close < band.lo * (1 - params.breakPct)) { breakIdx = i; break; }
          if (origRole === 'resistance' && c.close > band.hi * (1 + params.breakPct)) { breakIdx = i; break; }
        }
        if (breakIdx < 0) { alive.push(z); continue; }
        const polRole: 'support' | 'resistance' = origRole === 'support' ? 'resistance' : 'support';
        if (polarityReturnHeld(band, breakIdx, polRole)) {
          flipped.push({
            ...z,
            reasons: [...z.reasons, `полярность: книжная полоса ${origRole === 'support' ? 'поддержки' : 'сопротивления'} пробита по закрытию → ${polRole === 'support' ? 'поддержка' : 'сопротивление'} (ЯС гл. 11)`],
          });
        }
        // Пробита, но возврата/удержания ещё не было — зона не выдаётся
        // ни в одной роли (зоны addPolarityLevels её ещё не «поймали»).
      }
    };

    const bookSupportAlive: Zone[] = [];
    const bookResistanceAlive: Zone[] = [];
    routeBookZones(bookSupRaw, 'support', bookSupportAlive, bookResistanceAlive);
    routeBookZones(bookResRaw, 'resistance', bookResistanceAlive, bookSupportAlive);

    // ЗАДАЧА 3: для НЕкнижных зон роль остаётся корзиной источника + позиция
    // последней ЗАКРЫТОЙ цены относительно полосы (не live-price из аргумента).
    const inOwnRole = (z: Zone, role: BookBandRole): boolean => {
      if (!z.bookBand) {
        // Без явной книги: если средняя линии внутри ATR-полосы, оставляем зону
        // в своей корзине; иначе она должна быть по ту сторону последней закрытой цены.
        const bandLo = z.level - z.halfWidth;
        const bandHi = z.level + z.halfWidth;
        if (lastClose >= bandLo && lastClose <= bandHi) return true;
        return role === 'support' ? z.level <= lastClose : z.level >= lastClose;
      }
      return true;
    };

    const allSupport = [
      ...bookSupportAlive,
      ...nonBookSup.filter((z) => inOwnRole(z, 'support')),
    ];
    const allResistance = [
      ...bookResistanceAlive,
      ...nonBookRes.filter((z) => inOwnRole(z, 'resistance')),
    ];

    const support = allSupport
      .filter(significant)
      .sort(significance)
      .slice(0, this.MAX_ZONES_PER_SIDE)
      .sort((a, b) => b.level - a.level);

    const resistance = allResistance
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
   * ЗАДАЧА 4 (ЗГ гл. 2): «прорывы этих зон поддержки могут происходить
   * неоднократно в течение сессии, но пока цены закрытия держатся выше
   * поддержки, она остается в силе» — то есть глубокий внутрисессионный прокол
   * с удержанием закрытием остаётся ТЕСТОМ зоны. Поэтому касание поддержки =
   * нижняя граница диапазона свечи вошла в полосу/проколола её сверху
   * (c.low <= zoneTop) И закрытие осталось не ниже основания полосы
   * (c.close >= zoneBottom); зеркально для сопротивления. Правило «одна
   * закрытая свеча — не более одного касания» сохранено.
   */
  private static addTouchBasedLevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams,
    zoneHalfWidth: (level: number) => number,
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

    // Ширина зоны для проверки касаний — та же проекная ATR-полоса, что и в
    // mapToZones (задача 5), но с учётом ширины кластера: раньше использовалось
    // `Math.max(tol * price, atrVal * 0.25)` — глобальная ширина по цене без
    // потолка 2×ATR и без зависимости от ТФ, из-за чего на scalp широкие
    // кластеры давали завышенную halfWidth.
    // Проектное решение: полоса касаний = ATR-полоса центра кластера, расширенная
    // до покрытия всех членов (кластер может быть шире одной ATR-полосы; тест
    // любого члена считается тестом зоны).
    for (const zone of zoneDefs) {
      const hwCenter = zoneHalfWidth(zone.level);
      const spread = Math.max(...zone.members.map((m) => Math.abs(m - zone.level)));
      const halfWidth = hwCenter + spread;
      let supTouches = 0;
      let resTouches = 0;
      let lastSupTime = 0;
      let lastResTime = 0;

      for (let j = zone.firstIndex + 1; j < candles.length; j++) {
        const c = candles[j];
        // Одна закрытая свеча — не больше одного касания зоны. При нескольких
        // близких членах кластера старый вложенный цикл считал один тест 2–3 раза.
        // ЗАДАЧА 4: тест поддержки — low вошёл в зону или проколол её снизу вверх
        // при закрытии НЕ НИЖЕ основания полосы (глубокий прокол с восстановлением
        // — это тоже тест, ЗГ гл. 2).
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
   * 5. Длинное тело — ОДНА зона, а не две точки (ЗГ гл. 2, рис. 2.11).
   * Цитата: «Откат цен должен встретить поддержку либо на уровне середины
   * длинного белого тела, либо в основании всей белой свечи, включая и нижнюю
   * тень». Глоссарий ЗГ: поддержка «от середины до основания белой свечи
   * (включая и минимум нижней тени)»; для чёрной — сопротивление «от середины
   * до вершины свечи (включая верхнюю тень)».
   * Поэтому белая свеча даёт одну зону [c.low … mid], чёрная — [mid … c.high]
   * (по образцу addWindowLevels: level=середина полосы, halfWidth=её полуширина).
   * Книжный критерий «длинного тела» (ЗГ гл. 2): тело >= 3x тела ПРЕДЫДУЩЕЙ свечи.
   */
  private static addLongBodyLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams
  ) {
    const lookback = Math.min(params.lookback, candles.length);
    const startIdx = candles.length - lookback;
    const recent = candles.slice(startIdx);
    // Проектное отклонение: дополнительный числовой фильтр body > 1.5*avgBody(60)
    // книжным не является (в книгах среднего тела за 60 баров нет).
    const avgBody = recent.reduce((sum, c) => sum + c.body, 0) / recent.length;

    for (let i = 0; i < recent.length; i++) {
      const c = recent[i];
      const globalIdx = startIdx + i;
      const prev = candles[globalIdx - 1];
      // Инженерная защита (не из книг): без предыдущей свечи или при нулевом её
      // теле отношение к «телу предыдущей» не определено — зону не формируем.
      if (!prev || !(prev.body > 0)) continue;
      // Книжный критерий ЗГ гл. 2: тело >= 3x тела предыдущей свечи.
      const isLongByBook = c.body >= 3 * prev.body;
      // Проектный дополнительный фильтр (помечен выше): сохранён как эвристика,
      // из книжного критерия убран (книга avgBody не упоминает).
      if (isLongByBook && c.isLongCandle && c.body > avgBody * 1.5) {
        const mid = (c.open + c.close) / 2;

        // Индекс бара, СЛЕДУЮЩЕГО за длинной свечой: с него считается пробой
        // по закрытию (задача 2, ЗГ гл. 2 — «пока цены закрытия держатся выше
        // поддержки, она остается в силе»).
        const startCheckIndex = globalIdx + 1;
        if (c.isBullish) {
          // Книжная полоса [c.low … mid] с ролью «поддержка» — задаётся ИСТОЧНИКОМ,
          // а не позицией цены (задача 3). Метка исправлена: раньше было
          // «основание длинного белого тела», но код (и книга) используют c.low —
          // ВЕСЬ диапазон свечи с нижней тенью.
          const lo = c.low, hi = mid;
          addLevelToMap(
            supMap, (lo + hi) / 2,
            'зона длинного белого тела: от середины до основания свечи, включая нижнюю тень (ЗГ гл. 2, рис. 2.11)',
            c.time, params.tolerance, 1,
            {
              source: 'long-body', halfWidth: (hi - lo) / 2, formedAt: c.time,
              startCheckIndex, bookBand: { lo, hi, role: 'support' },
              // Проектное решение: книжная полоса длинного тела не сливается со
              // свинг-кластерами — иначе её геометрия [low…mid] теряется.
              keepSeparate: true,
            },
          );
        } else {
          // Аналогично: «вершина длинного чёрного тела» → вершина свечи с верхней тенью.
          const lo = mid, hi = c.high;
          addLevelToMap(
            resMap, (lo + hi) / 2,
            'зона длинного чёрного тела: от середины до вершины свечи, включая верхнюю тень (ЗГ гл. 2, рис. 2.11)',
            c.time, params.tolerance, 1,
            {
              source: 'long-body', halfWidth: (hi - lo) / 2, formedAt: c.time,
              startCheckIndex, bookBand: { lo, hi, role: 'resistance' },
              keepSeparate: true,
            },
          );
        }
      }
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
   * 7. Уровни Фибоначчи — строго ЯС гл. 12 (задача 6).
   * Книга: «Наиболее распространенными уровнями таких коррекций являются
   * 50%-ный, а также 38%-ный и 62%-ный»; коррекция измеряется от КОНКРЕТНОГО
   * движения A→B (рис. 12.1–12.7), а не от безымянного min/max окна.
   * Подъём low→high → коррекция вниз = поддержка на low + ratio×range;
   * спад high→low → отскок вверх = сопротивление на той же формуле
   * low + ratio×range (отсчёт от основания импульса).
   * Операционализация (пометить): пара A/B выбирается по последним двум
   * свингам findSwings за lookback — в книге способ поиска пары не формализован.
   * 23.6% и 78.6% удалены: в ЯС гл. 12 их нет (раньше ошибочно числились
   * книжными). Прежняя псевдоцитата заменена реальной цитатой выше.
   */
  private static addFibonacciLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams,
  ) {
    if (candles.length < 20) return;

    // Книжные уровни коррекции: только 38/50/62% (округления 38.2/61.8 допустимы).
    const fibRatios = [0.382, 0.5, 0.618];

    // Операционализация (не из книг): последние два экстремума свинг-детектора.
    const swings = findSwings(candles, Math.min(params.lookback, candles.length), params.swingSpan);
    if (swings.length < 2) return;
    const a = swings[swings.length - 2];
    const b = swings[swings.length - 1];
    if (a.type === b.type) return; // нужен направленный импульс low→high или high→low

    const isUpImpulse = a.type === 'low' && b.type === 'high';
    const impulseLow = Math.min(a.level, b.level);
    const impulseHigh = Math.max(a.level, b.level);
    const range = impulseHigh - impulseLow;
    if (!(range > 0)) return;

    const lastTime = candles[candles.length - 1]?.time ?? 0;
    const dirTag = isUpImpulse ? 'подъём' : 'спад';

    for (const ratio of fibRatios) {
      const pctLabel = `${Math.round(ratio * 100)}%`;
      // Коррекция всегда измеряется от основания импульса: при подъёме —
      // глубина коррекции вниз, при спаде — высота отскока вверх.
      const level = impulseLow + range * ratio;
      const reason = `Фибо ${pctLabel} коррекции импульса ${dirTag} ${impulseLow.toFixed(2)}\u2192${impulseHigh.toFixed(2)} (ЯС гл. 12)`;
      if (isUpImpulse) {
        // Подъём A→B: коррекция вниз встречает поддержку на уровнях ретрейса.
        addLevelToMap(supMap, level, reason, lastTime, params.tolerance, 1, { source: 'fibonacci', formedAt: lastTime });
      } else {
        // Спад A→B: отскок вверх встречает сопротивление на уровнях ретрейса.
        addLevelToMap(resMap, level, reason, lastTime, params.tolerance, 1, { source: 'fibonacci', formedAt: lastTime });
      }
    }
  }

  /** Активные окна: вверх — поддержка, вниз — сопротивление (гл. 7 ЯС). */
  private static addWindowLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number,
    market: ZoneMarket,
  ): void {
    for (const gap of detectGaps(candles, market)) {
      if (gap.broken) continue;
      const level = (gap.bottom + gap.top) / 2;
      const halfWidth = (gap.top - gap.bottom) / 2;
      const isUp = gap.direction === 'up';
      const target = isUp ? supMap : resMap;
      // Задача 2: книжная полоса окна [bottom … top] с ролью по направлению
      // (вверх → поддержка, вниз → сопротивление; ЯС гл. 7). startCheckIndex —
      // бар, следующий за открывшим гэп (candle.time == gap.time), с него
      // считается подтверждённый пробой (закрытие за дальней границей).
      const startCheckIdx = candles.findIndex((c) => c.time === gap.time);
      addLevelToMap(
        target,
        level,
        `окно ${isUp ? 'вверх → поддержка' : 'вниз → сопротивление'}${gap.filled ? ' (заполнено, не пробито)' : ''}`,
        gap.time,
        tolerance,
        1,
        {
          source: 'window', halfWidth, formedAt: gap.time,
          startCheckIndex: startCheckIdx >= 0 ? startCheckIdx + 1 : 0,
          bookBand: { lo: gap.bottom, hi: gap.top, role: isUp ? 'support' : 'resistance' },
        },
      );
    }
  }

  /**
   * Преобразование Map в массив Zone
   * FIX: добавлено поле formedAt для учёта времени жизни зоны.
   */
  private static mapToZones(
    map: Map<number, ZoneClusterData>,
    halfWidthOf: (level: number) => number,
    candles: Candle[],
    bookOnly: boolean,
  ): Zone[] {
    const zones: Zone[] = [];
    const lastTime = candles[candles.length - 1]?.time ?? 0;

    for (const [level, data] of map.entries()) {
      const hasBook = data.bookBand !== undefined;
      if (hasBook !== bookOnly) continue;
      const uniqueReasons = Array.from(new Set(data.reasons));
      const sources = Array.from(new Set(data.sources ?? []));
      const votes = sources.length || (uniqueReasons.length > 0 ? 1 : 0);
      // ЗАДАЧА 5: если источник задал книжную геометрию полосы (window/long-body),
      // halfWidth берётся из неё как есть; ATR-пол/потолок применяются только к
      // источникам без явной книги (swing-кластеры, MA, круглые числа, fib).
      const halfWidth = hasBook && data.halfWidth !== undefined
        ? data.halfWidth
        : Math.max(halfWidthOf(level), data.halfWidth ?? 0);
      zones.push({
        level,
        votes,
        strong: votes >= this.STRONG_ZONE_MIN_VOTES,
        reasons: uniqueReasons,
        sources,
        touches: data.touches,
        lastTouch: data.lastTouch,
        halfWidth,
        formedAt: data.formedAt ?? data.lastTouch ?? lastTime,
        bookBand: data.bookBand
          ? { ...data.bookBand, startCheckIndex: data.startCheckIndex }
          : undefined,
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
