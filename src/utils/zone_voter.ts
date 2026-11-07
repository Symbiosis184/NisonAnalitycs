// Zone Voter - определение зон поддержки/сопротивления по методологии Стива Нисона
// Ключевые принципы:
// 1. Уровни - это ЗОНЫ, а не точные цены
// 2. Количество касаний определяет силу
// 3. Объём подтверждает значимость
// 4. Полярность: пробитое сопротивление становится поддержкой
// 5. Кластеризация близких уровней
// 6. Уровни Фибоначчи (гл. 12)

import { Candle } from './candle';
import { sma } from './indicators';
import { findSwings, addLevelToMap, dedupeZones, ZoneClusterData } from './levels';

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

  /**
   * Кэш результатов collect() для избежания повторных вычислений.
   * Ключ: `${candles.length}_${lastCandleTime}_${tfKey}`
   */
  private static collectCache = new Map<string, { support: Zone[]; resistance: Zone[] }>();
  private static readonly CACHE_MAX_SIZE = 10;

  /**
   * Сбор всех зон с голосованием.
   * FIX: добавлена мемоизация для производительности.
   */
  static collect(
    price: number,
    candles: Candle[],
    tfKey: TimeframeKey = 'swing'
  ): { support: Zone[]; resistance: Zone[] } {
    // Проверяем кэш
    const lastCandle = candles[candles.length - 1];
    const cacheKey = `${candles.length}_${lastCandle?.time ?? 0}_${tfKey}`;
    const cached = this.collectCache.get(cacheKey);
    if (cached) return cached;

    const params = ZONE_PARAMS[tfKey];
    const supMap = new Map<number, ZoneClusterData>();
    const resMap = new Map<number, ZoneClusterData>();

    // 1. Касательная классификация: уровень + число касаний ценой после его образования
    this.addTouchBasedLevels(price, candles, supMap, resMap, params);

    // 2. Полярность: пробитые уровни меняют роль
    this.addPolarityLevels(price, candles, supMap, resMap, params);

    // 3. Скользящие средние как динамические уровни
    this.addMALevels(price, candles, supMap, resMap, params.tolerance);

    // 4. Объёмные климасы (главы 15)
    this.addVolumeClimaxLevels(candles, supMap, resMap, params.tolerance);

    // 5. Середины длинных тел (глава 2)
    this.addLongBodyLevels(candles, supMap, resMap, params.tolerance);

    // 6. Психологические круглые числа
    this.addRoundNumbers(price, supMap, resMap, params.tolerance);

    // 7. Уровни Фибоначчи (глава 12)
    this.addFibonacciLevels(candles, supMap, resMap, params.tolerance);

    // Финальная транзитивная дедупликация
    dedupeZones(supMap, params.tolerance);
    dedupeZones(resMap, params.tolerance);

    // Ширина зоны привязана к волатильности ТФ (ATR)
    const atrWindow = candles.length > 74 ? candles.slice(-60) : candles;
    const atrVal = atrWilder(atrWindow, 14);
    const zoneHalfWidth = (level: number) =>
      Math.max(params.tolerance * level, atrVal * 0.25);

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
      z.touches >= minTouches || z.votes >= this.STRONG_ZONE_MIN_VOTES;

    const support = this.mapToZones(supMap, zoneHalfWidth, candles)
      .filter(z => z.level <= price)
      .filter(significant)
      .sort(significance)
      .slice(0, this.MAX_ZONES_PER_SIDE)
      .sort((a, b) => b.level - a.level);

    const resistance = this.mapToZones(resMap, zoneHalfWidth, candles)
      .filter(z => z.level >= price)
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
        for (const m of zone.members) {
          // FIX: проверяем касание по halfWidth, а не по проценту
          // Поддержка: low вошёл в зону [m - halfWidth, m + halfWidth] и close > m
          if (c.low <= m + halfWidth && c.low >= m - halfWidth && c.close > m) {
            supTouches++;
            lastSupTime = c.time;
          }
          // Сопротивление: high вошёл в зону и close < m
          if (c.high >= m - halfWidth && c.high <= m + halfWidth && c.close < m) {
            resTouches++;
            lastResTime = c.time;
          }
        }
      }

      const asSupport = supTouches > 0 && zone.level <= price;
      const asResistance = resTouches > 0 && zone.level >= price;

      if (asSupport) {
        addLevelToMap(supMap, zone.level, `свинг-зона: ${supTouches} касание(й) поддержки`, lastSupTime, tol, supTouches);
      }
      if (asResistance) {
        addLevelToMap(resMap, zone.level, `свинг-зона: ${resTouches} касание(й) сопротивления`, lastResTime, tol, resTouches);
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
      if (swing.type === 'high') {
        // Проверяем: был ли пробой вверх И возврат к уровню сверху
        const brokeUp = candles.slice(fromIdx).some(
          (c) => c.close > swing.level * (1 + BREAK_PCT)
        );
        // Возврат: цена была выше уровня и вернулась к нему
        const returnedToLevel = candles.slice(fromIdx).some(
          (c) => c.high >= swing.level * (1 - BREAK_PCT) && 
                 c.low <= swing.level * (1 + BREAK_PCT) &&
                 c.close > swing.level
        );
        
        if (brokeUp && returnedToLevel && last.close > swing.level) {
          addLevelToMap(supMap, swing.level, 'полярность: пробитое сопротивление → поддержка', last.time, params.tolerance);
        }
      } else {
        const brokeDown = candles.slice(fromIdx).some(
          (c) => c.close < swing.level * (1 - BREAK_PCT)
        );
        const returnedToLevel = candles.slice(fromIdx).some(
          (c) => c.low <= swing.level * (1 + BREAK_PCT) && 
                 c.high >= swing.level * (1 - BREAK_PCT) &&
                 c.close < swing.level
        );
        
        if (brokeDown && returnedToLevel && last.close < swing.level) {
          addLevelToMap(resMap, swing.level, 'полярность: пробитая поддержка → сопротивление', last.time, params.tolerance);
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
    const lastTime = candles[candles.length - 1]?.time ?? Date.now();

    for (const period of periods) {
      if (candles.length >= period) {
        const ma = sma(closes, period);
        const maVal = ma[ma.length - 1];
        if (Number.isNaN(maVal)) continue;

        if (maVal <= price) {
          addLevelToMap(supMap, maVal, `MA${period}`, lastTime, tolerance);
        } else {
          addLevelToMap(resMap, maVal, `MA${period}`, lastTime, tolerance);
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
          addLevelToMap(supMap, level, 'объёмный климакс (гл. 15)', c.time, tolerance);
        } else {
          addLevelToMap(resMap, level, 'объёмный климакс (гл. 15)', c.time, tolerance);
        }
      }
    }
  }

  /**
   * 5. Середины длинных тел
   */
  private static addLongBodyLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number
  ) {
    const lookback = Math.min(60, candles.length);
    const recent = candles.slice(-lookback);
    const avgBody = recent.reduce((sum, c) => sum + c.body, 0) / recent.length;

    for (const c of recent) {
      if (c.isLongCandle && c.body > avgBody * 1.5) {
        const mid = (c.open + c.close) / 2;

        if (c.isBullish) {
          addLevelToMap(supMap, mid, 'середина длинного белого тела (гл. 2)', c.time, tolerance);
          addLevelToMap(supMap, c.low, 'основание длинного белого тела (гл. 2)', c.time, tolerance);
        } else {
          addLevelToMap(resMap, mid, 'середина длинного чёрного тела (гл. 2)', c.time, tolerance);
          addLevelToMap(resMap, c.high, 'вершина длинного чёрного тела (гл. 2)', c.time, tolerance);
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
    tolerance: number
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
      addLevelToMap(supMap, lower, 'психологический уровень (круглое число)', Date.now(), tolerance);
    }
    if (upper - price <= proximityThreshold && upper > 0) {
      addLevelToMap(resMap, upper, 'психологический уровень (круглое число)', Date.now(), tolerance);
    }
  }

  /**
   * 7. Уровни Фибоначчи (ЯС гл. 12)
   * Нисон: "Уровни коррекции 38%, 50% и 62% часто выступают как зоны поддержки/сопротивления"
   */
  private static addFibonacciLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number
  ) {
    if (candles.length < 20) return;

    // Находим свинг-хай и свинг-лоу за последние 50 свечей
    const lookback = Math.min(50, candles.length);
    const recent = candles.slice(-lookback);
    
    const swingHigh = Math.max(...recent.map(c => c.high));
    const swingLow = Math.min(...recent.map(c => c.low));
    const range = swingHigh - swingLow;
    
    if (range <= 0) return;

    const lastTime = candles[candles.length - 1]?.time ?? Date.now();
    
    // Уровни коррекции Фибоначчи
    const fibLevels = [
      { ratio: 0.236, name: 'Фибоначчи 23.6%' },
      { ratio: 0.382, name: 'Фибоначчи 38.2%' },
      { ratio: 0.500, name: 'Фибоначчи 50%' },
      { ratio: 0.618, name: 'Фибоначчи 61.8%' },
      { ratio: 0.786, name: 'Фибоначчи 78.6%' },
    ];

    for (const fib of fibLevels) {
      const level = swingHigh - range * fib.ratio;
      const lastPrice = candles[candles.length - 1].close;
      
      // Добавляем как поддержку если ниже цены, как сопротивление если выше
      if (level <= lastPrice) {
        addLevelToMap(supMap, level, `${fib.name} (гл. 12)`, lastTime, tolerance);
      } else {
        addLevelToMap(resMap, level, `${fib.name} (гл. 12)`, lastTime, tolerance);
      }
    }
  }

  /**
   * Преобразование Map в массив Zone
   * FIX: добавлено поле formedAt для учёта времени жизни зоны.
   */
  private static mapToZones(
    map: Map<number, ZoneClusterData>,
    halfWidthOf: (level: number) => number,
    candles: Candle[]
  ): Zone[] {
    const zones: Zone[] = [];
    const lastTime = candles[candles.length - 1]?.time ?? Date.now();

    for (const [level, data] of map.entries()) {
      const uniqueReasons = Array.from(new Set(data.reasons));
      zones.push({
        level,
        votes: uniqueReasons.length,
        strong: uniqueReasons.length >= this.STRONG_ZONE_MIN_VOTES,
        reasons: uniqueReasons,
        touches: data.touches,
        lastTouch: data.lastTouch,
        halfWidth: halfWidthOf(level),
        formedAt: data.lastTouch ?? lastTime,
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
    wickLow?: number
  ): boolean {
    const { support } = this.collect(price, candles, tfKey);
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
    wickHigh?: number
  ): boolean {
    const { resistance } = this.collect(price, candles, tfKey);
    return resistance.some(zone =>
      this.inBand(price, zone) ||
      (wickHigh !== undefined &&
        wickHigh >= zone.level - zone.halfWidth &&
        price <= zone.level + zone.halfWidth)
    );
  }
}
