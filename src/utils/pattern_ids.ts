// pattern_ids.ts — стабильные идентификаторы свечных моделей (П.7).
// Маппинг «каноническое имя модели → ID» используется вместо хрупких проверок
// подстроками (includes) в signal_generator.ts и patterns.ts.
// ВАЖНО: ID неизменяемы — на них завязаны сохранённые журналы сигналов.

export type PatternId =
  // гл. 3: односвечные теневые модели
  | 'HAMMER' | 'IMPERFECT_HAMMER' | 'INVERTED_HAMMER' | 'HANGING_MAN' | 'SHOOTING_STAR'
  // гл. 4: двухсвечные развороты
  | 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING'
  | 'DARK_CLOUD_COVER' | 'PIERCING_PATTERN'
  | 'BULLISH_BELT_HOLD' | 'BEARISH_BELT_HOLD'
  | 'TWEEZER_BOTTOM' | 'TWEEZER_TOP'
  | 'IN_NECK' | 'ON_NECK' | 'THRUSTING' | 'DOUBLE_THRUSTING_BULL'
  // гл. 5: звёзды
  | 'MORNING_STAR' | 'MORNING_DOJI_STAR' | 'EVENING_STAR' | 'EVENING_DOJI_STAR'
  | 'ABANDONED_BABY_BOTTOM' | 'ABANDONED_BABY_TOP'
  // гл. 6: трёхсвечные и более развороты
  | 'THREE_WHITE_SOLDIERS' | 'THREE_BLACK_CROWS' | 'THREE_IDENTICAL_CROWS'
  | 'TWO_CROWS' | 'THREE_MOUNTAINS' | 'THREE_RIVERS'
  | 'TOWER_TOP' | 'TOWER_BOTTOM' | 'LADDER_BOTTOM'
  | 'LAST_ENGULFING_BOTTOM' | 'LAST_ENGULFING_TOP'
  | 'KEY_REVERSAL_BULL' | 'KEY_REVERSAL_BEAR'
  | 'BULL_HARAMI' | 'BEAR_HARAMI' | 'BULL_HARAMI_CROSS' | 'BEAR_HARAMI_CROSS'
  | 'COUNTERATTACK_BULL' | 'COUNTERATTACK_BEAR'
  | 'SEPARATING_LINE_BULL' | 'SEPARATING_LINE_BEAR'
  // гл. 7: модели продолжения
  | 'RISE_THREE_METHODS' | 'FALL_THREE_METHODS' | 'TATAMI'
  | 'SIDE_BY_SIDE_WHITE' | 'SIDE_BY_SIDE_BLACK'
  | 'TASUKI_UP_GAP' | 'TASUKI_DOWN_GAP'
  | 'GAPPING_PLAY_HIGH' | 'GAPPING_PLAY_LOW'
  | 'CONSOLIDATION_BREAKOUT_BULL' | 'CONSOLIDATION_BREAKOUT_BEAR'
  | 'TREND_PULLBACK_WHITE' | 'TREND_PULLBACK_BLACK'
  // гл. 7: ослабленные формы (нейтральные предупреждения)
  | 'ADVANCE_BLOCK' | 'STALLED'
  // гл. 8: дожи и высокая волна (нейтральные предупреждения)
  | 'DOJI' | 'DRAGONFLY_DOJI' | 'GRAVESTONE_DOJI' | 'LONG_LEGGED_DOJI' | 'RICKSHAW_MAN'
  | 'HIGH_WAVE'
  // гл. 11: спружинивания
  | 'SPRING' | 'UPTHRUST'
  // гл. 15: объёмные модели
  | 'VOL_SPIN_ACCUMULATION' | 'VOL_SPIN_DISTRIBUTION'
  // Контекстные детекторы (не точки входа)
  | 'LEVEL_TEST_BULL' | 'LEVEL_TEST_BEAR';

/**
 * Канонические имена моделей, которые генерирует PatternDetector
 * (базовая часть name без контекстных суффиксов "(У ПОДДЕРЖКИ)", "(ОБЪЁМ)" и т.п.).
 */
export const CANONICAL_PATTERN_NAMES: ReadonlyArray<[string, PatternId]> = [
  // гл. 3: односвечные теневые модели
  ['МОЛОТ (НЕСОВЕРШЕННЫЙ)', 'IMPERFECT_HAMMER'],
  ['МОЛОТ', 'HAMMER'],
  ['ПЕРЕВЁРНУТЫЙ МОЛОТ', 'INVERTED_HAMMER'],
  ['ПОВЕШЕННЫЙ', 'HANGING_MAN'],
  ['ПАДАЮЩАЯ ЗВЕЗДА', 'SHOOTING_STAR'],
  
  // гл. 4: двухсвечные развороты
  ['БЫЧЬЕ ПОГЛОЩЕНИЕ', 'BULLISH_ENGULFING'],
  ['МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ', 'BEARISH_ENGULFING'],
  ['ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ', 'DARK_CLOUD_COVER'],
  ['ПРОСВЕТ В ОБЛАКАХ', 'PIERCING_PATTERN'],
  ['ЛИНИЯ ПОЯСА (БЫЧЬЯ)', 'BULLISH_BELT_HOLD'],
  ['ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)', 'BEARISH_BELT_HOLD'],
  ['ПИНЦЕТ-ОСНОВАНИЕ', 'TWEEZER_BOTTOM'],
  ['ПИНЦЕТ-ВЕРШИНА', 'TWEEZER_TOP'],
  ['НИЖЕ ШЕИ', 'IN_NECK'],
  ['НА ШЕЕ', 'ON_NECK'],
  ['ТОЛЧОК', 'THRUSTING'],
  ['ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)', 'DOUBLE_THRUSTING_BULL'],
  
  // гл. 5: звёзды
  ['УТРЕННЯЯ ЗВЕЗДА', 'MORNING_STAR'],
  ['УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА', 'MORNING_DOJI_STAR'],
  ['ВЕЧЕРНЯЯ ЗВЕЗДА', 'EVENING_STAR'],
  ['ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА', 'EVENING_DOJI_STAR'],
  ['ПОКИНУТЫЙ МЛАДЕНЕЦ (НИЗ)', 'ABANDONED_BABY_BOTTOM'],
  ['ПОКИНУТЫЙ МЛАДЕНЕЦ (ВЕРХ)', 'ABANDONED_BABY_TOP'],
  
  // гл. 6: трёхсвечные и более развороты
  ['ТРИ БЕЛЫХ СОЛДАТА', 'THREE_WHITE_SOLDIERS'],
  ['ТРИ ЧЁРНЫХ ВОРОНЫ', 'THREE_BLACK_CROWS'],
  ['ТРИ ОДИНАКОВЫЕ ВОРОНЫ', 'THREE_IDENTICAL_CROWS'],
  ['ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ', 'TWO_CROWS'],
  ['ТРИ ГОРЫ (ВЕРШИНА)', 'THREE_MOUNTAINS'],
  ['ТРИ РЕКИ (ОСНОВАНИЕ)', 'THREE_RIVERS'],
  ['БАШЕННАЯ ВЕРШИНА', 'TOWER_TOP'],
  ['БАШЕННОЕ ДНО', 'TOWER_BOTTOM'],
  ['ЛЕСТНИЧНОЕ ДНО', 'LADDER_BOTTOM'],
  ['ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)', 'LAST_ENGULFING_BOTTOM'],
  ['ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)', 'LAST_ENGULFING_TOP'],
  ['КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)', 'KEY_REVERSAL_BULL'],
  ['КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)', 'KEY_REVERSAL_BEAR'],
  ['БЫЧИЙ ХАРАМИ', 'BULL_HARAMI'],
  ['МЕДВЕЖИЙ ХАРАМИ', 'BEAR_HARAMI'],
  ['БЫЧИЙ ХАРАМИ-КРЕСТ', 'BULL_HARAMI_CROSS'],
  ['МЕДВЕЖИЙ ХАРАМИ-КРЕСТ', 'BEAR_HARAMI_CROSS'],
  ['КОНТРАТАКА (БЫЧЬЯ)', 'COUNTERATTACK_BULL'],
  ['КОНТРАТАКА (МЕДВЕЖЬЯ)', 'COUNTERATTACK_BEAR'],
  ['РАЗДЕЛЕНИЕ (БЫЧЬЕ)', 'SEPARATING_LINE_BULL'],
  ['РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)', 'SEPARATING_LINE_BEAR'],
  
  // гл. 7: модели продолжения
  ['ВОСХОДЯЩИЕ ТРИ МЕТОДА', 'RISE_THREE_METHODS'],
  ['НИСХОДЯЩИЕ ТРИ МЕТОДА', 'FALL_THREE_METHODS'],
  ['УДЕРЖАНИЕ НА ТАТАМИ', 'TATAMI'],
  ['ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ', 'SIDE_BY_SIDE_WHITE'],
  ['ТАСУКИ ВОСХОДЯЩЕГО ГЭПА', 'TASUKI_UP_GAP'],
  ['ТАСУКИ НИСХОДЯЩЕГО ГЭПА', 'TASUKI_DOWN_GAP'],
  ['ГЭП НА МАКСИМУМАХ', 'GAPPING_PLAY_HIGH'],
  ['ГЭП НА МИНИМУМАХ', 'GAPPING_PLAY_LOW'],
  ['ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)', 'CONSOLIDATION_BREAKOUT_BULL'],
  ['ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)', 'CONSOLIDATION_BREAKOUT_BEAR'],
  ['ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ', 'TREND_PULLBACK_WHITE'],
  ['ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ', 'TREND_PULLBACK_BLACK'],
  
  // гл. 7: ослабленные формы (нейтральные предупреждения)
  ['ОТБИТОЕ НАСТУПЛЕНИЕ', 'ADVANCE_BLOCK'],
  ['ТОРМОЖЕНИЕ', 'STALLED'],
  
  // гл. 8: дожи и высокая волна (нейтральные предупреждения)
  ['ДОДЖИ', 'DOJI'],
  ['ДОДЖИ-СТРЕКОЗА', 'DRAGONFLY_DOJI'],
  ['НАДГРОБИЕ', 'GRAVESTONE_DOJI'],
  ['ДЛИННОНОГАЯ ДОДЖИ', 'LONG_LEGGED_DOJI'],
  ['ДЛИННОНОГАЯ ДОДЖИ (РИКША)', 'RICKSHAW_MAN'],
  ['ВЫСОКАЯ ВОЛНА', 'HIGH_WAVE'],
  
  // гл. 11: спружинивания
  ['СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)', 'SPRING'],
  ['ВЕРХНЕЕ СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ВЕРШИНЫ)', 'UPTHRUST'],
  
  // гл. 15: объёмные модели
  ['НАКОПЛЕНИЕ', 'VOL_SPIN_ACCUMULATION'],
  ['РАСПРЕДЕЛЕНИЕ', 'VOL_SPIN_DISTRIBUTION'],
  
  // Контекстные детекторы (не точки входа)
  ['ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)', 'LEVEL_TEST_BULL'],
  ['ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)', 'LEVEL_TEST_BEAR'],
];

const NAME_TO_ID = new Map<string, PatternId>(CANONICAL_PATTERN_NAMES);

/**
 * Стабильный ID по имени модели из детектора. Сначала точное совпадение
 * (быстрый путь через Map), затем самый длинный префикс — имена детектора
 * могут содержать контекстные суффиксы ("МОЛОТ (У ПОДДЕРЖКИ) (ОБЪЁМ)").
 * Самый длинный префикс гарантирует, что "МОЛОТ (НЕСОВЕРШЕННЫЙ)" не спутается
 * с "МОЛОТ". Возвращает null для неизвестного имени (пользовательская заметка).
 */
export function getPatternId(patternName: string): PatternId | null {
  const p = patternName.toUpperCase();
  const exact = NAME_TO_ID.get(p);
  if (exact) return exact;
  let best: { name: string; id: PatternId } | null = null;
  for (const [name, id] of CANONICAL_PATTERN_NAMES) {
    if (p.startsWith(name) && (!best || name.length > best.name.length)) {
      best = { name, id };
    }
  }
  return best ? best.id : null;
}

/** Быстрая проверка принадлежности модели набору ID (вместо includes по подстрокам). */
export function matchesPatternId(patternName: string, ids: readonly PatternId[]): boolean {
  const id = getPatternId(patternName);
  return id !== null && ids.includes(id);
}

/**
 * Каноническая классификация моделей Нисона: РАЗВОРОТНЫЕ vs ПРОДОЛЖЕНИЕ.
 * Единый источник истины — раньше signal_generator и signal_quality имели
 * РАЗНЫЕ списки разворотов, из-за чего одна и та же формация фильтровалась
 * генератором как «разворот против тренда», а качество мерилось по ней как
 * по «продолжению по тренду» → взаимоисключающие сценарии в одном отчёте.
 */
export const REVERSAL_PATTERN_IDS: readonly PatternId[] = [
  // гл. 3: односвечные теневые развороты
  'HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER', 'HANGING_MAN', 'SHOOTING_STAR',
  
  // гл. 4: двухсвечные развороты
  'BULLISH_ENGULFING', 'BEARISH_ENGULFING',
  'DARK_CLOUD_COVER', 'PIERCING_PATTERN',
  'BULLISH_BELT_HOLD', 'BEARISH_BELT_HOLD',
  'TWEEZER_BOTTOM', 'TWEEZER_TOP',
  'DOUBLE_THRUSTING_BULL',
  
  // гл. 5: звёзды
  'MORNING_STAR', 'MORNING_DOJI_STAR', 'EVENING_STAR', 'EVENING_DOJI_STAR',
  'ABANDONED_BABY_BOTTOM', 'ABANDONED_BABY_TOP',
  
  // гл. 6: трёхсвечные и более развороты
  'THREE_WHITE_SOLDIERS', 'THREE_BLACK_CROWS', 'THREE_IDENTICAL_CROWS',
  'TWO_CROWS', 'THREE_MOUNTAINS', 'THREE_RIVERS',
  'TOWER_TOP', 'TOWER_BOTTOM', 'LADDER_BOTTOM',
  'LAST_ENGULFING_BOTTOM', 'LAST_ENGULFING_TOP',
  'KEY_REVERSAL_BULL', 'KEY_REVERSAL_BEAR',
  'BULL_HARAMI', 'BEAR_HARAMI', 'BULL_HARAMI_CROSS', 'BEAR_HARAMI_CROSS',
  'COUNTERATTACK_BULL', 'COUNTERATTACK_BEAR',
  
  // гл. 11: спружинивания
  'SPRING', 'UPTHRUST',
];

/** Разворотная ли модель (по канону Нисона)? Неизвестные имена — не разворот. */
export function isReversalPatternName(patternName: string): boolean {
  return matchesPatternId(patternName, REVERSAL_PATTERN_IDS);
}

/**
 * Модели ПРОДОЛЖЕНИЯ тренда (ЯС гл. 7).
 */
export const CONTINUATION_PATTERN_IDS: readonly PatternId[] = [
  // гл. 7: трёхсвечные продолжения
  'RISE_THREE_METHODS', 'FALL_THREE_METHODS', 'TATAMI',
  'SIDE_BY_SIDE_WHITE', 'SIDE_BY_SIDE_BLACK',
  'TASUKI_UP_GAP', 'TASUKI_DOWN_GAP',
  'GAPPING_PLAY_HIGH', 'GAPPING_PLAY_LOW',
  
  // гл. 7: двухсвечные продолжения
  'SEPARATING_LINE_BULL', 'SEPARATING_LINE_BEAR',
  'CONSOLIDATION_BREAKOUT_BULL', 'CONSOLIDATION_BREAKOUT_BEAR',
  
  // гл. 4: продолжение спада
  'IN_NECK', 'ON_NECK', 'THRUSTING',
  
  // гл. 7: продолжение тренда
  'TREND_PULLBACK_WHITE', 'TREND_PULLBACK_BLACK',
];

/** Модель продолжения тренда? */
export function isContinuationPatternName(patternName: string): boolean {
  return matchesPatternId(patternName, CONTINUATION_PATTERN_IDS);
}

/**
 * Нейтральные модели — предупреждения, а не точки входа (ЯС гл. 7–8).
 * Нисон: «Многие… считают доджи прямым сигналом покупать или продавать. Это неправильно».
 */
export const NEUTRAL_PATTERN_IDS: readonly PatternId[] = [
  // гл. 8: дожи и высокая волна
  'DOJI', 'DRAGONFLY_DOJI', 'GRAVESTONE_DOJI', 'LONG_LEGGED_DOJI', 'RICKSHAW_MAN',
  'HIGH_WAVE',
  
  // гл. 7: ослабленные формы (предупреждения об истощении тренда)
  'ADVANCE_BLOCK', 'STALLED',
  
  // гл. 11: контекстные детекторы
  'LEVEL_TEST_BULL', 'LEVEL_TEST_BEAR',
];

/** Нейтральная модель (предупреждение, не точка входа)? */
export function isNeutralPatternName(patternName: string): boolean {
  return matchesPatternId(patternName, NEUTRAL_PATTERN_IDS);
}

/**
 * Формации, которые НЕЛЬЗЯ торговать без подтверждения следующей закрытой свечой
 * (Нисон называет их «signal to a signal» — сам по себе вход запрещён).
 * Это НЕ «самодостаточные» модели — ровно наоборот: раньше в коде существовал
 * инвертированный список SELF_CONFIRMING («не требуют подтверждения»), который
 * противоречил книге и был удалён. Строгий учёт по главам:
 *  • гл. 3 — все односвечные модели (молот, повешенный, падающая звезда,
 *    перевёрнутый молот, доджи, поясные головы) — только «сигнал к сигналу»;
 *  • гл. 4–6 — двух-/трёхсвечные развороты с неполным выполнением определения
 *    (харами и харами-кроссы, татами/разделяющая линия, тычущие линии,
 *    контратака, твизеры) — подтверждение ОБЯЗАТЕЛЬНО;
 *  • гл. 5–6 — завершённые звёзды (утренняя/вечерняя), поглощения, тёмное облако,
 *    три белых солдата / три чёрных ворона, покинутое дитя — сильнейшие формации:
 *    Нисон допускает вход сразу по закрытии модели (подтверждение входит в её
 *    определение), отдельная следующая свеча не требуется.
 */
export const CONFIRMATION_REQUIRED_IDS: readonly PatternId[] = [
  // гл. 3: односвечные модели всегда требуют подтверждения следующей свечой
  'HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER', 'HANGING_MAN', 'SHOOTING_STAR',
  'DOJI', 'DRAGONFLY_DOJI', 'GRAVESTONE_DOJI', 'LONG_LEGGED_DOJI', 'RICKSHAW_MAN',
  'HIGH_WAVE',
  'BULLISH_BELT_HOLD', 'BEARISH_BELT_HOLD',
  
  // гл. 4–6: развороты с неполным определением — вход только после подтверждения
  'BULL_HARAMI', 'BEAR_HARAMI', 'BULL_HARAMI_CROSS', 'BEAR_HARAMI_CROSS',
  'TATAMI', 'SEPARATING_LINE_BULL', 'SEPARATING_LINE_BEAR',
  'THRUSTING', 'IN_NECK', 'ON_NECK', 'DOUBLE_THRUSTING_BULL',
  'COUNTERATTACK_BULL', 'COUNTERATTACK_BEAR',
  'TWEEZER_BOTTOM', 'TWEEZER_TOP',
  
  // гл. 7 (advance/retreat block): ослабленные формы — предупреждения
  'ADVANCE_BLOCK', 'STALLED',
  
  // гл. 11: спружинивания — Нисон рекомендует ждать подтверждения
  'SPRING', 'UPTHRUST',
  
  // гл. 15: объёмные модели — контекстные, требуют подтверждения
  'VOL_SPIN_ACCUMULATION', 'VOL_SPIN_DISTRIBUTION',
  
  // контекстные детекторы — не точки входа
  'LEVEL_TEST_BULL', 'LEVEL_TEST_BEAR',
];

/** Требуется ли модели подтверждение следующей ЗАКРЫТОЙ свечой для входа? */
export function requiresNextCandleConfirmation(patternName: string): boolean {
  return matchesPatternId(patternName, CONFIRMATION_REQUIRED_IDS);
}

/**
 * Завершённые формации, которые НЕ требуют дополнительного подтверждения
 * (подтверждение входит в определение модели).
 */
export const SELF_CONFIRMING_IDS: readonly PatternId[] = [
  // гл. 4: завершённые двухсвечные развороты
  'BULLISH_ENGULFING', 'BEARISH_ENGULFING',
  'DARK_CLOUD_COVER', 'PIERCING_PATTERN',
  
  // гл. 5: завершённые звёзды (третья свеча = подтверждение)
  'MORNING_STAR', 'MORNING_DOJI_STAR', 'EVENING_STAR', 'EVENING_DOJI_STAR',
  'ABANDONED_BABY_BOTTOM', 'ABANDONED_BABY_TOP',
  
  // гл. 6: завершённые трёхсвечные развороты
  'THREE_WHITE_SOLDIERS', 'THREE_BLACK_CROWS', 'THREE_IDENTICAL_CROWS',
  'TWO_CROWS', 'THREE_MOUNTAINS', 'THREE_RIVERS',
  'TOWER_TOP', 'TOWER_BOTTOM', 'LADDER_BOTTOM',
  'LAST_ENGULFING_BOTTOM', 'LAST_ENGULFING_TOP',
  'KEY_REVERSAL_BULL', 'KEY_REVERSAL_BEAR',
  
  // гл. 7: завершённые модели продолжения
  'RISE_THREE_METHODS', 'FALL_THREE_METHODS',
  'SIDE_BY_SIDE_WHITE', 'SIDE_BY_SIDE_BLACK',
  'TASUKI_UP_GAP', 'TASUKI_DOWN_GAP',
  'GAPPING_PLAY_HIGH', 'GAPPING_PLAY_LOW',
  'CONSOLIDATION_BREAKOUT_BULL', 'CONSOLIDATION_BREAKOUT_BEAR',
];

/** Завершённая формация (не требует дополнительного подтверждения)? */
export function isSelfConfirmingPattern(patternName: string): boolean {
  return matchesPatternId(patternName, SELF_CONFIRMING_IDS);
}
