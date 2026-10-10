// Signal Generator - Главный класс генерации торговых сигналов по Нисону
import { Candle } from './candle';
import { PatternDetector, SupportResistance, VolumeAnalyzer } from './pattern_engine';
import { getTrendContext, getTrendMacro } from './trend_detection';
import { ema, atr } from './indicators';
import { patternStory } from './patterns';

// Константы
const TIMEOUT_H1 = 10800; // 3 часа в секундах
const TIMEOUT_D1 = 259200; // 3 дня в секундах
const DOJI_MAX_FREQ = 0.15;
const RANGE_PROXIMITY_PCT = 0.015;

// Самодостаточные модели по Нисону (гл. 4-6)
const SELF_CONFIRMING = [
  'ПОГЛОЩЕНИЕ', 'ЗАВЕСА', 'ПРОСВЕТ', 'УТРЕННЯЯ ЗВЕЗДА', 'ВЕЧЕРНЯЯ ЗВЕЗДА',
  'СОЛДАТА', 'ВОРОНА', 'ТРИ МЕТОДА', 'ТАСУКИ', 'ТАТАМИ', 'ГЭП',
  'РАЗДЕЛЕНИЕ', 'ПОЯСА', 'НИЖЕ ШЕИ', 'НА ШЕЕ', 'ТОЛЧОК'
];

export interface Signal {
  direction: 'long' | 'short';
  pattern: string;
  entryPrice: number;
  stopLoss: number;
  target: number;
  risk: number;
  rr: number;
  quality: number;
  timestamp: number;
  confirmed: boolean;
  story: string;
  metadata: {
    patternCandlesCount: number;
    patternStartIdx: number;
    patternEndIdx: number;
    patternLow: number;
    patternHigh: number;
  };
}

export class SignalGenerator {
  // Оценка качества тени
  private shadowQuality(c: Candle, kind: 'hammer' | 'hanging' | 'star'): number {
    let ratio: number;
    if (kind === 'hammer' || kind === 'hanging') {
      ratio = c.body > 0 ? c.lowerWick / c.body : 9;
    } else {
      ratio = c.body > 0 ? c.upperWick / c.body : 9;
    }
    return ratio >= 2.0 ? 1.0 : 0.7;
  }

  // Определение бычьей формы накопления
  private accumBullShape(c1: Candle, c2: Candle): string | null {
    if (c2.body <= c2.totalRange * 0.3 && c2.lowerWick >= c2.body * 2.0 && c2.upperWick <= c2.lowerWick * 0.3) {
      return 'МОЛОТ';
    }
    if (c2.isDoji && c2.lowerWick > c2.totalRange * 0.4 && c2.upperWick < c2.totalRange * 0.1) {
      return 'ДОДЖИ-СТРЕКОЗА';
    }
    if (c1.isBearish && c2.isBullish && c2.isEngulfing(c1) && c2.isLongCandle) {
      return 'БЫЧЬЕ ПОГЛОЩЕНИЕ';
    }
    return null;
  }

  // Создание сигнала
  private makeSignal(
    direction: 'long' | 'short',
    pattern: string,
    candle: Candle,
    closedCandles: Candle[],
    tf: string,
    quality: number = 1.0
  ): Signal {
    const lc = closedCandles[closedCandles.length - 1];
    const pr = closedCandles.length > 1 ? closedCandles[closedCandles.length - 2] : lc;
    const rest = closedCandles.slice(0, -1);
    const rest2 = closedCandles.length > 2 ? closedCandles.slice(0, -2) : rest;

    // Combo detection
    const combo = [
      PatternDetector.isHammer(lc, rest).found,
      PatternDetector.isInvertedHammer(lc, rest).found,
      PatternDetector.isHangingMan(lc, rest).found,
      PatternDetector.isShootingStar(lc, rest).found,
      PatternDetector.isBullishEngulfing(pr, lc, rest2).found,
      PatternDetector.isBearishEngulfing(pr, lc, rest2).found,
      PatternDetector.isTweezerBottom(pr, lc, rest2).found,
      PatternDetector.isTweezerTop(pr, lc, rest2).found,
      lc.isDoji,
    ].filter(Boolean).length;

    if (combo >= 2) {
      quality = Math.min(quality + 0.3, 1.3);
      pattern = pattern + ' (комбо)';
    }

    // Книжные границы формации
    const endIdx = closedCandles.length - 1;
    const bounds = PatternDetector.getFormationBounds(pattern, closedCandles, endIdx);
    const bookStop = direction === 'long' ? bounds.patternLow : bounds.patternHigh;

    // Расчёт цели
    const zones = SupportResistance.findLevels(closedCandles);
    let target: number;
    
    if (direction === 'long') {
      const candidates = zones.resistance.filter((r: number) => r > candle.close);
      target = candidates.length > 0 ? candidates[0] : candle.close * 1.05;
    } else {
      const candidates = zones.support.filter((s: number) => s < candle.close);
      target = candidates.length > 0 ? candidates[0] : candle.close * 0.95;
    }

    const risk = Math.abs(candle.close - bookStop);
    const rr = Math.abs(target - candle.close) / risk;

    return {
      direction,
      pattern,
      entryPrice: candle.close,
      stopLoss: bookStop,
      target,
      risk: risk / candle.close,
      rr,
      quality,
      timestamp: Date.now(),
      confirmed: false,
      story: patternStory(pattern),
      metadata: {
        patternCandlesCount: bounds.patternCandlesCount,
        patternStartIdx: bounds.patternStartIdx,
        patternEndIdx: bounds.patternEndIdx,
        patternLow: bounds.patternLow,
        patternHigh: bounds.patternHigh,
      },
    };
  }

  // Главный метод поиска сигнала
  findSignal(candles: Candle[], tf: string = 'D'): Signal | null {
    if (candles.length < 6) return null;

    const lastClosed = candles[candles.length - 2];
    const prevClosed = candles[candles.length - 3];
    const closed = candles.slice(0, -1);

    // === ВЫСОКОПРИОРИТЕТНЫЕ (многокомпонентные) ===
    
    const morningStar = PatternDetector.isMorningStar(closed);
    if (morningStar.found) return this.makeSignal('long', morningStar.name, lastClosed, closed, tf);
    
    const eveningStar = PatternDetector.isEveningStar(closed);
    if (eveningStar.found) return this.makeSignal('short', eveningStar.name, lastClosed, closed, tf);
    
    const abandonedBaby = PatternDetector.isAbandonedBaby(closed);
    if (abandonedBaby.found) {
      const direction = abandonedBaby.name.includes('НИЗ') ? 'long' : 'short';
      return this.makeSignal(direction, abandonedBaby.name, lastClosed, closed, tf);
    }
    
    const towerTop = PatternDetector.isTowerTop(closed);
    if (towerTop.found) return this.makeSignal('short', towerTop.name, lastClosed, closed, tf);
    
    const towerBottom = PatternDetector.isTowerBottom(closed);
    if (towerBottom.found) return this.makeSignal('long', towerBottom.name, lastClosed, closed, tf);
    
    const threeMountains = PatternDetector.isThreeMountains(closed);
    if (threeMountains.found) return this.makeSignal('short', threeMountains.name, lastClosed, closed, tf);
    
    const threeRivers = PatternDetector.isThreeRivers(closed);
    if (threeRivers.found) return this.makeSignal('long', threeRivers.name, lastClosed, closed, tf);
    
    const risingThree = PatternDetector.isRisingThree(closed);
    if (risingThree.found) return this.makeSignal('long', risingThree.name, lastClosed, closed, tf);
    
    const fallingThree = PatternDetector.isFallingThree(closed);
    if (fallingThree.found) return this.makeSignal('short', fallingThree.name, lastClosed, closed, tf);
    
    const matHold = PatternDetector.isMatHold(closed);
    if (matHold.found) return this.makeSignal('long', matHold.name, lastClosed, closed, tf);
    
    const doubleThrusting = PatternDetector.isDoubleThrustingBull(closed);
    if (doubleThrusting.found) return this.makeSignal('long', doubleThrusting.name, lastClosed, closed, tf);
    
    const gappingPlay = PatternDetector.isGappingPlay(closed);
    if (gappingPlay.found) {
      const direction = gappingPlay.name.includes('МАКСИМУМАХ') ? 'long' : 'short';
      return this.makeSignal(direction, gappingPlay.name, lastClosed, closed, tf);
    }
    
    const consolidationBreakout = PatternDetector.isConsolidationBreakout(closed);
    if (consolidationBreakout.found) {
      const direction = consolidationBreakout.name.includes('БЫЧИЙ') ? 'long' : 'short';
      return this.makeSignal(direction, consolidationBreakout.name, lastClosed, closed, tf);
    }
    
    const keyReversal = PatternDetector.isKeyReversal(closed);
    if (keyReversal.found) {
      const direction = keyReversal.name.includes('БЫЧИЙ') ? 'long' : 'short';
      return this.makeSignal(direction, keyReversal.name, lastClosed, closed, tf);
    }
    
    const lastEngulfing = PatternDetector.isLastEngulfing(prevClosed, lastClosed, closed.slice(0, -2));
    if (lastEngulfing.found) {
      const direction = lastEngulfing.name.includes('ОСНОВАНИЕ') ? 'long' : 'short';
      return this.makeSignal(direction, lastEngulfing.name, lastClosed, closed, tf);
    }
    
    const volSpin = PatternDetector.isVolSpin(lastClosed, closed);
    if (volSpin.found) {
      const direction = volSpin.name.includes('НАКОПЛЕНИЕ') ? 'long' : 'short';
      return this.makeSignal(direction, volSpin.name, lastClosed, closed, tf);
    }
    
    const levelTest = PatternDetector.isLevelTest(closed);
    if (levelTest.found) {
      const direction = levelTest.name.includes('БЫЧИЙ') ? 'long' : 'short';
      return this.makeSignal(direction, levelTest.name, lastClosed, closed, tf);
    }
    
    const trendPullback = PatternDetector.isTrendPullbackCandle(closed);
    if (trendPullback.found) {
      const direction = trendPullback.name.includes('БЕЛАЯ') ? 'long' : 'short';
      return this.makeSignal(direction, trendPullback.name, lastClosed, closed, tf);
    }
    
    const gappingSideBySide = PatternDetector.isGappingSideBySide(closed);
    if (gappingSideBySide.found) {
      return this.makeSignal('long', gappingSideBySide.name, lastClosed, closed, tf);
    }
    
    const threeWhite = PatternDetector.isThreeWhiteSoldiers(closed);
    if (threeWhite.found) return this.makeSignal('long', threeWhite.name, lastClosed, closed, tf);
    
    const threeBlack = PatternDetector.isThreeBlackCrows(closed);
    if (threeBlack.found) return this.makeSignal('short', threeBlack.name, lastClosed, closed, tf);
    
    const ladderBottom = PatternDetector.isLadderBottom(closed);
    if (ladderBottom.found) return this.makeSignal('long', ladderBottom.name, lastClosed, closed, tf);
    
    const twoCrows = PatternDetector.isTwoCrows(closed);
    if (twoCrows.found) return this.makeSignal('short', twoCrows.name, lastClosed, closed, tf);
    
    const tasuki = PatternDetector.isTasuki(closed);
    if (tasuki.found) {
      const direction = tasuki.name.includes('ВОСХОДЯЩЕГО') ? 'long' : 'short';
      return this.makeSignal(direction, tasuki.name, lastClosed, closed, tf);
    }

    // === СРЕДНЕПРИОРИТЕТНЫЕ (двухсвечные) ===
    
    const bullishEngulfing = PatternDetector.isBullishEngulfing(prevClosed, lastClosed, candles.slice(0, -3));
    if (bullishEngulfing.found) return this.makeSignal('long', bullishEngulfing.name, lastClosed, closed, tf);
    
    const bearishEngulfing = PatternDetector.isBearishEngulfing(prevClosed, lastClosed, candles.slice(0, -3));
    if (bearishEngulfing.found) return this.makeSignal('short', bearishEngulfing.name, lastClosed, closed, tf);
    
    const piercing = PatternDetector.isPiercingPattern(prevClosed, lastClosed, candles.slice(0, -3));
    if (piercing.found) return this.makeSignal('long', piercing.name, lastClosed, closed, tf);
    
    const darkCloud = PatternDetector.isDarkCloudCover(prevClosed, lastClosed, candles.slice(0, -3));
    if (darkCloud.found) return this.makeSignal('short', darkCloud.name, lastClosed, closed, tf);
    
    const neck = PatternDetector.isNeckFamily(prevClosed, lastClosed, candles.slice(0, -3));
    if (neck.found) return this.makeSignal('short', neck.name, lastClosed, closed, tf);
    
    const counterattack = PatternDetector.isCounterattack(prevClosed, lastClosed, candles.slice(0, -3));
    if (counterattack.found) {
      const direction = counterattack.name.includes('БЫЧЬЯ') ? 'long' : 'short';
      return this.makeSignal(direction, counterattack.name, lastClosed, closed, tf);
    }
    
    const separating = PatternDetector.isSeparatingLines(prevClosed, lastClosed, candles.slice(0, -3));
    if (separating.found) {
      const direction = separating.name.includes('БЫЧЬЕ') ? 'long' : 'short';
      return this.makeSignal(direction, separating.name, lastClosed, closed, tf);
    }
    
    const bullishBelt = PatternDetector.isBullishBelt(prevClosed, lastClosed, candles.slice(0, -3));
    if (bullishBelt.found) return this.makeSignal('long', bullishBelt.name, lastClosed, closed, tf);
    
    const bearishBelt = PatternDetector.isBearishBelt(prevClosed, lastClosed, candles.slice(0, -3));
    if (bearishBelt.found) return this.makeSignal('short', bearishBelt.name, lastClosed, closed, tf);
    
    const tweezerBottom = PatternDetector.isTweezerBottom(prevClosed, lastClosed, candles.slice(0, -3));
    if (tweezerBottom.found) return this.makeSignal('long', tweezerBottom.name, lastClosed, closed, tf);
    
    const tweezerTop = PatternDetector.isTweezerTop(prevClosed, lastClosed, candles.slice(0, -3));
    if (tweezerTop.found) return this.makeSignal('short', tweezerTop.name, lastClosed, closed, tf);

    // === НИЗКОПРИОРИТЕТНЫЕ (с условиями) ===
    
    const harami = PatternDetector.isHarami(prevClosed, lastClosed, candles.slice(0, -3));
    if (harami.found) {
      const near = SupportResistance.isNearSupport(lastClosed.close, candles.slice(0, -3), 0.015) ||
                   SupportResistance.isNearResistance(lastClosed.close, candles.slice(0, -3), 0.015);
      if (near) {
        const direction = harami.name.includes('БЫЧИЙ') ? 'long' : 'short';
        return this.makeSignal(direction, harami.name + ' (У УРОВНЯ)', lastClosed, closed, tf, 0.8);
      }
    }
    
    const haramiCross = PatternDetector.isHaramiCross(prevClosed, lastClosed, candles.slice(0, -3));
    if (haramiCross.found) {
      const near = SupportResistance.isNearSupport(lastClosed.close, candles.slice(0, -3), 0.015) ||
                   SupportResistance.isNearResistance(lastClosed.close, candles.slice(0, -3), 0.015);
      if (near) {
        const direction = haramiCross.name.includes('БЫЧИЙ') ? 'long' : 'short';
        return this.makeSignal(direction, haramiCross.name + ' (У УРОВНЯ)', lastClosed, closed, tf, 0.9);
      }
    }

    const hammer = PatternDetector.isHammer(lastClosed, candles.slice(0, -2));
    if (hammer.found) {
      return this.makeSignal('long', hammer.name, lastClosed, closed, tf, this.shadowQuality(lastClosed, 'hammer'));
    }
    
    const imperfectHammer = PatternDetector.isImperfectHammer(lastClosed, candles.slice(0, -2));
    if (imperfectHammer.found) {
      return this.makeSignal('long', imperfectHammer.name, lastClosed, closed, tf, 0.7);
    }
    
    const invertedHammer = PatternDetector.isInvertedHammer(lastClosed, candles.slice(0, -2));
    if (invertedHammer.found) {
      return this.makeSignal('long', invertedHammer.name, lastClosed, closed, tf, this.shadowQuality(lastClosed, 'hammer'));
    }
    
    const hangingMan = PatternDetector.isHangingMan(lastClosed, candles.slice(0, -2));
    if (hangingMan.found) {
      return this.makeSignal('short', hangingMan.name, lastClosed, closed, tf, this.shadowQuality(lastClosed, 'hanging'));
    }
    
    const shootingStar = PatternDetector.isShootingStar(lastClosed, candles.slice(0, -2));
    if (shootingStar.found) {
      return this.makeSignal('short', shootingStar.name, lastClosed, closed, tf, this.shadowQuality(lastClosed, 'star'));
    }

    const spring = PatternDetector.isSpring(closed);
    if (spring.found) {
      return this.makeSignal('long', spring.name, lastClosed, closed, tf, 0.9);
    }

    // Доджи (с учётом частоты и контекста)
    const dojiType = PatternDetector.classifyDoji(lastClosed);
    if (dojiType.found) {
      const closes = closed.map(c => c.close);
      const rsiValues = ema(closes, 14);
      const dojiFreq = closed.filter(c => c.isDoji).length / closed.length;
      
      if (dojiFreq <= DOJI_MAX_FREQ) {
        const trend = getTrendContext(closed);
        if (trend === 'ВОСХОДЯЩИЙ') {
          return this.makeSignal('short', `${dojiType.name} НА ВЕРШИНЕ`, lastClosed, closed, tf);
        }
        if (trend === 'НИСХОДЯЩИЙ') {
          return this.makeSignal('long', `${dojiType.name} НА ДНЕ`, lastClosed, closed, tf, 0.8);
        }
        
        const levels = SupportResistance.findLevels(closed);
        const threshold = lastClosed.close * RANGE_PROXIMITY_PCT;
        const supBelow = levels.support.filter((lv: number) => lv <= lastClosed.close);
        const resAbove = levels.resistance.filter((lv: number) => lv >= lastClosed.close);
        
        if (supBelow.length > 0 && (lastClosed.close - Math.max(...supBelow)) <= threshold) {
          return this.makeSignal('long', `${dojiType.name} У ПОДДЕРЖКИ`, lastClosed, closed, tf);
        }
        if (resAbove.length > 0 && (Math.min(...resAbove) - lastClosed.close) <= threshold) {
          return this.makeSignal('short', `${dojiType.name} У СОПРОТИВЛЕНИЯ`, lastClosed, closed, tf);
        }
      }
    }

    return null;
  }

  // Подтверждение книги следующей свечой
  bookConfirmed(closed: Candle[], sigIdx: number, direction: 'long' | 'short'): boolean {
    if (sigIdx + 1 >= closed.length) return false;
    
    const sigC = closed[sigIdx];
    const nxt = closed[sigIdx + 1];
    
    if (direction === 'long') {
      return nxt.isBullish && nxt.close > sigC.close;
    }
    return (nxt.isBearish && nxt.close < sigC.close) || (nxt.open < sigC.bodyBottom);
  }

  // Проверка близости к зоне
  private nearZone(closed: Candle[], idx: number, side: 'sup' | 'res', pct: number = 0.015): boolean {
    const levels = SupportResistance.findLevels(closed.slice(0, idx + 1));
    const price = closed[idx].close;
    const threshold = price * pct;
    const pool = side === 'sup' ? levels.support : levels.resistance;
    return pool.some((x: number) => Math.abs(price - x) <= threshold);
  }

  // Определение типа сигнала по контексту
  contextKind(closed: Candle[], idx: number, sig: Signal, confirmed: boolean): 'signal' | 'warn' | 'none' {
    const name = sig.pattern;
    const direction = sig.direction;
    const macro = getTrendMacro(closed.slice(0, idx + 1), closed[idx].close);
    const selfConf = SELF_CONFIRMING.some(k => name.includes(k));
    
    if (!selfConf && !confirmed) {
      return 'none';
    }
    
    if (direction === 'long' && macro === 'НИСХОДЯЩИЙ') {
      return this.nearZone(closed, idx, 'sup') ? 'signal' : 'none';
    }
    if (direction === 'short' && macro === 'ВОСХОДЯЩИЙ') {
      return this.nearZone(closed, idx, 'res') ? 'warn' : 'none';
    }
    if (macro === 'БОКОВИК') {
      const side = direction === 'long' ? 'sup' : 'res';
      return this.nearZone(closed, idx, side) ? 'signal' : 'none';
    }
    
    return 'signal';
  }

  // Единая точка входа
  evaluate(closed: Candle[], idx: number): { signal: Signal | null; kind: 'signal' | 'warn' | 'none' } {
    if (idx < 5 || idx >= closed.length) {
      return { signal: null, kind: 'none' };
    }
    
    const sig = this.findSignal(closed.slice(0, idx + 2), 'D');
    if (!sig) {
      return { signal: null, kind: 'none' };
    }
    
    const confirmed = this.bookConfirmed(closed, idx, sig.direction);
    const kind = this.contextKind(closed, idx, sig, confirmed);
    
    return { signal: sig, kind };
  }

  // Сканирование истории сигналов
  scanHistory(closed: Candle[], view: number = 120): { rows: any[]; start: number } {
    const rows: any[] = [];
    const start = Math.max(6, closed.length - view);
    
    for (let s = start; s < closed.length; s++) {
      const { signal, kind } = this.evaluate(closed, s);
      
      if (!signal || kind === 'none') continue;
      
      if (rows.length > 0 && rows[rows.length - 1].pattern === signal.pattern && (s - rows[rows.length - 1].s) <= 3) {
        continue;
      }
      
      rows.push({
        s,
        idx: s - start,
        date: new Date(closed[s].time).toLocaleDateString('ru-RU'),
        pattern: signal.pattern,
        direction: signal.direction,
        kind,
        story: patternStory(signal.pattern),
      });
    }
    
    return { rows, start };
  }

  // Подтверждение pending сигнала
  confirmSignal(pending: Signal | null, newClosed: Candle): Signal | null {
    if (!pending) return null;
    
    const confirmed = (pending.direction === 'long' && newClosed.close > pending.metadata.patternHigh) ||
                      (pending.direction === 'short' && newClosed.close < pending.metadata.patternLow);
    
    if (confirmed) {
      return {
        ...pending,
        confirmed: true,
      };
    }
    
    return null;
  }
}

// Структурный стоп по свингам
export function calculateStructuralStop(candles: Candle[], side: 'long' | 'short', currentStop: number): number {
  if (candles.length < 20) return currentStop;
  
  const findSwingLows = (candles: Candle[], w: number = 2): [number, number][] => {
    const lows: [number, number][] = [];
    for (let i = w; i < candles.length - w; i++) {
      if (candles.slice(i - w, i + w + 1).every(c => candles[i].low <= c.low)) {
        lows.push([i, candles[i].low]);
      }
    }
    return lows;
  };
  
  const findSwingHighs = (candles: Candle[], w: number = 2): [number, number][] => {
    const highs: [number, number][] = [];
    for (let i = w; i < candles.length - w; i++) {
      if (candles.slice(i - w, i + w + 1).every(c => candles[i].high >= c.high)) {
        highs.push([i, candles[i].high]);
      }
    }
    return highs;
  };
  
  let structuralStop = currentStop;
  
  if (side === 'long') {
    const swingLows = findSwingLows(candles.slice(-30), 2);
    if (swingLows.length > 0) {
      const [, structuralLow] = swingLows[swingLows.length - 1];
      structuralStop = structuralLow * 0.998;
    }
  } else {
    const swingHighs = findSwingHighs(candles.slice(-30), 2);
    if (swingHighs.length > 0) {
      const [, structuralHigh] = swingHighs[swingHighs.length - 1];
      structuralStop = structuralHigh * 1.002;
    }
  }
  
  // MA20 как дополнительная защита
  if (candles.length >= 20) {
    const closes = candles.map(c => c.close);
    const ma20 = ema(closes, 20);
    const ma20Val = ma20[ma20.length - 1];
    const price = candles[candles.length - 1].close;
    
    if (side === 'long' && price > ma20Val) {
      const maStop = ma20Val * 0.995;
      structuralStop = Math.max(structuralStop, maStop);
    } else if (side === 'short' && price < ma20Val) {
      const maStop = ma20Val * 1.005;
      structuralStop = Math.min(structuralStop, maStop);
    }
  }
  
  return structuralStop;
}

// Расширенная версия book_model_extreme для сложных паттернов
export function bookModelExtremeV2(
  pattern: string,
  candles: Candle[],
  sigIdx: number,
  direction: 'long' | 'short',
  atrBuffer: number = 0.5
): { ok: boolean; extreme: number; reason: string } {
  if (sigIdx < 0 || sigIdx >= candles.length) {
    return { ok: false, extreme: 0, reason: 'неверный индекс свечи' };
  }
  
  const sigCandle = candles[sigIdx];
  
  // Классификация паттернов
  const simplePatterns = ['МОЛОТ', 'ПОВЕШЕН', 'ДОДЖИ', 'ПАДАЮЩАЯ ЗВЕЗДА', 'ПЕРЕВЁРНУТЫЙ МОЛОТ'];
  const twoCandlePatterns = ['ПОГЛОЩЕНИЕ', 'ПРОСВЕТ', 'ЗАВЕСА', 'ХАРАМИ', 'КРЕСТ ХАРАМИ', 'КОНТРАТАКА', 'РАЗДЕЛЕНИЕ'];
  const threeCandlePatterns = ['УТРЕННЯЯ ЗВЕЗДА', 'ВЕЧЕРНЯЯ ЗВЕЗДА', 'ТРИ БЕЛЫХ СОЛДАТА', 'ТРИ ЧЁРНЫХ ВОРОНЫ', 'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ', 'УДЕРЖАНИЕ НА ТАТАМИ'];
  const complexPatterns = ['ТРИ ГОРЫ', 'ТРИ РЕКИ', 'ТРИ БУДДЫ', 'БАШЕННАЯ'];
  const comboPatterns = ['КОМБО', 'ТЕСТ СОПРОТИВЛЕНИЯ', 'ТЕСТ ПОДДЕРЖКИ', 'ПРОРЫВ КОНСОЛИДАЦИИ'];
  
  let patternType: string | null = null;
  
  if (simplePatterns.some(p => pattern.includes(p))) patternType = 'simple';
  else if (twoCandlePatterns.some(p => pattern.includes(p))) patternType = 'two_candle';
  else if (threeCandlePatterns.some(p => pattern.includes(p))) patternType = 'three_candle';
  else if (complexPatterns.some(p => pattern.includes(p))) patternType = 'complex';
  else if (comboPatterns.some(p => pattern.includes(p))) patternType = 'combo';
  
  if (!patternType) {
    const extreme = direction === 'long' ? sigCandle.low : sigCandle.high;
    return { ok: true, extreme, reason: `fallback: экстремум сигнальной свечи (${pattern})` };
  }
  
  if (patternType === 'simple') {
    const extreme = direction === 'long' ? sigCandle.low : sigCandle.high;
    return { ok: true, extreme, reason: `минимум/максимум сигнальной свечи` };
  }
  
  if (patternType === 'two_candle') {
    if (sigIdx < 1) return { ok: false, extreme: 0, reason: 'недостаточно свечей для двухсвечного паттерна' };
    const prevCandle = candles[sigIdx - 1];
    const extreme = direction === 'long' 
      ? Math.min(sigCandle.low, prevCandle.low)
      : Math.max(sigCandle.high, prevCandle.high);
    return { ok: true, extreme, reason: 'минимум/максимум двухсвечной модели' };
  }
  
  if (patternType === 'three_candle') {
    if (sigIdx < 2) return { ok: false, extreme: 0, reason: 'недостаточно свечей для трёхсвечного паттерна' };
    const c1 = candles[sigIdx - 2];
    const c2 = candles[sigIdx - 1];
    const extreme = direction === 'long'
      ? Math.min(sigCandle.low, c1.low, c2.low)
      : Math.max(sigCandle.high, c1.high, c2.high);
    return { ok: true, extreme, reason: 'минимум/максимум трёхсвечной модели' };
  }
  
  if (patternType === 'complex') {
    const lookback = 50;
    const startIdx = Math.max(0, sigIdx - lookback);
    const window = candles.slice(startIdx, sigIdx + 1);
    
    if (['ТРИ ГОРЫ', 'ТРИ БУДДЫ', 'ВЕРШИНА', 'БАШЕННАЯ ВЕРШИНА'].some(k => pattern.includes(k))) {
      const extreme = Math.max(...window.map(c => c.high));
      return { ok: true, extreme, reason: 'максимум окна 50 свечей (Три горы/вершина)' };
    } else {
      const extreme = Math.min(...window.map(c => c.low));
      return { ok: true, extreme, reason: 'минимум окна 50 свечей (Три реки/основание)' };
    }
  }
  
  if (patternType === 'combo') {
    const lookback = 20;
    const startIdx = Math.max(0, sigIdx - lookback);
    const window = candles.slice(startIdx, sigIdx + 1);
    
    const extreme = direction === 'long'
      ? Math.min(...window.map(c => c.low))
      : Math.max(...window.map(c => c.high));
    return { ok: true, extreme, reason: 'ближайший свинг-минимум/максимум (комбо)' };
  }
  
  return { ok: false, extreme: 0, reason: 'необработанная ситуация' };
}

// Расчёт стопа с ATR буфером
export function calculateStopWithBuffer(
  extreme: number,
  direction: 'long' | 'short',
  atrVal: number,
  bufferMultiplier: number = 0.5
): number {
  const buffer = atrVal * bufferMultiplier;
  return direction === 'long' ? extreme - buffer : extreme + buffer;
}

// Блоклист макро-паттернов для внутридневных графиков
export const H1_BLOCKLIST = [
  'ТРИ ГОРЫ', 'ТРИ РЕКИ', 'ТРИ БУДДЫ', 'ПОЛАЯ ВЕРШИНА',
  'СКОВОРОДА', 'БАШЕННАЯ', 'ПРОРЫВ КОНСОЛИДАЦИИ'
];

// Подтверждение доджи (Глава 8)
export function checkDojiConfirmation(
  candles: Candle[],
  sigIdx: number,
  direction: 'long' | 'short'
): boolean {
  if (sigIdx + 1 >= candles.length) return false;
  
  const nextCandle = candles[sigIdx + 1];
  const dojiCandle = candles[sigIdx];
  
  if (direction === 'short') {
    return nextCandle.close < dojiCandle.low;
  }
  return nextCandle.close > dojiCandle.high;
}

export const signalGenerator = new SignalGenerator();
