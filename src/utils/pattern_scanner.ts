import type { Candle } from './candle';
import {
  PatternDetector,
  type PatternContext,
  type PatternDetection,
} from './pattern_engine';
import { getPatternId, type PatternId } from './pattern_ids';

export type CandidateDirection = 'long' | 'short' | 'neutral';

export interface PatternCandidate {
  name: string;
  direction: CandidateDirection;
  formationSize: number;
  patternStartIdx: number;
  patternEndIdx: number;
  patternLow: number;
  patternHigh: number;
  /** Контекстные наблюдения не превращаются в самостоятельную сделку. */
  tradeable: boolean;
}

export interface PatternScanOptions {
  context?: PatternContext;
  fromIndex?: number;
  toIndex?: number;
}

const CONTEXT_ONLY_IDS = new Set<PatternId>([
  'VOL_SPIN_ACCUMULATION', 'VOL_SPIN_DISTRIBUTION',
  'LEVEL_TEST_BULL', 'LEVEL_TEST_BEAR',
  'TREND_PULLBACK_WHITE', 'TREND_PULLBACK_BLACK',
  'CONSOLIDATION_BREAKOUT_BULL', 'CONSOLIDATION_BREAKOUT_BEAR',
  'ADVANCE_BLOCK', 'STALLED',
]);

/** Тип модели по стабильному ID, а не по случайным совпадениям подстрок. */
export function patternDirection(name: string): CandidateDirection {
  const id = getPatternId(name);
  if (!id) return 'neutral';
  if (CONTEXT_ONLY_IDS.has(id) || [
    'DOJI', 'DRAGONFLY_DOJI', 'GRAVESTONE_DOJI', 'LONG_LEGGED_DOJI',
    'RICKSHAW_MAN', 'HIGH_WAVE',
  ].includes(id)) return 'neutral';

  const bearish = new Set<PatternId>([
    'HANGING_MAN', 'SHOOTING_STAR', 'BEARISH_ENGULFING', 'DARK_CLOUD_COVER',
    'EVENING_STAR', 'EVENING_DOJI_STAR', 'ABANDONED_BABY_TOP',
    'THREE_BLACK_CROWS', 'THREE_IDENTICAL_CROWS', 'TWO_CROWS', 'THREE_MOUNTAINS',
    'TOWER_TOP', 'BEAR_HARAMI', 'BEAR_HARAMI_CROSS', 'TWEEZER_TOP',
    'BELT_HOLD_BEAR', 'COUNTERATTACK_BEAR', 'SEPARATING_LINE_BEAR',
    'LAST_ENGULFING_TOP', 'KEY_REVERSAL_BEAR', 'FALL_THREE_METHODS',
    'SIDE_BY_SIDE_GAP_DOWN', 'SIDE_BY_SIDE_GAP_BLACK_DOWN', 'TASUKI_DOWN_GAP', 'GAPPING_PLAY_LOW', 'THRUSTING', 'IN_NECK', 'ON_NECK',
    'UPTHRUST',
  ]);
  return bearish.has(id) ? 'short' : 'long';
}

/**
 * Единый чистый сканер формаций. Он только распознаёт модели и их фактические
 * границы: подтверждение, вход и риск рассчитываются отдельными слоями.
 * Все двухсвечные проверки получают историю ДО первой свечи формации.
 */
export function scanPatternCandidates(
  candles: Candle[],
  options: PatternScanOptions = {},
): PatternCandidate[] {
  const context = options.context;
  const first = Math.max(1, options.fromIndex ?? 1);
  const last = Math.min(candles.length - 1, options.toIndex ?? candles.length - 1);
  const found: PatternCandidate[] = [];

  for (let i = first; i <= last; i++) {
    const candle = candles[i];
    const prior = candles.slice(0, i);
    const closed = candles.slice(0, i + 1);
    const checks: PatternDetection[] = [
      PatternDetector.isHammer(candle, prior, context),
      PatternDetector.isImperfectHammer(candle, prior, context),
      PatternDetector.isInvertedHammer(candle, prior, context),
      PatternDetector.isHangingMan(candle, prior, context),
      PatternDetector.isShootingStar(candle, prior, context),
      PatternDetector.classifyDoji(candle),
      PatternDetector.isHighWave(candle, prior),
      PatternDetector.isSpring(closed),
      PatternDetector.isUpthrust(closed),
      PatternDetector.isVolSpin(candle, closed),
      PatternDetector.isLevelTest(closed, context),
      PatternDetector.isTrendPullbackCandle(closed),
      PatternDetector.isKeyReversal(closed),
      PatternDetector.isConsolidationBreakout(closed),
    ];

    if (i > 0) {
      const previous = candles[i - 1];
      // История строго до c1: c1 уже принадлежит двухсвечной формации.
      const history = candles.slice(0, i - 1);
      checks.push(
        PatternDetector.isBullishEngulfing(previous, candle, history, context),
        PatternDetector.isBearishEngulfing(previous, candle, history, context),
        PatternDetector.isHarami(previous, candle, history),
        PatternDetector.isHaramiCross(previous, candle, history),
        PatternDetector.isTweezerBottom(previous, candle, history, context),
        PatternDetector.isTweezerTop(previous, candle, history, context),
        PatternDetector.isDarkCloudCover(previous, candle, history, context),
        PatternDetector.isPiercingPattern(previous, candle, history, context),
        PatternDetector.isBullishBelt(previous, candle, history, context),
        PatternDetector.isBearishBelt(previous, candle, history, context),
        PatternDetector.isCounterattack(previous, candle, history, context),
        PatternDetector.isSeparatingLines(previous, candle, history),
        PatternDetector.isNeckFamily(previous, candle, history),
        PatternDetector.isLastEngulfing(previous, candle, history),
      );
    }

    if (i >= 2) {
      checks.push(
        PatternDetector.isMorningStar(closed),
        PatternDetector.isEveningStar(closed),
        PatternDetector.isThreeWhiteSoldiers(closed),
        PatternDetector.isThreeBlackCrows(closed),
        PatternDetector.isAdvanceBlock(closed),
        PatternDetector.isStalled(closed),
        PatternDetector.isTwoCrows(closed, context),
        PatternDetector.isAbandonedBaby(closed, context),
        PatternDetector.isTasuki(closed, context),
        PatternDetector.isDoubleThrustingBull(closed),
        PatternDetector.isGappingSideBySide(closed, context),
        // Легаси-ветка P0-3 (вариант B): прежнее имя «(ВНИЗ)» для белых свечей.
        PatternDetector.isGappingSideBySideLegacy(closed, context),
        PatternDetector.isTowerTop(closed),
        PatternDetector.isTowerBottom(closed),
        PatternDetector.isThreeMountains(closed),
        PatternDetector.isThreeRivers(closed),
      );
    }
    if (i >= 3) checks.push(PatternDetector.isMatHold(closed));
    if (i >= 4) {
      checks.push(
        PatternDetector.isRisingThree(closed),
        PatternDetector.isFallingThree(closed),
        PatternDetector.isLadderBottom(closed),
      );
    }
    if (i >= 5) checks.push(PatternDetector.isGappingPlay(closed, context));

    for (const check of checks) {
      if (!check.found) continue;
      const bounds = PatternDetector.getFormationBounds(
        check.name,
        candles,
        i,
        check.formationSize,
      );
      const direction = patternDirection(check.name);
      const id = getPatternId(check.name);
      found.push({
        name: check.name,
        direction,
        formationSize: bounds.patternCandlesCount,
        patternStartIdx: bounds.patternStartIdx,
        patternEndIdx: bounds.patternEndIdx,
        patternLow: bounds.patternLow,
        patternHigh: bounds.patternHigh,
        tradeable: direction !== 'neutral' && id !== null && !CONTEXT_ONLY_IDS.has(id),
      });
    }
  }

  const unique = new Map<string, PatternCandidate>();
  for (const candidate of found) {
    unique.set(`${candidate.name}|${candidate.patternEndIdx}`, candidate);
  }
  return [...unique.values()];
}
