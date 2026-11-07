// Signal Generator — генерация торговых сигналов по канону Нисона.
// ИСПРАВЛЕНО: устранение противоречий, защита от NaN, новые детекторы.

import { Candle } from './candle';
import { PatternDetector } from './pattern_engine';
import { getTrendMacro } from './trend_detection';
import { atr } from './indicators';
import { patternStory } from './patterns';
import { isReversalPatternName, requiresNextCandleConfirmation } from './pattern_ids';
import { nearestStructuralTarget } from './nison_targets';
import { resolveSignalStatus, SignalStatus } from './signal_lifecycle';
import { computeSignalQuality } from './signal_quality';
import type { Zone } from './zone_voter';
import { evaluatePricePath, type PricePathInfo } from './price_path';
import { detectPhase, phaseMultiplier, type PhaseInfo } from './wyckoff';

export interface MarketContext {
  zones: { support: Zone[]; resistance: Zone[] };
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
  status?: SignalStatus;
  story: string;
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

  resetRun(): void {
    this.firstSeen.clear();
    this.lastRunLen = -1;
  }

  private makeSignal(
    direction: 'long' | 'short',
    pattern: string,
    candle: Candle,
    closedCandles: Candle[],
    tf: string,
    quality: number = 1.0,
    boundsOverride?: { patternLow: number; patternHigh: number; patternCandlesCount?: number; patternStartIdx?: number; patternEndIdx?: number },
  ): Signal | null {
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
    // ИСПРАВЛЕНО: защита от NaN/бесконечности.
    if (!Number.isFinite(bookStop) || !Number.isFinite(candle.close)) return null;

    const risk = Math.abs(candle.close - bookStop);
    if (risk === 0) return null;
    const riskPercent = risk / candle.close;
    if (riskPercent > 0.10) return null;

    const noiseFloor = Math.max(candle.close * 0.01, atr(closedCandles, 14));
    const maxReward = candle.close * 0.20;
    const structural = nearestStructuralTarget(candle.close, direction, closedCandles, { noiseFloor, maxReward });
    if (!structural || !Number.isFinite(structural.level) || structural.level <= 0) return null;

    const target = structural.level;
    const reward = Math.abs(target - candle.close);
    if (!Number.isFinite(reward) || reward < noiseFloor || reward > maxReward) return null;

    const rr = reward / risk;
    if (!Number.isFinite(rr)) return null;

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
      confirmed: false,
      story: patternStory(pattern) + ` | цель: ${structural.detail} (${structural.kind === 'zone' ? 'S/R-зона' : 'свинг'})`,
      meta: bounds,
    };
  }

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

    if (status === 'pending' && !requiresNextCandleConfirmation(signal.pattern)) {
      const formationClosed = i < closedCount;
      const base = signal.pattern.toUpperCase();
      // «Последнее поглощение»: подтверждение — закрытие за уровнем поглощающей свечи (ЗГ гл. 3).
      const selfConfirming = base.includes('ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ')
        ? true
        : direction === 'long' ? patternCandle.isBullish : patternCandle.isBearish;
      if (formationClosed && selfConfirming) status = 'confirmed';
    }

    signal.status = status;
    signal.confirmed = status === 'confirmed';

    signal.quality = computeSignalQuality({
      direction,
      pattern: signal.pattern,
      confirmCandle: patternCandle,
      priorCandles: candles.slice(0, i),
      status,
    });

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

  findSignals(
    candles: Candle[],
    tf: string = 'D',
    opts?: { context?: MarketContext },
  ): Signal[] {
    if (candles.length < 6) return [];
    const ctx = opts?.context ?? null;
    const phase: PhaseInfo | null = ctx ? detectPhase(candles) : null;
    const closedCount = (() => {
      const last = candles[candles.length - 1];
      const forming = (last as unknown as { isForming?: boolean }).isForming === true;
      return forming ? candles.length - 1 : candles.length;
    })();

    const signals: Signal[] = [];
    const seen = new Set<string>();
    const pushUnique = (s: Signal): void => {
      const key = `${s.pattern}|${s.direction}|${s.meta.patternEndIdx}`;
      if (seen.has(key)) return;
      seen.add(key);
      signals.push(s);
    };

    // Обработка одной найденной формации (единый путь вместо трёх дублей).
    const emit = (
      check: { found: boolean; name: string },
      direction: 'long' | 'short',
      i: number,
    ): void => {
      if (!check.found) return;
      const patternCandle = candles[i];
      const closed = candles.slice(0, i + 1);
      const patternTrend = getTrendMacro(closed, patternCandle.close);
      const isReversalPattern = isReversalPatternName(check.name);

      if (patternTrend === 'БОКОВИК') return;
      if (isReversalPattern) {
        if (direction === 'long' && patternTrend !== 'НИСХОДЯЩИЙ') return;
        if (direction === 'short' && patternTrend !== 'ВОСХОДЯЩИЙ') return;
      } else {
        if (direction === 'long' && patternTrend === 'НИСХОДЯЩИЙ') return;
        if (direction === 'short' && patternTrend === 'ВОСХОДЯЩИЙ') return;
      }

      const bounds = PatternDetector.getFormationBounds(check.name, candles, i);
      const signal = this.makeSignal(direction, check.name, patternCandle, closed, tf, 1.0, bounds);
      if (!signal) return;
      this.applyLifecycle(signal, direction, patternCandle, bounds, candles, i, closedCount, ctx, phase);
      if ((signal.path?.adjustedRR ?? signal.rr) >= 2) pushUnique(signal);
    };

    for (let i = candles.length - 2; i >= Math.max(0, candles.length - 20); i--) {
      const patternCandle = candles[i];
      const closed = candles.slice(0, i + 1);

      // Трёхсвечные и более.
      emit(closed.length >= 3 ? PatternDetector.isMorningStar(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 3 ? PatternDetector.isEveningStar(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 3 ? PatternDetector.isAbandonedBaby(closed) : { found: false, name: '' },
        closed.length > 0 && closed[closed.length - 1].isBullish ? 'long' : 'short', i);
      emit(closed.length >= 6 ? PatternDetector.isTowerTop(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 6 ? PatternDetector.isTowerBottom(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 12 ? PatternDetector.isThreeMountains(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 12 ? PatternDetector.isThreeRivers(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 5 ? PatternDetector.isRisingThree(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 5 ? PatternDetector.isFallingThree(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 5 ? PatternDetector.isMatHold(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 4 ? PatternDetector.isDoubleThrustingBull(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 3 ? PatternDetector.isThreeWhiteSoldiers(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 3 ? PatternDetector.isThreeBlackCrows(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 5 ? PatternDetector.isLadderBottom(closed) : { found: false, name: '' }, 'long', i);
      emit(closed.length >= 3 ? PatternDetector.isTwoCrows(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 3 ? PatternDetector.isTasuki(closed) : { found: false, name: '' },
        closed.length > 0 && closed[closed.length - 1].isBullish ? 'long' : 'short', i);
      // НОВЫЕ: ослабленные формы (нейтральные предупреждения) — не генерируют сделки,
      // но фиксируются в журнале как «осторожность» через качество и статус.
      emit(closed.length >= 3 ? PatternDetector.isAdvanceBlock(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 2 ? PatternDetector.isStalled(closed) : { found: false, name: '' }, 'short', i);

      // Двухсвечные.
      if (i > 0) {
        const prevCandle = candles[i - 1];
        const hist = candles.slice(0, i - 1);
        emit(PatternDetector.isBullishEngulfing(prevCandle, patternCandle, hist), 'long', i);
        emit(PatternDetector.isBearishEngulfing(prevCandle, patternCandle, hist), 'short', i);
        emit(PatternDetector.isPiercingPattern(prevCandle, patternCandle, hist), 'long', i);
        emit(PatternDetector.isDarkCloudCover(prevCandle, patternCandle, hist), 'short', i);
        emit(PatternDetector.isTweezerBottom(prevCandle, patternCandle, hist), 'long', i);
        emit(PatternDetector.isTweezerTop(prevCandle, patternCandle, hist), 'short', i);
        emit(PatternDetector.isHarami(prevCandle, patternCandle, hist),
          prevCandle.isBearish ? 'long' : 'short', i);
        emit(PatternDetector.isHaramiCross(prevCandle, patternCandle, hist),
          prevCandle.isBearish ? 'long' : 'short', i);
        emit(PatternDetector.isLastEngulfing(prevCandle, patternCandle, hist),
          prevCandle.isBullish ? 'long' : 'short', i);
        emit(PatternDetector.isBullishBelt(prevCandle, patternCandle, hist), 'long', i);
        emit(PatternDetector.isBearishBelt(prevCandle, patternCandle, hist), 'short', i);
        emit(PatternDetector.isCounterattack(prevCandle, patternCandle, hist),
          prevCandle.isBearish ? 'long' : 'short', i);
        emit(PatternDetector.isSeparatingLines(prevCandle, patternCandle, hist),
          patternCandle.isBullish ? 'long' : 'short', i);
        emit(PatternDetector.isNeckFamily(prevCandle, patternCandle, hist), 'short', i);
      }

      // Односвечные.
      const prior = candles.slice(0, i);
      emit(PatternDetector.isHammer(patternCandle, prior), 'long', i);
      emit(PatternDetector.isShootingStar(patternCandle, prior), 'short', i);
      emit(PatternDetector.isHangingMan(patternCandle, prior), 'short', i);
      emit(PatternDetector.isInvertedHammer(patternCandle, prior), 'long', i);
      // НОВОЕ: верхнее спружинивание (гл. 11 ЯС).
      emit(closed.length >= 25 ? PatternDetector.isUpthrust(closed) : { found: false, name: '' }, 'short', i);
      emit(closed.length >= 25 ? PatternDetector.isSpring(closed) : { found: false, name: '' }, 'long', i);
    }

    // ИСПРАВЛЕНО: устранение противоречий по канону Нисона.
    // Если на одном завершении формации есть разнонаправленные сигналы и
    // НИ ОДИН не подтверждён закрытой свечой — отклоняем ВСЕ (не угадываем).
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
      if (confirmeds.length === 1) keep = confirmeds[0];
      else if (confirmeds.length >= 2) keep = confirmeds.find(g => g.direction === 'long') ?? confirmeds[0];
      else keep = undefined; // ни один не подтверждён → отклоняем все
      for (const g of group) {
        if (g !== keep) dropKeys.add(`${g.pattern}|${g.direction}|${g.meta.patternEndIdx}`);
      }
    }
    const deduped = dropKeys.size
      ? signals.filter(sg => !dropKeys.has(`${sg.pattern}|${sg.direction}|${sg.meta.patternEndIdx}`))
      : signals;

    const RANK: Record<string, number> = { confirmed: 3, pending: 2, expired: 1, invalidated: 0 };
    deduped.sort((a, b) =>
      (Number(Boolean((b as Signal & { isFreshEvent?: boolean }).isFreshEvent)) -
        Number(Boolean((a as Signal & { isFreshEvent?: boolean }).isFreshEvent))) ||
      (RANK[b.status ?? 'pending'] - RANK[a.status ?? 'pending']) ||
      Number(b.confirmed) - Number(a.confirmed) ||
      b.quality - a.quality ||
      b.rr - a.rr,
    );
    this.markFresh(deduped, candles.length);
    return deduped.slice(0, 8);
  }

  findSignal(candles: Candle[], tf: string = 'D'): Signal | null {
    const signals = this.findSignals(candles, tf);
    return signals.length > 0 ? signals[0] : null;
  }
}

export const signalGenerator = new SignalGenerator();
