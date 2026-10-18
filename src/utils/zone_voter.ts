// Zone Voter - определение зон поддержки/сопротивления по методологии Стива Нисона
// Ключевые принципы:
// 1. Уровни - это ЗОНЫ, а не точные цены
// 2. Количество касаний определяет силу
// 3. Объём подтверждает значимость
// 4. Полярность: пробитое сопротивление становится поддержкой
// 5. Кластеризация близких уровней

import { Candle } from './candle';
import { ema } from './indicators';
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
}

/** Ключ временнóго масштаба для кэша результатов collect (см. timeframeKey). */
export type TimeframeKey = 'scalp' | 'intraday' | 'swing' | 'position';

/**
 * Группировка интервалов Bybit по временнóму масштабу. Нужна потому, что
 * параметры зон (толеранс кластеризации, порог подтверждения пробоя) должны
 * различаться на разных ТФ: фиксированные 0.5% корректны для дневного графика,
 * но на 5-минутке шумят, а на недельном — слишком мелки.
 */
export function timeframeKey(tf: string): TimeframeKey {
  const t = tf.trim().toUpperCase();
  if (['1', '3', '5', '15'].includes(t)) return 'scalp';
  if (['30', '60', '1H', '2H', '4H'].includes(t)) return 'intraday';
  if (['D', '1D'].includes(t)) return 'swing';
  // Формы с минутным/часовым суффиксом в нижнем регистре ('15m', '1h', '4h')
  if (/^(1|3|5|15)(M|min)?$/.test(t)) return 'scalp';
  if (/^(30|60|1|2|4)(H|h)$/.test(t) || ['30M', '60M'].includes(t)) return 'intraday';
  return 'position'; // W и всё нестандартное
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
  // Толеранс по умолчанию (дневной ТФ, историческая совместимость): зоны в пределах
  // 0.5% считаются одной зоной. Для других ТФ передавайте timeframeKey в collect().
  private static readonly CLUSTER_TOLERANCE = 0.005;

  // Минимум голосов для сильной зоны
  private static readonly STRONG_ZONE_MIN_VOTES = 3;

  /**
   * Сбор всех зон с голосованием.
   * FIX аудита №1: уровни классифицируются как поддержка/сопротивление ОТНОСИТЕЛЬНО
   * каждой последующей свечи (касание), а не по положение относительно текущей цены.
   * Это даёт реальные касания (touches) вместо «все свинги ниже цены = поддержка».
   * @param timeframeKey — временнóй масштаб (см. timeframeKey): подбирает толеранс
   *   кластеризации и порог подтверждения пробоя под ТФ. По умолчанию — дневной.
   */
  static collect(
    price: number,
    candles: Candle[],
    tfKey: TimeframeKey = 'swing'
  ): { support: Zone[]; resistance: Zone[] } {
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

    // FIX аудита №1: финальная транзитивная дедупликация — разные источники
    // (MA, климакс, середины тел, круглые числа) могли оставить «половины»
    // одной зоны; до mapToZones сливаем их в единый уровень.
    dedupeZones(supMap, params.tolerance);
    dedupeZones(resMap, params.tolerance);

    // Ширина зоны привязана к волатильности ТФ (ATR): толеранс кластеризации,
    // но не уже 0.25×ATR и не шире 2×ATR (Нисон: уровень — это ЗОНА).
    // FIX канона (гл. 11): ATR считается по ПОСЛЕДНИМ ~60 свечам окна анализа,
    // а не по всей истории. При резкой смене волатильности (затишье → импульс)
    // исторический Wilder-ATR остаётся заниженным, зона получается тоньше своих
    // же касаний — формация у уровня переставала считаться «у поддержки» и
    // молот/звезда терялись на графике.
    const atrWindow = candles.length > 74 ? candles.slice(-60) : candles;
    const atrVal = atrWilder(atrWindow, 14);
    // FIX канона (гл. 11): ширина зоны — СВОЙСТВО УРОВНЯ, а не глобальная
    // константа текущего момента. Прежняя halfWidthBase применялась ко всем
    // зонам сразу: далеко стоящая зона получала полосу из сегодняшнего ATR,
    // и проверка «цена внутри полосы» давала ложные касания (молот «видел»
    // поддержку там, где её не было). Канон: зона = [уровень ± max(толеранс
    // кластеризации, 0.25×ATR)], т.е. полоса покрывает разброс составляющих
    // зону цен и шум вокруг уровня, но не растягивается на весь ATR-диапазон.
    const zoneHalfWidth = (level: number) =>
      Math.max(params.tolerance * level, atrVal * 0.25);

    // FIX канон-аудита (гл. 11): роль уровня определяется его ПОЗИЦИЕЙ ОТНОСИТЕЛЬНО
    // ТЕКУЩЕЙ ЦЕНЫ, а не тем, из какой карты он собран. Пробитое сопротивление
    // (полярность) живёт в supMap на уровне НИЖЕ цены — корректно; но свинг-хай
    // над ценой мог попасть в «поддержку» (если цена касалась его снизу какSupport
    // ложно срабатывал при level≈price), а круглое число ниже цены — в
    // «сопротивление». Финальная инварианта: поддержка ≤ цена ≤ сопротивление.
    const support = this.mapToZones(supMap, zoneHalfWidth)
      .filter(z => z.level <= price)
      .sort((a, b) => b.level - a.level); // Ближайшие к цене — первыми

    const resistance = this.mapToZones(resMap, zoneHalfWidth)
      .filter(z => z.level >= price)
      .sort((a, b) => a.level - b.level); // Ближайшие к цене — первыми

    return { support, resistance };
  }

  /** Wilder ATR(14) по закрытым свечам; 0 при нехватке данных. */
  private static atr(candles: Candle[], period = 14): number {
    return atrWilder(candles, period);
  }

  /**
   * 1+2. Касательная классификация свинг-уровней (FIX аудита №1/№2).
   * По Нисону уровень — это ЗОНА, многократно оттестированная ценой. Поэтому:
   *  • берём свинги из единого детектора levels.ts;
   *  • для каждого уровня смотрим только свечи ПОСЛЕ его образования (без lookahead);
   *  • касание поддержки: low <= zone*(1+tol) и close > zone (цена отскочила снизу вверх);
   *  • касание сопротивления: high >= zone*(1-tol) и close < zone (отбой сверху вниз);
   *  • если зона была пробита ЗАКРЫТИЕМ (≥0.3% за уровнем) — срабатывает полярность
   *    (гл. 11): пробитое сопротивление становится поддержкой и наоборот.
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

    // Сначала группируем свинги в зоны (кластеризация), помня самый ранний индекс
    // и ВСЕ составляющие цены каждой зоны. В одну зону сливаются и свинг-минимумы,
    // и свинг-максимумы: касания считаются отдельно для каждой ценой составляющей
    // (иначе зона из уровней 89.0 и 89.4 теряла бы касания к более высокому краю).
    const zoneDefs: Array<{ level: number; firstIndex: number; members: number[] }> = [];
    for (const swing of findSwings(candles, lookback, params.swingSpan)) {
      const hit = zoneDefs.find((z) =>
        z.members.some((m) => Math.abs(swing.level - m) / m <= tol));
      if (hit) {
        hit.firstIndex = Math.min(hit.firstIndex, swing.index);
        if (!hit.members.includes(swing.level)) hit.members.push(swing.level);
      } else {
        zoneDefs.push({ level: swing.level, firstIndex: swing.index, members: [swing.level] });
      }
    }

    for (const zone of zoneDefs) {
      let supTouches = 0;
      let resTouches = 0;
      let lastSupTime = 0;
      let lastResTime = 0;

      for (let j = zone.firstIndex + 1; j < candles.length; j++) {
        const c = candles[j];
        for (const m of zone.members) {
          // Поддержка: коснулась края зоны и закрылась ВЫШЕ него
          if (c.low <= m * (1 + tol) && c.close > m) {
            supTouches++;
            lastSupTime = c.time;
          }
          // Сопротивление: коснулась края зоны и закрылась НИЖЕ него
          // (проверяется независимо — свеча может дать оба сигнала на разных участках)
          if (c.high >= m * (1 - tol) && c.close < m) {
            resTouches++;
            lastResTime = c.time;
          }
        }
      }

      // Уровни без касаний после образования не голосуются (Нисон: уровень
      // значим ровно настолько, насколько его тестировала цена).
      // FIX канон-аудита: роль зоны определяется ПОЗИЦИЕЙ ОТНОСИТЕЛЬНО ЦЕНЫ, а не
      // счётчиком касаний. По Нисону (гл. 11) уровень НИЖЕ цены — это поддержка,
      // ВЫШЕ — сопротивление; «смена полярности» происходит только через ПРОБОЙ
      // закрытием (addPolarityLevels), а не потому что касаний-отбоев было больше.
      // Прежнее условие (supTouches > resTouches без проверки цены) могло показать
      // «поддержку» НАД ценой и исказить голосование источников в кластере.
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
   * По Нисону (глава 11): "Пробитое сопротивление становится поддержкой".
   * FIX аудита №2: пробой подтверждается ЗАКРЫТИЕМ свечи за уровнем (≥0.3%),
   * а не тенью/мигом; учитывается только закрытие последней свечи против зоны.
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
    // Порог подтверждения пробоя закрытием — под ТФ (см. ZONE_PARAMS)
    const BREAK_PCT = params.breakPct;

    for (const swing of swings) {
      // Индекс свинга +2 — минимум подтверждений экстремума; проверяем закрытия после него
      const fromIdx = Math.max(swing.index + 1, candles.length - 40);
      if (swing.type === 'high') {
        const brokeUp = candles.slice(fromIdx).some(
          (c) => c.close > swing.level * (1 + BREAK_PCT) && last.close > swing.level * (1 + BREAK_PCT)
        );
        if (brokeUp && last.close > swing.level) {
          // Пробитое сопротивление -> поддержка (только если цена УВЕРЕННО выше)
          addLevelToMap(supMap, swing.level, 'полярность: пробитое сопротивление → поддержка', last.time, params.tolerance);
        }
      } else {
        const brokeDown = candles.slice(fromIdx).some(
          (c) => c.close < swing.level * (1 - BREAK_PCT) && last.close < swing.level * (1 - BREAK_PCT)
        );
        if (brokeDown && last.close < swing.level) {
          addLevelToMap(resMap, swing.level, 'полярность: пробитая поддержка → сопротивление', last.time, params.tolerance);
        }
      }
    }
  }

  /**
   * 3. Скользящие средние как динамические уровни
   * По Нисону (глава 13): MA50, MA65, MA200 - важные уровни
   */
  private static addMALevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    tolerance: number
  ) {
    const closes = candles.map(c => c.close);
    const periods = [50, 65, 200];

    for (const period of periods) {
      if (candles.length >= period) {
        const ma = ema(closes, period);
        const maVal = ma[ma.length - 1];
        const lastTime = candles[candles.length - 1].time;

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
   * По Нисону (глава 15): свечи с экстремальным объёмом создают уровни
   */
  private static addVolumeClimaxLevels(
    candles: Candle[],
    supMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    tolerance: number
  ) {
    const lookback = Math.min(60, candles.length);
    const recent = candles.slice(-lookback);

    // Считаем средний объём
    const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;

    for (const c of recent) {
      // Кульминационный объём (>2x среднего)
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
   * По Нисону (глава 2): середины длинных свечей - важные уровни
   */
  private static addLongBodyLevels(
    candles: Candle[],
    supMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    tolerance: number
  ) {
    const lookback = Math.min(60, candles.length);
    const recent = candles.slice(-lookback);

    // Средний размер тела
    const avgBody = recent.reduce((sum, c) => sum + c.body, 0) / recent.length;

    for (const c of recent) {
      // Длинная свеча (>1.5x среднего)
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
   * По Нисону: круглые числа часто выступают как уровни
   */
  private static addRoundNumbers(
    price: number,
    supMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    tolerance: number
  ) {
    // Определяем шаг для круглых чисел в зависимости от цены
    let step: number;
    if (price >= 10000) step = 1000;
    else if (price >= 1000) step = 100;
    else if (price >= 100) step = 10;
    else if (price >= 10) step = 1;
    else if (price >= 1) step = 0.1;
    else step = 0.01;

    // Ближайшие круглые числа.
    // FIX канона (гл. 11): психологический уровень значим, когда к нему ПОДХОДИТ
    // цена — раньше он добавлялся «вслепую» на весь шаг (±10 пунктов при цене ~100),
    // и такой фантом перекрывал голосование РЕАЛЬНЫХ протестированных зон:
    // молот у поддержки 97 не детектировался, потому что единственной «поддержкой»
    // числилось круглое число 99. Теперь: только если close в пределах шага от
    // уровня (уровень актуален прямо сейчас).
    const lower = Math.floor(price / step) * step;
    const upper = Math.ceil(price / step) * step;

    if (price - lower <= step) {
      addLevelToMap(supMap, lower, 'психологический уровень (круглое число)', Date.now(), tolerance);
    }
    if (upper - price <= step) {
      addLevelToMap(resMap, upper, 'психологический уровень (круглое число)', Date.now(), tolerance);
    }
  }

  /**
   * Преобразование Map в массив Zone
   */
  private static mapToZones(
    map: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    halfWidthOf: (level: number) => number
  ): Zone[] {
    const zones: Zone[] = [];

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
      });
    }

    return zones;
  }

  /**
   * Проверка близости к поддержке.
   * FIX ТФ-аудита: раньше метод всегда собирал зоны с дневными параметрами,
   * из-за чего на внутридневных графиках фильтр «у поддержки» использовал
   * неверный толеранс. Теперь масштаб передаётся через timeframeKey.
   */
  static isNearSupport(
    price: number,
    candles: Candle[],
    _tolerance: number = 0.015,
    tfKey: TimeframeKey = 'swing',
    wickLow?: number
  ): boolean {
    // FIX канон-аудита: раньше порог был max(tol*price, halfWidth) — на дневном
    // ТФ это 1.5% от цены, т.е. свеча попадала «у поддержки», находясь на
    // расстоянии полутора ПРОЦЕНТОВ от зоны, которая по Нисону и так не шире
    // ATR. Канон (гл. 11): уровень — это ЗОНА [level − halfWidth … level + halfWidth];
    // «у поддержки» = ЦЕНА ВНУТРИ полосы.
    // FIX (wick-касания): разрыв между зоной и close молота/звезды — это ровно
    // ТЕНЬ свечи. По Нисону формация тестирует уровень именно тенью: если передан
    // low последней свечи, считается касанием, когда тень вошла в зону (с допуском
    // 0.3×halfWidth на шум), даже если закрытие осталось выше её края.
    const { support } = this.collect(price, candles, tfKey);
    // FIX канона (гл. 4/11): зона — это полоса [level ± halfWidth]. Прежнее
    // условие требовало, чтобы тень вошла в полосу СНИЗУ (wickLow ≤ верхнего
    // края) и отвергало самый частый канонический случай: молот, чья длинная
    // тень ПРОШИЛА зону сверху вниз (close над полосой, low под ней). Корректно:
    // тень коснулась уровня, если интервал [wickLow … price] пересекает полосу.
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
   * Проверка близости к сопротивлению (см. комментарий к isNearSupport).
   */
  static isNearResistance(
    price: number,
    candles: Candle[],
    _tolerance: number = 0.015,
    tfKey: TimeframeKey = 'swing',
    wickHigh?: number
  ): boolean {
    // См. комментарий к isNearSupport: high тени, вошедшей в зону сопротивления,
    // считается касанием уровня (Нисон: звезда тестит вершину тенью).
    const { resistance } = this.collect(price, candles, tfKey);
    // FIX канона (гл. 4-5): зеркально поддержке — тень звезды/повешенного может
    // ПРОШИТЬ зону сопротивления снизу вверх (high над полосой, close под ней).
    // Пересечение интервала [price … wickHigh] с полосой уровня = касание.
    return resistance.some(zone =>
      this.inBand(price, zone) ||
      (wickHigh !== undefined &&
        wickHigh >= zone.level - zone.halfWidth &&
        price <= zone.level + zone.halfWidth)
    );
  }
}
