import { Candle } from './candle';
import { ema } from './indicators';
import { ZoneVoter } from './zone_voter';

export class SupportResistance {
  static findLevels(candles: Candle[], lookback: number = 50): { support: number[]; resistance: number[] } {
    const recent = candles.slice(-lookback);
    const support: number[] = [];
    const resistance: number[] = [];
    
    for (let i = 2; i < recent.length - 2; i++) {
      const c = recent[i];
      
      if (c.low < recent[i - 1].low && c.low < recent[i - 2].low &&
          c.low < recent[i + 1].low && c.low < recent[i + 2].low) {
        support.push(c.low);
      }
      
      if (c.high > recent[i - 1].high && c.high > recent[i - 2].high &&
          c.high > recent[i + 1].high && c.high > recent[i + 2].high) {
        resistance.push(c.high);
      }
    }
    
    return { support, resistance };
  }
  
  static isNearSupport(price: number, candles: Candle[], tolerance: number = 0.015): boolean {
    const levels = this.findLevels(candles);
    return levels.support.some(level => Math.abs(price - level) / price <= tolerance);
  }
  
  static isNearResistance(price: number, candles: Candle[], tolerance: number = 0.015): boolean {
    const levels = this.findLevels(candles);
    return levels.resistance.some(level => Math.abs(price - level) / price <= tolerance);
  }
}

export class VolumeAnalyzer {
  static getAverageVolume(candles: Candle[], period: number = 20): number {
    if (candles.length < period) return 0;
    const recent = candles.slice(-period);
    return recent.reduce((s, c) => s + c.volume, 0) / period;
  }
  
  static isHighVolume(candle: Candle, candles: Candle[], multiplier: number = 1.3): boolean {
    const prevCandles = candles.slice(0, -1);
    const avg = this.getAverageVolume(prevCandles);
    return avg > 0 && candle.volume > avg * multiplier;
  }
}

export class PatternDetector {
  static getFormationBounds(patternName: string, candles: Candle[], endIdx: number) {
    if (endIdx < 0 || endIdx >= candles.length) {
      const c = candles[endIdx];
      return {
        patternCandlesCount: 1,
        patternStartIdx: endIdx,
        patternEndIdx: endIdx,
        patternLow: c.low,
        patternHigh: c.high
      };
    }
    
    const p = patternName.toUpperCase();
    
    if (['МОЛОТ', 'ПОВЕШЕННЫЙ', 'ЗВЕЗДА', 'ДОДЖИ', 'СТРЕКОЗА', 'НАДГРОБИЕ', 'ПЕРЕВЁРНУТЫЙ МОЛОТ'].some(k => p.includes(k))) {
      const c = candles[endIdx];
      return {
        patternCandlesCount: 1,
        patternStartIdx: endIdx,
        patternEndIdx: endIdx,
        patternLow: c.low,
        patternHigh: c.high
      };
    }
    
    if (['ПОГЛОЩЕНИЕ', 'ЗАВЕСА', 'ПРОСВЕТ', 'ХАРАМИ', 'ПИНЦЕТ', 'ПОЯСА', 'КОНТРАТАКА', 'РАЗДЕЛЕНИЕ', 'ШЕИ', 'ТОЛЧОК'].some(k => p.includes(k))) {
      const startIdx = Math.max(0, endIdx - 1);
      const c1 = candles[startIdx];
      const c2 = candles[endIdx];
      return {
        patternCandlesCount: 2,
        patternStartIdx: startIdx,
        patternEndIdx: endIdx,
        patternLow: Math.min(c1.low, c2.low),
        patternHigh: Math.max(c1.high, c2.high)
      };
    }
    
    if (['СОЛДАТА', 'ВОРОНА', 'ЗВЕЗДА', 'ТАТАМИ', 'ТОЛЧОК'].some(k => p.includes(k))) {
      const startIdx = Math.max(0, endIdx - 2);
      const formationCandles = candles.slice(startIdx, endIdx + 1);
      return {
        patternCandlesCount: 3,
        patternStartIdx: startIdx,
        patternEndIdx: endIdx,
        patternLow: Math.min(...formationCandles.map(c => c.low)),
        patternHigh: Math.max(...formationCandles.map(c => c.high))
      };
    }
    
    const c = candles[endIdx];
    return {
      patternCandlesCount: 1,
      patternStartIdx: endIdx,
      patternEndIdx: endIdx,
      patternLow: c.low,
      patternHigh: c.high
    };
  }

  static isHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    
    const zoneOk = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01) ||
                   VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3) ||
                   (m20 !== null && Math.abs(candle.low - m20) <= m20 * 0.01);
    
    const minRatio = zoneOk ? 1.0 : 1.5;
    if (candle.lowerWick < candle.body * minRatio) return { found: false, name: '' };
    if (candle.upperWick > candle.lowerWick * (zoneOk ? 0.6 : 0.3)) return { found: false, name: '' };
    
    let name = 'МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles)) name += ' (У ПОДДЕРЖКИ)';
    if (VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isImperfectHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.5) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 0.9) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    
    const zoneOk = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01) ||
                   VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3) ||
                   (m20 !== null && Math.abs(candle.low - m20) <= m20 * 0.01);
    
    if (!zoneOk) return { found: false, name: '' };
    
    return { found: true, name: 'МОЛОТ (НЕСОВЕРШЕННЫЙ)' };
  }

  static isInvertedHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    
    const zoneOk = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01) ||
                   VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3) ||
                   (m20 !== null && Math.abs(candle.low - m20) <= m20 * 0.01);
    
    const minRatio = zoneOk ? 1.0 : 1.5;
    if (candle.upperWick < candle.body * minRatio) return { found: false, name: '' };
    if (candle.lowerWick > candle.upperWick * (zoneOk ? 0.6 : 0.3)) return { found: false, name: '' };
    
    let name = 'ПЕРЕВЁРНУТЫЙ МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles)) name += ' (У ПОДДЕРЖКИ)';
    
    return { found: true, name };
  }

  static isHangingMan(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 1.5) return { found: false, name: '' };
    if (candle.upperWick > candle.lowerWick * 0.3) return { found: false, name: '' };
    
    let name = 'ПОВЕШЕННЫЙ';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles)) name += ' (У СОПРОТИВЛЕНИЯ)';
    
    return { found: true, name };
  }

  static isShootingStar(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.upperWick < candle.body * 1.5) return { found: false, name: '' };
    if (candle.lowerWick > candle.upperWick * 0.3) return { found: false, name: '' };
    
    let name = 'ПАДАЮЩАЯ ЗВЕЗДА';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isBullishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBullish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    
    let name = 'БЫЧЬЕ ПОГЛОЩЕНИЕ';
    if (ZoneVoter.isNearSupport(c2.close, prev)) name += ' (У ПОДДЕРЖКИ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isBearishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBearish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    
    let name = 'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ';
    if (ZoneVoter.isNearResistance(c2.close, prev)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isMorningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    if (!c2.isShortCandle) return { found: false, name: '' };
    if (!(c3.isBullish && c3.isLongCandle)) return { found: false, name: '' };
    if (c3.close <= c1.bodyMid) return { found: false, name: '' };
    
    let name = c2.isDoji ? 'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА' : 'УТРЕННЯЯ ЗВЕЗДА';
    if (c2.gapDownFrom(c1) && c3.gapUpFrom(c2)) name += ' (С ГЭПАМИ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isEveningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    if (!(c1.isBullish && c1.isLongCandle)) return { found: false, name: '' };
    if (!c2.isShortCandle) return { found: false, name: '' };
    if (!(c3.isBearish && c3.isLongCandle)) return { found: false, name: '' };
    if (c3.close >= c1.bodyMid) return { found: false, name: '' };
    
    let name = c2.isDoji ? 'ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА' : 'ВЕЧЕРНЯЯ ЗВЕЗДА';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isThreeWhiteSoldiers(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    if (!([c1, c2, c3].every(c => c.isBullish && c.isLongCandle))) return { found: false, name: '' };
    if (!(c2.close > c1.close && c3.close > c2.close)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ БЕЛЫХ СОЛДАТА' };
  }

  static isThreeBlackCrows(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    if (!([c1, c2, c3].every(c => c.isBearish && c.isLongCandle))) return { found: false, name: '' };
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ ЧЁРНЫХ ВОРОНЫ' };
  }

  static classifyDoji(candle: Candle): { found: boolean; name: string } {
    if (!candle.isDoji) return { found: false, name: '' };
    
    if (candle.lowerWick > candle.totalRange * 0.4 && candle.upperWick < candle.totalRange * 0.1) {
      return { found: true, name: 'ДОДЖИ-СТРЕКОЗА' };
    }
    if (candle.upperWick > candle.totalRange * 0.4 && candle.lowerWick < candle.totalRange * 0.1) {
      return { found: true, name: 'НАДГРОБИЕ' };
    }
    return { found: true, name: 'ДОДЖИ' };
  }

  static isSpring(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 25) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    const base = Math.min(...candles.slice(-21, -1).map(c => c.low));
    
    if (last.low < base && last.close > base && last.close > last.open) {
      return { found: true, name: 'СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)' };
    }
    
    return { found: false, name: '' };
  }

  static isTowerTop(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    if (!(candles[candles.length - 2].isBullish && candles[candles.length - 3].isBullish)) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    if (!(last.isBearish && last.isLongCandle)) return { found: false, name: '' };
    if (last.close >= Math.min(candles[candles.length - 2].low, candles[candles.length - 3].low)) return { found: false, name: '' };
    
    return { found: true, name: 'БАШЕННАЯ ВЕРШИНА' };
  }

  static isTowerBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    if (!(candles[candles.length - 2].isBearish && candles[candles.length - 3].isBearish)) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    if (!(last.isBullish && last.isLongCandle)) return { found: false, name: '' };
    if (last.close <= Math.max(candles[candles.length - 2].high, candles[candles.length - 3].high)) return { found: false, name: '' };
    
    return { found: true, name: 'БАШЕННОЕ ДНО' };
  }

  static isThreeMountains(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const highs: number[] = [];
    
    for (let i = 2; i < seg.length - 2; i++) {
      if (seg[i].high > seg[i-1].high && seg[i].high > seg[i-2].high &&
          seg[i].high > seg[i+1].high && seg[i].high > seg[i+2].high) {
        highs.push(seg[i].high);
      }
    }
    
    if (highs.length < 3) return { found: false, name: '' };
    const h = highs.slice(-3);
    const top = Math.max(...h);
    if (!h.every(x => Math.abs(x - top) <= top * 0.01)) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    if (!(last.isBearish && last.close < candles[candles.length - 2].close)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ ГОРЫ (ВЕРШИНА)' };
  }

  static isThreeRivers(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const lows: number[] = [];
    
    for (let i = 2; i < seg.length - 2; i++) {
      if (seg[i].low < seg[i-1].low && seg[i].low < seg[i-2].low &&
          seg[i].low < seg[i+1].low && seg[i].low < seg[i+2].low) {
        lows.push(seg[i].low);
      }
    }
    
    if (lows.length < 3) return { found: false, name: '' };
    const l = lows.slice(-3);
    const bot = Math.min(...l);
    if (!l.every(x => Math.abs(x - bot) <= bot * 0.01)) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    if (!(last.isBullish && last.close > candles[candles.length - 2].close)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ РЕКИ (ОСНОВАНИЕ)' };
  }

  static isHarami(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!c1.isLongCandle) return { found: false, name: '' };
    if (c2.body > c1.body * 0.4) return { found: false, name: '' };
    if (!c2.isInside(c1)) return { found: false, name: '' };
    
    if (c1.isBearish) return { found: true, name: 'БЫЧИЙ ХАРАМИ' };
    if (c1.isBullish) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ' };
    
    return { found: false, name: '' };
  }

  static isHaramiCross(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!c1.isLongCandle || !c2.isDoji || !c2.isInside(c1)) return { found: false, name: '' };
    
    if (c1.isBearish) return { found: true, name: 'БЫЧИЙ ХАРАМИ-КРЕСТ' };
    if (c1.isBullish) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ' };
    
    return { found: false, name: '' };
  }

  static isTweezerBottom(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && c2.isBullish)) return { found: false, name: '' };
    if (Math.abs(c1.low - c2.low) / c1.low > 0.004) return { found: false, name: '' };
    
    return { found: true, name: 'ПИНЦЕТ (НИЗ)' };
  }

  static isTweezerTop(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish && c2.isBearish)) return { found: false, name: '' };
    if (Math.abs(c1.high - c2.high) / c1.high > 0.004) return { found: false, name: '' };
    
    return { found: true, name: 'ПИНЦЕТ (ВЕРХ)' };
  }

  static isDarkCloudCover(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBearish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.open < c1.close * 0.995) return { found: false, name: '' };
    if (c2.close >= c1.bodyMid || c2.close <= c1.open) return { found: false, name: '' };
    
    let name = 'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ';
    if (ZoneVoter.isNearResistance(c2.close, prev)) name += ' (У СОПРОТИВЛЕНИЯ)';
    
    return { found: true, name };
  }

  static isPiercingPattern(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBullish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.open > c1.close * 1.005) return { found: false, name: '' };
    if (c2.close <= c1.bodyMid || c2.close >= c1.open) return { found: false, name: '' };
    
    let name = 'ПРОСВЕТ В ОБЛАКАХ';
    if (ZoneVoter.isNearSupport(c2.close, prev)) name += ' (У ПОДДЕРЖКИ)';
    
    return { found: true, name };
  }

  static isBullishBelt(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c2.isBullish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.lowerWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (c2.open >= c1.close) return { found: false, name: '' };
    
    return { found: true, name: 'ЛИНИЯ ПОЯСА (БЫЧЬЯ)' };
  }

  static isBearishBelt(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c2.isBearish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.upperWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (c2.open <= c1.close) return { found: false, name: '' };
    
    return { found: true, name: 'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)' };
  }

  static isCounterattack(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (Math.abs(c1.close - c2.close) / c1.close > 0.002) return { found: false, name: '' };
    const need = c1.totalRange * 0.5;
    const gap = c2.open - c1.close;
    
    if (c1.isBearish && c2.isBullish && gap <= -need) {
      return { found: true, name: 'КОНТРАТАКА (БЫЧЬЯ)' };
    }
    if (c1.isBullish && c2.isBearish && gap >= need) {
      return { found: true, name: 'КОНТРАТАКА (МЕДВЕЖЬЯ)' };
    }
    
    return { found: false, name: '' };
  }

  static isSeparatingLines(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (Math.abs(c1.open - c2.open) / c1.open > 0.001) return { found: false, name: '' };
    
    if (c1.isBearish && c2.isBullish && c2.isLongCandle && c2.open <= c2.low + c2.totalRange * 0.05) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (БЫЧЬЕ)' };
    }
    if (c1.isBullish && c2.isBearish && c2.isLongCandle && c2.open >= c2.high - c2.totalRange * 0.05) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)' };
    }
    
    return { found: false, name: '' };
  }

  static isNeckFamily(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBullish && c2.body <= c1.body * 0.5)) return { found: false, name: '' };
    
    const tol = c1.totalRange * 0.05;
    if (Math.abs(c2.close - c1.low) <= tol) {
      return { found: true, name: 'НИЖЕ ШЕИ' };
    }
    if (c1.bodyBottom - tol <= c2.close && c2.close <= c1.bodyBottom + tol) {
      return { found: true, name: 'НА ШЕЕ' };
    }
    if (c1.bodyBottom < c2.close && c2.close < c1.bodyMid) {
      return { found: true, name: 'ТОЛЧОК' };
    }
    
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

  static isGappingSideBySide(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c0 = candles[candles.length - 3];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    
    if (c1.low > c0.high && c1.isBullish && c2.isBullish) {
      if (Math.abs(c1.open - c2.open) / c1.open <= 0.005 && 
          Math.abs(c1.body - c2.body) <= Math.max(c1.body, c2.body) * 0.3) {
        return { found: true, name: 'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ' };
      }
    }
    
    return { found: false, name: '' };
  }

  static isRisingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const s1 = candles[candles.length - 4];
    const s2 = candles[candles.length - 3];
    const s3 = candles[candles.length - 2];
    const l = candles[candles.length - 1];
    
    if (!(f.isBullish && f.isLongCandle && l.isBullish && l.isLongCandle)) return { found: false, name: '' };
    if (l.close <= f.close) return { found: false, name: '' };
    
    for (const s of [s1, s2, s3]) {
      if (s.high > f.high || s.low < f.low || s.body > f.body * 0.5) {
        return { found: false, name: '' };
      }
    }
    
    if (!VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) return { found: false, name: '' };
    
    return { found: true, name: 'ВОСХОДЯЩИЕ ТРИ МЕТОДА' };
  }

  static isFallingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const s1 = candles[candles.length - 4];
    const s2 = candles[candles.length - 3];
    const s3 = candles[candles.length - 2];
    const l = candles[candles.length - 1];
    
    if (!(f.isBearish && f.isLongCandle && l.isBearish && l.isLongCandle)) return { found: false, name: '' };
    if (l.close >= f.close) return { found: false, name: '' };
    
    for (const s of [s1, s2, s3]) {
      if (s.high > f.high || s.low < f.low || s.body > f.body * 0.5) {
        return { found: false, name: '' };
      }
    }
    
    if (!VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) return { found: false, name: '' };
    
    return { found: true, name: 'НИСХОДЯЩИЕ ТРИ МЕТОДА' };
  }

  static isMatHold(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const c0 = candles[candles.length - 5];
    const c1 = candles[candles.length - 4];
    const c2 = candles[candles.length - 3];
    const c3 = candles[candles.length - 2];
    const c4 = candles[candles.length - 1];
    
    if (!(c0.isBullish && c0.isLongCandle)) return { found: false, name: '' };
    if (!(c1.isBearish && c1.isShortCandle)) return { found: false, name: '' };
    
    for (const s of [c1, c2, c3]) {
      if (s.body > c0.body * 0.5) return { found: false, name: '' };
    }
    
    if (!(c4.isBullish && c4.isLongCandle)) return { found: false, name: '' };
    if (c4.close <= Math.max(c1.high, c2.high, c3.high)) return { found: false, name: '' };
    
    return { found: true, name: 'УДЕРЖАНИЕ НА ТАТАМИ' };
  }

  static isLadderBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const c1 = candles[candles.length - 5];
    const c2 = candles[candles.length - 4];
    const c3 = candles[candles.length - 3];
    const c4 = candles[candles.length - 2];
    const c5 = candles[candles.length - 1];
    
    if (!([c1, c2, c3].every(c => c.isBearish))) return { found: false, name: '' };
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    if (!(c4.isBearish && c4.upperWick >= c4.totalRange * 0.3)) return { found: false, name: '' };
    if (!(c5.isBullish && c5.isLongCandle && c5.close > c4.high)) return { found: false, name: '' };
    
    return { found: true, name: 'ЛЕСТНИЧНОЕ ДНО' };
  }

  static isTwoCrows(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    if (!(c1.isBullish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBearish && c3.isBearish)) return { found: false, name: '' };
    if (c2.open <= c1.close) return { found: false, name: '' };
    if (c2.close <= c1.close) return { found: false, name: '' };
    if (!(c3.open > c2.open && c3.close < c2.close && c3.close > c1.close)) return { found: false, name: '' };
    
    let name = 'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ';
    if (ZoneVoter.isNearResistance(c3.close, candles.slice(0, -3))) name += ' (У СОПРОТИВЛЕНИЯ)';
    
    return { found: true, name };
  }

  static isAbandonedBaby(candles: Candle[]): { found: boolean; name: string } {
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

  static isGappingPlay(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-5, -1);
    
    if (!cons.every(c => c.isShortCandle)) return { found: false, name: '' };
    
    const consTop = Math.max(...cons.map(c => c.high));
    const consBot = Math.min(...cons.map(c => c.low));
    
    if (last.isBullish && last.open >= consTop) {
      return { found: true, name: 'ГЭП НА МАКСИМУМАХ' };
    }
    if (last.isBearish && last.open <= consBot) {
      return { found: true, name: 'ГЭП НА МИНИМУМАХ' };
    }
    
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

  static isKeyReversal(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 21) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const seg = candles.slice(-21, -1);
    
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));
    
    if (!(last.isLongCandle && avg > 0 && last.volume > avg * 1.3)) {
      return { found: false, name: '' };
    }
    
    if (last.isBullish && last.close > prev.high && last.low <= lo * 1.05) {
      return { found: true, name: 'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)' };
    }
    if (last.isBearish && last.close < prev.low && last.high >= hi * 0.95) {
      return { found: true, name: 'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)' };
    }
    
    return { found: false, name: '' };
  }

  static isLastEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    const eng = c2.bodyTop >= c1.bodyTop && c2.bodyBottom <= c1.bodyBottom && c2.body > c1.body;
    if (!eng) return { found: false, name: '' };
    
    if (c1.isBullish && c2.isBearish) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)' };
    }
    if (c1.isBearish && c2.isBullish) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)' };
    }
    
    return { found: false, name: '' };
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
    const m20Val = m20.length > 0 ? m20[m20.length - 1] : null;
    const m65Val = m65.length > 0 ? m65[m65.length - 1] : null;
    
    const supHold = (m20Val !== null && last.low <= m20Val * 1.005 && last.close > m20Val) ||
                    (m65Val !== null && last.low <= m65Val * 1.005 && last.close > m65Val) ||
                    (ZoneVoter.isNearSupport(last.close, pre, 0.01) && last.close > last.open);
    
    const resHold = (m20Val !== null && last.high >= m20Val * 0.995 && last.close < m20Val) ||
                    (m65Val !== null && last.high >= m65Val * 0.995 && last.close < m65Val) ||
                    (ZoneVoter.isNearResistance(last.close, pre, 0.01) && last.close < last.open);
    
    if (supHold && (last.isBullish || last.close > mid)) {
      return { found: true, name: 'ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)' };
    }
    if (resHold && (last.isBearish || last.close < mid)) {
      return { found: true, name: 'ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)' };
    }
    
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
      if (last.close < Math.max(...pullbackWindow.map(c => c.close))) {
        return { found: false, name: '' };
      }
      return { found: true, name: 'ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ' };
    }
    
    if (last.isBearish) {
      const pull = pullbackWindow[pullbackWindow.length - 1].close - pullbackWindow[0].close;
      if (pull <= 0) return { found: false, name: '' };
      if (last.close > Math.min(...pullbackWindow.map(c => c.close))) {
        return { found: false, name: '' };
      }
      return { found: true, name: 'ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ' };
    }
    
    return { found: false, name: '' };
  }
}
