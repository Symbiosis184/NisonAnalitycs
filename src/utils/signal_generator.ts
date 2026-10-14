// Signal Generator - Главный класс генерации торговых сигналов по Нисону
import { Candle } from './candle';
import { PatternDetector, VolumeAnalyzer } from './pattern_engine';
import { ZoneVoter } from './zone_voter';
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

  // Создание сигнала
  private makeSignal(
    direction: 'long' | 'short',
    pattern: string,
    candle: Candle,
    closedCandles: Candle[],
    tf: string,
    quality: number = 1.0
  ): Signal {
    // Книжные границы формации
    const endIdx = closedCandles.length - 1;
    const bounds = PatternDetector.getFormationBounds(pattern, closedCandles, endIdx);
    const bookStop = direction === 'long' ? bounds.patternLow : bounds.patternHigh;

    // Расчёт цели по зонам Нисона
    const zones = ZoneVoter.collect(candle.close, closedCandles);
    let target: number;
    
    if (direction === 'long') {
      const candidates = zones.resistance.filter((z) => z.level > candle.close);
      target = candidates.length > 0 ? candidates[0].level : candle.close * 1.05;
    } else {
      const candidates = zones.support.filter((z) => z.level < candle.close);
      target = candidates.length > 0 ? candidates[0].level : candle.close * 0.95;
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
      confirmed: false, // Будет установлено позже
      story: patternStory(pattern),
      metadata: bounds,
    };
  }

  // Проверка подтверждения паттерна следующей свечой (методология Нисона)
  private checkConfirmation(
    direction: 'long' | 'short',
    patternCandle: Candle,
    confirmationCandle: Candle,
    bounds: { patternLow: number; patternHigh: number }
  ): boolean {
    if (direction === 'long') {
      // Для бычьего паттерна: следующая свеча должна быть бычьей и закрыться выше максимума всей формации
      return confirmationCandle.isBullish && confirmationCandle.close > bounds.patternHigh;
    } else {
      // Для медвежьего паттерна: следующая свеча должна быть медвежьей и закрыться ниже минимума всей формации
      return confirmationCandle.isBearish && confirmationCandle.close < bounds.patternLow;
    }
  }

  // Главный метод поиска всех подтверждённых сигналов
  findSignals(candles: Candle[], tf: string = 'D'): Signal[] {
    if (candles.length < 6) return [];

    const signals: Signal[] = [];
    
    // Проверяем последние 20 свечей на наличие паттернов
    for (let i = candles.length - 2; i >= Math.max(0, candles.length - 20); i--) {
      const patternCandle = candles[i];
      const nextCandle = candles[i + 1]; // Следующая свеча для подтверждения
      const closed = candles.slice(0, i + 1);
      
      // Проверяем все типы паттернов
      const patterns = [
        // Высокоприоритетные
        { check: PatternDetector.isMorningStar(closed), direction: 'long' as const },
        { check: PatternDetector.isEveningStar(closed), direction: 'short' as const },
        { check: PatternDetector.isAbandonedBaby(closed), direction: closed[closed.length - 1].isBullish ? 'long' as const : 'short' as const },
        { check: PatternDetector.isTowerTop(closed), direction: 'short' as const },
        { check: PatternDetector.isTowerBottom(closed), direction: 'long' as const },
        { check: PatternDetector.isThreeMountains(closed), direction: 'short' as const },
        { check: PatternDetector.isThreeRivers(closed), direction: 'long' as const },
        { check: PatternDetector.isRisingThree(closed), direction: 'long' as const },
        { check: PatternDetector.isFallingThree(closed), direction: 'short' as const },
        { check: PatternDetector.isMatHold(closed), direction: 'long' as const },
        { check: PatternDetector.isDoubleThrustingBull(closed), direction: 'long' as const },
        { check: PatternDetector.isThreeWhiteSoldiers(closed), direction: 'long' as const },
        { check: PatternDetector.isThreeBlackCrows(closed), direction: 'short' as const },
        { check: PatternDetector.isLadderBottom(closed), direction: 'long' as const },
        { check: PatternDetector.isTwoCrows(closed), direction: 'short' as const },
        { check: PatternDetector.isTasuki(closed), direction: closed[closed.length - 1].isBullish ? 'long' as const : 'short' as const },
      ];

      for (const { check, direction } of patterns) {
        if (check.found) {
          const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf);
          
          // Проверяем подтверждение следующей свечой
          const bounds = PatternDetector.getFormationBounds(check.name, closed, closed.length - 1);
          signal.confirmed = this.checkConfirmation(direction, patternCandle, nextCandle, bounds);
          
          if (signal.confirmed && signal.rr >= 2) {
            signals.push(signal);
          }
        }
      }

      // Двухсвечные паттерны
      if (i > 0) {
        const prevCandle = candles[i - 1];
        const twoCandlePatterns = [
          { check: PatternDetector.isBullishEngulfing(prevCandle, patternCandle, candles.slice(0, i - 1)), direction: 'long' as const },
          { check: PatternDetector.isBearishEngulfing(prevCandle, patternCandle, candles.slice(0, i - 1)), direction: 'short' as const },
          { check: PatternDetector.isPiercingPattern(prevCandle, patternCandle, candles.slice(0, i - 1)), direction: 'long' as const },
          { check: PatternDetector.isDarkCloudCover(prevCandle, patternCandle, candles.slice(0, i - 1)), direction: 'short' as const },
          { check: PatternDetector.isTweezerBottom(prevCandle, patternCandle, candles.slice(0, i - 1)), direction: 'long' as const },
          { check: PatternDetector.isTweezerTop(prevCandle, patternCandle, candles.slice(0, i - 1)), direction: 'short' as const },
        ];

        for (const { check, direction } of twoCandlePatterns) {
          if (check.found) {
            const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf);
            const bounds = PatternDetector.getFormationBounds(check.name, closed, closed.length - 1);
            signal.confirmed = this.checkConfirmation(direction, patternCandle, nextCandle, bounds);
            
            if (signal.confirmed && signal.rr >= 2) {
              signals.push(signal);
            }
          }
        }
      }

      // Односвечные паттерны
      const oneCandlePatterns = [
        { check: PatternDetector.isHammer(patternCandle, candles.slice(0, i)), direction: 'long' as const },
        { check: PatternDetector.isShootingStar(patternCandle, candles.slice(0, i)), direction: 'short' as const },
        { check: PatternDetector.isHangingMan(patternCandle, candles.slice(0, i)), direction: 'short' as const },
        { check: PatternDetector.isInvertedHammer(patternCandle, candles.slice(0, i)), direction: 'long' as const },
      ];

      for (const { check, direction } of oneCandlePatterns) {
        if (check.found) {
          const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf);
          const bounds = PatternDetector.getFormationBounds(check.name, closed, closed.length - 1);
          signal.confirmed = this.checkConfirmation(direction, patternCandle, nextCandle, bounds);
          
          if (signal.confirmed && signal.rr >= 2) {
            signals.push(signal);
          }
        }
      }
    }

    // Сортируем по качеству и возвращаем топ-5
    return signals
      .sort((a, b) => b.quality - a.quality)
      .slice(0, 5);
  }

  // Для обратной совместимости
  findSignal(candles: Candle[], tf: string = 'D'): Signal | null {
    const signals = this.findSignals(candles, tf);
    return signals.length > 0 ? signals[0] : null;
  }
}

export const signalGenerator = new SignalGenerator();
