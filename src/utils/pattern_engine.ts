import { Candle } from './candle';
import { ema } from './indicators';
import { ZoneVoter, timeframeKey, type TimeframeKey } from './zone_voter';
import { findSwings } from './levels';
import { getSwingTrend } from './trend_detection';
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
  static isHighVolume(candle: Candle, candles: Candle[], multiplier: number = 1.3): boolean {
    const prev = candles.slice(0, -1);
    const avg = this.getAverageVolume(prev);
    return avg > 0 && candle.volume > avg * multiplier;
  }
}

let PATTERN_TF_KEY: TimeframeKey = 'swing';
export function setPatternTimeframe(tf: string): void { PATTERN_TF_KEY = timeframeKey(tf); }
export function getPatternTimeframe(): TimeframeKey { return PATTERN_TF_KEY; }

type MarketKind = 'crypto' | 'stocks';
let CURRENT_MARKET: MarketKind = 'crypto';
export function setMarket(market: MarketKind): void { CURRENT_MARKET = market; }
export function getMarket(): MarketKind { return CURRENT_MARKET; }
function GAP_PATTERNS_ENABLED(): boolean { return CURRENT_MARKET === 'stocks'; }

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
  static getFormationBounds(patternName: string, candles: Candle[], endIdx: number) {
    const n = candles.length;
    if (n === 0) {
      return { patternCandlesCount: 0, patternStartIdx: -1, patternEndIdx: -1, patternLow: 0, patternHigh: 0 };
    }
    const idx = Math.min(Math.max(endIdx, 0), n - 1);
    const count = Math.min(getPatternCandleCount(patternName), idx + 1);
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

  private static precededByDecline(prev: Candle[]): boolean {
    const seg = prev.slice(-8);
    if (seg.length < 4) return false;
    const first = seg[0].close, last = seg[seg.length - 1].close;
    const lo = Math.min(...seg.map(c => c.low));
    const avgRange = seg.reduce((s, c) => s + (c.high - c.low), 0) / seg.length;
    return last <= first * 0.997 || last <= first - avgRange * 0.5 || last <= lo * 1.02;
  }

  private static precededByRally(prev: Candle[]): boolean {
    const seg = prev.slice(-8);
    if (seg.length < 4) return false;
    const first = seg[0].close, last = seg[seg.length - 1].close;
    const hi = Math.max(...seg.map(c => c.high));
    const avgRange = seg.reduce((s, c) => s + (c.high - c.low), 0) / seg.length;
    return last >= first * 1.003 || last >= first + avgRange * 0.5 || last >= hi * 0.98;
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

  static isHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };

    const nearSupport = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.low) ||
      ZoneVoter.isNearSupport(candle.low, prevCandles, 0.01, PATTERN_TF_KEY);
    if (!nearSupport) return { found: false, name: '' };

    const volumeOk = VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3);
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    const maOk = m20 !== null && Number.isFinite(m20) && Math.abs(candle.low - m20) <= m20 * 0.01;

    let name = 'МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (volumeOk) name += ' (ОБЪЁМ)';
    else if (maOk) name += ' (MA20)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО (гл. 4, рис. 4.8–4.9 ЯС): у несовершенного молота нижняя
   * тень короче двух тел, но не меньше одного тела.
   */
  static isImperfectHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.5) return { found: false, name: '' };
    if (candle.lowerWick < candle.body) return { found: false, name: '' };
    if (candle.lowerWick >= candle.body * 2) return { found: false, name: '' }; // иначе это обычный молот
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };

    const nearSupport = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.low) ||
      ZoneVoter.isNearSupport(candle.low, prevCandles, 0.01, PATTERN_TF_KEY);
    if (!nearSupport) return { found: false, name: '' };

    return { found: true, name: 'МОЛОТ (НЕСОВЕРШЕННЫЙ)' };
  }

  /**
   * ИСПРАВЛЕНО: тело в НИЖНЕЙ части диапазона — сравнение с серединой
   * ДИАПАЗОНА, а не тела (цвет не важен, гл. 5 ЯС).
   */
  static isInvertedHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };

    const nearSupport = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.low) ||
      ZoneVoter.isNearSupport(candle.low, prevCandles, 0.01, PATTERN_TF_KEY);
    if (!nearSupport) return { found: false, name: '' };

    let name = 'ПЕРЕВЁРНУТЫЙ МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО: тело у ВЕРХНЕЙ границы диапазона — сравнение с серединой
   * ДИАПАЗОНА (цвет не важен, гл. 4 ЯС).
   */
  static isHangingMan(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalHigh(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByRally(prevCandles)) return { found: false, name: '' };

    let name = 'ПОВЕШЕННЫЙ';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (candle.isBearish) name += ' (ЧЁРНОЕ ТЕЛО)';
    return { found: true, name };
  }

  static isShootingStar(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.atLocalHigh(candle, prevCandles)) return { found: false, name: '' };
    if (!this.precededByRally(prevCandles)) return { found: false, name: '' };

    let name = 'ПАДАЮЩАЯ ЗВЕЗДА';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  // ─── гл. 8 ЯС: ДОДЖИ И ВЫСОКАЯ ВОЛНА ────────────────────────────────

  /**
   * ИСПРАВЛЕНО: добавлены длинноногая дожи и рикша (гл. 8 ЯС).
   */
  static classifyDoji(candle: Candle): { found: boolean; name: string } {
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
  static isHighWave(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
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

  static isBullishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBullish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };

    let name = 'БЫЧЬЕ ПОГЛОЩЕНИЕ';
    if (this.isSmallRelative(c1, prev.slice(-20)) && this.isLongRelative(c2, prev.slice(-20))) name += ' (СИЛЬНОЕ)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isBearishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBearish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };

    let name = 'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ';
    if (this.isSmallRelative(c1, prev.slice(-20)) && this.isLongRelative(c2, prev.slice(-20))) name += ' (СИЛЬНОЕ)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО (гл. 4 ЯС): гэп смягчён до адаптивного допуска — на крипте
   * строгие гэпы редки; метка «(ГЭП)» ставится только при настоящем гэпе.
   */
  static isDarkCloudCover(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBearish && c2.isLongCandle)) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    if (c2.close >= c1.bodyMid || c2.close <= c1.open) return { found: false, name: '' };

    const tol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (c2.open < c1.close - tol) return { found: false, name: '' };

    let name = 'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ';
    if (c2.open > c1.high) name += ' (ГЭП ВЫШЕ МАКСИМУМА)';
    else if (c2.open > c1.close) name += ' (ГЭП)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  static isPiercingPattern(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBullish && c2.isLongCandle)) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    if (c2.close <= c1.bodyMid || c2.close >= c1.open) return { found: false, name: '' };

    const tol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (c2.open > c1.close + tol) return { found: false, name: '' };

    let name = 'ПРОСВЕТ В ОБЛАКАХ';
    if (c2.open < c1.low) name += ' (ГЭП НИЖЕ МИНИМУМА)';
    else if (c2.open < c1.close) name += ' (ГЭП)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  /**
   * ИСПРАВЛЕНО (ЗГ гл. 3): основание «последнее поглощение» — крупная ЧЁРНАЯ
   * поглощает малое БЕЛОЕ во время СПАДА; вершина — зеркально.
   */
  static isLastEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
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
  static isMorningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const winMS = this.relWindow(candles, candles.length - 3);

    const ctxMS = candles.slice(Math.max(0, candles.length - 13), candles.length - 2);
    if (ctxMS.length >= 4) {
      const ctxHi = Math.max(...ctxMS.map(x => x.high));
      const ctxLo = Math.min(...ctxMS.map(x => x.low));
      if (ctxHi > ctxLo && c1.close > ctxLo + (ctxHi - ctxLo) * 0.34) return { found: false, name: '' };
    }
    if (!(c1.isBearish && this.isLongRelative(c1, winMS))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, winMS)) return { found: false, name: '' };
    if (!(c3.isBullish && this.isLongRelative(c3, winMS))) return { found: false, name: '' };
    if (c3.close <= c1.bodyMid) return { found: false, name: '' };

    const gapTol = this.adaptiveTol(candles.slice(0, -3), 0.15);
    if (c2.close > c1.bodyBottom + gapTol) return { found: false, name: '' };

    {
      const seg = candles.slice(Math.max(0, candles.length - 11), candles.length - 2);
      if (!this.makesNewExtreme(c2.low, seg, true)) return { found: false, name: '' };
    }

    let name = c2.isDoji ? 'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА' : 'УТРЕННЯЯ ЗВЕЗДА';
    if (c2.high < c1.bodyBottom) name += ' (ГЭП ВНИЗ)';
    if (c3.open > c2.bodyTop) name += ' (ГЭП ВВЕРХ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isEveningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const winES = this.relWindow(candles, candles.length - 3);

    const ctxES = candles.slice(Math.max(0, candles.length - 13), candles.length - 2);
    if (ctxES.length >= 4) {
      const ctxHi = Math.max(...ctxES.map(x => x.high));
      const ctxLo = Math.min(...ctxES.map(x => x.low));
      if (ctxHi > ctxLo && c1.close < ctxHi - (ctxHi - ctxLo) * 0.34) return { found: false, name: '' };
    }
    if (!(c1.isBullish && this.isLongRelative(c1, winES))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, winES)) return { found: false, name: '' };
    if (!(c3.isBearish && this.isLongRelative(c3, winES))) return { found: false, name: '' };
    if (c3.close >= c1.bodyMid) return { found: false, name: '' };

    const gapTol = this.adaptiveTol(candles.slice(0, -3), 0.15);
    if (c2.close < c1.bodyTop - gapTol) return { found: false, name: '' };

    {
      const seg = candles.slice(Math.max(0, candles.length - 11), candles.length - 2);
      if (!this.makesNewExtreme(c2.high, seg, false)) return { found: false, name: '' };
    }

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
  static isThreeWhiteSoldiers(candles: Candle[]): { found: boolean; name: string } {
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

    return { found: true, name: 'ТРИ БЕЛЫХ СОЛДАТА' };
  }

  /**
   * ИСПРАВЛЕНО (гл. 6 ЯС): добавлен контекст предшествующего роста и
   * выделение «трёх одинаковых ворон» (глоссарий ЯС).
   */
  static isThreeBlackCrows(candles: Candle[]): { found: boolean; name: string } {
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

  /** НОВОЕ (гл. 7 ЯС): «отбитое наступление» — ослабление быков. */
  static isAdvanceBlock(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];

    if (!([c1, c2, c3].every(c => c.isBullish))) return { found: false, name: '' };
    if (!(c2.close > c1.close && c3.close > c2.close)) return { found: false, name: '' };
    if (!this.precededByRally(candles.slice(0, -3))) return { found: false, name: '' };

    const shrinkingBodies = c3.body < c2.body && c2.body < c1.body;
    const longUpperLastTwo = c2.upperWick > c2.totalRange * 0.3 && c3.upperWick > c3.totalRange * 0.3;
    if (!(shrinkingBodies || longUpperLastTwo)) return { found: false, name: '' };

    return { found: true, name: 'ОТБИТОЕ НАСТУПЛЕНИЕ' };
  }

  /** НОВОЕ (гл. 7 ЯС): «торможение» — малая свеча на плече длинной белой. */
  static isStalled(candles: Candle[]): { found: boolean; name: string } {
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
  static isSpring(candles: Candle[]): { found: boolean; name: string } {
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
  static isUpthrust(candles: Candle[]): { found: boolean; name: string } {
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

  static isHarami(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!this.isLongRelative(c1, this.relWindow([...prev, c1], prev.length + 1))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, [...prev.slice(-19), c1])) return { found: false, name: '' };
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };

    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ' };
    return { found: false, name: '' };
  }

  static isHaramiCross(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!this.isLongRelative(c1, this.relWindow([...prev, c1], prev.length + 1))) return { found: false, name: '' };
    if (!c2.isDoji) return { found: false, name: '' };
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };

    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ-КРЕСТ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ' };
    return { found: false, name: '' };
  }

  static isTweezerBottom(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && c2.isBullish)) return { found: false, name: '' };
    const tolB = Math.max(c1.low * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.15);
    if (Math.abs(c1.low - c2.low) > tolB) return { found: false, name: '' };
    if (!ZoneVoter.isNearSupport(c2.low, prev, 0.01, PATTERN_TF_KEY)) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    return { found: true, name: 'ПИНЦЕТ (НИЗ)' };
  }

  static isTweezerTop(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish && c2.isBearish)) return { found: false, name: '' };
    const tolT = Math.max(c1.high * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.15);
    if (Math.abs(c1.high - c2.high) > tolT) return { found: false, name: '' };
    if (!ZoneVoter.isNearResistance(c2.high, prev, 0.01, PATTERN_TF_KEY)) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    return { found: true, name: 'ПИНЦЕТ (ВЕРХ)' };
  }

  /**
   * ИСПРАВЛЕНО (гл. 6 ЯС): убрано выдуманное условие `c2.open >= c1.close`.
   * Захват за пояс — длинная свеча с открытием на экстремуме сессии.
   */
  static isBullishBelt(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c2.isBullish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.lowerWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };

    let name = 'ЛИНИЯ ПОЯСА (БЫЧЬЯ)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  static isBearishBelt(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c2.isBearish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.upperWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };

    let name = 'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  static isCounterattack(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    const closeTol = Math.max(c1.close * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.1);
    if (Math.abs(c1.close - c2.close) > closeTol) return { found: false, name: '' };
    if (!(c1.isLongCandle && c2.isLongCandle)) return { found: false, name: '' };
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
  static isSeparatingLines(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
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
  static isNeckFamily(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBullish && c2.body <= c1.body * 0.5)) return { found: false, name: '' };

    const tol = c1.totalRange * 0.05;
    if (Math.abs(c2.close - c1.low) <= tol) return { found: true, name: 'НИЖЕ ШЕИ' };
    if (c1.bodyBottom - tol <= c2.close && c2.close <= c1.bodyBottom + tol) return { found: true, name: 'НА ШЕЕ' };
    if (c1.bodyBottom < c2.close && c2.close < c1.bodyMid) return { found: true, name: 'ТОЛЧОК' };
    return { found: false, name: '' };
  }

  static isDoubleThrustingBull(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 4) return { found: false, name: '' };
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

  static isTowerTop(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    if (!(candles[candles.length - 2].isBullish && candles[candles.length - 3].isBullish)) return { found: false, name: '' };
    {
      const pre = candles.slice(Math.max(0, candles.length - 11), candles.length - 1);
      if (pre.length >= 3) {
        const hi = Math.max(...pre.map(c => c.high));
        const lo = Math.min(...pre.map(c => c.low));
        const lastPre = pre[pre.length - 1];
        if (!(lastPre.close >= lo + (hi - lo) * 0.6 && hi > lo)) return { found: false, name: '' };
      }
    }
    const last = candles[candles.length - 1];
    if (!(last.isBearish && (this.isLongRelative(last, this.relWindow(candles, candles.length - 1)) || last.isLongCandle))) return { found: false, name: '' };
    if (last.close >= Math.min(candles[candles.length - 2].low, candles[candles.length - 3].low)) return { found: false, name: '' };
    return { found: true, name: 'БАШЕННАЯ ВЕРШИНА' };
  }

  static isTowerBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    if (!(candles[candles.length - 2].isBearish && candles[candles.length - 3].isBearish)) return { found: false, name: '' };
    {
      const pre = candles.slice(Math.max(0, candles.length - 11), candles.length - 1);
      if (pre.length >= 3) {
        const hi = Math.max(...pre.map(c => c.high));
        const lo = Math.min(...pre.map(c => c.low));
        const lastPre = pre[pre.length - 1];
        if (!(lastPre.close <= lo + (hi - lo) * 0.4 && hi > lo)) return { found: false, name: '' };
      }
    }
    const last = candles[candles.length - 1];
    if (!(last.isBullish && (this.isLongRelative(last, this.relWindow(candles, candles.length - 1)) || last.isLongCandle))) return { found: false, name: '' };
    if (last.close <= Math.max(candles[candles.length - 2].high, candles[candles.length - 3].high)) return { found: false, name: '' };
    return { found: true, name: 'БАШЕННОЕ ДНО' };
  }

  static isThreeMountains(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const highs: number[] = [];
    for (let i = 2; i < seg.length - 2; i++) {
      if (seg[i].high > seg[i - 1].high && seg[i].high > seg[i - 2].high &&
        seg[i].high > seg[i + 1].high && seg[i].high > seg[i + 2].high) {
        highs.push(seg[i].high);
      }
    }
    if (highs.length < 3) return { found: false, name: '' };
    const h = highs.slice(-3);
    const top = Math.max(...h);
    const alignTol = Math.max(top * 0.001, (seg.reduce((a, c) => a + (c.high - c.low), 0) / seg.length) * 0.3);
    if (!h.every(x => Math.abs(x - top) <= alignTol)) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    if (!(last.isBearish && last.close < candles[candles.length - 2].close)) return { found: false, name: '' };
    return { found: true, name: 'ТРИ ГОРЫ (ВЕРШИНА)' };
  }

  static isThreeRivers(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const lows: number[] = [];
    for (let i = 2; i < seg.length - 2; i++) {
      if (seg[i].low < seg[i - 1].low && seg[i].low < seg[i - 2].low &&
        seg[i].low < seg[i + 1].low && seg[i].low < seg[i + 2].low) {
        lows.push(seg[i].low);
      }
    }
    if (lows.length < 3) return { found: false, name: '' };
    const l = lows.slice(-3);
    const bot = Math.min(...l);
    const alignTolr = Math.max(bot * 0.001, (seg.reduce((a, c) => a + (c.high - c.low), 0) / seg.length) * 0.3);
    if (!l.every(x => Math.abs(x - bot) <= alignTolr)) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    if (!(last.isBullish && last.close > candles[candles.length - 2].close)) return { found: false, name: '' };
    return { found: true, name: 'ТРИ РЕКИ (ОСНОВАНИЕ)' };
  }

  /**
   * ИСПРАВЛЕНО (гл. 7 ЯС): объём — усилитель, не обязательное условие.
   * «Значимость моделей „три ступени" ПОВЫШАЕТСЯ, если объём выше».
   */
  static isRisingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const l = candles[candles.length - 1];

    if (!(f.isBullish && f.isLongCandle && l.isBullish && l.isLongCandle)) return { found: false, name: '' };
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

  static isFallingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const l = candles[candles.length - 1];

    if (!(f.isBearish && f.isLongCandle && l.isBearish && l.isLongCandle)) return { found: false, name: '' };
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
  static isMatHold(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const c0 = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const c4 = candles[candles.length - 1];

    if (!(c0.isBullish && c0.isLongCandle)) return { found: false, name: '' };
    if (!small[0].isBearish) return { found: false, name: '' };
    for (const s of small) {
      if (s.body > c0.body * 0.5) return { found: false, name: '' };
      if (s.high > c0.high || s.low < c0.low) return { found: false, name: '' };
    }
    if (!(c4.isBullish && c4.isLongCandle)) return { found: false, name: '' };
    if (c4.close <= Math.max(...small.map(s => s.high))) return { found: false, name: '' };
    if (!this.precededByRally(candles.slice(0, -5))) return { found: false, name: '' };

    let name = 'УДЕРЖАНИЕ НА ТАТАМИ';
    if (small[0].bodyBottom > c0.bodyTop) name += ' (ГЭП ВВЕРХ)';
    return { found: true, name };
  }

  static isLadderBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const [c1, c2, c3, c4, c5] = candles.slice(-5);
    if (!([c1, c2, c3].every(c => c.isBearish))) return { found: false, name: '' };
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    if (!(c4.isBearish && c4.upperWick >= c4.totalRange * 0.3)) return { found: false, name: '' };
    if (!(c5.isBullish && c5.isLongCandle && c5.close > c4.high)) return { found: false, name: '' };
    return { found: true, name: 'ЛЕСТНИЧНОЕ ДНО' };
  }

  /**
   * ИСПРАВЛЕНО (гл. 6 ЯС): «две взлетевшие вороны» — гэповая модель,
   * требует гейта и контекста восходящего тренда.
   */
  static isTwoCrows(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
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
    if (ZoneVoter.isNearResistance(c3.close, candles.slice(0, -3), 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  static isAbandonedBaby(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
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

  static isTasuki(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];

    if (c1.isBullish && c2.isBullish && c2.open > c1.close && c3.isBearish && c1.close <= c3.close && c3.close <= c2.open) {
      return { found: true, name: 'ТАСУКИ ВОСХОДЯЩЕГО ГЭПА' };
    }
    if (c1.isBearish && c2.isBearish && c2.open < c1.close && c3.isBullish && c1.close >= c3.close && c3.close >= c2.open) {
      return { found: true, name: 'ТАСУКИ НИСХОДЯЩЕГО ГЭПА' };
    }
    return { found: false, name: '' };
  }

  static isGappingSideBySide(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c0 = candles[candles.length - 3];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];

    if (c0.isBearish && c1.open > c0.high && c1.isBullish && c2.isBullish) {
      if (Math.abs(c1.open - c2.open) / c1.open <= 0.005 &&
        Math.abs(c1.body - c2.body) <= Math.max(c1.body, c2.body) * 0.3) {
        return { found: true, name: 'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ' };
      }
    }
    return { found: false, name: '' };
  }

  static isGappingPlay(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 7) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-6, -1);
    if (!cons.every(c => c.totalRange > 0 && c.body <= c.totalRange * 0.3)) return { found: false, name: '' };
    const consTop = Math.max(...cons.map(c => c.high));
    const consBot = Math.min(...cons.map(c => c.low));

    if (last.isBullish && last.open >= consTop) return { found: true, name: 'ГЭП НА МАКСИМУМАХ' };
    if (last.isBearish && last.open <= consBot) return { found: true, name: 'ГЭП НА МИНИМУМАХ' };
    return { found: false, name: '' };
  }

  static isConsolidationBreakout(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 7) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-5, -1);
    const small = cons.filter(c => c.body <= c.totalRange * 0.5).length;
    if (small < 3) return { found: false, name: '' };
    const top = Math.max(...cons.map(c => c.high));
    const bot = Math.min(...cons.map(c => c.low));
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));
    const volOk = avg > 0 && last.volume > avg * 1.3;

    if (last.isBullish && last.isLongCandle && last.close > top && volOk) {
      return { found: true, name: 'ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)' };
    }
    if (last.isBearish && last.isLongCandle && last.close < bot && volOk) {
      return { found: true, name: 'ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)' };
    }
    return { found: false, name: '' };
  }

  /**
   * ИСПРАВЛЕНО (глоссарий ЯС): ключевой разворот — закрытие выше/ниже
   * предыдущей ЦЕНЫ ЗАКРЫТИЯ, а не максимума/минимума.
   */
  static isKeyReversal(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 21) return { found: false, name: '' };
    const n = candles.length;
    const last = candles[n - 1];
    const prev = candles[n - 2];
    const seg = candles.slice(-21, -1);
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));

    if (!(last.isLongCandle && avg > 0 && last.volume > avg * 1.3)) return { found: false, name: '' };

    const winKR = this.relWindow(candles, n - 1);
    if (!this.isLongRelative(last, winKR)) return { found: false, name: '' };

    let name = '';
    if (last.isBullish && last.low < lo && last.close > prev.close && this.precededByDecline(seg)) {
      name = 'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)';
    } else if (last.isBearish && last.high > hi && last.close < prev.close && this.precededByRally(seg)) {
      name = 'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)';
    }
    if (!name) return { found: false, name: '' };

    if (last.isBullish && last.close > prev.high) name += ' (ВНЕШНИЙ ДЕНЬ)';
    if (last.isBearish && last.close < prev.low) name += ' (ВНЕШНИЙ ДЕНЬ)';
    return { found: true, name };
  }

  static isVolSpin(candle: Candle, candles: Candle[]): { found: boolean; name: string } {
    const avg = VolumeAnalyzer.getAverageVolume(candles);
    if (!(avg > 0 && candle.volume > avg * 1.5)) return { found: false, name: '' };
    if (candle.totalRange <= 0 || candle.body > candle.totalRange * 0.3) return { found: false, name: '' };
    const seg = candles.slice(-20);
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    if (hi <= lo) return { found: false, name: '' };
    const pos = (candle.close - lo) / (hi - lo);
    if (pos <= 0.3) return { found: true, name: 'НАКОПЛЕНИЕ' };
    if (pos >= 0.7) return { found: true, name: 'РАСПРЕДЕЛЕНИЕ' };
    return { found: false, name: '' };
  }

  static isLevelTest(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 30) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(0, -1);
    const mid = (last.high + last.low) / 2;
    const closes = pre.map(c => c.close);
    const m20 = ema(closes, 20);
    const m65 = ema(closes, 65);
    const m20Val = m20.length > 0 && Number.isFinite(m20[m20.length - 1]) ? m20[m20.length - 1] : null;
    const m65Val = m65.length > 0 && Number.isFinite(m65[m65.length - 1]) ? m65[m65.length - 1] : null;

    const supHold = (m20Val !== null && last.low <= m20Val * 1.005 && last.close > m20Val) ||
      (m65Val !== null && last.low <= m65Val * 1.005 && last.close > m65Val) ||
      (ZoneVoter.isNearSupport(last.close, pre, 0.01, PATTERN_TF_KEY) && last.close > last.open);
    const resHold = (m20Val !== null && last.high >= m20Val * 0.995 && last.close < m20Val) ||
      (m65Val !== null && last.high >= m65Val * 0.995 && last.close < m65Val) ||
      (ZoneVoter.isNearResistance(last.close, pre, 0.01, PATTERN_TF_KEY) && last.close < last.open);

    if (supHold && (last.isBullish || last.close > mid)) return { found: true, name: 'ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)' };
    if (resHold && (last.isBearish || last.close < mid)) return { found: true, name: 'ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)' };
    return { found: false, name: '' };
  }

  static isTrendPullbackCandle(candles: Candle[]): { found: boolean; name: string } {
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
