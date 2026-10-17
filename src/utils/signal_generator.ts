// Signal Generator - Главный класс генерации торговых сигналов по Нисону
import { Candle } from './candle';
import { PatternDetector, VolumeAnalyzer } from './pattern_engine';

import { getTrendContext, getTrendMacro } from './trend_detection';
import { ema, atr } from './indicators';
import { patternStory } from './patterns';
import { matchesPatternId, PatternId } from './pattern_ids';
import { nearestStructuralTarget } from './nison_targets';

// Константы
const TIMEOUT_H1 = 10800; // 3 часа в секундах
const TIMEOUT_D1 = 259200; // 3 дня в секундах
const DOJI_MAX_FREQ = 0.15;
const RANGE_PROXIMITY_PCT = 0.015;

// Самодостаточные модели по Нисону (гл. 4-6).
// П.7: стабильные ID вместо подстрок — переименование отображаемого имени
// модели больше не сломает эту проверку.
export const SELF_CONFIRMING: readonly PatternId[] = [
  'BULLISH_ENGULFING', 'BEARISH_ENGULFING', 'DARK_CLOUD_COVER', 'LIGHTING_AT_THE_WELL',
  'MORNING_STAR', 'EVENING_STAR', 'THREE_WHITE_SOLDIERS', 'THREE_BLACK_CROWS',
  'RISE_THREE_METHODS', 'FALL_THREE_METHODS', 'TATAMI', 'SIDE_BY_SIDE_GAP',
  'SEPARATING_LINE_BULL', 'SEPARATING_LINE_BEAR', 'BELT_HOLD_BULL', 'BELT_HOLD_BEAR',
  'ADVANCE_BLOCK', 'RETREAT_BLOCK', 'THRUSTING', 'DOUBLE_THRUSTING_BULL',
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
  meta: {
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

  // Создание сигнала с улучшенной логикой
  private makeSignal(
    direction: 'long' | 'short',
    pattern: string,
    candle: Candle,
    closedCandles: Candle[],
    tf: string,
    quality: number = 1.0,
    boundsOverride?: { patternLow: number; patternHigh: number; patternCandlesCount?: number; patternStartIdx?: number; patternEndIdx?: number }
  ): Signal | null {
    // Книжные границы формации (FIX аудита №4: берём ГРАНИЦЫ ПАТТЕРНА, а не одной свечи)
    const endIdx = closedCandles.length - 1;
    const bounds = PatternDetector.getFormationBounds(pattern, closedCandles, endIdx);
    if (boundsOverride) {
      bounds.patternLow = boundsOverride.patternLow;
      bounds.patternHigh = boundsOverride.patternHigh;
      if (boundsOverride.patternCandlesCount !== undefined) bounds.patternCandlesCount = boundsOverride.patternCandlesCount;
      if (boundsOverride.patternStartIdx !== undefined) bounds.patternStartIdx = boundsOverride.patternStartIdx;
      if (boundsOverride.patternEndIdx !== undefined) bounds.patternEndIdx = boundsOverride.patternEndIdx;
    }
    const bookStop = direction === 'long' ? bounds.patternLow : bounds.patternHigh;

    // Проверка реалистичности стопа
    const risk = Math.abs(candle.close - bookStop);
    const riskPercent = risk / candle.close;
    
    // Стоп не должен быть слишком близко (< 0.5%) или слишком далеко (> 10%)
    if (riskPercent < 0.005 || riskPercent > 0.10) {
      return null; // Сигнал нереалистичен
    }

    // Канон Нисона (гл. 4–6): цель — ближайший ЗНАЧИМЫЙ ценовой ориентир
    // (сильная S/R-зона или экстремум предшествующего движения), а не индикаторный уровень.
    // FIX: удалена подмена «Цель = 3×ATR» — у Нисона выход определяется структурой рынка.
    // ATR остаётся только как шумовой пол (risk-менеджмент, см. nison_targets.ts).
    const noiseFloor = Math.max(candle.close * 0.01, atr(closedCandles, 14));
    const maxReward = candle.close * 0.20;
    const structural = nearestStructuralTarget(candle.close, direction, closedCandles, {
      noiseFloor,
      maxReward,
    });
    if (!structural) return null; // Нет явного уровня — ждём (Нисон), сигнал не генерируем
    const target = structural.level;
    const minReward = noiseFloor;

    // Проверка реалистичности цели
    const reward = Math.abs(target - candle.close);
    
    // Цель должна быть в разумном диапазоне относительно входа и стопа
    if (reward < minReward || reward > maxReward) {
      return null; // Сигнал нереалистичен
    }

    // Явная проверка на нулевой риск перед расчётом R:R
    if (risk === 0) {
      return null; // Невозможно рассчитать R:R
    }

    const rr = reward / risk;

    return {
      direction,
      pattern,
      entryPrice: candle.close,
      stopLoss: bookStop,
      target,
      risk: riskPercent,
      rr,
      quality,
      timestamp: Date.now(),
      confirmed: false, // Будет установлено позже
      story: patternStory(pattern) + ` | цель: ${structural.detail} (${structural.kind === 'zone' ? 'S/R-зона' : 'свинг'})`,
      meta: bounds,
    };
  }

  // Проверка подтверждения паттерна следующей свечой (методология Нисона).
  // FIX аудита №3: раньше требовалось закрытие ВЫШЕ максимума всей формации для лонга —
  // это отсекало почти все бычьи развороты (утренняя звезда закрывается ниже хая первой свечи).
  // Канон Нисона: подтверждение = продолжение движения в сторону сигнала
  // (бычья свеча, закрывшаяся выше close сигнальной свечи для лонга; зеркально для шорта)
  // ИЛИ пробой «шеи» формации. Плюс стоп-уровень формации не должен быть пробит.
  private checkConfirmation(
    direction: 'long' | 'short',
    patternCandle: Candle,
    confirmationCandle: Candle,
    bounds: { patternLow: number; patternHigh: number }
  ): boolean {
    if (direction === 'long') {
      // Бычье подтверждение: свеча бычья, закрылась выше close сигнальной свечи
      // (или выше максимума формации — усиленный вариант), и стоп формации не пробит.
      const heldStop = confirmationCandle.low > bounds.patternLow;
      const progressed =
        confirmationCandle.isBullish && confirmationCandle.close > patternCandle.close;
      const breakout = confirmationCandle.close > bounds.patternHigh;
      return heldStop && (progressed || breakout);
    } else {
      const heldStop = confirmationCandle.high < bounds.patternHigh;
      const progressed =
        confirmationCandle.isBearish && confirmationCandle.close < patternCandle.close;
      const breakdown = confirmationCandle.close < bounds.patternLow;
      return heldStop && (progressed || breakdown);
    }
  }

  // Главный метод поиска всех подтверждённых сигналов
  findSignals(candles: Candle[], tf: string = 'D'): Signal[] {
    if (candles.length < 6) return [];

    const signals: Signal[] = [];
    
    // Определяем текущий тренд для контекстной фильтрации
    const currentTrend = getTrendMacro(candles, candles[candles.length - 1].close);
    
    // Проверяем последние 20 свечей на наличие паттернов
    for (let i = candles.length - 2; i >= Math.max(0, candles.length - 20); i--) {
      const patternCandle = candles[i];
      const nextCandle = candles[i + 1]; // Следующая свеча для подтверждения
      const closed = candles.slice(0, i + 1);
      
      // Определяем тренд в момент паттерна
      const patternTrend = getTrendMacro(closed, patternCandle.close);
      
      // Проверяем все типы паттернов с проверкой минимального количества свечей
      const patterns = [
        // Высокоприоритетные (3+ свечи)
        { check: closed.length >= 3 ? PatternDetector.isMorningStar(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 3 ? PatternDetector.isEveningStar(closed) : { found: false, name: '' }, direction: 'short' as const },
        { check: closed.length >= 3 ? PatternDetector.isAbandonedBaby(closed) : { found: false, name: '' }, direction: closed[closed.length - 1].isBullish ? 'long' as const : 'short' as const },
        { check: closed.length >= 6 ? PatternDetector.isTowerTop(closed) : { found: false, name: '' }, direction: 'short' as const },
        { check: closed.length >= 6 ? PatternDetector.isTowerBottom(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 12 ? PatternDetector.isThreeMountains(closed) : { found: false, name: '' }, direction: 'short' as const },
        { check: closed.length >= 12 ? PatternDetector.isThreeRivers(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 5 ? PatternDetector.isRisingThree(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 5 ? PatternDetector.isFallingThree(closed) : { found: false, name: '' }, direction: 'short' as const },
        { check: closed.length >= 5 ? PatternDetector.isMatHold(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 4 ? PatternDetector.isDoubleThrustingBull(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 3 ? PatternDetector.isThreeWhiteSoldiers(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 3 ? PatternDetector.isThreeBlackCrows(closed) : { found: false, name: '' }, direction: 'short' as const },
        { check: closed.length >= 5 ? PatternDetector.isLadderBottom(closed) : { found: false, name: '' }, direction: 'long' as const },
        { check: closed.length >= 3 ? PatternDetector.isTwoCrows(closed) : { found: false, name: '' }, direction: 'short' as const },
        { check: closed.length >= 3 ? PatternDetector.isTasuki(closed) : { found: false, name: '' }, direction: closed[closed.length - 1].isBullish ? 'long' as const : 'short' as const },
      ];

      for (const { check, direction } of patterns) {
        if (check.found) {
          // Контекстная фильтрация: сигнал должен соответствовать тренду
          // Разворотные паттерны (Morning Star, Evening Star и т.д.) могут идти против тренда
          // П.7: сверка по стабильным ID моделей вместо includes по подстрокам
          const isReversalPattern = matchesPatternId(check.name, [
            'MORNING_STAR', 'EVENING_STAR',
            'ABANDONED_BABY_BOTTOM', 'ABANDONED_BABY_TOP',
            'TOWER_TOP', 'TOWER_BOTTOM', 'THREE_MOUNTAINS', 'THREE_RIVERS',
          ]);
          
          if (!isReversalPattern) {
            // Для продолжительных паттернов проверяем соответствие тренду
            if (direction === 'long' && patternTrend === 'НИСХОДЯЩИЙ') continue;
            if (direction === 'short' && patternTrend === 'ВОСХОДЯЩИЙ') continue;
          }

          // FIX аудита №4/№5: границы формации считаем ОДИН раз — на полном массиве
          // candles со смещением endIdx=i (для многокомпонентных паттернов это срез
          // closed, поэтому endIdx = i корректно только при вызове на candles).
          const bounds = PatternDetector.getFormationBounds(check.name, candles, i);
          
          const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf, 1.0, bounds);
          
          // Пропускаем если сигнал нереалистичен
          if (!signal) continue;
          
          // FIX аудита №3: подтверждение следующей свечой (канон Нисона)
          signal.confirmed = this.checkConfirmation(direction, patternCandle, nextCandle, bounds);
          
          // FIX аудита №7: раньше неподтверждённые сигналы молча выбрасывались —
          // пользователь не видел «почти-сигналов». Теперь они возвращаются с confirmed=false.
          if (signal.rr >= 2) {
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
            // Контекстная фильтрация для двухсвечных паттернов
            // Поглощение, завеса и просвет - РАЗВОРОТНЫЕ паттерны
            // Они должны идти ПРОТИВ текущего тренда
            // П.7: сверка по стабильным ID моделей
            const isReversalPattern = matchesPatternId(check.name, [
              'BULLISH_ENGULFING', 'BEARISH_ENGULFING', 'DARK_CLOUD_COVER', 'LIGHTING_AT_THE_WELL',
            ]);
            
            if (isReversalPattern) {
              // Разворотные паттерны должны идти против тренда
              if (direction === 'long' && patternTrend === 'ВОСХОДЯЩИЙ') continue;
              if (direction === 'short' && patternTrend === 'НИСХОДЯЩИЙ') continue;
            } else {
              // Продолжительные паттерны должны соответствовать тренду
              if (direction === 'long' && patternTrend === 'НИСХОДЯЩИЙ') continue;
              if (direction === 'short' && patternTrend === 'ВОСХОДЯЩИЙ') continue;
            }

            // FIX аудита №4/№5: единые границы формации для стопа, мета и подтверждения
            const bounds = PatternDetector.getFormationBounds(check.name, candles, i);
            
            const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf, 1.0, bounds);
            
            // Пропускаем если сигнал нереалистичен
            if (!signal) continue;
            
            // FIX аудита №3: подтверждение следующей свечой (канон Нисона)
            signal.confirmed = this.checkConfirmation(direction, patternCandle, nextCandle, bounds);
            
            // FIX аудита №7: неподтверждённые сигналы возвращаются с confirmed=false
            if (signal.rr >= 2) {
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
          // Контекстная фильтрация для односвечных паттернов
          // Молот и перевёрнутый молот - разворотные, могут идти против тренда
          // Повешенный и падающая звезда - продолжительные, должны соответствовать тренду
          // П.7: включает обычный, несовершенный и перевёрнутый молот
          const isReversalPattern = matchesPatternId(check.name, ['HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER']);
          
          if (!isReversalPattern) {
            if (direction === 'long' && patternTrend === 'НИСХОДЯЩИЙ') continue;
            if (direction === 'short' && patternTrend === 'ВОСХОДЯЩИЙ') continue;
          }

          // FIX аудита №4/№5: единые границы формации (для односвечных = high/low самой свечи)
          const bounds = PatternDetector.getFormationBounds(check.name, candles, i);
          
          const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf, 1.0, bounds);
          
          // Пропускаем если сигнал нереалистичен
          if (!signal) continue;
          
          // FIX аудита №3: подтверждение следующей свечой (канон Нисона)
          signal.confirmed = this.checkConfirmation(direction, patternCandle, nextCandle, bounds);
          
          // FIX аудита №7: неподтверждённые сигналы возвращаются с confirmed=false
          if (signal.rr >= 2) {
            signals.push(signal);
          }
        }
      }
    }

    // FIX аудита №8: детерминированная сортировка — сначала подтверждённые,
    // затем по качеству, затем по RR (стабильный порядок для UI и бэктеста).
    return signals
      .sort((a, b) =>
        Number(b.confirmed) - Number(a.confirmed) ||
        b.quality - a.quality ||
        b.rr - a.rr
      )
      .slice(0, 5);
  }

  // Для обратной совместимости
  findSignal(candles: Candle[], tf: string = 'D'): Signal | null {
    const signals = this.findSignals(candles, tf);
    return signals.length > 0 ? signals[0] : null;
  }
}

export const signalGenerator = new SignalGenerator();
