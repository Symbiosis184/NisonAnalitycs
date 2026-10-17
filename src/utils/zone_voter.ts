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

export interface Zone {
  level: number;
  votes: number;
  strong: boolean;
  reasons: string[];
  touches: number;
  lastTouch?: number;
}

export class ZoneVoter {
  // Толеранс для кластеризации (0.5% - зоны в пределах 0.5% считаются одной зоной)
  private static readonly CLUSTER_TOLERANCE = 0.005;
  
  // Минимум голосов для сильной зоны
  private static readonly STRONG_ZONE_MIN_VOTES = 3;

  /**
   * Сбор всех зон с голосованием.
   * FIX аудита №1: уровни классифицируются как поддержка/сопротивление ОТНОСИТЕЛЬНО
   * каждой последующей свечи (касание), а не по положению относительно текущей цены.
   * Это даёт реальные касания (touches) вместо «все свинги ниже цены = поддержка».
   */
  static collect(price: number, candles: Candle[]): { support: Zone[]; resistance: Zone[] } {
    const supMap = new Map<number, ZoneClusterData>();
    const resMap = new Map<number, ZoneClusterData>();

    // 1. Касательная классификация: уровень + число касаний ценой после его образования
    this.addTouchBasedLevels(price, candles, supMap, resMap);

    // 2. Полярность: пробитые уровни меняют роль
    this.addPolarityLevels(price, candles, supMap, resMap);

    // 3. Скользящие средние как динамические уровни
    this.addMALevels(price, candles, supMap, resMap);

    // 4. Объёмные климасы (главы 15)
    this.addVolumeClimaxLevels(candles, supMap, resMap);

    // 5. Середины длинных тел (глава 2)
    this.addLongBodyLevels(candles, supMap, resMap);

    // 6. Психологические круглые числа
    this.addRoundNumbers(price, supMap, resMap);

    // FIX аудита №1: финальная транзитивная дедупликация — разные источники
    // (MA, климакс, середины тел, круглые числа) могли оставить «половины»
    // одной зоны; до mapToZones сливаем их в единый уровень.
    dedupeZones(supMap, this.CLUSTER_TOLERANCE);
    dedupeZones(resMap, this.CLUSTER_TOLERANCE);

    // Преобразуем в массивы Zone
    const support = this.mapToZones(supMap)
      .filter(z => z.level <= price)
      .sort((a, b) => b.level - a.level); // Ближайшие к цене сверху

    const resistance = this.mapToZones(resMap)
      .filter(z => z.level >= price)
      .sort((a, b) => a.level - b.level); // Ближайшие к цене снизу

    return { support, resistance };
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
    resMap: Map<number, ZoneClusterData>
  ) {
    const lookback = Math.min(150, candles.length);
    const tol = this.CLUSTER_TOLERANCE;

    // Сначала группируем свинги в зоны (кластеризация), помня самый ранний индекс
    // и ВСЕ составляющие цены каждой зоны. В одну зону сливаются и свинг-минимумы,
    // и свинг-максимумы: касания считаются отдельно для каждой ценой составляющей
    // (иначе зона из уровней 89.0 и 89.4 теряла бы касания к более высокому краю).
    const zoneDefs: Array<{ level: number; firstIndex: number; members: number[] }> = [];
    for (const swing of findSwings(candles, lookback)) {
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

      // Классификация относительно ТЕКУЩЕЙ цены для финального отображения:
      // зона остаётся поддержкой, если она ниже цены ИЛИ имеет больше касаний-поддержки;
      // аналогично для сопротивления. Уровни без касаний после образования не голосуются.
      const asSupport = supTouches > 0 && (zone.level <= price || supTouches > resTouches);
      const asResistance = resTouches > 0 && (zone.level >= price || resTouches > supTouches);

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
    resMap: Map<number, ZoneClusterData>
  ) {
    if (candles.length < 6) return;
    const lookback = Math.min(150, candles.length);
    const swings = findSwings(candles, lookback);
    const last = candles[candles.length - 1];
    const BREAK_PCT = 0.003;

    for (const swing of swings) {
      // Индекс свинга +2 — минимум подтверждений экстремума; проверяем закрытия после него
      const fromIdx = Math.max(swing.index + 1, candles.length - 40);
      if (swing.type === 'high') {
        const brokeUp = candles.slice(fromIdx).some(
          (c) => c.close > swing.level * (1 + BREAK_PCT) && last.close > swing.level * (1 + BREAK_PCT)
        );
        if (brokeUp && last.close > swing.level) {
          // Пробитое сопротивление -> поддержка (только если цена УВЕРЕННО выше)
          addLevelToMap(supMap, swing.level, 'полярность: пробитое сопротивление → поддержка', last.time, this.CLUSTER_TOLERANCE);
        }
      } else {
        const brokeDown = candles.slice(fromIdx).some(
          (c) => c.close < swing.level * (1 - BREAK_PCT) && last.close < swing.level * (1 - BREAK_PCT)
        );
        if (brokeDown && last.close < swing.level) {
          addLevelToMap(resMap, swing.level, 'полярность: пробитая поддержка → сопротивление', last.time, this.CLUSTER_TOLERANCE);
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
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>
  ) {
    const closes = candles.map(c => c.close);
    const periods = [50, 65, 200];

    for (const period of periods) {
      if (candles.length >= period) {
        const ma = ema(closes, period);
        const maVal = ma[ma.length - 1];
        const lastTime = candles[candles.length - 1].time;

                if (maVal <= price) {
          addLevelToMap(supMap, maVal, `MA${period}`, lastTime, this.CLUSTER_TOLERANCE);
        } else {
          addLevelToMap(resMap, maVal, `MA${period}`, lastTime, this.CLUSTER_TOLERANCE);
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
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>
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
          addLevelToMap(supMap, level, 'объёмный климакс (гл. 15)', c.time, this.CLUSTER_TOLERANCE);
        } else {
          addLevelToMap(resMap, level, 'объёмный климакс (гл. 15)', c.time, this.CLUSTER_TOLERANCE);
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
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>
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
          addLevelToMap(supMap, mid, 'середина длинного белого тела (гл. 2)', c.time, this.CLUSTER_TOLERANCE);
          addLevelToMap(supMap, c.low, 'основание длинного белого тела (гл. 2)', c.time, this.CLUSTER_TOLERANCE);
        } else {
          addLevelToMap(resMap, mid, 'середина длинного чёрного тела (гл. 2)', c.time, this.CLUSTER_TOLERANCE);
          addLevelToMap(resMap, c.high, 'вершина длинного чёрного тела (гл. 2)', c.time, this.CLUSTER_TOLERANCE);
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
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>
  ) {
    // Определяем шаг для круглых чисел в зависимости от цены
    let step: number;
    if (price >= 10000) step = 1000;
    else if (price >= 1000) step = 100;
    else if (price >= 100) step = 10;
    else if (price >= 10) step = 1;
    else if (price >= 1) step = 0.1;
    else step = 0.01;

    // Ближайшие круглые числа
    const lower = Math.floor(price / step) * step;
    const upper = Math.ceil(price / step) * step;

    addLevelToMap(supMap, lower, 'психологический уровень (круглое число)', Date.now(), this.CLUSTER_TOLERANCE);
    addLevelToMap(resMap, upper, 'психологический уровень (круглое число)', Date.now(), this.CLUSTER_TOLERANCE);
  }

  /**
   * Преобразование Map в массив Zone
   */
  private static mapToZones(
    map: Map<number, { reasons: string[]; touches: number; lastTouch: number }>
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
      });
    }

    return zones;
  }

  /**
   * Проверка близости к поддержке
   */
  static isNearSupport(price: number, candles: Candle[], tolerance: number = 0.015): boolean {
    const { support } = this.collect(price, candles);
    return support.some(zone => Math.abs(price - zone.level) / price <= tolerance);
  }

  /**
   * Проверка близости к сопротивлению
   */
  static isNearResistance(price: number, candles: Candle[], tolerance: number = 0.015): boolean {
    const { resistance } = this.collect(price, candles);
    return resistance.some(zone => Math.abs(price - zone.level) / price <= tolerance);
  }
}
