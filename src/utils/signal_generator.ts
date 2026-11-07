// Торговые сценарии поверх единого сканера свечных формаций.
// Числовые фильтры риска, RR, качества и окна ожидания — эвристики проекта.

import { Candle } from './candle';
import type { PatternMarket } from './pattern_engine';
import { atr } from './indicators';
import { patternStory } from './patterns';
import { requiresNextCandleConfirmation } from './pattern_ids';
import { nearestStructuralTarget } from './nison_targets';
import { resolveSignalLifecycle, type SignalStatus } from './signal_lifecycle';
import { computeSignalQuality } from './signal_quality';
import type { Zone } from './zone_voter';
import { evaluatePricePath, type PricePathInfo } from './price_path';
import { detectPhase, type PhaseInfo } from './wyckoff';
import { scanPatternCandidates, type PatternCandidate } from './pattern_scanner';

export interface MarketContext {
  zones: { support: Zone[]; resistance: Zone[] };
  volumeBands?: Array<{ low: number; high: number; weight: number }>;
}

export interface Signal {
  direction: 'long' | 'short';
  pattern: string;
  /** Для pending — оценка сценария; для confirmed — фактический close входа. */
  entryPrice: number;
  stopLoss: number;
  target: number;
  risk: number;
  rr: number;
  /** Эвристическая оценка в [0, 1], не статистическая вероятность. */
  quality: number;
  timestamp: number;
  confirmed: boolean;
  status: SignalStatus;
  story: string;
  path?: PricePathInfo;
  phase?: PhaseInfo;
  isFreshEvent?: boolean;
  meta: {
    patternCandlesCount: number;
    patternStartIdx: number;
    patternEndIdx: number;
    patternLow: number;
    patternHigh: number;
    confirmationIndex: number | null;
    /** null у pending: фактического входа ещё не было. */
    entryIndex: number | null;
    entryTime: number | null;
    entryEstimated: boolean;
  };
}

export class SignalGenerator {
  private markFresh(signals: Signal[], closedCount: number): void {
    for (const signal of signals) {
      // Свежесть выводится только из переданной истории: событие произошло на
      // последнем закрытом баре. Скрытый кэш здесь мог переносить состояние
      // между инструментами и подавлять одинаковые формации разных прогонов.
      const eventIndex = signal.meta.entryIndex ?? signal.meta.patternEndIdx;
      signal.isFreshEvent = eventIndex === closedCount - 1;
    }
  }

  private makeSignal(
    candidate: PatternCandidate,
    candles: Candle[],
    closedCount: number,
    timeframe: string,
    context: MarketContext | null,
  ): Signal | null {
    const direction = candidate.direction;
    if (direction !== 'long' && direction !== 'short') return null;

    const patternEndIdx = candidate.patternEndIdx;
    const patternCandle = candles[patternEndIdx];
    let status: SignalStatus;
    let confirmationIndex: number | null;
    let entryIndex: number | null;

    if (requiresNextCandleConfirmation(candidate.name)) {
      const lifecycle = resolveSignalLifecycle(
        candles,
        patternEndIdx,
        direction,
        patternCandle.close,
        candidate,
        closedCount,
      );
      if (lifecycle.status === 'invalidated' || lifecycle.status === 'expired') return null;
      status = lifecycle.status;
      confirmationIndex = lifecycle.confirmationIndex;
      entryIndex = status === 'confirmed' ? confirmationIndex : null;
    } else {
      // Завершённая модель подтверждена своим последним закрытым баром.
      status = 'confirmed';
      confirmationIndex = patternEndIdx;
      entryIndex = patternEndIdx;
    }

    const referenceIndex = entryIndex ?? patternEndIdx;
    const entryCandle = candles[referenceIndex];
    const history = candles.slice(0, referenceIndex + 1);
    const entryPrice = entryCandle.close;
    const stopLoss = direction === 'long' ? candidate.patternLow : candidate.patternHigh;
    if (!Number.isFinite(stopLoss) || !Number.isFinite(entryPrice) || entryPrice <= 0) return null;

    const riskDistance = direction === 'long' ? entryPrice - stopLoss : stopLoss - entryPrice;
    if (!Number.isFinite(riskDistance) || riskDistance <= 0) return null;
    const risk = riskDistance / entryPrice;
    if (risk > 0.10) return null;

    // ATR, лимиты 10%/20% и RR≥2 — настройки риска проекта, не правила книг.
    const noiseFloor = Math.max(entryPrice * 0.01, atr(history, 14));
    const maxReward = entryPrice * 0.20;
    const structural = nearestStructuralTarget(entryPrice, direction, history, {
      noiseFloor,
      maxReward,
      timeframe,
    });
    if (!structural || !Number.isFinite(structural.level) || structural.level <= 0) return null;

    const reward = direction === 'long'
      ? structural.level - entryPrice
      : entryPrice - structural.level;
    if (!Number.isFinite(reward) || reward < noiseFloor || reward > maxReward) return null;
    const rr = reward / riskDistance;
    if (!Number.isFinite(rr) || rr < 2) return null;

    const quality = computeSignalQuality({
      direction,
      pattern: candidate.name,
      confirmCandle: entryCandle,
      priorCandles: candles.slice(0, referenceIndex),
      status,
    });
    const phase = detectPhase(history);

    const signal: Signal = {
      direction,
      pattern: candidate.name,
      entryPrice,
      stopLoss,
      target: structural.level,
      risk,
      rr,
      quality,
      timestamp: entryCandle.time,
      confirmed: status === 'confirmed',
      status,
      story: patternStory(candidate.name)
        + ` | ${status === 'confirmed' ? 'фактический вход по закрытию бара подтверждения' : 'оценочный сценарий до подтверждения'}`
        + ` | цель: ${structural.detail} (${structural.kind === 'zone' ? 'S/R-зона' : 'свинг'})`,
      phase,
      meta: {
        patternCandlesCount: candidate.formationSize,
        patternStartIdx: candidate.patternStartIdx,
        patternEndIdx,
        patternLow: candidate.patternLow,
        patternHigh: candidate.patternHigh,
        confirmationIndex,
        entryIndex,
        entryTime: entryIndex === null ? null : candles[entryIndex].time,
        entryEstimated: status === 'pending',
      },
    };

    if (context) {
      const path = evaluatePricePath({
        direction,
        entry: entryPrice,
        target: signal.target,
        stop: stopLoss,
        zones: context.zones,
        volumeBands: context.volumeBands,
      });
      signal.path = path;
      signal.story += ` | путь: ${path.description}`;
    }
    return signal;
  }

  findSignals(
    candles: Candle[],
    timeframe: string = 'D',
    opts?: { context?: MarketContext; market?: PatternMarket },
  ): Signal[] {
    if (candles.length < 6) return [];
    const context = opts?.context ?? null;
    const last = candles[candles.length - 1];
    const forming = (last as unknown as { isForming?: boolean }).isForming === true;
    const closedCount = forming ? candles.length - 1 : candles.length;
    if (closedCount < 6) return [];

    const candidates = scanPatternCandidates(candles, {
      context: { timeframe, market: opts?.market ?? 'crypto' },
      fromIndex: Math.max(1, closedCount - 20),
      toIndex: closedCount - 1,
    });
    const signals: Signal[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.tradeable) continue;
      const signal = this.makeSignal(candidate, candles, closedCount, timeframe, context);
      if (!signal) continue;
      const key = `${signal.pattern}|${signal.direction}|${signal.meta.patternEndIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push(signal);
    }

    // При разнонаправленных сценариях сохраняется только одно фактически
    // подтверждённое направление. Если подтверждены обе стороны (или ни одной),
    // вся группа отклоняется: произвольный приоритет long/short недопустим.
    const byEnd = new Map<number, Signal[]>();
    for (const signal of signals) {
      const group = byEnd.get(signal.meta.patternEndIdx) ?? [];
      group.push(signal);
      byEnd.set(signal.meta.patternEndIdx, group);
    }
    const deduped = signals.filter(signal => {
      const group = byEnd.get(signal.meta.patternEndIdx) ?? [];
      if (new Set(group.map(item => item.direction)).size < 2) return true;
      const confirmedDirections = new Set(
        group.filter(item => item.status === 'confirmed').map(item => item.direction),
      );
      return confirmedDirections.size === 1
        && signal.status === 'confirmed'
        && confirmedDirections.has(signal.direction);
    });

    this.markFresh(deduped, closedCount);
    const rank: Record<SignalStatus, number> = {
      confirmed: 3,
      pending: 2,
      expired: 1,
      invalidated: 0,
    };
    deduped.sort((a, b) =>
      Number(Boolean(b.isFreshEvent)) - Number(Boolean(a.isFreshEvent))
      || rank[b.status] - rank[a.status]
      || Number(b.confirmed) - Number(a.confirmed)
      || b.quality - a.quality
      || b.rr - a.rr);
    return deduped.slice(0, 8);
  }

  findSignal(candles: Candle[], timeframe: string = 'D'): Signal | null {
    return this.findSignals(candles, timeframe)[0] ?? null;
  }
}

export const signalGenerator = new SignalGenerator();
