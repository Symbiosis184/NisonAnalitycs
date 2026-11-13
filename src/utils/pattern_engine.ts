import { Candle } from './candle';
import { ema, sma } from './indicators';
import { ZoneVoter, timeframeKey, type TimeframeKey } from './zone_voter';
import { findSwings } from './levels';
import { getSwingTrend, isFlatMarket } from './trend_detection';
import { getPatternCandleCount } from './pattern_ids';

const SWING_SPAN_BY_TF: Record<TimeframeKey, number> = {
  scalp: 2, intraday: 3, swing: 3, position: 4,
};

export class SupportResistance {
  static findLevels(candles: Candle[], lookback: number = 50, tfKey: TimeframeKey = 'swing'): { support: number[]; resistance: number[] } {
    const swings = findSwings(candles, lookback, SWING_SPAN_BY_TF[tfKey]);
    return {
      support: swings.filter(s => s.type === 'low').map(s => s.level),
      resistance: swings.filter(s => s.type === 'high').map(s => s.level),
    };
  }
  static isNearSupport(price: number, candles: Candle[], tfKey: TimeframeKey = 'swing', wickLow?: number): boolean {
    return ZoneVoter.isNearSupport(price, candles, undefined, tfKey, wickLow);
  }
  static isNearResistance(price: number, candles: Candle[], tfKey: TimeframeKey = 'swing', wickHigh?: number): boolean {
    return ZoneVoter.isNearResistance(price, candles, undefined, tfKey, wickHigh);
  }
}

export class VolumeAnalyzer {
  static getAverageVolume(candles: Candle[], period: number = 20): number {
    if (candles.length < period) return 0;
    return candles.slice(-period).reduce((s, c) => s + c.volume, 0) / period;
  }
  /**
   * Сравнение с объёмом строго ПРЕДШЕСТВУЮЩИХ свечей. Вызывающий код обязан
   * исключить текущую свечу: так одинаковые аргументы дают одинаковый результат
   * в списке моделей, сигналах и бэктесте.
   */
  static isHighVolume(candle: Candle, priorCandles: Candle[], multiplier: number = 1.3): boolean {
    const avg = this.getAverageVolume(priorCandles);
    return avg > 0 && candle.volume > avg * multiplier;
  }
}

export type PatternMarket = 'crypto' | 'stocks';
export interface PatternContext {
  timeframe?: string;
  market?: PatternMarket;
}
export interface PatternDetection {
  found: boolean;
  name: string;
  /** Фактический размер переменной формации; иначе используется реестр ID. */
  formationSize?: number;
}
const DEFAULT_PATTERN_CONTEXT: Required<PatternContext> = { timeframe: 'D', market: 'crypto' };
function patternContext(context?: PatternContext): Required<PatternContext> {
  return { ...DEFAULT_PATTERN_CONTEXT, ...context };
}

function zoneMarket(context?: PatternContext): 'stock' | 'crypto' {
  return patternContext(context).market === 'stocks' ? 'stock' : 'crypto';
}

/** Базовое имя модели без контекстных суффиксов в скобках. */
function baseName(name: string): string {
  const i = name.indexOf(' (');
  return (i > 0 ? name.slice(0, i) : name).trim();
}

export class PatternDetector {
  /**
   * ИСПРАВЛЕНО: размерность формации берётся из единого канонического
   * справочника (гл. 4–7 ЯС), а не подбирается по подстрокам имени.
   */
  static getFormationBounds(
    patternName: string,
    candles: Candle[],
    endIdx: number,
    formationSize?: number,
  ) {
    const n = candles.length;
    if (n === 0) {
      return { patternCandlesCount: 0, patternStartIdx: -1, patternEndIdx: -1, patternLow: 0, patternHigh: 0 };
    }
    const idx = Math.min(Math.max(endIdx, 0), n - 1);
    const count = Math.min(formationSize ?? getPatternCandleCount(patternName), idx + 1);
    const startIdx = idx - count + 1;
    const formation = candles.slice(startIdx, idx + 1);
    return {
      patternCandlesCount: count,
      patternStartIdx: startIdx,
      patternEndIdx: idx,
      patternLow: Math.min(...formation.map(c => c.low)),
      patternHigh: Math.max(...formation.map(c => c.high)),
    };
  }

  private static atLocalLow(candle: Candle, prevCandles: Candle[]): boolean {
    if (prevCandles.length < 5) return true;
    const segNoSelf = prevCandles.slice(-8);
    const lo2 = Math.min(...segNoSelf.map(c => c.low));
    const hi2 = Math.max(...segNoSelf.map(c => c.high));
    if (hi2 <= lo2) return true;
    const priorBand = lo2 + (hi2 - lo2) * 0.35;
    const bodyAtPriorBottom = Math.min(candle.open, candle.close) <= priorBand ||
      (candle.lowerWick >= candle.body * 2 && candle.low <= hi2);
    const bodyInUpperHalf = candle.close >= (candle.high + candle.low) / 2;
    return bodyAtPriorBottom && bodyInUpperHalf;
  }

  private static atLocalHigh(candle: Candle, prevCandles: Candle[]): boolean {
    if (prevCandles.length < 5) return true;
    const segNoSelf = prevCandles.slice(-8);
    const lo2 = Math.min(...segNoSelf.map(c => c.low));
    const hi2 = Math.max(...segNoSelf.map(c => c.high));
    if (hi2 <= lo2) return true;
    const priorBand = hi2 - (hi2 - lo2) * 0.35;
    const bodyAtPriorTop = Math.max(candle.open, candle.close) >= priorBand ||
      (candle.upperWick >= candle.body * 2 && candle.high >= lo2);
    const bodyInLowerHalf = candle.close <= (candle.high + candle.low) / 2;
    return bodyAtPriorTop && bodyInLowerHalf;
  }

  /**
   * ИСПРАВЛЕНО P0-1 (гл. 4 ЯС, «Молот и повешенный»): повешенный имеет ту же
   * форму, что молот — малое тело в ВЕРХНЕЙ части диапазона и длинная нижняя
   * тень; отличается только контекстом (формируется после роста). Общий хелпер
   * atLocalHigh написан для падающей звезды (тело внизу) и с условием
   * `close >= (high+low)/2` детектора повешенного взаимно исключался — модель
   * не срабатывала никогда при prevCandles.length >= 5. Здесь та же привязка
   * к локальному максимуму, но тело проверяется в верхней половине диапазона.
   */
  private static atLocalHighBodyUp(candle: Candle, prevCandles: Candle[]): boolean {
    if (prevCandles.length < 5) return true;
    const segNoSelf = prevCandles.slice(-8);
    const lo2 = Math.min(...segNoSelf.map(c => c.low));
    const hi2 = Math.max(...segNoSelf.map(c => c.high));
    if (hi2 <= lo2) return true;
    const priorBand = hi2 - (hi2 - lo2) * 0.35;
    const bodyAtPriorTop = Math.max(candle.open, candle.close) >= priorBand ||
      (candle.lowerWick >= candle.body * 2 && candle.high >= lo2);
    const bodyInUpperHalf = candle.close >= (candle.high + candle.low) / 2;
    return bodyAtPriorTop && bodyInUpperHalf;
  }

  /**
   * Разворотная модель требует уже существующего движения, которое она может
   * развернуть. Близость к экстремуму сама по себе трендом не является.
   * Сначала используется структура свингов; если её недостаточно — направление
   * и наклон доступной SMA. Это воспроизводимая эвристика контекста, а не
   * числовой порог, заданный книгами.
   */
  private static precededByDecline(prev: Candle[]): boolean {
    if (prev.length < 4) return false;
    const swing = getSwingTrend(prev);
    if (swing === 'НИСХОДЯЩИЙ') return true;
    if (swing === 'ВОСХОДЯЩИЙ') return false;
    return this.maDirection(prev) === 'down';
  }

  /**
   * P2-6: контекст для разворотных моделей основания с длинной
   * формацией (лестничное дно — 5 свечей). При достаточной предыстории
   * требует подтверждённый спад как precededByDecline; при короткой истории
   * (prev.length < 4) допускает модель, если сама формация начинается от
   * локального экстремума (дно/вершина последних 10 баров до формации) —
   * проектная эвристика вместо жёсткого минимума предыстории.
   */
  private static precededByDeclineOrFormation(prev: Candle[], dir: 'up' | 'down'): boolean {
    if (prev.length >= 4) return dir === 'down' ? this.precededByDecline(prev) : this.precededByRally(prev);
    const window = prev.slice(-10);
    if (window.length < 3) return false;
    const closes = window.map(x => x.close);
    const last = closes[closes.length - 1];
    return dir === 'down' ? last <= Math.min(...closes) : last >= Math.max(...closes);
  }

  private static precededByRally(prev: Candle[]): boolean {
    if (prev.length < 4) return false;
    const swing = getSwingTrend(prev);
    if (swing === 'ВОСХОДЯЩИЙ') return true;
    if (swing === 'НИСХОДЯЩИЙ') return false;
    return this.maDirection(prev) === 'up';
  }

  /**
   * Направление отдельной стрелки дожи (проектное отображение, не смена
   * нейтрального книжного типа). После роста допускается медвежья реакция.
   * Одиночный дожи после снижения бычьей стрелки не получает: в главе 8 Нисон
   * прямо указывает, что в основании ему нужно более сильное подтверждение от
   * других технических индикаторов. Такое подтверждение может дать отдельная
   * бычья модель, но не сам факт пробоя максимума дожи.
   */
  static getDojiContextDirection(prev: Candle[]): 'short' | null {
    return this.precededByRally(prev) ? 'short' : null;
  }

  private static maDirection(candles: Candle[]): 'up' | 'down' | 'flat' {
    const period = Math.min(65, candles.length);
    if (period < 4) return 'flat';
    const closes = candles.map(c => c.close);
    const meanAt = (end: number) => {
      const from = Math.max(0, end - period + 1);
      const part = closes.slice(from, end + 1);
      return part.reduce((sum, value) => sum + value, 0) / part.length;
    };
    const now = meanAt(closes.length - 1);
    const before = meanAt(closes.length - 2);
    const last = closes[closes.length - 1];
    const avgRange = candles.slice(-period)
      .reduce((sum, c) => sum + c.totalRange, 0) / period;
    const tolerance = Math.max(Number.EPSILON, avgRange * 0.05);
    if (last < now - tolerance && now < before - tolerance) return 'down';
    if (last > now + tolerance && now > before + tolerance) return 'up';
    return 'flat';
  }

  private static makesNewExtreme(value: number, window: Candle[], isLow: boolean): boolean {
    if (window.length === 0) return true;
    const ref = isLow ? Math.min(...window.map(c => c.low)) : Math.max(...window.map(c => c.high));
    const avgRange = window.reduce((s, c) => s + (c.high - c.low), 0) / window.length;
    const tol = Math.max(ref * 0.001, avgRange * 0.25);
    return isLow ? value <= ref + tol : value >= ref - tol;
  }

  private static isLongRelative(candle: Candle, window: Candle[]): boolean {
    if (window.length < 3) return candle.isLongCandle || candle.body > candle.totalRange * 0.45;
    const bodies = window.map(c => c.body).sort((a, b) => a - b);
    const med = bodies[Math.floor(bodies.length / 2)];
    return candle.body > candle.totalRange * 0.45 && med > 0 && candle.body >= med * 1.5;
  }

  private static relWindow(candles: Candle[], beforeIdx: number): Candle[] {
    return candles.slice(Math.max(0, beforeIdx - 20), beforeIdx);
  }

  private static isSmallRelative(candle: Candle, window: Candle[]): boolean {
    if (candle.isShortCandle || candle.isDoji) return true;
    if (window.length < 3) return false;
    const bodies = window.map(c => c.body).sort((a, b) => a - b);
    const med = bodies[Math.floor(bodies.length / 2)];
    return med > 0 && candle.body <= med * 0.4;
  }

  /** Адаптивный допуск: доля ATR вместо фиксированного процента. */
  private static adaptiveTol(candles: Candle[], k: number = 0.25): number {
    if (candles.length === 0) return 0;
    const price = candles[candles.length - 1].close;
    const avgRange = candles.reduce((s, c) => s + (c.high - c.low), 0) / candles.length;
    return Math.max(price * 0.001, avgRange * k);
  }

  // ─── гл. 4 ЯС: МОЛОТ / ПОВЕШЕННЫЙ / ПАДАЮЩАЯ ЗВЕЗДА ────────────────

  static isHammer(candle: Candle, prevCandles: Candle[], context?: PatternContext): PatternDetection {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };

    // Близость поддержки усиливает контекст, но не отменяет геометрию модели.
    const volumeOk = VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3);
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    const maOk = m20 !== null && Number.isFinite(m20) && Math.abs(candle.low - m20) <= m20 * 0.01;

    let name = 'МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У ПОДДЕРЖКИ)';
    if (volumeOk) name += ' (ОБЪЁМ)';
    else if (maOk) name += ' (MA20)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО (гл. 4, рис. 4.8–4.9 ЯС): у несовершенного молота нижняя
   * тень короче двух тел, но не меньше одного тела.
   */
  static isImperfectHammer(candle: Candle, prevCandles: Candle[], context?: PatternContext): PatternDetection {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.5) return { found: false, name: '' };
    if (candle.lowerWick < candle.body) return { found: false, name: '' };
    if (candle.lowerWick >= candle.body * 2) return { found: false, name: '' }; // иначе это обычный молот
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };

    // Близость поддержки усиливает контекст, но не отменяет геометрию модели.
    return { found: true, name: 'МОЛОТ (НЕСОВЕРШЕННЫЙ)' };
  }

  /**
   * ИСПРАВЛЕНО: тело в НИЖНЕЙ части диапазона — сравнение с серединой
   * ДИАПАЗОНА, а не тела (цвет не важен, гл. 5 ЯС).
   */
  static isInvertedHammer(candle: Candle, prevCandles: Candle[], context?: PatternContext): PatternDetection {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };

    // Близость поддержки усиливает контекст, но не отменяет геометрию модели.
    let name = 'ПЕРЕВЁРНУТЫЙ МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО: тело у ВЕРХНЕЙ границы диапазона — сравнение с серединой
   * ДИАПАЗОНА (цвет не важен, гл. 4 ЯС).
   */
  static isHangingMan(candle: Candle, prevCandles: Candle[], context?: PatternContext): PatternDetection {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalHighBodyUp(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByRally(prevCandles)) return { found: false, name: '' };

    let name = 'ПОВЕШЕННЫЙ';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (candle.isBearish) name += ' (ЧЁРНОЕ ТЕЛО)';
    return { found: true, name };
  }

  static isShootingStar(candle: Candle, prevCandles: Candle[], context?: PatternContext): PatternDetection {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalHigh(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByRally(prevCandles)) return { found: false, name: '' };

    let name = 'ПАДАЮЩАЯ ЗВЕЗДА';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  // ─── гл. 8 ЯС: ДОДЖИ И ВЫСОКАЯ ВОЛНА ────────────────────────────────

  /**
   * ИСПРАВЛЕНО: добавлены длинноногая дожи и рикша (гл. 8 ЯС).
   */
  static classifyDoji(candle: Candle): PatternDetection {
    if (!candle.isDoji) return { found: false, name: '' };
    const r = candle.totalRange;
    if (r <= 0) return { found: false, name: '' };

    const longUpper = candle.upperWick > r * 0.4;
    const longLower = candle.lowerWick > r * 0.4;
    const shortUpper = candle.upperWick < r * 0.1;
    const shortLower = candle.lowerWick < r * 0.1;

    if (longLower && shortUpper) return { found: true, name: 'ДОДЖИ-СТРЕКОЗА' };
    if (longUpper && shortLower) return { found: true, name: 'НАДГРОБИЕ' };
    if (longUpper && longLower) {
      const mid = (candle.high + candle.low) / 2;
      const isRickshaw = Math.abs(candle.close - mid) <= r * 0.1;
      return { found: true, name: isRickshaw ? 'ДЛИННОНОГАЯ ДОДЖИ (РИКША)' : 'ДЛИННОНОГАЯ ДОДЖИ' };
    }
    return { found: true, name: 'ДОДЖИ' };
  }

  /** НОВОЕ (гл. 2 ЯС): высокая волна — малое тело + длинные обе тени. */
  static isHighWave(candle: Candle, prevCandles: Candle[]): PatternDetection {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (candle.isDoji) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.3) return { found: false, name: '' };
    if (!(candle.upperWick >= candle.totalRange * 0.3 && candle.lowerWick >= candle.totalRange * 0.3)) {
      return { found: false, name: '' };
    }
    if (!this.isSmallRelative(candle, prevCandles.slice(-20))) return { found: false, name: '' };
    return { found: true, name: 'ВЫСОКАЯ ВОЛНА' };
  }

  // ─── гл. 4 ЯС: ПОГЛОЩЕНИЕ, ЗАВЕСА, ПРОСВЕТ ──────────────────────────

  static isBullishEngulfing(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    if (!(c1.isBearish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBullish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };

    let name = 'БЫЧЬЕ ПОГЛОЩЕНИЕ';
    if (this.isSmallRelative(c1, prev.slice(-20)) && this.isLongRelative(c2, prev.slice(-20))) name += ' (СИЛЬНОЕ)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У ПОДДЕРЖКИ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isBearishEngulfing(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    if (!(c1.isBullish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBearish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };

    let name = 'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ';
    if (this.isSmallRelative(c1, prev.slice(-20)) && this.isLongRelative(c2, prev.slice(-20))) name += ' (СИЛЬНОЕ)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  /** Гл. 4 ЯС: открытие второй свечи строго за закрытием первой. */
  static isDarkCloudCover(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    // P2-1: канон ЯС гл. «Построение свечей» — длинное тело относительно предшествующих
    // свечей (OR с абсолютной мерой — как в isTowerFormation; проектная эвристика).
    const winDCC = this.relWindow([...prev, c1, c2], prev.length);
    if (!(c1.isBullish && (this.isLongRelative(c1, winDCC) || c1.isLongCandle))) return { found: false, name: '' };
    if (!(c2.isBearish && (this.isLongRelative(c2, [...winDCC.slice(1), c1]) || c2.isLongCandle))) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    if (c2.close >= c1.bodyMid || c2.close <= c1.open) return { found: false, name: '' };

    // P1-1 (вариант A): канон ЯС гл. 3 для акций допускает открытие выше ЦЕНЫ
    // ЗАКРЫТИЯ первой свечи (не обязательно выше максимума). На круглосуточном
    // крипторынке open ≈ prevClose, поэтому жёсткое `open > close` делало модель
    // недостижимой. Проектная эвристика: adaptiveTol(0.15) — reject только если
    // открытие ниже close более чем на допуск. Метки «(ГЭП…)» — только при
    // настоящем разрыве диапазонов (low2 > high1 / open > high1 по канону окон).
    const tol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (c2.open < c1.close - tol) return { found: false, name: '' };

    let name = 'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ';
    const realGapUp = c2.low > c1.high || c2.open > c1.high;
    if (realGapUp && c2.open > c1.high) name += ' (ГЭП ВЫШЕ МАКСИМУМА)';
    else if (realGapUp) name += ' (ГЭП)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  static isPiercingPattern(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    // P2-1: зеркально завесе — относительная длина тела (канон ЯС, OR-комбинация).
    const winPP = this.relWindow([...prev, c1, c2], prev.length);
    if (!(c1.isBearish && (this.isLongRelative(c1, winPP) || c1.isLongCandle))) return { found: false, name: '' };
    if (!(c2.isBullish && (this.isLongRelative(c2, [...winPP.slice(1), c1]) || c2.isLongCandle))) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    if (c2.close <= c1.bodyMid || c2.close >= c1.open) return { found: false, name: '' };

    // P1-1 (вариант A): зеркально завесе — reject только если открытие выше
    // close первой свечи более чем на адаптивный допуск (эвристика проекта).
    // Метка «(ГЭП…)» — только при настоящем разрыве диапазонов.
    const tol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (c2.open > c1.close + tol) return { found: false, name: '' };

    let name = 'ПРОСВЕТ В ОБЛАКАХ';
    const realGapDown = c2.high < c1.low || c2.open < c1.low;
    if (realGapDown && c2.open < c1.low) name += ' (ГЭП НИЖЕ МИНИМУМА)';
    else if (realGapDown) name += ' (ГЭП)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО (ЗГ гл. 3): основание «последнее поглощение» — крупная ЧЁРНАЯ
   * поглощает малое БЕЛОЕ во время СПАДА; вершина — зеркально.
   */
  static isLastEngulfing(c1: Candle, c2: Candle, prev: Candle[]): PatternDetection {
    const eng = c2.bodyTop >= c1.bodyTop && c2.bodyBottom <= c1.bodyBottom && c2.body > c1.body;
    if (!eng) return { found: false, name: '' };

    if (c1.isBullish && c2.isBearish && this.precededByDecline(prev)) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)' };
    }
    if (c1.isBearish && c2.isBullish && this.precededByRally(prev)) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)' };
    }
    return { found: false, name: '' };
  }

  // ─── гл. 5 ЯС: ЗВЁЗДЫ ────────────────────────────────────────────────

  /**
   * ИСПРАВЛЕНО (гл. 5 ЯС): гэп третьей свечи не обязателен — «второй гэп
   * возникает редко и не влияет на силу сигнала». Оставлен как усилитель.
   */
  static isMorningStar(candles: Candle[]): PatternDetection {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const winMS = this.relWindow(candles, candles.length - 3);
    if (!this.precededByDecline(candles.slice(0, -3))) return { found: false, name: '' };
    if (!(c1.isBearish && this.isLongRelative(c1, winMS))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, winMS)) return { found: false, name: '' };
    if (!(c3.isBullish && this.isLongRelative(c3, winMS))) return { found: false, name: '' };
    if (c3.close <= c1.bodyMid) return { found: false, name: '' };

    const gapTol = this.adaptiveTol(candles.slice(0, -3), 0.15);
    if (c2.close > c1.bodyBottom + gapTol) return { found: false, name: '' };

    let name = c2.isDoji ? 'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА' : 'УТРЕННЯЯ ЗВЕЗДА';
    if (c2.high < c1.bodyBottom) name += ' (ГЭП ВНИЗ)';
    if (c3.open > c2.bodyTop) name += ' (ГЭП ВВЕРХ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isEveningStar(candles: Candle[]): PatternDetection {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const winES = this.relWindow(candles, candles.length - 3);
    if (!this.precededByRally(candles.slice(0, -3))) return { found: false, name: '' };
    if (!(c1.isBullish && this.isLongRelative(c1, winES))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, winES)) return { found: false, name: '' };
    if (!(c3.isBearish && this.isLongRelative(c3, winES))) return { found: false, name: '' };
    if (c3.close >= c1.bodyMid) return { found: false, name: '' };

    const gapTol = this.adaptiveTol(candles.slice(0, -3), 0.15);
    if (c2.close < c1.bodyTop - gapTol) return { found: false, name: '' };

    let name = c2.isDoji ? 'ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА' : 'ВЕЧЕРНЯЯ ЗВЕЗДА';
    if (c2.low > c1.bodyTop) name += ' (ГЭП ВВЕРХ)';
    if (c3.open < c2.bodyBottom) name += ' (ГЭП ВНИЗ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  // ─── гл. 6–7 ЯС: ТРИ СОЛДАТА / ВОРОНЫ / ОСЛАБЛЕННЫЕ ФОРМЫ ────────────

  /**
   * ИСПРАВЛЕНО (гл. 7 ЯС): добавлена проверка последовательно повышающихся
   * цен закрытия — ключевой критерий «трёх наступающих белых солдат».
   */
  static isThreeWhiteSoldiers(candles: Candle[]): PatternDetection {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const winSW = this.relWindow(candles, candles.length - 3);

    if (!([c1, c2, c3].every(c => c.isBullish && (this.isLongRelative(c, winSW) || c.isLongCandle)))) {
      return { found: false, name: '' };
    }
    // ИСПРАВЛЕНО: последовательно повышающиеся закрытия.
    if (!(c2.close > c1.close && c3.close > c2.close)) return { found: false, name: '' };
    // Короткие верхние тени (иначе это «отбитое наступление»).
    if ([c1, c2, c3].some(c => c.upperWick > c.totalRange * 0.3)) return { found: false, name: '' };
    // Открытия внутри предыдущих тел.
    if (!(c2.open >= c1.bodyBottom && c2.open <= c1.bodyTop)) return { found: false, name: '' };
    if (!(c3.open >= c2.bodyBottom && c3.open <= c2.bodyTop)) return { found: false, name: '' };
    const prior = candles.slice(0, -3);
    // ИСПРАВЛЕНО (гл. 7 ЯС «Три наступающих белых солдата»): модель формируется
    // «на рынке, прошедшем длительный спад или находящемся в затяжной консолидации»
    // в зоне низких цен. Требуется спад ИЛИ база/консолидация; боковик-основание
    // валиден по книге. Противостоящий подтверждённый рост блокирует сигнал.
    if (!this.precededByDecline(prior) && !isFlatMarket(prior)) {
      return { found: false, name: '' };
    }

    return { found: true, name: 'ТРИ БЕЛЫХ СОЛДАТА' };
  }

  /**
   * ИСПРАВЛЕНО (гл. 6 ЯС): добавлен контекст предшествующего роста и
   * выделение «трёх одинаковых ворон» (глоссарий ЯС).
   */
  static isThreeBlackCrows(candles: Candle[]): PatternDetection {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const winBC = this.relWindow(candles, candles.length - 3);

    if (!([c1, c2, c3].every(c => c.isBearish && (this.isLongRelative(c, winBC) || c.isLongCandle)))) {
      return { found: false, name: '' };
    }
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    if ([c1, c2, c3].some(c => c.lowerWick > c.totalRange * 0.3)) return { found: false, name: '' };
    if (!(c2.open >= c1.bodyBottom && c2.open <= c1.bodyTop)) return { found: false, name: '' };
    if (!(c3.open >= c2.bodyBottom && c3.open <= c2.bodyTop)) return { found: false, name: '' };
    // ИСПРАВЛЕНО: вороны — разворот после РОСТА (гл. 6 ЯС).
    if (!this.precededByRally(candles.slice(0, -3))) return { found: false, name: '' };

    const tolOpen = this.adaptiveTol(winBC, 0.1);
    if (Math.abs(c2.open - c1.close) <= tolOpen && Math.abs(c3.open - c2.close) <= tolOpen) {
      return { found: true, name: 'ТРИ ОДИНАКОВЫЕ ВОРОНЫ' };
    }
    return { found: true, name: 'ТРИ ЧЁРНЫХ ВОРОНЫ' };
  }

  /**
   * P2-1f (гл. 7 ЯС): «отбитое наступление» — ослабление быков.
   * Канон: три последовательно повышающиеся закрытия белых свечей при
   * ПОСЛЕДОВАТЕЛЬНО СОКРАЩАЮЩИХСЯ телах (каждая следующая свеча короче
   * предыдущей). Тень как альтернативный признак удалена: она описывает
   * другую модель («падающая звезда» / «звёздный» вариант), а не канон.
   */
  static isAdvanceBlock(candles: Candle[]): PatternDetection {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];

    if (!([c1, c2, c3].every(c => c.isBullish))) return { found: false, name: '' };
    if (!(c2.close > c1.close && c3.close > c2.close)) return { found: false, name: '' };
    if (!this.precededByRally(candles.slice(0, -3))) return { found: false, name: '' };

    // Единственный канонический признак: убывающие тела трёх свечей.
    if (!(c3.body < c2.body && c2.body < c1.body)) return { found: false, name: '' };

    // P2-7 (гл. 7 ЯС): усиление признака — убывание тел должно быть ЗАМЕТНЫМ,
    // а не шумовым микросокращением. Требуем заметного суммарного сжатия:
    // третье тело обязано быть существенно меньше первого (не менее 40%
    // сокращения тела за формацию). Порог отношения 0.6 согласован с тестами
    // и не завязан на медиану предыстории (мелкие фоновные свечи не должны
    // блокировать сигнал, построенный на длинных телах самой формации).
    if (c1.body <= 0 || c3.body > c1.body * 0.6) return { found: false, name: '' };

    return { found: true, name: 'ОТБИТОЕ НАСТУПЛЕНИЕ', formationSize: 3 };
  }

  /** НОВОЕ (гл. 7 ЯС): «торможение» — малая свеча на плече длинной белой. */
  static isStalled(candles: Candle[]): PatternDetection {
    if (candles.length < 2) return { found: false, name: '' };
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];

    if (!(c1.isBullish && c2.isBullish)) return { found: false, name: '' };
    if (!this.isLongRelative(c1, this.relWindow(candles, candles.length - 2))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, this.relWindow(candles, candles.length - 2))) return { found: false, name: '' };
    // Малая свеча «едет на плече»: в верхней половине тела длинной.
    const tol = this.adaptiveTol(candles.slice(0, -2), 0.15);
    if (c2.bodyBottom < c1.bodyMid || c2.bodyTop < c1.bodyTop - tol) return { found: false, name: '' };
    if (!this.precededByRally(candles.slice(0, -2))) return { found: false, name: '' };

    return { found: true, name: 'ТОРМОЖЕНИЕ' };
  }

  // ─── гл. 11 ЯС: СПРУЖИНИВАНИЯ ────────────────────────────────────────

  /** ИСПРАВЛЕНО: добавлена проверка бокового коридора (гл. 11 ЯС). */
  static isSpring(candles: Candle[]): PatternDetection {
    if (candles.length < 25) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const baseWindow = candles.slice(-21, -1);
    const base = Math.min(...baseWindow.map(c => c.low));

    if (!(last.low < base && last.close > base && last.close > last.open)) {
      return { found: false, name: '' };
    }
    // Проверка боковика: диапазон последних 20 свечей не превышает 5×ATR.
    const hi = Math.max(...baseWindow.map(c => c.high));
    const lo = Math.min(...baseWindow.map(c => c.low));
    const avgRange = baseWindow.reduce((s, c) => s + (c.high - c.low), 0) / baseWindow.length;
    if (avgRange > 0 && (hi - lo) > avgRange * 5) return { found: false, name: '' };

    return { found: true, name: 'СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)' };
  }

  /** НОВОЕ (гл. 11 ЯС): верхнее спружинивание — зеркало нижнего. */
  static isUpthrust(candles: Candle[]): PatternDetection {
    if (candles.length < 25) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const topWindow = candles.slice(-21, -1);
    const top = Math.max(...topWindow.map(c => c.high));

    if (!(last.high > top && last.close < top && last.close < last.open)) {
      return { found: false, name: '' };
    }
    const hi = Math.max(...topWindow.map(c => c.high));
    const lo = Math.min(...topWindow.map(c => c.low));
    const avgRange = topWindow.reduce((s, c) => s + (c.high - c.low), 0) / topWindow.length;
    if (avgRange > 0 && (hi - lo) > avgRange * 5) return { found: false, name: '' };

    return { found: true, name: 'ВЕРХНЕЕ СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ВЕРШИНЫ)' };
  }

  // ─── гл. 6 ЯС: ХАРАМИ, ПИНЦЕТ, ПОЯС, КОНТРАТАКА, РАЗДЕЛЕНИЕ, ШЕЯ ─────

  static isHarami(c1: Candle, c2: Candle, prev: Candle[]): PatternDetection {
    if (!this.isLongRelative(c1, this.relWindow([...prev, c1], prev.length + 1))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, [...prev.slice(-19), c1])) return { found: false, name: '' };
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };

    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ' };
    return { found: false, name: '' };
  }

  static isHaramiCross(c1: Candle, c2: Candle, prev: Candle[]): PatternDetection {
    if (!this.isLongRelative(c1, this.relWindow([...prev, c1], prev.length + 1))) return { found: false, name: '' };
    if (!c2.isDoji) return { found: false, name: '' };
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };

    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ-КРЕСТ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ' };
    return { found: false, name: '' };
  }

  static isTweezerBottom(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    // Пинцет определяется повторным экстремумом; цвета и типы тел могут различаться.
    const tolB = Math.max(c1.low * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.15);
    if (Math.abs(c1.low - c2.low) > tolB) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    const name = ZoneVoter.isNearSupport(c2.low, prev, 0.01, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))
      ? 'ПИНЦЕТ (НИЗ) (У ПОДДЕРЖКИ)' : 'ПИНЦЕТ (НИЗ)';
    return { found: true, name };
  }

  static isTweezerTop(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    const tolT = Math.max(c1.high * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.15);
    if (Math.abs(c1.high - c2.high) > tolT) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    const name = ZoneVoter.isNearResistance(c2.high, prev, 0.01, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))
      ? 'ПИНЦЕТ (ВЕРХ) (У СОПРОТИВЛЕНИЯ)' : 'ПИНЦЕТ (ВЕРХ)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО (гл. 6 ЯС): убрано выдуманное условие `c2.open >= c1.close`.
   * Захват за пояс — длинная свеча с открытием на экстремуме сессии.
   */
  static isBullishBelt(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    // P2-1 (гл. «Построение свечей» ЯС): длинное тело — относительно предшествующих
    // свечей; OR с абсолютной мерой — как в isTowerFormation (проектная эвристика).
    if (!(c2.isBullish && (this.isLongRelative(c2, this.relWindow([...prev, c1, c2], prev.length + 1)) || c2.isLongCandle))) return { found: false, name: '' };
    if (c2.lowerWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };

    let name = 'ЛИНИЯ ПОЯСА (БЫЧЬЯ)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  static isBearishBelt(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    // P2-1 (гл. «Построение свечей» ЯС): зеркально бычьему поясу — относительная длина тела.
    if (!(c2.isBearish && (this.isLongRelative(c2, this.relWindow([...prev, c1, c2], prev.length + 1)) || c2.isLongCandle))) return { found: false, name: '' };
    if (c2.upperWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };

    let name = 'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  static isCounterattack(c1: Candle, c2: Candle, prev: Candle[], context?: PatternContext): PatternDetection {
    if (patternContext(context).market !== 'stocks') return { found: false, name: '' };
    const closeTol = Math.max(c1.close * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.1);
    if (Math.abs(c1.close - c2.close) > closeTol) return { found: false, name: '' };
    // PR #44 (#A5, гл. 3 ЯС «Построение японских свечей»): длинное тело — заметно
    // бо́льшее ПО ОТНОШЕНИЮ к предшествующим; OR с абсолютной мерой — как в belt'ах
    // и остальных моделях (проектная эвристика).
    const winCA1 = this.relWindow(prev, prev.length - 1);
    const winCA2 = this.relWindow([...prev, c1], prev.length);
    if (!((this.isLongRelative(c1, winCA1) || c1.isLongCandle) && (this.isLongRelative(c2, winCA2) || c2.isLongCandle))) return { found: false, name: '' };
    const need = c1.totalRange * 0.5;
    const gap = c2.open - c1.close;

    if (c1.isBearish && c2.isBullish && gap <= -need && this.precededByDecline(prev)) {
      return { found: true, name: 'КОНТРАТАКА (БЫЧЬЯ)' };
    }
    if (c1.isBullish && c2.isBearish && gap >= need && this.precededByRally(prev)) {
      return { found: true, name: 'КОНТРАТАКА (МЕДВЕЖЬЯ)' };
    }
    return { found: false, name: '' };
  }

  /**
   * ИСПРАВЛЕНО (гл. 7 ЯС): разделение — две КОНТРАСТНЫЕ свечи с одинаковыми
   * ценами открытия; бычье — продолжение РОСТА, медвежье — продолжение СПАДА.
   */
  static isSeparatingLines(c1: Candle, c2: Candle, prev: Candle[]): PatternDetection {
    const tol = Math.max(c1.open * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.1);
    if (Math.abs(c1.open - c2.open) > tol) return { found: false, name: '' };
    const winSL = this.relWindow(prev, prev.length - 1);
    if (!(this.isLongRelative(c1, winSL) && this.isLongRelative(c2, [...winSL.slice(1), c1]))) {
      return { found: false, name: '' };
    }

    // Бычье разделение: чёрная → белая (контраст), продолжение РОСТА.
    if (c1.isBearish && c2.isBullish && c2.open <= c2.low + c2.totalRange * 0.05 && this.precededByRally(prev)) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (БЫЧЬЕ)' };
    }
    // Медвежье разделение: белая → чёрная (контраст), продолжение СПАДА.
    if (c1.isBullish && c2.isBearish && c2.open >= c2.high - c2.totalRange * 0.05 && this.precededByDecline(prev)) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)' };
    }
    return { found: false, name: '' };
  }

  /**
   * ИСПРАВЛЕНО (гл. 4 ЯС): «ниже шеи / на шее / толчок» — МЕДВЕЖЬИ модели
   * продолжения спада, не бычьи.
   */
  static isNeckFamily(c1: Candle, c2: Candle, prev: Candle[]): PatternDetection {
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    // ИСПРАВЛЕНО (#B1): прежний гейт `c2.open >= c1.low` требовал открытия белой
    // НИЖЕ минимума чёрной. Так как low₁ ≤ close₁ по определению свечи, а на
    // круглосуточном рынке open₂ ≈ close₁, условие было невыполнимо всегда и все
    // три модели семьи шеи были недостижимы.
    // Канон ЯС гл.6 («Контратака»): у «на шее» торги открываются «лишь немного
    // ниже предыдущего уровня закрытия». Допуск adaptiveTol(0.15) и распространение
    // этого гейта на «ниже шеи» и «толчок» — проектная эвристика для рынков без
    // сессий: книга задаёт открытие только для «на шее» и без числового порога.
    // Сноска C1b (расхождение в источнике, требует решения владельца): в русском
    // издании два разных определения «на шее» — ЯС гл. 4: «в модели „на шее" —
    // чуть выше цены закрытия»; ЯС глоссарий А, «На шее»: «ценой закрытия немного
    // выше минимумов черной свечи». Для чёрной свечи close = bodyBottom, а
    // low ≤ close — это разные уровни. Привязки цен ЗАКРЫТИЯ ниже оставлены
    // как есть (по гл. 4); вариант не выбран самостоятельно из-за противоречия
    // в источнике.
    const openTol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (!c2.isBullish || c2.open > c1.close + openTol) return { found: false, name: '' };

    const tol = c1.totalRange * 0.05;
    const smallWhite = c2.body <= c1.body * 0.5;
    // ИСПРАВЛЕНО P0-2 (гл. 4 ЯС, «Другие модели разворота»): привязки «ниже
    // шеи» и «на шее» были перепутаны местами. По книге «ниже шеи» — белая
    // свеча закрывается ВБЛИЗИ МИНИМУМА предыдущего дня; «на шее» — ЧУТЬ
    // ВЫШЕ ЦЕНЫ ЗАКРЫТИЯ предыдущего дня. Проверка идёт от более низкого
    // уровня (минимум) к более высокому (закрытие), чтобы закрытие у самого
    // минимума не классифицировалось как «на шее».
    if (smallWhite && Math.abs(c2.close - c1.low) <= tol) {
      return { found: true, name: 'НИЖЕ ШЕИ' };
    }
    if (smallWhite && c2.close >= c1.close - tol && c2.close <= c1.close + tol * 2) {
      return { found: true, name: 'НА ШЕЕ' };
    }
    // У толчка белое тело не обязано быть малым, но закрытие не выше середины.
    if (c1.close < c2.close && c2.close < c1.bodyMid) {
      return { found: true, name: 'ТОЛЧОК' };
    }
    return { found: false, name: '' };
  }

  static isDoubleThrustingBull(candles: Candle[]): PatternDetection {
    if (candles.length < 4) return { found: false, name: '' };
    // P2-6 (ЯС гл. 4 «Двойной толчок»: «двойной толчок вниз» — бычий разворот
    // после спада): разворотная модель основания — требует предшествующего спада.
    if (!this.precededByDecline(candles.slice(0, -4))) return { found: false, name: '' };
    for (let i = 0; i < 2; i++) {
      const a = candles[candles.length - 4 + i * 2];
      const b = candles[candles.length - 3 + i * 2];
      if (!(a.isBearish && b.isBullish && a.bodyBottom < b.close && b.close < a.bodyMid)) {
        return { found: false, name: '' };
      }
    }
    return { found: true, name: 'ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)' };
  }

  // ─── гл. 6–7 ЯС: МНОГОСВЕЧНЫЕ ФОРМАЦИИ ───────────────────────────────

  static isTowerTop(candles: Candle[]): PatternDetection {
    return this.isTowerFormation(candles, true);
  }

  static isTowerBottom(candles: Candle[]): PatternDetection {
    return this.isTowerFormation(candles, false);
  }

  /** Длинная свеча(и) → переменная консолидация → длинная свеча(и) другого цвета. */
  private static isTowerFormation(candles: Candle[], top: boolean): PatternDetection {
    const n = candles.length;
    if (n < 4) return { found: false, name: '' };
    const end = n - 1;
    const longAt = (index: number, bullish: boolean) => {
      const candle = candles[index];
      return candle.isBullish === bullish &&
        (candle.isLongCandle || this.isLongRelative(candle, this.relWindow(candles, index)));
    };
    if (!longAt(end, !top)) return { found: false, name: '' };

    let rightStart = end;
    while (rightStart > 0 && end - rightStart < 2 && longAt(rightStart - 1, !top)) {
      rightStart--;
    }
    const rightLeg = candles.slice(rightStart, end + 1);

    for (let leftEnd = rightStart - 2; leftEnd >= Math.max(0, rightStart - 12); leftEnd--) {
      if (!longAt(leftEnd, top)) continue;
      const consolidation = candles.slice(leftEnd + 1, rightStart);
      if (consolidation.length === 0) continue;
      const bodyLimit = Math.max(candles[leftEnd].body, candles[end].body) * 0.6;
      if (consolidation.some((c) => c.body > bodyLimit)) continue;

      const crossed = top
        ? Math.min(...rightLeg.map((c) => c.close)) < Math.min(...consolidation.map((c) => c.low))
        : Math.max(...rightLeg.map((c) => c.close)) > Math.max(...consolidation.map((c) => c.high));
      if (!crossed) continue;

      let leftStart = leftEnd;
      while (leftStart > 0 && leftEnd - leftStart < 2 && longAt(leftStart - 1, top)) {
        leftStart--;
      }
      const prior = candles.slice(0, leftStart);
      if (top ? !this.precededByRally(prior) : !this.precededByDecline(prior)) continue;
      return {
        found: true,
        name: top ? 'БАШЕННАЯ ВЕРШИНА' : 'БАШЕННОЕ ДНО',
        formationSize: n - leftStart,
      };
    }
    return { found: false, name: '' };
  }

  static isThreeMountains(candles: Candle[]): PatternDetection {
    if (candles.length < 12) return { found: false, name: '' };
    const offset = Math.max(0, candles.length - 40);
    const seg = candles.slice(offset);
    const peaks = findSwings(seg, seg.length, 2).filter((s) => s.type === 'high').slice(-3);
    if (peaks.length < 3) return { found: false, name: '' };
    const top = Math.max(...peaks.map((p) => p.level));
    const alignTol = Math.max(top * 0.001,
      (seg.reduce((a, c) => a + c.totalRange, 0) / seg.length) * 0.3);
    if (!peaks.every((p) => Math.abs(p.level - top) <= alignTol)) return { found: false, name: '' };

    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const lastIndex = candles.length - 1;
    const thirdPeakIndex = offset + peaks[2].index;
    // Последняя гора сама по себе не завершает модель: нужна отдельная
    // медвежья свеча после неё. Закрытие ниже предыдущего минимума —
    // воспроизводимая проектная формализация этого подтверждения.
    if (lastIndex <= thirdPeakIndex || !last.isBearish || last.close >= previous.low) {
      return { found: false, name: '' };
    }
    return {
      found: true,
      name: 'ТРИ ГОРЫ (ВЕРШИНА)',
      formationSize: lastIndex - (offset + peaks[0].index) + 1,
    };
  }

  static isThreeRivers(candles: Candle[]): PatternDetection {
    if (candles.length < 12) return { found: false, name: '' };
    const offset = Math.max(0, candles.length - 40);
    const seg = candles.slice(offset);
    const troughs = findSwings(seg, seg.length, 2).filter((s) => s.type === 'low').slice(-3);
    if (troughs.length < 3) return { found: false, name: '' };
    const bottom = Math.min(...troughs.map((t) => t.level));
    const alignTol = Math.max(bottom * 0.001,
      (seg.reduce((a, c) => a + c.totalRange, 0) / seg.length) * 0.3);
    if (!troughs.every((t) => Math.abs(t.level - bottom) <= alignTol)) return { found: false, name: '' };

    const firstIndex = offset + troughs[0].index;
    const thirdIndex = offset + troughs[2].index;
    const lastIndex = candles.length - 1;
    if (lastIndex <= thirdIndex) return { found: false, name: '' };
    const intermediateTop = Math.max(...candles.slice(firstIndex + 1, thirdIndex).map((c) => c.high));
    const last = candles[lastIndex];
    // Бычье подтверждение появляется только при выходе выше обоих
    // промежуточных пиков, а не при любом росте относительно вчерашнего close.
    if (!last.isBullish || last.close <= intermediateTop) return { found: false, name: '' };
    return {
      found: true,
      name: 'ТРИ РЕКИ (ОСНОВАНИЕ)',
      formationSize: lastIndex - firstIndex + 1,
    };
  }

  /**
   * ИСПРАВЛЕНО (гл. 7 ЯС): объём — усилитель, не обязательное условие.
   * «Значимость моделей „три ступени" ПОВЫШАЕТСЯ, если объём выше».
   */
  static isRisingThree(candles: Candle[]): PatternDetection {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const l = candles[candles.length - 1];
    if (!this.precededByRally(candles.slice(0, -5))) return { found: false, name: '' };

    // P2-1 (гл. «Построение свечей» ЯС): длинное тело — относительно предшествующих
    // свечей; OR с абсолютной мерой — как в isTowerFormation (проектная эвристика).
    const winRT = this.relWindow(candles, candles.length - 5);
    const winRL = this.relWindow(candles, candles.length - 1);
    if (!(f.isBullish && (this.isLongRelative(f, winRT) || f.isLongCandle) &&
          l.isBullish && (this.isLongRelative(l, winRL) || l.isLongCandle))) return { found: false, name: '' };
    if (l.close <= f.close) return { found: false, name: '' };
    for (const s of small) {
      if (s.high > f.high || s.low < f.low || s.body > f.body * 0.5) return { found: false, name: '' };
    }
    // Дрейф вниз внутри паузы.
    if (small[2].close > small[0].close * 1.02) return { found: false, name: '' };

    let name = 'ВОСХОДЯЩИЕ ТРИ МЕТОДА';
    if (VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isFallingThree(candles: Candle[]): PatternDetection {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const l = candles[candles.length - 1];
    if (!this.precededByDecline(candles.slice(0, -5))) return { found: false, name: '' };

    // P2-1 (гл. «Построение свечей» ЯС): зеркально восходящим трём — относительная длина тела.
    const winFT = this.relWindow(candles, candles.length - 5);
    const winFL = this.relWindow(candles, candles.length - 1);
    if (!(f.isBearish && (this.isLongRelative(f, winFT) || f.isLongCandle) &&
          l.isBearish && (this.isLongRelative(l, winFL) || l.isLongCandle))) return { found: false, name: '' };
    if (l.close >= f.close) return { found: false, name: '' };
    for (const s of small) {
      if (s.high > f.high || s.low < f.low || s.body > f.body * 0.5) return { found: false, name: '' };
    }
    if (small[2].close < small[0].close * 0.98) return { found: false, name: '' };

    let name = 'НИСХОДЯЩИЕ ТРИ МЕТОДА';
    if (VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО (гл. 6 ЯС): малые свечи — в пределах ДИАПАЗОНА первой свечи,
   * первая малая может быть выше тела (гэп вверх по глоссарию).
   */
  static isMatHold(candles: Candle[]): PatternDetection {
    // В книге допускаются две, три или четыре маленькие ЧЁРНЫЕ свечи.
    for (const smallCount of [4, 3, 2]) {
      const size = smallCount + 2;
      if (candles.length < size) continue;
      const c0 = candles[candles.length - size];
      const small = candles.slice(candles.length - size + 1, candles.length - 1);
      const last = candles[candles.length - 1];
      // P2-1 (гл. «Построение свечей» ЯС): относительная длина тела первой и
      // последней свечи (OR с абсолютной мерой — проектная эвристика).
      const winMH0 = this.relWindow(candles, candles.length - size);
      const winMHL = this.relWindow(candles, candles.length - 1);
      if (!(c0.isBullish && (this.isLongRelative(c0, winMH0) || c0.isLongCandle))) continue;
      if (!small.every(s => s.isBearish && s.body <= c0.body * 0.5)) continue;
      if (small.some(s => s.high > c0.high || s.low < c0.low)) continue;
      if (!(last.isBullish && ((this.isLongRelative(last, winMHL) || last.isLongCandle) || last.open > small[small.length - 1].high))) continue;
      if (last.close <= Math.max(...small.map(s => s.high))) continue;
      if (!this.precededByRally(candles.slice(0, -size))) continue;
      let name = 'УДЕРЖАНИЕ НА ТАТАМИ';
      if (small[0].bodyBottom > c0.bodyTop) name += ' (ГЭП ВВЕРХ)';
      return { found: true, name, formationSize: size };
    }
    return { found: false, name: '' };
  }

  /**
   * P2-1e: «Лестничное дно» — ВСПОМОГАТЕЛЬНАЯ модель; источник — сторонние
   * справочники свечных моделей, у Нисона не описана (в ЯС и ЗГ такой модели
   * нет; прежняя ссылка «гл. 6 ЯС» была необоснованной). Геометрия и контекст —
   * проектная формализация: три чёрные свечи с последовательно снижающимися
   * закрытиями («ступени вниз»), затем четвёртая свеча НЕ закрывается ниже
   * третьей (падение остановлено), и пятая — длинная белая свеча, чьё закрытие
   * превышает максимум четвёртой.
   */
  static isLadderBottom(candles: Candle[]): PatternDetection {
    if (candles.length < 5) return { found: false, name: '' };
    // P2-6: разворотная модель основания — требует предшествующего спада.
    // Формация состоит из 5 свечей, поэтому в контекст входят и три снижающиеся
    // чёрные «ступени» самой лестницы: при короткой предыстории (prev.length < 4)
    // fallback проверяет, что формация начинается от локального дна.
    if (!this.precededByDeclineOrFormation(candles.slice(0, -2), 'down')) return { found: false, name: '' };
    const [c1, c2, c3, c4, c5] = candles.slice(-5);
    if (!([c1, c2, c3].every(c => c.isBearish))) return { found: false, name: '' };
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    // «Ступень» останавливается: четвёртая свеча не закрывается ниже третьей.
    if (!(c4.close >= c3.close)) return { found: false, name: '' };
    // Разворот: длинная белая свеча над максимумом четвёртой.
    // B3: Math.max(c4.high, c5.open) избыточен — c5.isBullish уже даёт
    // close > open, поэтому достаточно сравнения с c4.high (поведение не меняется).
    // P2-1 (проектная формализация относительной длины тела; ЯС гл. «Построение свечей»):
    // относительная длина тела разворота.
    if (!(c5.isBullish && (this.isLongRelative(c5, this.relWindow(candles, candles.length - 1)) || c5.isLongCandle))) return { found: false, name: '' };
    if (!(c5.close > c4.high)) return { found: false, name: '' };
    return { found: true, name: 'ЛЕСТНИЧНОЕ ДНО', formationSize: 5 };
  }

  /**
   * ИСПРАВЛЕНО (гл. 6 ЯС): «две взлетевшие вороны» — гэповая модель,
   * требует гейта и контекста восходящего тренда.
   */
  static isTwoCrows(candles: Candle[], context?: PatternContext): PatternDetection {
    if (patternContext(context).market !== 'stocks') return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];

    if (!(c1.isBullish && (this.isLongRelative(c1, this.relWindow(candles, candles.length - 3)) || c1.isLongCandle))) return { found: false, name: '' };
    if (!(c2.isBearish && c3.isBearish)) return { found: false, name: '' };
    if (c2.open <= c1.close) return { found: false, name: '' };
    if (c2.close <= c1.close) return { found: false, name: '' };
    if (!(c3.open > c2.open && c3.close < c2.close && c3.close > c1.close)) return { found: false, name: '' };
    if (!this.precededByRally(candles.slice(0, -3))) return { found: false, name: '' };

    let name = 'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ';
    if (ZoneVoter.isNearResistance(c3.close, candles.slice(0, -3), 0.015, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context))) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  static isAbandonedBaby(candles: Candle[], context?: PatternContext): PatternDetection {
    if (patternContext(context).market !== 'stocks') return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    if (!c2.isDoji) return { found: false, name: '' };

    if (c1.isBearish && c2.high < c1.low && c3.isBullish && c3.low > c2.high) {
      return { found: true, name: 'ПОКИНУТЫЙ МЛАДЕНЕЦ (НИЗ)' };
    }
    if (c1.isBullish && c2.low > c1.high && c3.isBearish && c3.high < c2.low) {
      return { found: true, name: 'ПОКИНУТЫЙ МЛАДЕНЕЦ (ВЕРХ)' };
    }
    return { found: false, name: '' };
  }

  static isTasuki(candles: Candle[], context?: PatternContext): PatternDetection {
    if (patternContext(context).market !== 'stocks') return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const similarBodies = Math.abs(c2.body - c3.body) <= Math.max(c2.body, c3.body) * 0.3;
    const opensInsideSecond = c3.open >= c2.bodyBottom && c3.open <= c2.bodyTop;
    if (!similarBodies || !opensInsideSecond) return { found: false, name: '' };

    if (c1.isBullish && c2.isBullish && c3.isBearish && c2.low > c1.high &&
      c3.close >= c1.high && c3.close < c2.low &&
      this.precededByRally(candles.slice(0, -3))) {
      return { found: true, name: 'ТАСУКИ ВОСХОДЯЩЕГО ГЭПА' };
    }
    if (c1.isBearish && c2.isBearish && c3.isBullish && c2.high < c1.low &&
      c3.close > c2.high && c3.close <= c1.low &&
      this.precededByDecline(candles.slice(0, -3))) {
      return { found: true, name: 'ТАСУКИ НИСХОДЯЩЕГО ГЭПА' };
    }
    return { found: false, name: '' };
  }

  static isGappingSideBySide(candles: Candle[], context?: PatternContext): PatternDetection {
    if (patternContext(context).market !== 'stocks') return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c0 = candles[candles.length - 3];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    // ОТМЕНА ошибочного P0-3 (гл. 7 ЯС, глоссарий А): downgap side-by-side
    // white lines — ДВЕ БЕЛЫЕ свечи после гэпа вниз на падающем рынке,
    // медвежий сигнал продолжения. Ветка с ЧЁРНЫМИ свечами («ГЭП СМЕЖНЫХ
    // ЧЁРНЫХ СВЕЧЕЙ») канону не соответствует и удалена вместе с методом
    // isGappingSideBySideLegacy и ID SIDE_BY_SIDE_GAP_BLACK_DOWN.
    if (Math.abs(c1.open - c2.open) / c1.open > 0.005 ||
      Math.abs(c1.body - c2.body) > Math.max(c1.body, c2.body) * 0.3) {
      return { found: false, name: '' };
    }

    if (c0.isBullish && c1.isBullish && c2.isBullish &&
      c1.low > c0.high && this.precededByRally(candles.slice(0, -3))) {
      return { found: true, name: 'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ' };
    }
    if (c0.isBearish && c1.isBullish && c2.isBullish &&
      c1.high < c0.low && this.precededByDecline(candles.slice(0, -3))) {
      return { found: true, name: 'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)' };
    }
    return { found: false, name: '' };
  }

  static isGappingPlay(candles: Candle[], context?: PatternContext): PatternDetection {
    if (patternContext(context).market !== 'stocks') return { found: false, name: '' };
    const last = candles[candles.length - 1];
    if (!last) return { found: false, name: '' };

    // Нисон допускает несколько свечей консолидации, а не фиксированные пять.
    for (let count = 8; count >= 2; count--) {
      const size = count + 1;
      if (candles.length < size + 4) continue;
      const consStart = candles.length - size;
      const cons = candles.slice(consStart, -1);
      if (!cons.every((c) => c.totalRange > 0 && c.body <= c.totalRange * 0.3)) continue;
      const consTop = Math.max(...cons.map((c) => c.high));
      const consBot = Math.min(...cons.map((c) => c.low));
      const prior = candles.slice(0, consStart);
      const impulse = prior.slice(-2);
      const avgRange = impulse.reduce((sum, c) => sum + c.totalRange, 0) / impulse.length;
      const move = impulse[impulse.length - 1].close - impulse[0].open;
      const sharpEnough = Math.abs(move) >= Math.max(avgRange * 1.5, consTop - consBot);

      if (last.isBullish && last.low > consTop && move > 0 && sharpEnough &&
        this.precededByRally(prior)) {
        return { found: true, name: 'ГЭП НА МАКСИМУМАХ', formationSize: size };
      }
      if (last.isBearish && last.high < consBot && move < 0 && sharpEnough &&
        this.precededByDecline(prior)) {
        return { found: true, name: 'ГЭП НА МИНИМУМАХ', formationSize: size };
      }
    }
    return { found: false, name: '' };
  }

  static isConsolidationBreakout(candles: Candle[]): PatternDetection {
    if (candles.length < 7) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-5, -1);
    const small = cons.filter(c => c.body <= c.totalRange * 0.5).length;
    if (small < 3) return { found: false, name: '' };
    const top = Math.max(...cons.map(c => c.high));
    const bot = Math.min(...cons.map(c => c.low));
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));
    const volOk = avg > 0 && last.volume > avg * 1.3;
    // P2-1g (гл. «Построение свечей» ЯС): длинное тело — относительное, по меридиане
    // предшествующих тел; абсолютная доля собственного диапазона недостаточна.
    const winCB = this.relWindow(candles, candles.length - 1);
    const longBody = this.isLongRelative(last, winCB) || last.isLongCandle;

    if (last.isBullish && longBody && last.close > top && volOk) {
      return { found: true, name: 'ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)' };
    }
    if (last.isBearish && longBody && last.close < bot && volOk) {
      return { found: true, name: 'ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)' };
    }
    return { found: false, name: '' };
  }

  /**
   * ИСПРАВЛЕНО (глоссарий ЯС): ключевой разворот — закрытие выше/ниже
   * предыдущей ЦЕНЫ ЗАКРЫТИЯ, а не максимума/минимума.
   */
  static isKeyReversal(candles: Candle[]): PatternDetection {
    if (candles.length < 21) return { found: false, name: '' };
    const n = candles.length;
    const last = candles[n - 1];
    const prev = candles[n - 2];
    const seg = candles.slice(-21, -1);
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));

    // P2-1 (гл. «Построение свечей» ЯС): длинное тело — относительно предшествующих.
    // P2-7 (гл. «Объём и открытый интерес» ЯС): объём УСИЛИВАЕТ сигнал, а не является
    // обязательным условием — переведён из жёсткого гейта в метку «(ОБЪЁМ)» ниже.
    const winKR = this.relWindow(candles, n - 1);
    if (!this.isLongRelative(last, winKR)) return { found: false, name: '' };

    let name = '';
    if (last.isBullish && last.low < lo && last.close > prev.close && this.precededByDecline(seg)) {
      name = 'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)';
    } else if (last.isBearish && last.high > hi && last.close < prev.close && this.precededByRally(seg)) {
      name = 'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)';
    }
    if (!name) return { found: false, name: '' };

    if (avg > 0 && last.volume > avg * 1.3) name += ' (ОБЪЁМ)';

    if (last.isBullish && last.close > prev.high) name += ' (ВНЕШНИЙ ДЕНЬ)';
    if (last.isBearish && last.close < prev.low) name += ' (ВНЕШНИЙ ДЕНЬ)';
    return { found: true, name };
  }

  static isVolSpin(candle: Candle, candles: Candle[]): PatternDetection {
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));
    if (!(avg > 0 && candle.volume > avg * 1.5)) return { found: false, name: '' };
    if (candle.totalRange <= 0 || candle.body > candle.totalRange * 0.3) return { found: false, name: '' };
    // P2-5: позиция считается по окну ПРЕДШЕСТВУЮЩИХ свечей — новый экстремум
    // не должен автоматически давать pos=0/1 (иначе любая свеча за пределами
    // старого диапазона «накапливается» или «распределяется»).
    const seg = candles.slice(0, -1).slice(-20);
    if (seg.length === 0) return { found: false, name: '' };
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    if (hi <= lo) return { found: false, name: '' };
    const pos = (candle.close - lo) / (hi - lo);
    if (pos <= 0.3) return { found: true, name: 'НАКОПЛЕНИЕ' };
    if (pos >= 0.7) return { found: true, name: 'РАСПРЕДЕЛЕНИЕ' };
    return { found: false, name: '' };
  }

  static isLevelTest(candles: Candle[], context?: PatternContext): PatternDetection {
    if (candles.length < 30) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(0, -1);
    const mid = (last.high + last.low) / 2;
    const closes = pre.map(c => c.close);
    // P2-2: канон ЯС, глава «Скользящие средние» — канонические ПРОСТЫЕ средние
    // (в т.ч. 65-дневная). EMA противоречила каноны и согласованности с zone_voter.ts
    // («SMA, а не EMA: канон»). Guards на NaN сохранены.
    const m20 = sma(closes, 20);
    const m65 = sma(closes, 65);
    const m20Val = m20.length > 0 && Number.isFinite(m20[m20.length - 1]) ? m20[m20.length - 1] : null;
    const m65Val = m65.length > 0 && Number.isFinite(m65[m65.length - 1]) ? m65[m65.length - 1] : null;

    const supHold = (m20Val !== null && last.low <= m20Val * 1.005 && last.close > m20Val) ||
      (m65Val !== null && last.low <= m65Val * 1.005 && last.close > m65Val) ||
      (ZoneVoter.isNearSupport(last.close, pre, 0.01, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context)) && last.close > last.open);
    const resHold = (m20Val !== null && last.high >= m20Val * 0.995 && last.close < m20Val) ||
      (m65Val !== null && last.high >= m65Val * 0.995 && last.close < m65Val) ||
      (ZoneVoter.isNearResistance(last.close, pre, 0.01, timeframeKey(patternContext(context).timeframe), undefined, zoneMarket(context)) && last.close < last.open);

    if (supHold && (last.isBullish || last.close > mid)) return { found: true, name: 'ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)' };
    if (resHold && (last.isBearish || last.close < mid)) return { found: true, name: 'ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)' };
    return { found: false, name: '' };
  }

  static isTrendPullbackCandle(candles: Candle[]): PatternDetection {
    if (candles.length < 20) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(0, -1);
    const bodyRatio = last.body / last.totalRange;
    if (bodyRatio < 0.6) return { found: false, name: '' };
    const pullbackWindow = pre.slice(-5);

    if (last.isBullish) {
      const pull = pullbackWindow[pullbackWindow.length - 1].close - pullbackWindow[0].close;
      if (pull >= 0) return { found: false, name: '' };
      if (last.close < Math.max(...pullbackWindow.map(c => c.close))) return { found: false, name: '' };
      return { found: true, name: 'ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ' };
    }
    if (last.isBearish) {
      const pull = pullbackWindow[pullbackWindow.length - 1].close - pullbackWindow[0].close;
      if (pull <= 0) return { found: false, name: '' };
      if (last.close > Math.min(...pullbackWindow.map(c => c.close))) return { found: false, name: '' };
      return { found: true, name: 'ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ' };
    }
    return { found: false, name: '' };
  }
}
