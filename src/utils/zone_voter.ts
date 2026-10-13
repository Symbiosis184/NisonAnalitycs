// Zone Voter - определение зон поддержки/сопротивления по методологии Стива Нисона
// Ключевые принципы:
// 1. Уровни - это ЗОНЫ, а не точные цены
// 2. Количество касаний определяет силу
// 3. Объём подтверждает значимость
// 4. Полярность: пробитое сопротивление становится поддержкой
// 5. Кластеризация близких уровней

import { Candle } from './candle';
import { ema } from './indicators';

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
   * Сбор всех зон с голосованием
   */
  static collect(price: number, candles: Candle[]): { support: Zone[]; resistance: Zone[] } {
    const supMap = new Map<number, { reasons: string[]; touches: number; lastTouch: number }>();
    const resMap = new Map<number, { reasons: string[]; touches: number; lastTouch: number }>();

    const addZone = (
      map: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
      level: number,
      reason: string,
      touchTime: number = candles[candles.length - 1].time
    ) => {
      // Кластеризация: ищем близкие уровни
      let clustered = false;
      for (const [existingLevel, data] of map.entries()) {
        if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
          data.reasons.push(reason);
          data.touches++;
          data.lastTouch = Math.max(data.lastTouch, touchTime);
          clustered = true;
          break;
        }
      }
      
      if (!clustered) {
        map.set(level, { reasons: [reason], touches: 1, lastTouch: touchTime });
      }
    };

    // 1. Свинг-минимумы и максимумы (главный источник по Нисону)
    this.addSwingLevels(candles, supMap, resMap);

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
   * 1. Свинг-минимумы и максимумы
   * По Нисону: локальные экстремумы - основные уровни S/R
   */
  private static addSwingLevels(
    candles: Candle[],
    supMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>
  ) {
    const lookback = Math.min(100, candles.length);
    const recent = candles.slice(-lookback);

    for (let i = 2; i < recent.length - 2; i++) {
      const c = recent[i];

      // Swing low (поддержка)
      if (c.low < recent[i - 1].low && c.low < recent[i - 2].low &&
          c.low < recent[i + 1].low && c.low < recent[i + 2].low) {
        const addZone = (map: Map<number, any>, level: number, reason: string, time: number) => {
          let clustered = false;
          for (const [existingLevel, data] of map.entries()) {
            if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
              data.reasons.push(reason);
              data.touches++;
              data.lastTouch = Math.max(data.lastTouch, time);
              clustered = true;
              break;
            }
          }
          if (!clustered) {
            map.set(level, { reasons: [reason], touches: 1, lastTouch: time });
          }
        };
        addZone(supMap, c.low, 'свинг-минимум', c.time);
      }

      // Swing high (сопротивление)
      if (c.high > recent[i - 1].high && c.high > recent[i - 2].high &&
          c.high > recent[i + 1].high && c.high > recent[i + 2].high) {
        const addZone = (map: Map<number, any>, level: number, reason: string, time: number) => {
          let clustered = false;
          for (const [existingLevel, data] of map.entries()) {
            if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
              data.reasons.push(reason);
              data.touches++;
              data.lastTouch = Math.max(data.lastTouch, time);
              clustered = true;
              break;
            }
          }
          if (!clustered) {
            map.set(level, { reasons: [reason], touches: 1, lastTouch: time });
          }
        };
        addZone(resMap, c.high, 'свинг-максимум', c.time);
      }
    }
  }

  /**
   * 2. Полярность: пробитые уровни меняют роль
   * По Нисону (глава 11): "Пробитое сопротивление становится поддержкой"
   */
  private static addPolarityLevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>,
    resMap: Map<number, { reasons: string[]; touches: number; lastTouch: number }>
  ) {
    const lookback = Math.min(100, candles.length);
    const recent = candles.slice(-lookback);

    // Находим все свинги
    const swings: { level: number; type: 'high' | 'low'; time: number }[] = [];
    
    for (let i = 2; i < recent.length - 2; i++) {
      const c = recent[i];
      
      if (c.low < recent[i - 1].low && c.low < recent[i - 2].low &&
          c.low < recent[i + 1].low && c.low < recent[i + 2].low) {
        swings.push({ level: c.low, type: 'low', time: c.time });
      }
      
      if (c.high > recent[i - 1].high && c.high > recent[i - 2].high &&
          c.high > recent[i + 1].high && c.high > recent[i + 2].high) {
        swings.push({ level: c.high, type: 'high', time: c.time });
      }
    }

    // Проверяем полярность
    for (const swing of swings) {
      if (swing.type === 'high' && price > swing.level) {
        // Пробитое сопротивление -> поддержка
        const addZone = (map: Map<number, any>, level: number, reason: string, time: number) => {
          let clustered = false;
          for (const [existingLevel, data] of map.entries()) {
            if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
              data.reasons.push(reason);
              data.touches++;
              data.lastTouch = Math.max(data.lastTouch, time);
              clustered = true;
              break;
            }
          }
          if (!clustered) {
            map.set(level, { reasons: [reason], touches: 1, lastTouch: time });
          }
        };
        addZone(supMap, swing.level, 'полярность: пробитое сопротивление → поддержка', swing.time);
      }
      
      if (swing.type === 'low' && price < swing.level) {
        // Пробитая поддержка -> сопротивление
        const addZone = (map: Map<number, any>, level: number, reason: string, time: number) => {
          let clustered = false;
          for (const [existingLevel, data] of map.entries()) {
            if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
              data.reasons.push(reason);
              data.touches++;
              data.lastTouch = Math.max(data.lastTouch, time);
              clustered = true;
              break;
            }
          }
          if (!clustered) {
            map.set(level, { reasons: [reason], touches: 1, lastTouch: time });
          }
        };
        addZone(resMap, swing.level, 'полярность: пробитая поддержка → сопротивление', swing.time);
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

        const addZone = (map: Map<number, any>, level: number, reason: string, time: number) => {
          let clustered = false;
          for (const [existingLevel, data] of map.entries()) {
            if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
              data.reasons.push(reason);
              data.touches++;
              data.lastTouch = Math.max(data.lastTouch, time);
              clustered = true;
              break;
            }
          }
          if (!clustered) {
            map.set(level, { reasons: [reason], touches: 1, lastTouch: time });
          }
        };

        if (maVal <= price) {
          addZone(supMap, maVal, `MA${period}`, lastTime);
        } else {
          addZone(resMap, maVal, `MA${period}`, lastTime);
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
        const addZone = (map: Map<number, any>, level: number, reason: string, time: number) => {
          let clustered = false;
          for (const [existingLevel, data] of map.entries()) {
            if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
              data.reasons.push(reason);
              data.touches++;
              data.lastTouch = Math.max(data.lastTouch, time);
              clustered = true;
              break;
            }
          }
          if (!clustered) {
            map.set(level, { reasons: [reason], touches: 1, lastTouch: time });
          }
        };

        const level = c.isBullish ? c.low : c.high;
        if (c.isBullish) {
          addZone(supMap, level, 'объёмный климакс (гл. 15)', c.time);
        } else {
          addZone(resMap, level, 'объёмный климакс (гл. 15)', c.time);
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

        const addZone = (map: Map<number, any>, level: number, reason: string, time: number) => {
          let clustered = false;
          for (const [existingLevel, data] of map.entries()) {
            if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
              data.reasons.push(reason);
              data.touches++;
              data.lastTouch = Math.max(data.lastTouch, time);
              clustered = true;
              break;
            }
          }
          if (!clustered) {
            map.set(level, { reasons: [reason], touches: 1, lastTouch: time });
          }
        };

        if (c.isBullish) {
          addZone(supMap, mid, 'середина длинного белого тела (гл. 2)', c.time);
          addZone(supMap, c.low, 'основание длинного белого тела (гл. 2)', c.time);
        } else {
          addZone(resMap, mid, 'середина длинного чёрного тела (гл. 2)', c.time);
          addZone(resMap, c.high, 'вершина длинного чёрного тела (гл. 2)', c.time);
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

    const addZone = (map: Map<number, any>, level: number, reason: string) => {
      let clustered = false;
      for (const [existingLevel, data] of map.entries()) {
        if (Math.abs(level - existingLevel) / existingLevel <= this.CLUSTER_TOLERANCE) {
          data.reasons.push(reason);
          data.touches++;
          clustered = true;
          break;
        }
      }
      if (!clustered) {
        map.set(level, { reasons: [reason], touches: 1, lastTouch: Date.now() });
      }
    };

    addZone(supMap, lower, 'психологический уровень (круглое число)');
    addZone(resMap, upper, 'психологический уровень (круглое число)');
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
