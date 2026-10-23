// Аудит №12: ранжирование сигналов по канону Нисона.
//
// Стив Нисон («Japanese Candlestick Charting Techniques», гл. 3 и 8) repeatedly
// подчёркивает: НЕ ВСЕ паттерны равны. Сила сигнала зависит от контекста:
//   1) наличие предшествующего выраженного тренда (без тренда развороту не из чего разворачиваться);
//   2) объём на подтверждающей свече (всплеск = участие крупных игроков);
//   3) размер тела подтверждающей свечи (маленькое тело = нерешительность);
//   4) качество тени модели (молот/звезда: тень ≥ 2×тела — сильный сигнал, ~1.5× — умеренный);
//   5) жизненный цикл (подтверждённый сильнее ожидающего; отменённый — не сигнал).
//
// До этого пункта quality был константой 1.0 для всех сигналов — UI показывал
// «уверенность 100%» и у сильного молота с объёмом, и у вялой звезды без объёма.
// Теперь это честная, детерминированная оценка в [0, 1].

import { Candle } from './candle';
import { VolumeAnalyzer } from './pattern_engine';
import { getTrendContext, getTrendMacro } from './trend_detection';
import { matchesPatternId, PatternId, isReversalPatternName } from './pattern_ids';
import type { SignalStatus } from './signal_lifecycle';
import { candleDelta } from './volume_profile';

export interface QualityInput {
  direction: 'long' | 'short';
  pattern: string;
  /** Подтверждающая (последняя) свеча формации */
  confirmCandle: Candle;
  /** Свечи ТОЛЬКО до подтверждающей (без look-ahead) */
  priorCandles: Candle[];
  status?: SignalStatus;
}

/** Множество односвечных моделей, где качество тени — книжный критерий силы */
const SHADOW_MODELS: readonly PatternId[] = [
  'HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER', 'HANGING_MAN', 'SHOOTING_STAR',
];

/**
 * Разворотные модели требуют выраженного предшествующего тренда (Нисон, гл. 3).
 * FIX противоречий сигналов: список больше НЕ дублируется локально — единый
 * канонический источник pattern_ids.REVERSAL_PATTERN_IDS используется и здесь,
 * и в контекстной фильтрации signal_generator. Раньше списки различались
 * (харами/толчки/башни/три горы), из-за чего одна формация получала взаимо-
 * исключающие трактовки трендового контекста в двух слоях анализа.
 */
export function isReversalModel(pattern: string): boolean {
  return isReversalPatternName(pattern);
}

/**
 * Оценка качества сигнала по канону Нисона.
 * Возвращает множитель в диапазоне [0.2, 1.0] — детерминированный,
 * только по данным, доступным в момент формирования сигнала.
 */
export function computeSignalQuality(input: QualityInput): number {
  const { direction, pattern, confirmCandle, priorCandles } = input;

  // 1) Контекст тренда. Для разворота нужен выраженный предшествующий тренд ПРОТИВ
  // направления сигнала; для продолжения — тренд ПО направлению.
  let trendScore = 0.7; // нейтральный контекст
  if (priorCandles.length >= 6) {
    const lastClose = priorCandles[priorCandles.length - 1].close;
    const trend =
      priorCandles.length >= 20 ? getTrendContext(priorCandles) : getTrendMacro(priorCandles, lastClose);
    const reversal = isReversalModel(pattern);
    const aligned =
      direction === 'long'
        ? reversal ? trend === 'НИСХОДЯЩИЙ' : trend === 'ВОСХОДЯЩИЙ'
        : reversal ? trend === 'ВОСХОДЯЩИЙ' : trend === 'НИСХОДЯЩИЙ';
    const opposed =
      direction === 'long'
        ? reversal ? trend === 'ВОСХОДЯЩИЙ' : trend === 'НИСХОДЯЩИЙ'
        : reversal ? trend === 'НИСХОДЯЩИЙ' : trend === 'ВОСХОДЯЩИЙ';
    trendScore = aligned ? 1.0 : opposed ? 0.5 : 0.7;
  }

  // 2) Объём подтверждающей свечи относительно базовой линии предыдущих свечей.
  //    Книжный порог «значимого всплеска» — ×1.3 (совпадает с VolumeAnalyzer).
  let avgVol = VolumeAnalyzer.getAverageVolume(priorCandles, 20);
  if (avgVol <= 0 && priorCandles.length > 0) {
    // короткая история: среднее по всем доступным предшествующим свечам
    avgVol = priorCandles.reduce((s, cc) => s + cc.volume, 0) / priorCandles.length;
  }
  const volRatio = avgVol > 0 ? confirmCandle.volume / avgVol : 1;
  let volumeScore = volRatio >= 1.5 ? 1.0 : volRatio >= 1.3 ? 0.9 : volRatio >= 1.0 ? 0.75 : 0.55;

  // 2b) Многомерный объём подтверждения паттерна (запрос пользователя):
  //     proxy-дельта и дисбаланс агрессии подтверждающей свечи. Всплеск объёма
  //     без направления — нерешительность; объём + агрессивное закрытие «в нашу
  //     сторону» — книжный признак участия крупных игроков (Нисон, гл. 3/8).
  const { delta, imbalance } = candleDelta(confirmCandle);
  if (volRatio >= 1.3) {
    const agrees = direction === 'long' ? delta > 0 : delta < 0;
    if (agrees && imbalance !== null) volumeScore = Math.min(1, volumeScore + 0.1);
    else if (!agrees) volumeScore = Math.max(0.45, volumeScore - 0.15);
  }

  // 3) Тело подтверждающей свечи: сильное тело = решимость, маленькое = нерешительность.
  //    Для односвечных ТЕНЕВЫХ моделей (молот/звезда/повешенный) маленькое тело —
  //    КНИЖНОЕ требование канона (Нисон: «small real body»), поэтому телесный штраф
  //    к ним не применяется (иначе идеальная свеча наказывалась бы за свою природу).
  const isShadowModel = matchesPatternId(pattern, SHADOW_MODELS);
  const range = Math.max(confirmCandle.high - confirmCandle.low, 1e-9);
  const bodyRatio = confirmCandle.body / range;
  const bodyScore = isShadowModel
    ? 1.0
    : bodyRatio >= 0.6 ? 1.0 : bodyRatio >= 0.4 ? 0.85 : bodyRatio >= 0.2 ? 0.7 : 0.55;

  // 4) Качество тени для теневых моделей (молот/звезда/повешенный):
  //    тень ≥ 2×тела — сильный сигнал, ≥1.5× — умеренный (гл. 3).
  let shadowScore = 1.0;
  if (isShadowModel) {
    const kind =
      matchesPatternId(pattern, ['HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER']) && direction === 'long'
        ? ('lower' as const)
        : direction === 'short'
          ? ('upper' as const)
          : ('none' as const);
    const wick = kind === 'lower' ? confirmCandle.lowerWick : kind === 'upper' ? confirmCandle.upperWick : 0;
    const ratio = confirmCandle.body > 0 ? wick / confirmCandle.body : wick > 0 ? 9 : 0;
    shadowScore = ratio >= 2.0 ? 1.0 : ratio >= 1.5 ? 0.85 : 0.7;
  }

  // 5) Жизненный цикл: подтверждение — сильнейшее состояние (гл. 3: «wait for confirmation»).
  const lifecycleScore =
    input.status === 'confirmed' ? 1.0 : input.status === 'pending' ? 0.85 : input.status === 'expired' ? 0.6 : 0.5;

  const q = trendScore * volumeScore * bodyScore * shadowScore * lifecycleScore;
  return Math.min(1, Math.max(0.2, Math.round(q * 100) / 100));
}
