// pattern_ids.ts — стабильные идентификаторы свечных моделей (П.7).
// Маппинг «каноническое имя модели → ID» используется вместо хрупких проверок
// подстроками (includes) в signal_generator.ts и patterns.ts.
// ВАЖНО: ID неизменяемы — на них завязаны сохранённые журналы сигналов.

export type PatternId =
  | 'HAMMER' | 'IMPERFECT_HAMMER' | 'INVERTED_HAMMER' | 'HANGING_MAN' | 'SHOOTING_STAR'
  | 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING'
  | 'MORNING_STAR' | 'EVENING_STAR'
  | 'THREE_WHITE_SOLDIERS' | 'THREE_BLACK_CROWS' | 'TWO_CROWS'
  | 'DOJI' | 'DRAGONFLY_DOJI' | 'GRAVESTONE_DOJI'
  | 'SPRING' | 'TOWER_TOP' | 'TOWER_BOTTOM' | 'THREE_MOUNTAINS' | 'THREE_RIVERS'
  | 'BULL_HARAMI' | 'BEAR_HARAMI' | 'BULL_HARAMI_CROSS' | 'BEAR_HARAMI_CROSS'
  | 'TWEEZER_BOTTOM' | 'TWEEZER_TOP'
  | 'DARK_CLOUD_COVER' | 'LIGHTING_AT_THE_WELL'
  | 'BELT_HOLD_BULL' | 'BELT_HOLD_BEAR'
  | 'COUNTERATTACK_BULL' | 'COUNTERATTACK_BEAR'
  | 'SEPARATING_LINE_BULL' | 'SEPARATING_LINE_BEAR'
  | 'ADVANCE_BLOCK' | 'RETREAT_BLOCK' | 'THRUSTING' | 'DOUBLE_THRUSTING_BULL'
  | 'SIDE_BY_SIDE_GAP' | 'RISE_THREE_METHODS' | 'FALL_THREE_METHODS'
  | 'TATAMI' | 'LADDER_BOTTOM' | 'ABANDONED_BABY_BOTTOM' | 'ABANDONED_BABY_TOP'
  | 'TASUKI_UP_GAP' | 'TASUKI_DOWN_GAP'
  | 'GAPPING_PLAY_HIGH' | 'GAPPING_PLAY_LOW'
  | 'CONSOLIDATION_BREAKOUT_BULL' | 'CONSOLIDATION_BREAKOUT_BEAR'
  | 'KEY_REVERSAL_BULL' | 'KEY_REVERSAL_BEAR'
  | 'LAST_EGULFING_BOTTOM' | 'LAST_EGULFING_TOP'
  | 'VOL_SPIN_ACCUMULATION' | 'VOL_SPIN_DISTRIBUTION'
  | 'LEVEL_TEST_BULL' | 'LEVEL_TEST_BEAR'
  | 'TREND_PULLBACK_WHITE' | 'TREND_PULLBACK_BLACK';

/**
 * Канонические имена моделей, которые генерирует PatternDetector
 * (базовая часть name без контекстных суффиксов "(У ПОДДЕРЖКИ)", "(ОБЪЁМ)" и т.п.).
 */
export const CANONICAL_PATTERN_NAMES: ReadonlyArray<[string, PatternId]> = [
  ['МОЛОТ (НЕСОВЕРШЕННЫЙ)', 'IMPERFECT_HAMMER'],
  ['ПЕРЕВЁРНУТЫЙ МОЛОТ', 'INVERTED_HAMMER'],
  ['МОЛОТ', 'HAMMER'],
  ['ПОВЕШЕННЫЙ', 'HANGING_MAN'],
  ['ПАДАЮЩАЯ ЗВЕЗДА', 'SHOOTING_STAR'],
  ['БЫЧЬЕ ПОГЛОЩЕНИЕ', 'BULLISH_ENGULFING'],
  ['МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ', 'BEARISH_ENGULFING'],
  ['УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА', 'MORNING_STAR'],
  ['ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА', 'EVENING_STAR'],
  ['УТРЕННЯЯ ЗВЕЗДА', 'MORNING_STAR'],
  ['ВЕЧЕРНЯЯ ЗВЕЗДА', 'EVENING_STAR'],
  ['ТРИ БЕЛЫХ СОЛДАТА', 'THREE_WHITE_SOLDIERS'],
  ['ТРИ ЧЁРНЫХ ВОРОНЫ', 'THREE_BLACK_CROWS'],
  ['ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ', 'TWO_CROWS'],
  ['ДОДЖИ-СТРЕКОЗА', 'DRAGONFLY_DOJI'],
  ['НАДГРОБИЕ', 'GRAVESTONE_DOJI'],
  ['ДОДЖИ', 'DOJI'],
  ['СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)', 'SPRING'],
  ['БАШЕННАЯ ВЕРШИНА', 'TOWER_TOP'],
  ['БАШЕННОЕ ДНО', 'TOWER_BOTTOM'],
  ['ТРИ ГОРЫ (ВЕРШИНА)', 'THREE_MOUNTAINS'],
  ['ТРИ РЕКИ (ОСНОВАНИЕ)', 'THREE_RIVERS'],
  ['БЫЧИЙ ХАРАМИ-КРЕСТ', 'BULL_HARAMI_CROSS'],
  ['МЕДВЕЖИЙ ХАРАМИ-КРЕСТ', 'BEAR_HARAMI_CROSS'],
  ['БЫЧИЙ ХАРАМИ', 'BULL_HARAMI'],
  ['МЕДВЕЖИЙ ХАРАМИ', 'BEAR_HARAMI'],
  ['ПИНЦЕТ (НИЗ)', 'TWEEZER_BOTTOM'],
  ['ПИНЦЕТ (ВЕРХ)', 'TWEEZER_TOP'],
  ['ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ', 'DARK_CLOUD_COVER'],
  ['ПРОСВЕТ В ОБЛАКАХ', 'LIGHTING_AT_THE_WELL'],
  ['ЛИНИЯ ПОЯСА (БЫЧЬЯ)', 'BELT_HOLD_BULL'],
  ['ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)', 'BELT_HOLD_BEAR'],
  ['КОНТРАТАКА (БЫЧЬЯ)', 'COUNTERATTACK_BULL'],
  ['КОНТРАТАКА (МЕДВЕЖЬЯ)', 'COUNTERATTACK_BEAR'],
  ['РАЗДЕЛЕНИЕ (БЫЧЬЕ)', 'SEPARATING_LINE_BULL'],
  ['РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)', 'SEPARATING_LINE_BEAR'],
  ['НИЖЕ ШЕИ', 'ADVANCE_BLOCK'],
  ['НА ШЕЕ', 'RETREAT_BLOCK'],
  ['ТОЛЧОК', 'THRUSTING'],
  ['ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)', 'DOUBLE_THRUSTING_BULL'],
  ['ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ', 'SIDE_BY_SIDE_GAP'],
  ['ВОСХОДЯЩИЕ ТРИ МЕТОДА', 'RISE_THREE_METHODS'],
  ['НИСХОДЯЩИЕ ТРИ МЕТОДА', 'FALL_THREE_METHODS'],
  ['УДЕРЖАНИЕ НА ТАТАМИ', 'TATAMI'],
  ['ЛЕСТНИЧНОЕ ДНО', 'LADDER_BOTTOM'],
  ['ПОКИНУТЫЙ МЛАДЕНЕЦ (НИЗ)', 'ABANDONED_BABY_BOTTOM'],
  ['ПОКИНУТЫЙ МЛАДЕНЕЦ (ВЕРХ)', 'ABANDONED_BABY_TOP'],
  ['ТАСУКИ ВОСХОДЯЩЕГО ГЭПА', 'TASUKI_UP_GAP'],
  ['ТАСУКИ НИСХОДЯЩЕГО ГЭПА', 'TASUKI_DOWN_GAP'],
  ['ГЭП НА МАКСИМУМАХ', 'GAPPING_PLAY_HIGH'],
  ['ГЭП НА МИНИМУМАХ', 'GAPPING_PLAY_LOW'],
  ['ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)', 'CONSOLIDATION_BREAKOUT_BULL'],
  ['ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)', 'CONSOLIDATION_BREAKOUT_BEAR'],
  ['КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)', 'KEY_REVERSAL_BULL'],
  ['КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)', 'KEY_REVERSAL_BEAR'],
  ['ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)', 'LAST_EGULFING_BOTTOM'],
  ['ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)', 'LAST_EGULFING_TOP'],
  ['НАКОПЛЕНИЕ', 'VOL_SPIN_ACCUMULATION'],
  ['РАСПРЕДЕЛЕНИЕ', 'VOL_SPIN_DISTRIBUTION'],
  ['ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)', 'LEVEL_TEST_BULL'],
  ['ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)', 'LEVEL_TEST_BEAR'],
  ['ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ', 'TREND_PULLBACK_WHITE'],
  ['ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ', 'TREND_PULLBACK_BLACK'],
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
  // односвечные теневые развороты (гл. 3)
  'HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER', 'HANGING_MAN', 'SHOOTING_STAR',
  // двухсвечные развороты (гл. 4)
  'BULLISH_ENGULFING', 'BEARISH_ENGULFING', 'DARK_CLOUD_COVER', 'LIGHTING_AT_THE_WELL',
  'TWEEZER_BOTTOM', 'TWEEZER_TOP',
  // трёхсвечные развороты (гл. 5–6)
  'MORNING_STAR', 'EVENING_STAR', 'ABANDONED_BABY_BOTTOM', 'ABANDONED_BABY_TOP',
  'THREE_MOUNTAINS', 'THREE_RIVERS', 'TOWER_TOP', 'TOWER_BOTTOM',
  'LAST_EGULFING_BOTTOM', 'LAST_EGULFING_TOP',
  'THRUSTING', 'DOUBLE_THRUSTING_BULL',
  // харами — разворотная природа (Нисон относит к разворотам при слабом теле)
  'BULL_HARAMI', 'BEAR_HARAMI', 'BULL_HARAMI_CROSS', 'BEAR_HARAMI_CROSS',
];

/** Разворотная ли модель (по канону Нисона)? Неизвестные имена — не разворот. */
export function isReversalPatternName(patternName: string): boolean {
  return matchesPatternId(patternName, REVERSAL_PATTERN_IDS);
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
  'DOJI', 'DRAGONFLY_DOJI', 'GRAVESTONE_DOJI',
  'BELT_HOLD_BULL', 'BELT_HOLD_BEAR',
  // гл. 4–6: развороты с неполным определением — вход только после подтверждения
  'BULL_HARAMI', 'BEAR_HARAMI', 'BULL_HARAMI_CROSS', 'BEAR_HARAMI_CROSS',
  'TATAMI', 'SEPARATING_LINE_BULL', 'SEPARATING_LINE_BEAR',
  'THRUSTING', 'DOUBLE_THRUSTING_BULL',
  'COUNTERATTACK_BULL', 'COUNTERATTACK_BEAR',
  'TWEEZER_BOTTOM', 'TWEEZER_TOP',
  // гл. 7 (advance/retreat block), гл. 12 (two crows): двух-/трёхсвечные
  // формации, определение которых НЕ включает завершающую подтверждающую
  // свечу — Нисон требует ждать следующую закрытую свечу
  'ADVANCE_BLOCK', 'RETREAT_BLOCK', 'TWO_CROWS',
  // контекстные односвечные модели (не гл. 3, а специфические формации):
  // подтверждение следующей свечой обязательно
  'KEY_REVERSAL_BULL', 'KEY_REVERSAL_BEAR',
  'LAST_EGULFING_BOTTOM', 'LAST_EGULFING_TOP',
  'VOL_SPIN_ACCUMULATION', 'VOL_SPIN_DISTRIBUTION',
  'LEVEL_TEST_BULL', 'LEVEL_TEST_BEAR',
  'TREND_PULLBACK_WHITE', 'TREND_PULLBACK_BLACK',
];

/** Требуется ли модели подтверждение следующей ЗАКРЫТОЙ свечой для входа? */
export function requiresNextCandleConfirmation(patternName: string): boolean {
  return matchesPatternId(patternName, CONFIRMATION_REQUIRED_IDS);
}
