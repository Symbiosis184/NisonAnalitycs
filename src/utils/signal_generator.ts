// Signal Generator - Главный класс генерации торговых сигналов по Нисону
import { Candle } from './candle';
import { PatternDetector, VolumeAnalyzer } from './pattern_engine';

import { getTrendContext, getTrendMacro } from './trend_detection';
import { ema, atr } from './indicators';
import { patternStory } from './patterns';
import { isReversalPatternName, requiresNextCandleConfirmation } from './pattern_ids';
import { nearestStructuralTarget } from './nison_targets';
import { resolveSignalStatus, SignalStatus } from './signal_lifecycle';
import { computeSignalQuality } from './signal_quality';
import type { Zone } from './zone_voter';
import { evaluatePricePath, type PricePathInfo } from './price_path';
import { detectPhase, phaseMultiplier, type PhaseInfo } from './wyckoff';
import { buildVolumeProfile, type VolumeProfile } from './volume_profile';

// Константы
const TIMEOUT_H1 = 10800; // 3 часа в секундах
const TIMEOUT_D1 = 259200; // 3 дня в секундах
const DOJI_MAX_FREQ = 0.15;
const RANGE_PROXIMITY_PCT = 0.015;

// Точное соответствие книгам Нисона («Japanese Candlestick Charting Techniques»):
//  • гл. 3: односвечные модели (молот, повешенный, падающая звезда, доджи,
//    поясные головы) — «сигнал к сигналу», вход ТОЛЬКО после подтверждения
//    следующей закрытой свечой;
//  • гл. 4–6: харами/харами-кроссы, татами, тычущие линии, контратака,
//    твизеры — неполные формации, подтверждение ОБЯЗАТЕЛЬНО;
//  • гл. 5–6: завершённые формации (утренняя/вечерняя звезда, поглощения,
//    тёмное облако, три белых солдата / три чёрных ворона, покинутое дитя) —
//    последняя свеча самой модели И ЕСТЬ подтверждение Нисона: торговое
//    решение принимается сразу по её закрытии, ждать ещё одну свечу книга
//    требует только для моделей из первых двух пунктов.
// Учёт ведёт единый канонический список CONFIRMATION_REQUIRED_IDS
// (pattern_ids.ts). Инвертированный список SELF_CONFIRMING («не требуют
// подтверждения») удалён как противоречащий книге. Жизненный цикл
// (signal_lifecycle.resolveSignalStatus) остаётся единым для всех моделей —
// он фиксирует отмену сигнала при пробое границ формации.

/** Рыночный контекст для «путь-осознанной» фильтрации (запрос: контекст рынка). */
export interface MarketContext {
  /** Зоны S/R, собранные ZoneVoter относительно текущей цены */
  zones: { support: Zone[]; resistance: Zone[] };
  /** Опционально: профиль объёма (HVN/LVN bands) из volume_profile.buildVolumeProfile */
  volumeBands?: Array<{ low: number; high: number; weight: number }>;
}

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
  // Аудит №11: полноценный жизненный цикл по Нисону вместо булева «раз и навсегда».
  status?: SignalStatus;
  story: string;
  // Контекст рынка (запрос: фазы Вайкоффа + путь цены). Заполняются, только если
  // вызывающий передал marketContext в findSignals — обратная совместимость сохранена.
  path?: PricePathInfo;
  phase?: PhaseInfo;
  meta: {
    patternCandlesCount: number;
    patternStartIdx: number;
    patternEndIdx: number;
    patternLow: number;
    patternHigh: number;
  };
}

export class SignalGenerator {
  // FIX бэктест-аудита №2: события «первого наблюдения» формации.
  // findSignals сканирует окно последних 20 баров, поэтому одна и та же
  // формация возвращается на каждом последующем баре окна; в one-at-a-time
  // прогонах (Backtest.tsx, computeEdgeReport) фильтр «свежих» событий
  // patternEndIdx === i ловил бы формацию только на её ПЕРВОМ баре окна —
  // т.е. за день ДО подтверждения. Здесь фиксируем момент, когда пара
  // (паттерн|направление|endIdx) появляется в выдаче впервые за прогон,
  // и помечаем сигнал isFreshEvent. Потребители фильтруют по этому флагу:
  // вход происходит сразу после подтверждения формации, без lookahead
  // (весь контекст — только закрытые свечи до текущего бара).
  // Кэш живёт между вызовами одного one-at-a-time прогона (слайсы растут от
  // одного стартового бара → длина не убывает); при новом прогоне (длина
  // уменьшилась) кэш сбрасывается автоматически.
  private firstSeen = new Map<string, number>();
  private lastRunLen = -1;
  private markFresh(arr: Signal[], len: number): void {
    if (len < this.lastRunLen) this.firstSeen.clear();
    this.lastRunLen = len;
    for (const s of arr) {
      const key = `${s.pattern}|${s.direction}|${s.meta.patternEndIdx}`;
      if (!this.firstSeen.has(key)) {
        this.firstSeen.set(key, len);
        (s as Signal & { isFreshEvent?: boolean }).isFreshEvent = true;
      }
    }
  }

  // Сброс кэша «свежих событий» — вызывается перед новым one-at-a-time прогоном
  // (страница «Бэктест», computeEdgeReport), чтобы первый бар прогона гарантиро-
  // ванно считался событием, даже если история пересеклась с предыдущим прогоном.
  resetRun(): void {
    this.firstSeen.clear();
    this.lastRunLen = -1;
  }

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
    // FIX бэктест-аудита: раньше при boundsOverride границы брались с полного
    // массива, но patternStartIdx/patternEndIdx перезаписывались относительными
    // индексами короткого среза closed (closedCandles.length-1), из-за чего у
    // потребителей, сверяющих endIdx с индексом бара на ПОЛНОМ массиве
    // (Backtest.tsx, computeEdgeReport), никогда не было совпадения → 0 событий.
    // Теперь override целиком авторитетен (он вычислен вызывающим на полном
    // массиве со смещением i); если индексов нет — считаем их по closed.
    const endIdx = closedCandles.length - 1;
    type Bounds = ReturnType<typeof PatternDetector.getFormationBounds>;
    let bounds: Bounds;
    if (boundsOverride && boundsOverride.patternEndIdx !== undefined) {
      const eIdx = boundsOverride.patternEndIdx;
      const cnt = boundsOverride.patternCandlesCount ?? 1;
      bounds = {
        patternLow: boundsOverride.patternLow,
        patternHigh: boundsOverride.patternHigh,
        patternCandlesCount: cnt,
        patternStartIdx: boundsOverride.patternStartIdx ?? eIdx - (cnt - 1),
        patternEndIdx: eIdx,
      };
    } else {
      bounds = PatternDetector.getFormationBounds(pattern, closedCandles, endIdx);
      if (boundsOverride) {
        bounds.patternLow = boundsOverride.patternLow;
        bounds.patternHigh = boundsOverride.patternHigh;
        if (boundsOverride.patternCandlesCount !== undefined) bounds.patternCandlesCount = boundsOverride.patternCandlesCount;
        if (boundsOverride.patternStartIdx !== undefined) bounds.patternStartIdx = boundsOverride.patternStartIdx;
      }
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

  // Аудит №11: подтверждение = жизненный цикл signal_lifecycle.resolveSignalStatus,
  // вычисляемый ТОЛЬКО по закрытым свечам (closedCount). Булев confirmed сохранён
  // как «status === 'confirmed'» для обратной совместимости UI/journal.
  private applyLifecycle(
    signal: Signal,
    direction: 'long' | 'short',
    patternCandle: Candle,
    bounds: { patternLow: number; patternHigh: number },
    candles: Candle[],
    i: number,
    closedCount: number,
    ctx?: MarketContext | null,
    phase?: PhaseInfo | null,
  ): void {
    let status = resolveSignalStatus(candles, i, direction, patternCandle.close, bounds, closedCount);

    // Строго по книгам Нисона (гл. 5–6): ЗАВЕРШЁННЫЕ формации (звёзды,
    // поглощения, тёмное облако, три солдата/ворона, покинутое дитя и т.п.)
    // содержат подтверждение внутри себя — последняя свеча модели, закрывшаяся
    // в направлении сигнала, И ЕСТЬ подтверждающая свеча. Для них ждать ещё
    // одну следующую свечу книга не требует → фиксируем confirmed сразу
    // (при условии, что жизненный цикл не вынес более строгий вердикт —
    // invalidated/expired остаются в силе).
    // Модели из CONFIRMATION_REQUIRED_IDS (односвечные гл. 3, харами, татами,
    // тычущие, контратака, твизеры) ждут подтверждения следующей свечой.
    if (status === 'pending' && !requiresNextCandleConfirmation(signal.pattern)) {
      const formationClosed = i < closedCount; // сигнальная свеча уже закрыта
      const inDirection = direction === 'long' ? patternCandle.isBullish : patternCandle.isBearish;
      if (formationClosed && inDirection) status = 'confirmed';
    }

    signal.status = status;
    signal.confirmed = status === 'confirmed';

    // Аудит №12: честная оценка силы сигнала по канону Нисона вместо константы 1.0
    // (тренд-контекст + объём подтверждения + тело свечи + качество тени + жизненный цикл).
    signal.quality = computeSignalQuality({
      direction,
      pattern: signal.pattern,
      confirmCandle: patternCandle,
      priorCandles: candles.slice(0, i),
      status,
    });

    // Контекст рынка (запрос пользователя): фаза Вайкоффа + «путь цены» до цели.
    // quality корректируется множителем фазы; adjustedRR учитывает препятствия
    // на транзите — фильтр в findSignals использует его вместо формального rr.
    if (phase) {
      signal.phase = phase;
      signal.quality = Math.min(1, Math.round(signal.quality * phaseMultiplier(direction, phase) * 100) / 100);
    }
    if (ctx) {
      const path = evaluatePricePath({
        direction,
        entry: signal.entryPrice,
        target: signal.target,
        stop: signal.stopLoss,
        zones: ctx.zones,
        volumeBands: ctx.volumeBands,
      });
      signal.path = path;
      signal.story += ` | путь: ${path.description}`;
    }
  }

  // Главный метод поиска всех сигналов с жизненным циклом по Нисону.
  // opts.context — рыночный контекст (зоны S/R, фазы Вайкоффа, профиль объёма).
  // Без него поведение идентично прежнему (обратная совместимость тестов/UI).
  findSignals(
    candles: Candle[],
    tf: string = 'D',
    opts?: { context?: MarketContext },
  ): Signal[] {
    if (candles.length < 6) return [];

    const ctx = opts?.context ?? null;
    // Фаза Вайкоффа вычисляется один раз на полном массиве (контекст «здесь и сейчас»)
    const phase: PhaseInfo | null = ctx ? detectPhase(candles) : null;

    // Аудит №11: live-последняя свеча Bybit формируется — не учитывать её
    // как подтверждающую. Исторический прогон (все свечи закрыты) передаёт
    // весь массив; здесь conservative-правило: последняя свеча считается
    // незакрытой только если она помечена формирующейся (isForming).
    const closedCount = (() => {
      const last = candles[candles.length - 1];
      const forming = (last as unknown as { isForming?: boolean }).isForming === true;
      return forming ? candles.length - 1 : candles.length;
    })();

    const signals: Signal[] = [];

    // FIX бэктест-аудита: дедупликация по (паттерн|направление|endIdx).
    // findSignals сканирует окно последних 20 баров и возвращает живые сигналы
    // (pending/confirmed) повторно на каждом последующем баре. В one-at-a-time
    // прогонах (страница «Бэктест», computeEdgeReport) это раздувало выборку, а
    // фильтр «свежих» событий `patternEndIdx === i` не совпадал ни с одним
    // сигналом из-за переиндексации границ формации коротким срезом closed в
    // makeSignal. Итог — пустая таблица бэктеста. Дедуп + корректный endIdx
    // решают обе проблемы.
    const seen = new Set<string>();
    const pushUnique = (s: Signal): void => {
      const key = `${s.pattern}|${s.direction}|${s.meta.patternEndIdx}`;
      if (seen.has(key)) return;
      seen.add(key);
      signals.push(s);
    };

    
    // Определяем текущий тренд для контекстной фильтрации
    const currentTrend = getTrendMacro(candles, candles[candles.length - 1].close);
    
    // Проверяем последние 20 свечей на наличие паттернов
    for (let i = candles.length - 2; i >= Math.max(0, candles.length - 20); i--) {
      const patternCandle = candles[i];
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
          // Контекстная фильтрация СТРОГО по книгам Нисона:
          //  • разворотные модели легитимны только ПОСЛЕ выраженного предшествующего
          //    тренда ПРОТИВ направления сигнала («after a downtrend/uptrend» — часть
          //    определений гл. 5–6; в боковике разворачивать нечего);
          //  • модели продолжения имеют силу только ПОПУТНО тренду (гл. 9–10).
          // П.7: сверка по стабильным ID моделей; единый канонический классификатор.
          const isReversalPattern = isReversalPatternName(check.name);
          
          if (patternTrend === 'БОКОВИК') continue; // нет ни того, что продолжать, ни того, что разворачивать
          if (isReversalPattern) {
            // Разворот требует предшествующего тренда против сигнала
            if (direction === 'long' && patternTrend !== 'НИСХОДЯЩИЙ') continue;
            if (direction === 'short' && patternTrend !== 'ВОСХОДЯЩИЙ') continue;
          } else {
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
          
          // Аудит №11: жизненный цикл по ЗАКРЫТЫМ свечам (pending/confirmed/invalidated/expired)
          this.applyLifecycle(signal, direction, patternCandle, bounds, candles, i, closedCount, ctx, phase);
          
          // FIX аудита №7: раньше неподтверждённые сигналы молча выбрасывались —
          // пользователь не видел «почти-сигналов». Теперь они возвращаются с confirmed=false.
          // Запрос «контекст рынка»: порог RR считается по СКОРРЕКТИРОВАННОМУ пути
          // adjustedRR (если передан контекст) — формальный RR больше не самоцель.
          if ((signal.path?.adjustedRR ?? signal.rr) >= 2) {
            pushUnique(signal);
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
            // FIX противоречий: единый канонический классификатор разворотов
            const isReversalPattern = isReversalPatternName(check.name);
            
            if (patternTrend === 'БОКОВИК') continue;
            if (isReversalPattern) {
              // Строго по Нисону (гл. 4): разворот легитимен только ПОСЛЕ выраженного
              // предшествующего тренда ПРОТИВ сигнала — в боковике разворачивать нечего
              if (direction === 'long' && patternTrend !== 'НИСХОДЯЩИЙ') continue;
              if (direction === 'short' && patternTrend !== 'ВОСХОДЯЩИЙ') continue;
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
            
            // Аудит №11: жизненный цикл по закрытым свечам
            this.applyLifecycle(signal, direction, patternCandle, bounds, candles, i, closedCount, ctx, phase);
            
            // FIX аудита №7: неподтверждённые сигналы возвращаются с confirmed=false
            // Порог — по path-aware adjustedRR при наличии рыночного контекста.
            if ((signal.path?.adjustedRR ?? signal.rr) >= 2) {
              pushUnique(signal);
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
          // Контекстная фильтрация односвечных паттернов.
          // FIX противоречий: раньше молот считался разворотом, а повешенный/
          // падающая звезда — продолжением; в signal_quality они же числились
          // разворотами → двойная трактовка контекста и взаимоисключающие
          // сценарии long+short в одном отчёте. По Нисону (гл. 3) ВСЕ теневые
          // модели — попытки разворота: валидны только после предшествующего
          // тренда ПРОТИВ направления сигнала (молот — после снижения,
          // повешенный/падающая звезда — после роста). В боковике модель не
          // имеет разворотной силы (нет того, что разворачивать).
          if (patternTrend === 'БОКОВИК') continue;
          if (direction === 'long' && patternTrend !== 'НИСХОДЯЩИЙ') continue;
          if (direction === 'short' && patternTrend !== 'ВОСХОДЯЩИЙ') continue;

          // FIX аудита №4/№5: единые границы формации (для односвечных = high/low самой свечи)
          const bounds = PatternDetector.getFormationBounds(check.name, candles, i);
          
          const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf, 1.0, bounds);
          
          // Пропускаем если сигнал нереалистичен
          if (!signal) continue;
          
          // Аудит №11: жизненный цикл по ЗАКРЫТЫМ свечам (pending/confirmed/invalidated/expired)
          this.applyLifecycle(signal, direction, patternCandle, bounds, candles, i, closedCount, ctx, phase);
          
          // FIX аудита №7: неподтверждённые сигналы возвращаются с confirmed=false
          // Порог — по path-aware adjustedRR при наличии рыночного контекста.
          if ((signal.path?.adjustedRR ?? signal.rr) >= 2) {
            pushUnique(signal);
          }
        }
      }
    }

    // FIX аудита №8: детерминированная сортировка.
    // Строго по Нисону (гл. 4–6): взаимоисключающие сигналы на одном и том же
    // завершении формации (long+short, например бычье и медвежье поглощение)
    // не сосуществуют — остаётся только реально подтверждённый закрытой свечой;
    // если подтверждены оба или ни одного — предпочтительнее неподтверждённый
    // «первый» сигнал модели (бычий/медвежий задаётся направлением тренда).
    const byEnd = new Map<number, Signal[]>();
    for (const sig of signals) {
      const arr = byEnd.get(sig.meta.patternEndIdx) ?? [];
      arr.push(sig);
      byEnd.set(sig.meta.patternEndIdx, arr);
    }
    const dropKeys = new Set<string>();
    for (const [, group] of byEnd) {
      if (group.length < 2) continue;
      const dirs = new Set(group.map(g => g.direction));
      if (dirs.size < 2) continue;
      const confirmeds = group.filter(g => g.status === 'confirmed');
      let keep: Signal | undefined;
      if (confirmeds.length === 1) {
        keep = confirmeds[0];
      } else if (confirmeds.length >= 2) {
        keep = confirmeds.find(g => g.direction === 'long') ?? confirmeds[0];
      } else {
        keep = group.find(g => g.direction === 'long') ?? group[0];
      }
      for (const g of group) {
        if (g !== keep) dropKeys.add(`${g.pattern}|${g.direction}|${g.meta.patternEndIdx}`);
      }
    }
    const deduped = dropKeys.size ? signals.filter(sg => !dropKeys.has(`${sg.pattern}|${sg.direction}|${sg.meta.patternEndIdx}`)) : signals;

    // Аудит №11: приоритет жизненного цикла — подтверждённые > ожидает > истёк > отменён.
    const RANK: Record<string, number> = { confirmed: 3, pending: 2, expired: 1, invalidated: 0 };
    // FIX бэктест-аудита №2: сортировка ДО среза лимита — иначе «свежие» события
    // (первое появление формации) могли вылетать из top-5 по quality и бэктест
    // терял их навсегда. Первыми идут свежие события этого прогона.
    deduped.sort((a, b) =>
      (Number(Boolean((b as Signal & { isFreshEvent?: boolean }).isFreshEvent)) -
        Number(Boolean((a as Signal & { isFreshEvent?: boolean }).isFreshEvent))) ||
      (RANK[b.status ?? 'pending'] - RANK[a.status ?? 'pending']) ||
      Number(b.confirmed) - Number(a.confirmed) ||
      b.quality - a.quality ||
      b.rr - a.rr
    );
    this.markFresh(deduped, candles.length);
    return deduped.slice(0, 8);
  }

  // Для обратной совместимости
  findSignal(candles: Candle[], tf: string = 'D'): Signal | null {
    const signals = this.findSignals(candles, tf);
    return signals.length > 0 ? signals[0] : null;
  }
}

export const signalGenerator = new SignalGenerator();
