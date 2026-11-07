// Signal Generator — генерация торговых сигналов строго по канону Нисона.
import { Candle } from './candle';
import { PatternDetector, patternCanon, basePatternName, type PatternCanon } from './pattern_engine';
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

// Параметры риска (НЕ канон Нисона: книга требует оценивать соотношение риска и прибыли
// — ЯС гл. 4, ЗГ гл. 4 — но числовых порогов не фиксирует). Значения вынесены в opts.
const DEFAULT_MIN_RR = 2;
const DEFAULT_MAX_RISK_PCT = 0.10;
const DEFAULT_MAX_REWARD_PCT = 0.20;
const SCAN_BARS = 20;
const MAX_SIGNALS = 8;

/** Рыночный контекст для «путь-осознанной» фильтрации. */
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

/**
 * Предупреждения (ЯС гл. 7–8): модели, которые НЕ являются точкой входа —
 * дожи, «высокая волна», «отбитое наступление», «торможение».
 * «Многие… считают доджи прямым сигналом покупать или продавать. Это неправильно».
 */
export interface CautionSignal {
  index: number;
  pattern: string;
  note: string;
  severity: number;
}

type Candidate = {
  check: { found: boolean; name: string };
  direction: 'long' | 'short';
  candle: Candle;
  i: number;
  closed: Candle[];
};

export class SignalGenerator {
  // Кэш «свежих» событий для one-at-a-time прогонов (без lookahead).
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

  /** Классификация модели: локальный канон (таблица по книгам) → внешний маппер как fallback. */
  private canon(name: string): PatternCanon & { isReversal: boolean } {
    const c = patternCanon(name);
    const base = basePatternName(name);
    const isReversal = c.kind === 'reversal' ? true : c.kind === 'continuation' ? false : isReversalPatternName(base);
    return { ...c, isReversal };
  }

  private needsConfirmation(name: string): boolean {
    const base = basePatternName(name);
    const local = patternCanon(base);
    return local ? local.needsConfirmation : requiresNextCandleConfirmation(base);
  }

  private makeSignal(
    direction: 'long' | 'short',
    pattern: string,
    candle: Candle,
    closedCandles: Candle[],
    tf: string,
    quality: number,
    boundsOverride?: {
      patternLow: number;
      patternHigh: number;
      patternCandlesCount?: number;
      patternStartIdx?: number;
      patternEndIdx?: number;
    },
    limits?: { minRR?: number; maxRiskPct?: number; maxRewardPct?: number },
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

    // ЯС гл. 4: стоп — за экстремумом ФОРМАЦИИ («книжный» стоп).
    const bookStop = direction === 'long' ? bounds.patternLow : bounds.patternHigh;
    const risk = Math.abs(candle.close - bookStop);
    if (risk === 0) return null;
    const riskPercent = risk / candle.close;
    if (riskPercent > (limits?.maxRiskPct ?? DEFAULT_MAX_RISK_PCT)) return null;

    // ЯС гл. 4/11: цель — ближайший ЗНАЧИМЫЙ ценовой ориентир (зона S/R или экстремум),
    // ATR используется только как шумовой пол.
    const noiseFloor = Math.max(candle.close * 0.01, atr(closedCandles, 14));
    const maxReward = candle.close * (limits?.maxRewardPct ?? DEFAULT_MAX_REWARD_PCT);
    const structural = nearestStructuralTarget(candle.close, direction, closedCandles, { noiseFloor, maxReward });
    if (!structural) return null; // нет явного ориентира — сигнала нет

    const target = structural.level;
    const reward = Math.abs(target - candle.close);
    if (reward < noiseFloor || reward > maxReward) return null;

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
      confirmed: false,
      story:
        patternStory(pattern) +
        ` | цель: ${structural.detail} (${structural.kind === 'zone' ? 'S/R-зона' : 'свинг'})`,
      meta: bounds,
    };
  }

  /**
   * Жизненный цикл сигнала (ЯС гл. 4–6):
   * завершённые формации содержат подтверждение в себе; модели из гл. 3/6
   * (односвечные, харами, татами, тычущие, контратака, пинцет, последнее поглощение)
   * ждут подтверждения СЛЕДУЮЩЕЙ закрытой свечой.
   */
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

    if (status === 'pending' && !this.needsConfirmation(signal.pattern)) {
      const formationClosed = i < closedCount; // сигнальная свеча уже закрыта
      // Для «последнего поглощения» направление противоположно цвету последней свечи
      // (ЗГ гл. 3): подтверждение — закрытие за её уровнем, его проверяет resolveSignalStatus.
      const base = basePatternName(signal.pattern);
      const selfConfirming = base.startsWith('ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ')
        ? true
        : direction === 'long'
          ? patternCandle.isBullish
          : patternCandle.isBearish;
      if (formationClosed && selfConfirming) status = 'confirmed';
    }

    signal.status = status;
    signal.confirmed = status === 'confirmed';

    const canon = this.canon(signal.pattern);
    signal.quality = computeSignalQuality({
      direction,
      pattern: signal.pattern,
      confirmCandle: patternCandle,
      priorCandles: candles.slice(0, i),
      status,
    });
    // Вес модели по книге (второстепенные сигналы не должны конкурировать с основными).
    signal.quality = Math.min(1, Math.round(signal.quality * canon.weight * 100) / 100);

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

  /** Сбор всех кандидатов на баре i (единый конвейер вместо трёх дублирующих веток). */
  private collectCandidates(candles: Candle[], i: number): Candidate[] {
    const patternCandle = candles[i];
    const closed = candles.slice(0, i + 1);
    const out: Candidate[] = [];
    const push = (check: { found: boolean; name: string }, direction: 'long' | 'short'): void => {
      if (check.found) out.push({ check, direction, candle: patternCandle, i, closed });
    };

    // --- формации из 3+ свечей ---
    if (closed.length >= 3) {
      push(PatternDetector.isMorningStar(closed), 'long');
      push(PatternDetector.isEveningStar(closed), 'short');
      push(PatternDetector.isThreeWhiteSoldiers(closed), 'long');
      push(PatternDetector.isThreeBlackCrows(closed), 'short');
      push(PatternDetector.isAdvanceBlock(closed), 'short'); // neutral → в caution-поток
      push(PatternDetector.isStalled(closed), 'short'); //      neutral → в caution-поток
      push(PatternDetector.isTwoCrows(closed), 'short');
      push(PatternDetector.isTasuki(closed), closed[closed.length - 1].isBullish ? 'long' : 'short');
      push(PatternDetector.isAbandonedBaby(closed), closed[closed.length - 1].isBullish ? 'long' : 'short');
      push(PatternDetector.isDoubleThrustingBull(closed), 'long');
    }
    if (closed.length >= 5) {
      push(PatternDetector.isRisingThree(closed), 'long');
      push(PatternDetector.isFallingThree(closed), 'short');
      push(PatternDetector.isMatHold(closed), 'long');
      push(PatternDetector.isLadderBottom(closed), 'long');
    }
    if (closed.length >= 6) {
      push(PatternDetector.isTowerTop(closed), 'short');
      push(PatternDetector.isTowerBottom(closed), 'long');
      push(PatternDetector.isConsolidationBreakout(closed), closed[closed.length - 1].isBullish ? 'long' : 'short');
    }
    if (closed.length >= 7) push(PatternDetector.isGappingPlay(closed), closed[closed.length - 1].isBullish ? 'long' : 'short');
    if (closed.length >= 12) {
      push(PatternDetector.isThreeMountains(closed), 'short');
      push(PatternDetector.isThreeRivers(closed), 'long');
    }
    if (closed.length >= 21) {
      push(PatternDetector.isKeyReversal(closed), closed[closed.length - 1].isBullish ? 'long' : 'short');
      push(PatternDetector.isSpring(closed), 'long');
      push(PatternDetector.isUpthrust(closed), 'short');
    }

    // --- формации из двух свечей ---
    if (i > 0) {
      const prevCandle = candles[i - 1];
      const hist = candles.slice(0, i - 1);
      push(PatternDetector.isBullishEngulfing(prevCandle, patternCandle, hist), 'long');
      push(PatternDetector.isBearishEngulfing(prevCandle, patternCandle, hist), 'short');
      push(PatternDetector.isPiercingPattern(prevCandle, patternCandle, hist), 'long');
      push(PatternDetector.isDarkCloudCover(prevCandle, patternCandle, hist), 'short');
      push(PatternDetector.isLastEngulfing(prevCandle, patternCandle, hist), hist.length && prevCandle.isBullish ? 'long' : 'short');
      push(PatternDetector.isHarami(prevCandle, patternCandle, hist), prevCandle.isBearish ? 'long' : 'short');
      push(PatternDetector.isHaramiCross(prevCandle, patternCandle, hist), prevCandle.isBearish ? 'long' : 'short');
      push(PatternDetector.isCounterattack(prevCandle, patternCandle, hist), prevCandle.isBearish ? 'long' : 'short');
      push(PatternDetector.isSeparatingLines(prevCandle, patternCandle, hist), patternCandle.isBullish ? 'long' : 'short');
      push(PatternDetector.isNeckFamily(prevCandle, patternCandle, hist), 'short');
      push(PatternDetector.isBullishBelt(patternCandle, candles.slice(0, i)), 'long');
      push(PatternDetector.isBearishBelt(patternCandle, candles.slice(0, i)), 'short');
      push(PatternDetector.isTweezerBottom(candles, i), 'long');
      push(PatternDetector.isTweezerTop(candles, i), 'short');
    }

    // --- одиночные свечи ---
    const prior = candles.slice(0, i);
    push(PatternDetector.isHammer(patternCandle, prior), 'long');
    push(PatternDetector.isImperfectHammer(patternCandle, prior), 'long');
    push(PatternDetector.isInvertedHammer(patternCandle, prior), 'long');
    push(PatternDetector.isHangingMan(patternCandle, prior), 'short');
    push(PatternDetector.isShootingStar(patternCandle, prior), 'short');
    push(PatternDetector.isTrendPullbackCandle(closed), patternCandle.isBullish ? 'long' : 'short');

    // --- нейтральные (предупреждения, не точки входа) ---
    const doji = PatternDetector.classifyDoji(patternCandle);
    if (doji.found) out.push({ check: doji, direction: 'short', candle: patternCandle, i, closed });
    const highWave = PatternDetector.isHighWave(patternCandle, prior);
    if (highWave.found) out.push({ check: highWave, direction: 'short', candle: patternCandle, i, closed });
    const volSpin = PatternDetector.isVolSpin(patternCandle, prior);
    if (volSpin.found) {
      out.push({ check: volSpin, direction: volSpin.name === 'НАКОПЛЕНИЕ' ? 'long' : 'short', candle: patternCandle, i, closed });
    }
    const levelTest = PatternDetector.isLevelTest(closed);
    if (levelTest.found) out.push({ check: levelTest, direction: levelTest.name.includes('БЫЧИЙ') ? 'long' : 'short', candle: patternCandle, i, closed });

    return out;
  }

  findSignals(
    candles: Candle[],
    tf: string = 'D',
    opts?: { context?: MarketContext; minRR?: number; maxRiskPct?: number; maxRewardPct?: number },
  ): Signal[] {
    if (candles.length < 6) return [];
    const ctx = opts?.context ?? null;
    const limits = {
      minRR: opts?.minRR ?? DEFAULT_MIN_RR,
      maxRiskPct: opts?.maxRiskPct ?? DEFAULT_MAX_RISK_PCT,
      maxRewardPct: opts?.maxRewardPct ?? DEFAULT_MAX_REWARD_PCT,
    };
    const phase: PhaseInfo | null = ctx ? detectPhase(candles) : null;

    // Последняя свеча считается незакрытой только если она помечена формирующейся.
    const last = candles[candles.length - 1];
    const forming = (last as unknown as { isForming?: boolean }).isForming === true;
    const closedCount = forming ? candles.length - 1 : candles.length;

    const signals: Signal[] = [];
    const seen = new Set<string>();
    const pushUnique = (s: Signal): void => {
      const key = `${s.pattern}|${s.direction}|${s.meta.patternEndIdx}`;
      if (seen.has(key)) return;
      seen.add(key);
      signals.push(s);
    };

    // Старт с последней ЗАКРЫТОЙ свечи: для live-счёта (формирующаяся свеча) это length-2,
    // для полностью закрытой истории — length-1 (прежняя версия теряла самый свежий сигнал).
    const startIdx = Math.max(1, closedCount - 1);
    const stopIdx = Math.max(0, candles.length - SCAN_BARS);

    for (let i = startIdx; i >= stopIdx; i--) {
      const patternCandle = candles[i];
      const closed = candles.slice(0, i + 1);
      const patternTrend = getTrendMacro(closed, patternCandle.close);

      for (const cand of this.collectCandidates(candles, i)) {
        const canon = this.canon(cand.check.name);
        // ЯС гл. 8: дожи, «высокая волна», «отбитое наступление», «торможение» —
        // предупреждения, а не сигналы к сделке.
        if (canon.kind === 'neutral') continue;

        // Контекстная фильтрация строго по книге: разворот легитимен только ПОСЛЕ тренда
        // против сигнала (гл. 4–6), продолжение — только попутно тренду (гл. 7).
        if (patternTrend === 'БОКОВИК') continue;
        if (canon.isReversal) {
          if (cand.direction === 'long' && patternTrend !== 'НИСХОДЯЩИЙ') continue;
          if (cand.direction === 'short' && patternTrend !== 'ВОСХОДЯЩИЙ') continue;
        } else {
          if (cand.direction === 'long' && patternTrend === 'НИСХОДЯЩИЙ') continue;
          if (cand.direction === 'short' && patternTrend === 'ВОСХОДЯЩИЙ') continue;
        }

        const bounds = PatternDetector.getFormationBounds(cand.check.name, candles, i);
        const signal = this.makeSignal(
          cand.direction,
          cand.check.name,
          cand.candle,
          cand.closed,
          tf,
          1.0,
          bounds,
          limits,
        );
        if (!signal) continue;

        this.applyLifecycle(signal, cand.direction, patternCandle, bounds, candles, i, closedCount, ctx, phase);

        // Неподтверждённые сигналы возвращаются с confirmed = false (жизненный цикл решает).
        if ((signal.path?.adjustedRR ?? signal.rr) >= limits.minRR) pushUnique(signal);
      }
    }

    // Взаимоисключающие сигналы на одном завершении формации (ЯС гл. 4–6).
    const byEnd = new Map<number, Signal[]>();
    for (const sig of signals) {
      const arr = byEnd.get(sig.meta.patternEndIdx) ?? [];
      arr.push(sig);
      byEnd.set(sig.meta.patternEndIdx, arr);
    }
    const dropKeys = new Set<string>();
    for (const [, group] of byEnd) {
      if (group.length < 2) continue;
      const dirs = new Set(group.map((g) => g.direction));
      if (dirs.size < 2) continue;
      const confirmeds = group.filter((g) => g.status === 'confirmed');
      let keep: Signal | undefined;
      if (confirmeds.length === 1) keep = confirmeds[0];
      else if (confirmeds.length >= 2) keep = confirmeds.find((g) => g.direction === 'long') ?? confirmeds[0];
      else keep = group.find((g) => g.direction === 'long') ?? group[0];
      for (const g of group) {
        if (g !== keep) dropKeys.add(`${g.pattern}|${g.direction}|${g.meta.patternEndIdx}`);
      }
    }
    const deduped = dropKeys.size
      ? signals.filter((sg) => !dropKeys.has(`${sg.pattern}|${sg.direction}|${sg.meta.patternEndIdx}`))
      : signals;

    const RANK: Record<string, number> = { confirmed: 3, pending: 2, expired: 1, invalidated: 0 };
    deduped.sort(
      (a, b) =>
        Number(Boolean((b as Signal & { isFreshEvent?: boolean }).isFreshEvent)) -
          Number(Boolean((a as Signal & { isFreshEvent?: boolean }).isFreshEvent)) ||
        RANK[b.status ?? 'pending'] - RANK[a.status ?? 'pending'] ||
        Number(b.confirmed) - Number(a.confirmed) ||
        b.quality - a.quality ||
        b.rr - a.rr,
    );
    this.markFresh(deduped, candles.length);
    return deduped.slice(0, MAX_SIGNALS);
  }

  /**
   * Предупреждения, не являющиеся точками входа (ЯС гл. 7–8):
   * дожи на вершине/в основании, «высокая волна», «отбитое наступление», «торможение»,
   * тест уровня. Используются дашбордом для фиксации риска по открытым позициям
   * (закрыть часть, поднять стоп, продать покрытый колл — гл. 7/19).
   */
  findCautionSignals(candles: Candle[], _tf: string = 'D'): CautionSignal[] {
    if (candles.length < 6) return [];
    const last = candles[candles.length - 1];
    const forming = (last as unknown as { isForming?: boolean }).isForming === true;
    const closedCount = forming ? candles.length - 1 : candles.length;
    const startIdx = Math.max(1, closedCount - 1);
    const out: CautionSignal[] = [];
    const seen = new Set<string>();

    for (let i = startIdx; i >= Math.max(0, candles.length - SCAN_BARS); i--) {
      const closed = candles.slice(0, i + 1);
      const trend = getTrendMacro(closed, candles[i].close);
      for (const cand of this.collectCandidates(candles, i)) {
        const canon = this.canon(cand.check.name);
        if (canon.kind !== 'neutral') continue;
        const key = `${cand.check.name}|${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const base = basePatternName(cand.check.name);
        let note = 'Неопределённость: сигнал требует подтверждения следующей закрытой свечой';
        if (base === 'НАДГРОБИЕ' || base === 'ДЛИННОНОГАЯ ДОДЖИ' || base === 'ДОДЖИ') {
          note =
            trend === 'ВОСХОДЯЩИЙ'
              ? 'Доджи после роста: прежняя тенденция, вероятно, завершается (гл. 8). Вход — только после подтверждения.'
              : 'Доджи в основании требует более сильного подтверждения, чем на вершине (гл. 8).';
        } else if (base === 'ВЫСОКАЯ ВОЛНА') {
          note = 'Рынок «потерял ощущение направления» (гл. 2, 8): тренд под угрозой.';
        } else if (base === 'ОТБИТОЕ НАСТУПЛЕНИЕ' || base === 'ТОРМОЖЕНИЕ') {
          note = 'Ослабление подъёма (гл. 7): фиксировать прибыль/защищать длинные позиции, короткие НЕ открывать.';
        } else if (base.startsWith('ТЕСТ')) {
          note = 'Проверка уровня поддержки/сопротивления (гл. 11, 13) — контекст, а не точка входа.';
        }
        out.push({ index: i, pattern: cand.check.name, note, severity: canon.weight });
      }
    }
    return out.sort((a, b) => b.index - a.index || b.severity - a.severity).slice(0, MAX_SIGNALS);
  }

  /** Обратная совместимость. */
  findSignal(candles: Candle[], tf: string = 'D'): Signal | null {
    const signals = this.findSignals(candles, tf);
    return signals.length > 0 ? signals[0] : null;
  }
}

export const signalGenerator = new SignalGenerator();
