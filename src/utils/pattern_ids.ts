// pattern_ids.ts — стабильные идентификаторы свечных моделей (П.7).
// ВАЖНО: ID неизменяемы — на них завязаны сохранённые журналы сигналов.
// ИСПРАВЛЕНО: маппинг «ниже шеи / на шее» (гл. 4 ЯС), добавлены новые модели.

export type PatternId =
  // гл. 3 ЯС: односвечные теневые
  | 'HAMMER' | 'IMPERFECT_HAMMER' | 'INVERTED_HAMMER' | 'HANGING_MAN' | 'SHOOTING_STAR'
  // гл. 4 ЯС: двухсвечные развороты
  | 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING'
  | 'DARK_CLOUD_COVER' | 'PIERCING_PATTERN'
  // гл. 5 ЯС: звёзды
  | 'MORNING_STAR' | 'EVENING_STAR'
  | 'MORNING_DOJI_STAR' | 'EVENING_DOJI_STAR'
  | 'ABANDONED_BABY_BOTTOM' | 'ABANDONED_BABY_TOP'
  // гл. 6 ЯС: прочие развороты
  | 'THREE_WHITE_SOLDIERS' | 'THREE_BLACK_CROWS' | 'THREE_IDENTICAL_CROWS'
  | 'TWO_CROWS' | 'THREE_MOUNTAINS' | 'THREE_RIVERS'
  | 'TOWER_TOP' | 'TOWER_BOTTOM' | 'LADDER_BOTTOM'
  | 'BULL_HARAMI' | 'BEAR_HARAMI' | 'BULL_HARAMI_CROSS' | 'BEAR_HARAMI_CROSS'
  | 'TWEEZER_BOTTOM' | 'TWEEZER_TOP'
  | 'BELT_HOLD_BULL' | 'BELT_HOLD_BEAR'
  | 'COUNTERATTACK_BULL' | 'COUNTERATTACK_BEAR'
  | 'SEPARATING_LINE_BULL' | 'SEPARATING_LINE_BEAR'
  | 'LAST_ENGULFING_BOTTOM' | 'LAST_ENGULFING_TOP'
  | 'KEY_REVERSAL_BULL' | 'KEY_REVERSAL_BEAR'
  // гл. 7 ЯС: продолжения
  | 'RISE_THREE_METHODS' | 'FALL_THREE_METHODS' | 'TATAMI'
  | 'SIDE_BY_SIDE_GAP' | 'SIDE_BY_SIDE_GAP_DOWN'
  | 'TASUKI_UP_GAP' | 'TASUKI_DOWN_GAP'
  | 'GAPPING_PLAY_HIGH' | 'GAPPING_PLAY_LOW'
  | 'THRUSTING' | 'IN_NECK' | 'ON_NECK' | 'DOUBLE_THRUSTING_BULL'
  // гл. 7 ЯС: ослабленные формы (нейтральные предупреждения)
  | 'ADVANCE_BLOCK' | 'STALLED'
  // гл. 8 ЯС: дожи и высокая волна (нейтральные)
  | 'DOJI' | 'DRAGONFLY_DOJI' | 'GRAVESTONE_DOJI'
  | 'LONG_LEGGED_DOJI' | 'RICKSHAW_MAN' | 'HIGH_WAVE'
  // гл. 11 ЯС: спружинивания
  | 'SPRING' | 'UPTHRUST'
  // гл. 15 ЯС: объёмные модели
  | 'VOL_SPIN_ACCUMULATION' | 'VOL_SPIN_DISTRIBUTION'
  // Контекстные (не точки входа)
  | 'LEVEL_TEST_BULL' | 'LEVEL_TEST_BEAR'
  | 'TREND_PULLBACK_WHITE' | 'TREND_PULLBACK_BLACK'
  | 'CONSOLIDATION_BREAKOUT_BULL' | 'CONSOLIDATION_BREAKOUT_BEAR';

export const CANONICAL_PATTERN_NAMES: ReadonlyArray<[string, PatternId]> = [
  // Порядок важен: сначала специфичные имена, потом общие.
  ['МОЛОТ (НЕСОВЕРШЕННЫЙ)', 'IMPERFECT_HAMMER'],
  ['ПЕРЕВЁРНУТЫЙ МОЛОТ', 'INVERTED_HAMMER'],
  ['МОЛОТ', 'HAMMER'],
  ['ПОВЕШЕННЫЙ', 'HANGING_MAN'],
  ['ПАДАЮЩАЯ ЗВЕЗДА', 'SHOOTING_STAR'],
  ['БЫЧЬЕ ПОГЛОЩЕНИЕ', 'BULLISH_ENGULFING'],
  ['МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ', 'BEARISH_ENGULFING'],
  ['УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА', 'MORNING_DOJI_STAR'],
  ['ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА', 'EVENING_DOJI_STAR'],
  ['УТРЕННЯЯ ЗВЕЗДА', 'MORNING_STAR'],
  ['ВЕЧЕРНЯЯ ЗВЕЗДА', 'EVENING_STAR'],
  ['ТРИ ОДИНАКОВЫЕ ВОРОНЫ', 'THREE_IDENTICAL_CROWS'],
  ['ТРИ БЕЛЫХ СОЛДАТА', 'THREE_WHITE_SOLDIERS'],
  ['ТРИ ЧЁРНЫХ ВОРОНЫ', 'THREE_BLACK_CROWS'],
  ['ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ', 'TWO_CROWS'],
  ['ДОДЖИ-СТРЕКОЗА', 'DRAGONFLY_DOJI'],
  ['НАДГРОБИЕ', 'GRAVESTONE_DOJI'],
  ['ДЛИННОНОГАЯ ДОДЖИ (РИКША)', 'RICKSHAW_MAN'],
  ['ДЛИННОНОГАЯ ДОДЖИ', 'LONG_LEGGED_DOJI'],
  ['ДОДЖИ', 'DOJI'],
  ['ВЫСОКАЯ ВОЛНА', 'HIGH_WAVE'],
  ['СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)', 'SPRING'],
  ['ВЕРХНЕЕ СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ВЕРШИНЫ)', 'UPTHRUST'],
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
  ['ПРОСВЕТ В ОБЛАКАХ', 'PIERCING_PATTERN'],
  ['ЛИНИЯ ПОЯСА (БЫЧЬЯ)', 'BELT_HOLD_BULL'],
  ['ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)', 'BELT_HOLD_BEAR'],
  ['КОНТРАТАКА (БЫЧЬЯ)', 'COUNTERATTACK_BULL'],
  ['КОНТРАТАКА (МЕДВЕЖЬЯ)', 'COUNTERATTACK_BEAR'],
  ['РАЗДЕЛЕНИЕ (БЫЧЬЕ)', 'SEPARATING_LINE_BULL'],
  ['РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)', 'SEPARATING_LINE_BEAR'],
  // ИСПРАВЛЕНО (гл. 4 ЯС): «ниже шеи» и «на шее» — отдельные модели.
  ['НИЖЕ ШЕИ', 'IN_NECK'],
  ['НА ШЕЕ', 'ON_NECK'],
  ['ТОЛЧОК', 'THRUSTING'],
  ['ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)', 'DOUBLE_THRUSTING_BULL'],
  // ОТМЕНА ошибочного P0-3: downgap side-by-side white lines (гл. 7 ЯС,
  // глоссарий А) — две БЕЛЫЕ свечи после гэпа вниз, медвежье продолжение.
  ['ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)', 'SIDE_BY_SIDE_GAP_DOWN'],
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
  // ИСПРАВЛЕНО: опечатка EGULFING → ENGULFING.
  ['ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)', 'LAST_ENGULFING_BOTTOM'],
  ['ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)', 'LAST_ENGULFING_TOP'],
  ['НАКОПЛЕНИЕ', 'VOL_SPIN_ACCUMULATION'],
  ['РАСПРЕДЕЛЕНИЕ', 'VOL_SPIN_DISTRIBUTION'],
  ['ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)', 'LEVEL_TEST_BULL'],
  ['ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)', 'LEVEL_TEST_BEAR'],
  ['ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ', 'TREND_PULLBACK_WHITE'],
  ['ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ', 'TREND_PULLBACK_BLACK'],
  ['ОТБИТОЕ НАСТУПЛЕНИЕ', 'ADVANCE_BLOCK'],
  ['ТОРМОЖЕНИЕ', 'STALLED'],
];

const NAME_TO_ID = new Map<string, PatternId>(CANONICAL_PATTERN_NAMES);

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

export function matchesPatternId(patternName: string, ids: readonly PatternId[]): boolean {
  const id = getPatternId(patternName);
  return id !== null && ids.includes(id);
}

/**
 * Разворотные модели по канону Нисона.
 * ИСПРАВЛЕНО: «толчок» / «ниже шеи» / «на шее» — это ПРОДОЛЖЕНИЯ (гл. 4 ЯС),
 * не развороты. «Отбитое наступление» и «торможение» — нейтральные.
 */
export const REVERSAL_PATTERN_IDS: readonly PatternId[] = [
  'HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER', 'HANGING_MAN', 'SHOOTING_STAR',
  'BULLISH_ENGULFING', 'BEARISH_ENGULFING',
  'DARK_CLOUD_COVER', 'PIERCING_PATTERN',
  'MORNING_STAR', 'EVENING_STAR', 'MORNING_DOJI_STAR', 'EVENING_DOJI_STAR',
  'ABANDONED_BABY_BOTTOM', 'ABANDONED_BABY_TOP',
  'THREE_WHITE_SOLDIERS', 'THREE_BLACK_CROWS', 'THREE_IDENTICAL_CROWS',
  'TWO_CROWS', 'THREE_MOUNTAINS', 'THREE_RIVERS',
  'TOWER_TOP', 'TOWER_BOTTOM', 'LADDER_BOTTOM',
  'BULL_HARAMI', 'BEAR_HARAMI', 'BULL_HARAMI_CROSS', 'BEAR_HARAMI_CROSS',
  'TWEEZER_BOTTOM', 'TWEEZER_TOP',
  'BELT_HOLD_BULL', 'BELT_HOLD_BEAR',
  'COUNTERATTACK_BULL', 'COUNTERATTACK_BEAR',
  'LAST_ENGULFING_BOTTOM', 'LAST_ENGULFING_TOP',
  'KEY_REVERSAL_BULL', 'KEY_REVERSAL_BEAR',
  'SPRING', 'UPTHRUST',
];

export function isReversalPatternName(patternName: string): boolean {
  return matchesPatternId(patternName, REVERSAL_PATTERN_IDS);
}

/** Дожи остаются нейтральными моделями; направление задаёт только контекст. */
export const DOJI_PATTERN_IDS: readonly PatternId[] = [
  'DOJI', 'DRAGONFLY_DOJI', 'GRAVESTONE_DOJI', 'LONG_LEGGED_DOJI', 'RICKSHAW_MAN',
];

export function isDojiPatternName(patternName: string): boolean {
  return matchesPatternId(patternName, DOJI_PATTERN_IDS);
}

/**
 * Модели, требующие подтверждения следующей закрытой свечой.
 * ИСПРАВЛЕНО по канону:
 *  - «две взлетевшие вороны» требуют оценки четвёртой сессии;
 *  - смежные белые свечи подтверждаются следующей сессией;
 *  - «ключевой разворот» и «спружинивания» — завершённые формации;
 *  - «три белых солдата / чёрных вороны», звёзды, поглощения — завершённые;
 *  - односвечные гл. 3, харами, твизеры, пояс, контратака, разделение,
 *    татами, толчок/шея — требуют подтверждения.
 */
export const CONFIRMATION_REQUIRED_IDS: readonly PatternId[] = [
  // гл. 3 ЯС: все односвечные теневые
  'HAMMER', 'IMPERFECT_HAMMER', 'INVERTED_HAMMER', 'HANGING_MAN', 'SHOOTING_STAR',
  'DOJI', 'DRAGONFLY_DOJI', 'GRAVESTONE_DOJI', 'LONG_LEGGED_DOJI', 'RICKSHAW_MAN',
  'HIGH_WAVE',
  'BELT_HOLD_BULL', 'BELT_HOLD_BEAR',
  // гл. 6 ЯС: неполные формации
  'BULL_HARAMI', 'BEAR_HARAMI', 'BULL_HARAMI_CROSS', 'BEAR_HARAMI_CROSS',
  'TATAMI', 'SEPARATING_LINE_BULL', 'SEPARATING_LINE_BEAR',
  'TWO_CROWS', 'SIDE_BY_SIDE_GAP', 'SIDE_BY_SIDE_GAP_DOWN',
  'THRUSTING', 'IN_NECK', 'ON_NECK', 'DOUBLE_THRUSTING_BULL',
  'COUNTERATTACK_BULL', 'COUNTERATTACK_BEAR',
  'TWEEZER_BOTTOM', 'TWEEZER_TOP',
  // гл. 7 ЯС: ослабленные формы
  'ADVANCE_BLOCK', 'STALLED',
  // гл. 15 ЯС: объёмные контекстные
  'VOL_SPIN_ACCUMULATION', 'VOL_SPIN_DISTRIBUTION',
  'LEVEL_TEST_BULL', 'LEVEL_TEST_BEAR',
  'TREND_PULLBACK_WHITE', 'TREND_PULLBACK_BLACK',
];

export function requiresNextCandleConfirmation(patternName: string): boolean {
  return matchesPatternId(patternName, CONFIRMATION_REQUIRED_IDS);
}

/**
 * Количество свечей в формации — единый источник для границ.
 * ИСПРАВЛЕНО: явная размерность вместо строкового маппинга по подстрокам.
 */
export const PATTERN_CANDLE_COUNTS: Readonly<Record<PatternId, number>> = {
  HAMMER: 1, IMPERFECT_HAMMER: 1, INVERTED_HAMMER: 1,
  HANGING_MAN: 1, SHOOTING_STAR: 1,
  DOJI: 1, DRAGONFLY_DOJI: 1, GRAVESTONE_DOJI: 1,
  LONG_LEGGED_DOJI: 1, RICKSHAW_MAN: 1, HIGH_WAVE: 1,
  SPRING: 1, UPTHRUST: 1,
  VOL_SPIN_ACCUMULATION: 1, VOL_SPIN_DISTRIBUTION: 1,
  LEVEL_TEST_BULL: 1, LEVEL_TEST_BEAR: 1,
  TREND_PULLBACK_WHITE: 1, TREND_PULLBACK_BLACK: 1,
  BULLISH_ENGULFING: 2, BEARISH_ENGULFING: 2,
  LAST_ENGULFING_BOTTOM: 2, LAST_ENGULFING_TOP: 2,
  KEY_REVERSAL_BULL: 2, KEY_REVERSAL_BEAR: 2,
  DARK_CLOUD_COVER: 2, PIERCING_PATTERN: 2,
  BULL_HARAMI: 2, BEAR_HARAMI: 2,
  BULL_HARAMI_CROSS: 2, BEAR_HARAMI_CROSS: 2,
  TWEEZER_BOTTOM: 2, TWEEZER_TOP: 2,
  BELT_HOLD_BULL: 1, BELT_HOLD_BEAR: 1,
  COUNTERATTACK_BULL: 2, COUNTERATTACK_BEAR: 2,
  SEPARATING_LINE_BULL: 2, SEPARATING_LINE_BEAR: 2,
  IN_NECK: 2, ON_NECK: 2, THRUSTING: 2,
  STALLED: 2,
  MORNING_STAR: 3, EVENING_STAR: 3,
  MORNING_DOJI_STAR: 3, EVENING_DOJI_STAR: 3,
  ABANDONED_BABY_BOTTOM: 3, ABANDONED_BABY_TOP: 3,
  THREE_WHITE_SOLDIERS: 3, THREE_BLACK_CROWS: 3, THREE_IDENTICAL_CROWS: 3,
  TWO_CROWS: 3, ADVANCE_BLOCK: 3,
  SIDE_BY_SIDE_GAP: 3, SIDE_BY_SIDE_GAP_DOWN: 3, TASUKI_UP_GAP: 3, TASUKI_DOWN_GAP: 3,
  DOUBLE_THRUSTING_BULL: 4,
  RISE_THREE_METHODS: 5, FALL_THREE_METHODS: 5,
  TATAMI: 5, LADDER_BOTTOM: 5,
  TOWER_TOP: 6, TOWER_BOTTOM: 6,
  GAPPING_PLAY_HIGH: 7, GAPPING_PLAY_LOW: 7,
  CONSOLIDATION_BREAKOUT_BULL: 6, CONSOLIDATION_BREAKOUT_BEAR: 6,
  THREE_MOUNTAINS: 12, THREE_RIVERS: 12,
};

/** Размерность формации по имени паттерна. */
export function getPatternCandleCount(patternName: string): number {
  const id = getPatternId(patternName);
  return id ? PATTERN_CANDLE_COUNTS[id] : 1;
}
