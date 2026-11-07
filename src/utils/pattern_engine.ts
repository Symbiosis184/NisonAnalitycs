import { Candle } from './candle';
import { atr, ema } from './indicators';
import { ZoneVoter, timeframeKey, type TimeframeKey } from './zone_voter';
import { findSwings } from './levels';

/** Глубина окна свинг-детектора по временному масштабу (синхронно с ZONE_PARAMS в zone_voter). */
const SWING_SPAN_BY_TF: Record<TimeframeKey, number> = {
  scalp: 2,
  intraday: 3,
  swing: 3,
  position: 4,
};

export class SupportResistance {
  /**
   * Зоны на каждом ТФ — СВОИ (ЯС гл. 11: уровень — это зона, ширина привязана к масштабу).
   * Span свинга зависит от ТФ: scalp=2, intraday/swing=3, position=4.
   */
  static findLevels(
    candles: Candle[],
    lookback: number = 50,
    tfKey: TimeframeKey = 'swing',
  ): { support: number[]; resistance: number[] } {
    const swings = findSwings(candles, lookback, SWING_SPAN_BY_TF[tfKey]);
    const support = swings.filter((s) => s.type === 'low').map((s) => s.level);
    const resistance = swings.filter((s) => s.type === 'high').map((s) => s.level);
    return { support, resistance };
  }

  static isNearSupport(price: number, candles: Candle[], tfKey: TimeframeKey = 'swing', wickLow?: number): boolean {
    return ZoneVoter.isNearSupport(price, candles, undefined, tfKey, wickLow);
  }

  static isNearResistance(price: number, candles: Candle[], tfKey: TimeframeKey = 'swing', wickHigh?: number): boolean {
    return ZoneVoter.isNearResistance(price, candles, undefined, tfKey, wickHigh);
  }
}

export class VolumeAnalyzer {
  static getAverageVolume(candles: Candle[], period: number = 20): number {
    if (candles.length < period || period <= 0) return 0;
    const recent = candles.slice(-period);
    return recent.reduce((s, c) => s + c.volume, 0) / period;
  }

  /** ЯС гл. 15: объём — ПОДТВЕРЖДЕНИЕ силы движения, а не самостоятельный сигнал. */
  static isHighVolume(candle: Candle, candles: Candle[], multiplier: number = 1.3): boolean {
    const prevCandles = candles.slice(0, -1);
    const avg = this.getAverageVolume(prevCandles);
    return avg > 0 && candle.volume > avg * multiplier;
  }
}

/* ------------------------------------------------------------------ *
 *  ТФ-контекст детектора (ЯС гл. 11: ширина зоны и толеранс зависят   *
 *  от таймфрейма).                                                    *
 * ------------------------------------------------------------------ */
let PATTERN_TF_KEY: TimeframeKey = 'swing';

export function setPatternTimeframe(tf: string): void {
  PATTERN_TF_KEY = timeframeKey(tf);
}

export function getPatternTimeframe(): TimeframeKey {
  return PATTERN_TF_KEY;
}

/* ------------------------------------------------------------------ *
 *  Рыночный контекст. Нисон писал по акциям и фьючерсам, где гэпы —   *
 *  обычное явление (ЯС гл. 7). Криптовалюты торгуются 24/7, поэтому   *
 *  ЧИСТО гэповые модели на крипте отключены; в моделях, где гэп по    *
 *  книге является усилителем, а не обязательным условием (звёзды,     *
 *  завеса, просвет), он сохраняется как допуск + метка в имени.       *
 * ------------------------------------------------------------------ */
type MarketKind = 'crypto' | 'stocks';
let CURRENT_MARKET: MarketKind = 'crypto';

export function setMarket(market: MarketKind): void {
  CURRENT_MARKET = market;
}

export function getMarket(): MarketKind {
  return CURRENT_MARKET;
}

function GAP_PATTERNS_ENABLED(): boolean {
  return CURRENT_MARKET === 'stocks';
}

/* ------------------------------------------------------------------ *
 *  КАНОНИЧЕСКАЯ КЛАССИФИКАЦИЯ МОДЕЛЕЙ (единый источник истины).       *
 *  kind:              'reversal' | 'continuation' | 'neutral'         *
 *  needsConfirmation: требуется ли подтверждение СЛЕДУЮЩЕЙ закрытой    *
 *                     свечой (ЯС гл. 4–8, ЗГ гл. 3).                  *
 *  weight:            относительная значимость модели по книге.       *
 * ------------------------------------------------------------------ */
export type PatternKind = 'reversal' | 'continuation' | 'neutral';

export interface PatternCanon {
  kind: PatternKind;
  needsConfirmation: boolean;
  weight: number;
}

const PATTERN_CANON: Record<string, PatternCanon> = {
  // --- гл. 4: одиночные свечи (сигнал «к сигналу», подтверждение обязательно) ---
  'МОЛОТ': { kind: 'reversal', needsConfirmation: true, weight: 1.0 },
  'ПЕРЕВЁРНУТЫЙ МОЛОТ': { kind: 'reversal', needsConfirmation: true, weight: 0.9 },
  'ПОВЕШЕННЫЙ': { kind: 'reversal', needsConfirmation: true, weight: 0.9 },
  'ПАДАЮЩАЯ ЗВЕЗДА': { kind: 'reversal', needsConfirmation: true, weight: 0.9 },

  // --- гл. 4: модели из двух свечей (завершённая формация = подтверждение) ---
  'БЫЧЬЕ ПОГЛОЩЕНИЕ': { kind: 'reversal', needsConfirmation: false, weight: 1.0 },
  'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ': { kind: 'reversal', needsConfirmation: false, weight: 1.0 },
  'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ': { kind: 'reversal', needsConfirmation: false, weight: 1.0 },
  'ПРОСВЕТ В ОБЛАКАХ': { kind: 'reversal', needsConfirmation: false, weight: 1.0 },

  // --- гл. 5: звёзды (третья свеча модели и есть подтверждение Нисона) ---
  'УТРЕННЯЯ ЗВЕЗДА': { kind: 'reversal', needsConfirmation: false, weight: 1.0 },
  'ВЕЧЕРНЯЯ ЗВЕЗДА': { kind: 'reversal', needsConfirmation: false, weight: 1.0 },
  // Звёзды дожи: ЯС гл. 5 — «в случае со звёздами дожи всегда важно дожидаться
  // одной или двух следующих свечей для подтверждения сигнала».
  'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА': { kind: 'reversal', needsConfirmation: true, weight: 1.0 },
  'ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА': { kind: 'reversal', needsConfirmation: true, weight: 1.0 },
  'ПОКИНУТЫЙ МЛАДЕНЕЦ': { kind: 'reversal', needsConfirmation: false, weight: 1.0 },

  // --- гл. 6: второстепенные разворотные модели (подтверждение обязательно) ---
  'БЫЧИЙ ХАРАМИ': { kind: 'reversal', needsConfirmation: true, weight: 0.5 },
  'МЕДВЕЖИЙ ХАРАМИ': { kind: 'reversal', needsConfirmation: true, weight: 0.5 },
  'БЫЧИЙ ХАРАМИ-КРЕСТ': { kind: 'reversal', needsConfirmation: true, weight: 0.8 },
  'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ': { kind: 'reversal', needsConfirmation: true, weight: 0.8 },
  'ПИНЦЕТ-ОСНОВАНИЕ': { kind: 'reversal', needsConfirmation: true, weight: 0.6 },
  'ПИНЦЕТ-ВЕРШИНА': { kind: 'reversal', needsConfirmation: true, weight: 0.6 },
  'ЛИНИЯ ПОЯСА (БЫЧЬЯ)': { kind: 'reversal', needsConfirmation: true, weight: 0.7 },
  'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)': { kind: 'reversal', needsConfirmation: true, weight: 0.7 },
  'КОНТРАТАКА (БЫЧЬЯ)': { kind: 'reversal', needsConfirmation: true, weight: 0.6 },
  'КОНТРАТАКА (МЕДВЕЖЬЯ)': { kind: 'reversal', needsConfirmation: true, weight: 0.6 },
  'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ': { kind: 'reversal', needsConfirmation: false, weight: 0.8 },
  'ТРИ ГОРЫ': { kind: 'reversal', needsConfirmation: true, weight: 0.8 },
  'ТРИ РЕКИ': { kind: 'reversal', needsConfirmation: true, weight: 0.8 },
  'БАШЕННАЯ ВЕРШИНА': { kind: 'reversal', needsConfirmation: false, weight: 0.9 },
  'БАШЕННОЕ ДНО': { kind: 'reversal', needsConfirmation: false, weight: 0.9 },
  'ТРИ ЧЁРНЫХ ВОРОНЫ': { kind: 'reversal', needsConfirmation: false, weight: 0.9 },
  'ТРИ БЕЛЫХ СОЛДАТА': { kind: 'reversal', needsConfirmation: false, weight: 0.9 },
  'ЛЕСТНИЧНОЕ ДНО': { kind: 'reversal', needsConfirmation: false, weight: 0.7 },
  'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)': { kind: 'reversal', needsConfirmation: true, weight: 0.8 },
  'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)': { kind: 'reversal', needsConfirmation: true, weight: 0.8 },
  'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)': { kind: 'reversal', needsConfirmation: false, weight: 0.8 },
  'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)': { kind: 'reversal', needsConfirmation: false, weight: 0.8 },
  'СПРУЖИНИВАНИЕ': { kind: 'reversal', needsConfirmation: false, weight: 0.9 },
  'ВЕРХНЕЕ СПРУЖИНИВАНИЕ': { kind: 'reversal', needsConfirmation: false, weight: 0.9 },
  'НАКОПЛЕНИЕ': { kind: 'reversal', needsConfirmation: true, weight: 0.6 },
  'РАСПРЕДЕЛЕНИЕ': { kind: 'reversal', needsConfirmation: true, weight: 0.6 },
  'ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)': { kind: 'reversal', needsConfirmation: false, weight: 0.6 },

  // --- гл. 7: модели продолжения ---
  'РАЗДЕЛЕНИЕ (БЫЧЬЕ)': { kind: 'continuation', needsConfirmation: false, weight: 0.7 },
  'РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)': { kind: 'continuation', needsConfirmation: false, weight: 0.7 },
  'НИЖЕ ШЕИ': { kind: 'continuation', needsConfirmation: true, weight: 0.6 },
  'НА ШЕЕ': { kind: 'continuation', needsConfirmation: true, weight: 0.6 },
  'ТОЛЧОК': { kind: 'continuation', needsConfirmation: true, weight: 0.6 },
  'ВОСХОДЯЩИЕ ТРИ МЕТОДА': { kind: 'continuation', needsConfirmation: false, weight: 0.9 },
  'НИСХОДЯЩИЕ ТРИ МЕТОДА': { kind: 'continuation', needsConfirmation: false, weight: 0.9 },
  'УДЕРЖАНИЕ НА ТАТАМИ': { kind: 'continuation', needsConfirmation: false, weight: 0.8 },
  'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ': { kind: 'continuation', needsConfirmation: false, weight: 0.8 },
  'ТАСУКИ ВОСХОДЯЩЕГО ГЭПА': { kind: 'continuation', needsConfirmation: false, weight: 0.8 },
  'ТАСУКИ НИСХОДЯЩЕГО ГЭПА': { kind: 'continuation', needsConfirmation: false, weight: 0.8 },
  'ГЭП НА МАКСИМУМАХ': { kind: 'continuation', needsConfirmation: false, weight: 0.9 },
  'ГЭП НА МИНИМУМАХ': { kind: 'continuation', needsConfirmation: false, weight: 0.9 },
  'ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)': { kind: 'continuation', needsConfirmation: false, weight: 0.7 },
  'ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)': { kind: 'continuation', needsConfirmation: false, weight: 0.7 },
  'ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ': { kind: 'continuation', needsConfirmation: false, weight: 0.7 },
  'ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ': { kind: 'continuation', needsConfirmation: false, weight: 0.7 },

  // --- гл. 7/8: НЕ сигналы к сделке, а предупреждения (только caution-поток) ---
  'ОТБИТОЕ НАСТУПЛЕНИЕ': { kind: 'neutral', needsConfirmation: false, weight: 0.4 },
  'ТОРМОЖЕНИЕ': { kind: 'neutral', needsConfirmation: false, weight: 0.4 },
  'ДОДЖИ': { kind: 'neutral', needsConfirmation: true, weight: 0.3 },
  'ДОДЖИ-СТРЕКОЗА': { kind: 'neutral', needsConfirmation: true, weight: 0.3 },
  'НАДГРОБИЕ': { kind: 'neutral', needsConfirmation: true, weight: 0.4 },
  'ДЛИННОНОГАЯ ДОДЖИ': { kind: 'neutral', needsConfirmation: true, weight: 0.4 },
  'ВЫСОКАЯ ВОЛНА': { kind: 'neutral', needsConfirmation: true, weight: 0.4 },
  'ТЕСТ ПОДДЕРЖКИ': { kind: 'neutral', needsConfirmation: false, weight: 0.3 },
  'ТЕСТ СОПРОТИВЛЕНИЯ': { kind: 'neutral', needsConfirmation: false, weight: 0.3 },
};

/** Имя модели без усилителей вида « (У ПОДДЕРЖКИ)», « (ОБЪЁМ)», « (ГЭП ВВЕРХ)». */
export function basePatternName(name: string): string {
  const i = name.indexOf(' (');
  return (i > 0 ? name.slice(0, i) : name).trim();
}

const DEFAULT_CANON: PatternCanon = { kind: 'reversal', needsConfirmation: true, weight: 0.5 };

export function patternCanon(name: string): PatternCanon {
  const base = basePatternName(name);
  return PATTERN_CANON[base] ?? DEFAULT_CANON;
}

/** ЯС гл. 8: дожи — «указатель перекрёстка», а не сигнал к сделке. */
export function isNonDirectionalPattern(name: string): boolean {
  return patternCanon(name).kind === 'neutral';
}

/** Количество свечей в формации — по точному соответствию книге (гл. 4–7). */
const FORMATION_SPAN: Array<[string, number]> = [
  ['ДВОЙНОЙ ТОЛЧОК', 4],
  ['УДЕРЖАНИЕ НА ТАТАМИ', 5],
  ['ВОСХОДЯЩИЕ ТРИ МЕТОДА', 5],
  ['НИСХОДЯЩИЕ ТРИ МЕТОДА', 5],
  ['ЛЕСТНИЧНОЕ ДНО', 5],
  ['БАШЕННАЯ ВЕРШИНА', 6],
  ['БАШЕННОЕ ДНО', 6],
  ['ПРОРЫВ КОНСОЛИДАЦИИ', 6],
  ['СПРУЖИНИВАНИЕ', 21],
  ['ГЭП НА МАКСИМУМАХ', 7],
  ['ГЭП НА МИНИМУМАХ', 7],
  ['ГЭП СМЕЖНЫХ БЕЛЫХ', 3],
  ['ТАСУКИ', 3],
  ['ТРИ БЕЛЫХ СОЛДАТА', 3],
  ['ТРИ ЧЁРНЫХ ВОРОНЫ', 3],
  ['ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ', 3],
  ['ПОКИНУТЫЙ МЛАДЕНЕЦ', 3],
  ['ОТБИТОЕ НАСТУПЛЕНИЕ', 3],
  ['УТРЕННЯЯ', 3],
  ['ВЕЧЕРНЯЯ', 3],
  ['КЛЮЧЕВОЙ РАЗВОРОТ', 2],
  ['ТОРМОЖЕНИЕ', 2],
  ['ПАДАЮЩАЯ ЗВЕЗДА', 1],
  ['ПЕРЕВЁРНУТЫЙ МОЛОТ', 1],
  ['МОЛОТ', 1],
  ['ПОВЕШЕННЫЙ', 1],
  ['ДОДЖИ', 1],
  ['СТРЕКОЗА', 1],
  ['НАДГРОБИЕ', 1],
  ['ВЫСОКАЯ ВОЛНА', 1],
  ['ПОГЛОЩЕНИЕ', 2],
  ['ЗАВЕСА', 2],
  ['ПРОСВЕТ', 2],
  ['ХАРАМИ', 2],
  ['ПИНЦЕТ', 2],
  ['ПОЯСА', 2],
  ['КОНТРАТАКА', 2],
  ['РАЗДЕЛЕНИЕ', 2],
  ['ШЕИ', 2],
  ['ТОЛЧОК', 2],
  ['НАКОПЛЕНИЕ', 1],
  ['РАСПРЕДЕЛЕНИЕ', 1],
  ['ТЕСТ ПОДДЕРЖКИ', 1],
  ['ТЕСТ СОПРОТИВЛЕНИЯ', 1],
  ['ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ', 6],
  ['ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ', 6],
  ['ЗВЕЗДА', 3],
];

export class PatternDetector {
  /* ---------------------------------------------------------------- *
   *  Границы формации (для стопа, метаданных и жизненного цикла).    *
   *  ЯС гл. 4: стоп размещается за экстремумом ФОРМАЦИИ, а не одной  *
   *  свечи.                                                          *
   * ---------------------------------------------------------------- */
  static getFormationBounds(
    patternName: string,
    candles: Candle[],
    endIdx: number,
  ): {
    patternCandlesCount: number;
    patternStartIdx: number;
    patternEndIdx: number;
    patternLow: number;
    patternHigh: number;
  } {
    const n = candles.length;
    const empty = {
      patternCandlesCount: 0,
      patternStartIdx: -1,
      patternEndIdx: -1,
      patternLow: 0,
      patternHigh: 0,
    };
    if (n === 0) return empty;

    // Безопасный clamp: прежняя версия обращалась к candles[endIdx] при неверном индексе.
    const idx = Math.min(Math.max(endIdx, 0), n - 1);
    const last = candles[idx];
    if (!last) return empty;

    const p = (patternName || '').toUpperCase();

    // «Три горы» / «три реки» (гл. 6): стоп — за экстремумом трёх пиков, а не последних свечей.
    if (p.includes('ТРИ ГОРЫ')) {
      const seg = candles.slice(Math.max(0, idx - 40), idx + 1);
      const peaks = this.localExtremes(seg).highs.slice(-3);
      const highs = peaks.length ? peaks : seg.map((c) => c.high);
      return {
        patternCandlesCount: seg.length,
        patternStartIdx: idx - seg.length + 1,
        patternEndIdx: idx,
        patternLow: Math.min(...seg.slice(-3).map((c) => c.low)),
        patternHigh: Math.max(...highs),
      };
    }
    if (p.includes('ТРИ РЕКИ')) {
      const seg = candles.slice(Math.max(0, idx - 40), idx + 1);
      const troughs = this.localExtremes(seg).lows.slice(-3);
      const lows = troughs.length ? troughs : seg.map((c) => c.low);
      return {
        patternCandlesCount: seg.length,
        patternStartIdx: idx - seg.length + 1,
        patternEndIdx: idx,
        patternLow: Math.min(...lows),
        patternHigh: Math.max(...seg.slice(-3).map((c) => c.high)),
      };
    }

    let count = 1;
    for (const [key, span] of FORMATION_SPAN) {
      if (p.includes(key)) {
        count = span;
        break;
      }
    }
    count = Math.max(1, Math.min(count, idx + 1));
    const startIdx = idx - count + 1;
    const formation = candles.slice(startIdx, idx + 1);
    return {
      patternCandlesCount: count,
      patternStartIdx: startIdx,
      patternEndIdx: idx,
      patternLow: Math.min(...formation.map((c) => c.low)),
      patternHigh: Math.max(...formation.map((c) => c.high)),
    };
  }

  /* ---------------------------------------------------------------- *
   *  Вспомогательные функции канона                                   *
   * ---------------------------------------------------------------- */

  /** Адаптивный допуск: уровень — это ЗОНА (ЯС гл. 11), ширина привязана к волатильности ТФ. */
  private static adaptiveTol(window: Candle[], k: number = 0.25, ref?: number): number {
    if (!window.length) return 0;
    const close = ref ?? window[window.length - 1].close;
    const ranges = window.map((c) => c.high - c.low);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const a = window.length >= 14 ? atr(window, 14) : 0;
    const vol = Number.isFinite(a) && a > 0 ? (a as number) : avgRange;
    return Math.max(close * 0.001, vol * k);
  }

  /** ЯС гл. 2: «длинная свеча» — заметно бо́льшая по отношению к ПРЕДШЕСТВУЮЩИМ. */
  private static isLongRelative(candle: Candle, window: Candle[]): boolean {
    if (window.length < 3) return candle.isLongCandle || candle.body > candle.totalRange * 0.45;
    const bodies = window.map((c) => c.body).sort((a, b) => a - b);
    const med = bodies[Math.floor(bodies.length / 2)];
    return candle.body > candle.totalRange * 0.45 && med > 0 && candle.body >= med * 1.5;
  }

  /** ЯС гл. 2/5: «малое тело» — малое ОТНОСИТЕЛЬНО предшествующих свечей. */
  private static isSmallRelative(candle: Candle, window: Candle[]): boolean {
    if (candle.isShortCandle || candle.isDoji) return true;
    if (window.length < 3) return false;
    const bodies = window.map((c) => c.body).sort((a, b) => a - b);
    const med = bodies[Math.floor(bodies.length / 2)];
    return med > 0 && candle.body <= med * 0.4;
  }

  /** Малое тело не должно быть «длинным» относительно окна — канон «малой свечи». */
  private static isSmallBody(candle: Candle, window: Candle[], maxRangeShare: number = 0.45): boolean {
    if (candle.totalRange <= 0) return false;
    if (candle.body > candle.totalRange * maxRangeShare) return false;
    return !this.isLongRelative(candle, window);
  }

  /** Окно предшественников для относительной оценки длины (до 20 закрытых свечей). */
  private static relWindow(candles: Candle[], beforeIdx: number): Candle[] {
    return candles.slice(Math.max(0, beforeIdx - 20), beforeIdx);
  }

  private static makesNewExtreme(value: number, window: Candle[], isLow: boolean): boolean {
    if (window.length === 0) return true;
    const ref = isLow ? Math.min(...window.map((c) => c.low)) : Math.max(...window.map((c) => c.high));
    const avgRange = window.reduce((s, c) => s + (c.high - c.low), 0) / window.length;
    const tol = Math.max(ref * 0.001, avgRange * 0.25);
    return isLow ? value <= ref + tol : value >= ref - tol;
  }

  /** Локальные экстремумы (окно ±2 свечи). */
  private static localExtremes(seg: Candle[]): { highs: number[]; lows: number[] } {
    const highs: number[] = [];
    const lows: number[] = [];
    for (let i = 2; i < seg.length - 2; i++) {
      const c = seg[i];
      if (c.high > seg[i - 1].high && c.high > seg[i - 2].high && c.high > seg[i + 1].high && c.high > seg[i + 2].high) {
        highs.push(c.high);
      }
      if (c.low < seg[i - 1].low && c.low < seg[i - 2].low && c.low < seg[i + 1].low && c.low < seg[i + 2].low) {
        lows.push(c.low);
      }
    }
    return { highs, lows };
  }

  /** Тело второй свечи полностью перекрывает тело первой (ЯС гл. 4: тени не обязательны). */
  private static engulfsBody(outer: Candle, inner: Candle): boolean {
    return outer.bodyTop >= inner.bodyTop && outer.bodyBottom <= inner.bodyBottom && outer.body > inner.body;
  }

  /**
   * ЯС гл. 4: разворотный сигнал действителен только после движения ПРОТИВ него.
   * ЗГ гл. 3: «молот, образовавшийся после двух-трёхдневного падения, обычно нейтрален» —
   * поэтому оцениваем окно не менее 6 свечей и требуем значимого смещения (в т.ч. в единицах диапазона).
   */
  private static precededByDecline(prev: Candle[]): boolean {
    const seg = prev.slice(-8);
    if (seg.length < 4) return false;
    const first = seg[0].close;
    const last = seg[seg.length - 1].close;
    const lo = Math.min(...seg.map((c) => c.low));
    const avgRange = seg.reduce((s, c) => s + (c.high - c.low), 0) / seg.length;
    return last <= first * 0.997 || last <= first - avgRange * 0.5 || last <= lo * 1.02;
  }

  private static precededByRally(prev: Candle[]): boolean {
    const seg = prev.slice(-8);
    if (seg.length < 4) return false;
    const first = seg[0].close;
    const last = seg[seg.length - 1].close;
    const hi = Math.max(...seg.map((c) => c.high));
    const avgRange = seg.reduce((s, c) => s + (c.high - c.low), 0) / seg.length;
    return last >= first * 1.003 || last >= first + avgRange * 0.5 || last >= hi * 0.98;
  }

  /**
   * Бычий контекст молота/перевёрнутого молота (ЯС гл. 4):
   * свеча — отказ у дна: приход к нижней части окна и возврат цены в верхнюю половину своего диапазона.
   */
  private static atLocalLow(candle: Candle, prevCandles: Candle[]): boolean {
    if (prevCandles.length < 5) return true; // нехватка истории — не штрафуем
    const segNoSelf = prevCandles.slice(-8);
    const lo = Math.min(...segNoSelf.map((c) => c.low));
    const hi = Math.max(...segNoSelf.map((c) => c.high));
    if (hi <= lo) return true;

    const nearBottom = candle.low <= lo + (hi - lo) * 0.15;
    const priorBand = lo + (hi - lo) * 0.35;
    // Отказ может быть выполнен тенью без обновления минимума (тест существующей зоны).
    const bodyAtPriorBottom =
      Math.min(candle.open, candle.close) <= priorBand ||
      (candle.lowerWick >= candle.body * 2 && candle.low <= hi);
    // Тело — в ВЕРХНЕЙ части диапазона свечи (гл. 4, рис. 4.7).
    const bodyInUpperHalf = candle.close >= (candle.high + candle.low) / 2;

    return (nearBottom || bodyAtPriorBottom) && bodyInUpperHalf;
  }

  /** Медвежий аналог (ЯС гл. 4–5): отказ у потолка, тело в нижней части диапазона. */
  private static atLocalHigh(candle: Candle, prevCandles: Candle[]): boolean {
    if (prevCandles.length < 5) return true;
    const segNoSelf = prevCandles.slice(-8);
    const lo = Math.min(...segNoSelf.map((c) => c.low));
    const hi = Math.max(...segNoSelf.map((c) => c.high));
    if (hi <= lo) return true;

    const nearTop = candle.high >= hi - (hi - lo) * 0.15;
    const bodyInLowerHalf = candle.close <= (candle.high + candle.low) / 2;
    return nearTop && bodyInLowerHalf;
  }

  private static nearSupport(candle: Candle, prevCandles: Candle[]): boolean {
    return (
      ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.low) ||
      ZoneVoter.isNearSupport(candle.low, prevCandles, 0.01, PATTERN_TF_KEY)
    );
  }

  private static nearResistance(candle: Candle, prevCandles: Candle[]): boolean {
    return (
      ZoneVoter.isNearResistance(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.high) ||
      ZoneVoter.isNearResistance(candle.high, prevCandles, 0.01, PATTERN_TF_KEY)
    );
  }

  /* ---------------------------------------------------------------- *
   *  гл. 4: МОЛОТ / ПОВЕШЕННЫЙ / ПАДАЮЩАЯ ЗВЕЗДА, гл. 5: ПЕРЕВЁРНУТЫЙ *
   * ---------------------------------------------------------------- */

  static isHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    // Малое тело в верхней части диапазона (гл. 4, рис. 4.7).
    if (!this.isSmallBody(candle, prevCandles.slice(-20))) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    // Разворот в основании: нужен предшествующий спад и локальное дно.
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    // ГЛАВНОЕ подтверждение по канону: молот — это ОТКАЗ У ЗОНЫ ПОДДЕРЖКИ (гл. 4, 11).
    if (!this.nearSupport(candle, prevCandles)) return { found: false, name: '' };

    const closes = prevCandles.map((c) => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    const volumeOk = VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3);
    const maOk = m20 !== null && Math.abs(candle.low - m20) <= m20 * 0.01;

    let name = 'МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (volumeOk) name += ' (ОБЪЁМ)';
    else if (maOk) name += ' (MA20)';
    return { found: true, name };
  }

  /**
   * Несовершенный молот (ЯС гл. 4, рис. 4.8–4.10): нижняя тень не обязана вдвое превышать тело,
   * но обязательны приход к зоне поддержки и возврат цены вверх. Вес модели ниже.
   */
  static isImperfectHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (!this.isSmallBody(candle, prevCandles.slice(-20), 0.5)) return { found: false, name: '' };
    if (candle.lowerWick < candle.body) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.25) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.nearSupport(candle, prevCandles)) return { found: false, name: '' };
    return { found: true, name: 'МОЛОТ (НЕСОВЕРШЕННЫЙ)' };
  }

  static isInvertedHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (!this.isSmallBody(candle, prevCandles.slice(-20))) return { found: false, name: '' };
    // гл. 5: верхняя тень не менее двух тел, нижняя несущественна, тело в НИЖНЕЙ части диапазона.
    // Цвет тела значения не имеет — сравнение с серединой ДИАПАЗОНА, а не тела.
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.precededByDecline(prevCandles)) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    if (!this.nearSupport(candle, prevCandles)) return { found: false, name: '' };

    let name = 'ПЕРЕВЁРНУТЫЙ МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  static isHangingMan(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (!this.isSmallBody(candle, prevCandles.slice(-20))) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    // Тело у ВЕРХНЕЙ границы диапазона; цвет не важен (гл. 4).
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    // Повешенный = форма молота НА ВЕРШИНЕ роста (гл. 4).
    if (!this.precededByRally(prevCandles)) return { found: false, name: '' };
    if (!this.atLocalHigh(candle, prevCandles)) return { found: false, name: '' };

    let name = 'ПОВЕШЕННЫЙ';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (candle.isBearish) name += ' (ЧЁРНОЕ ТЕЛО)';
    return { found: true, name };
  }

  static isShootingStar(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (!this.isSmallBody(candle, prevCandles.slice(-20))) return { found: false, name: '' };
    // гл. 5: длинная верхняя тень, малое тело у НИЖНЕЙ границы диапазона, цвет не важен.
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > (candle.high + candle.low) / 2) return { found: false, name: '' };
    if (!this.precededByRally(prevCandles)) return { found: false, name: '' };
    if (!this.atLocalHigh(candle, prevCandles)) return { found: false, name: '' };

    let name = 'ПАДАЮЩАЯ ЗВЕЗДА';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 4: ПОГЛОЩЕНИЕ, ЗАВЕСА, ПРОСВЕТ                               *
   * ---------------------------------------------------------------- */

  static isBullishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBullish) return { found: false, name: '' };
    if (!(this.engulfsBody(c2, c1) || c2.isEngulfing(c1))) return { found: false, name: '' };
    // гл. 4: поглощение — РАЗВОРОТ после спада; вне спада это continuation-шум.
    if (!this.precededByDecline(prev)) return { found: false, name: '' };

    let name = 'БЫЧЬЕ ПОГЛОЩЕНИЕ';
    if (this.isSmallRelative(c1, prev.slice(-20)) && this.isLongRelative(c2, prev.slice(-20))) name += ' (СИЛЬНОЕ)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isBearishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBearish) return { found: false, name: '' };
    if (!(this.engulfsBody(c2, c1) || c2.isEngulfing(c1))) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };

    let name = 'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ';
    if (this.isSmallRelative(c1, prev.slice(-20)) && this.isLongRelative(c2, prev.slice(-20))) name += ' (СИЛЬНОЕ)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isDarkCloudCover(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish && this.isLongRelative(c1, prev.slice(-20)))) return { found: false, name: '' };
    if (!(c2.isBearish && this.isLongRelative(c2, [...prev.slice(-19), c1]))) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    // гл. 4: закрытие второй свечи НИЖЕ середины белого тела, но ВЫШЕ его открытия
    // (иначе это уже медвежье поглощение).
    if (c2.close >= c1.bodyMid || c2.close <= c1.open) return { found: false, name: '' };
    // Гэп — усилитель: на фьючерсах открытие выше максимума, на акциях достаточно выше закрытия.
    // Для круглосуточных рынков применяется адаптивный допуск (гибкость по гл. 5).
    const tol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (c2.open < c1.close - tol) return { found: false, name: '' };

    let name = 'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ';
    if (c2.open > c1.high) name += ' (ГЭП ВЫШЕ МАКСИМУМА)';
    else if (c2.open > c1.close) name += ' (ГЭП)';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isPiercingPattern(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && this.isLongRelative(c1, prev.slice(-20)))) return { found: false, name: '' };
    if (!(c2.isBullish && this.isLongRelative(c2, [...prev.slice(-19), c1]))) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    // гл. 4: правило жёстче, чем у завесы, — белая свеча должна подниматься как минимум
    // до половины тела чёрной, но не перекрывать его целиком.
    if (c2.close <= c1.bodyMid || c2.close >= c1.open) return { found: false, name: '' };
    const tol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (c2.open > c1.close + tol) return { found: false, name: '' };

    let name = 'ПРОСВЕТ В ОБЛАКАХ';
    if (c2.open < c1.low) name += ' (ГЭП НИЖЕ МИНИМУМА)';
    else if (c2.open < c1.close) name += ' (ГЭП)';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  /* ---------------------------------------------------------------- *
   *  ЗГ гл. 3: ОСНОВАНИЕ / ВЕРШИНА «ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ»             *
   *  Основание: крупная ЧЁРНАЯ поглощает малое БЕЛОЕ тело ВО ВРЕМЯ    *
   *  СПАДА → бычий сигнал, подтверждение = закрытие выше закрытия     *
   *  чёрной свечи. Вершина — зеркально.                               *
   * ---------------------------------------------------------------- */
  static isLastEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (c1.isBullish && c2.isBearish && this.engulfsBody(c2, c1) && this.precededByDecline(prev)) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)' };
    }
    if (c1.isBearish && c2.isBullish && this.engulfsBody(c2, c1) && this.precededByRally(prev)) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)' };
    }
    return { found: false, name: '' };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 5: ЗВЁЗДЫ                                                    *
   * ---------------------------------------------------------------- */
  static isMorningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const win = this.relWindow(candles, candles.length - 3);

    // Разворот ПОСЛЕ СПАДА: закрытие первой свечи — в нижней трети диапазана предшествующих ~10 свечей.
    const ctx = candles.slice(Math.max(0, candles.length - 13), candles.length - 2);
    if (ctx.length >= 4) {
      const hi = Math.max(...ctx.map((x) => x.high));
      const lo = Math.min(...ctx.map((x) => x.low));
      if (hi > lo && c1.close > lo + (hi - lo) * 0.34) return { found: false, name: '' };
    }
    if (!(c1.isBearish && this.isLongRelative(c1, win))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, win)) return { found: false, name: '' };
    if (!(c3.isBullish && this.isLongRelative(c3, win))) return { found: false, name: '' };
    // Третья свеча закрывается ВЫШЕ середины тела первой (гл. 5).
    if (c3.close <= c1.bodyMid) return { found: false, name: '' };
    // Звезда — малое тело НИЖЕ тела первой свечи; допуск адаптивный (гибкость по гл. 5).
    const gapTol = this.adaptiveTol(candles.slice(0, -3), 0.15);
    if (c2.close > c1.bodyBottom + gapTol) return { found: false, name: '' };
    // Второй гэп НЕ обязателен (гл. 5): «второй гэп возникает редко и не является обязательным».
    // Минимум звезды — новое локальное дно окна (адаптивный допуск).
    {
      const seg = candles.slice(Math.max(0, candles.length - 11), candles.length - 2);
      if (!this.makesNewExtreme(c2.low, seg, true)) return { found: false, name: '' };
    }

    let name = c2.isDoji ? 'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА' : 'УТРЕННЯЯ ЗВЕЗДА';
    if (c2.high < c1.bodyBottom) name += ' (ГЭП ВНИЗ)';
    if (c3.open > c2.bodyTop) name += ' (ГЭП ВВЕРХ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isEveningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const win = this.relWindow(candles, candles.length - 3);

    const ctx = candles.slice(Math.max(0, candles.length - 13), candles.length - 2);
    if (ctx.length >= 4) {
      const hi = Math.max(...ctx.map((x) => x.high));
      const lo = Math.min(...ctx.map((x) => x.low));
      if (hi > lo && c1.close < hi - (hi - lo) * 0.34) return { found: false, name: '' };
    }
    if (!(c1.isBullish && this.isLongRelative(c1, win))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, win)) return { found: false, name: '' };
    if (!(c3.isBearish && this.isLongRelative(c3, win))) return { found: false, name: '' };
    if (c3.close >= c1.bodyMid) return { found: false, name: '' };
    const gapTol = this.adaptiveTol(candles.slice(0, -3), 0.15);
    if (c2.close < c1.bodyTop - gapTol) return { found: false, name: '' };
    {
      const seg = candles.slice(Math.max(0, candles.length - 11), candles.length - 2);
      if (!this.makesNewExtreme(c2.high, seg, false)) return { found: false, name: '' };
    }

    let name = c2.isDoji ? 'ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА' : 'ВЕЧЕРНЯЯ ЗВЕЗДА';
    if (c2.low > c1.bodyTop) name += ' (ГЭП ВВЕРХ)';
    if (c3.open < c2.bodyBottom) name += ' (ГЭП ВНИЗ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 7: ТРИ БЕЛЫХ СОЛДАТА / ТРИ ЧЁРНЫХ ВОРОНЫ + ослабленные формы *
   * ---------------------------------------------------------------- */
  static isThreeWhiteSoldiers(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const win = this.relWindow(candles, candles.length - 3);

    if (![c1, c2, c3].every((c) => c.isBullish && (this.isLongRelative(c, win) || c.isLongCandle))) {
      return { found: false, name: '' };
    }
    // гл. 7: последовательно ПОВЫШАЮЩИЕСЯ цены закрытия.
    if (!(c2.close > c1.close && c3.close > c2.close)) return { found: false, name: '' };
    // Закрытия у максимумов сессий: короткие верхние тени.
    if ([c1, c2, c3].some((c) => c.upperWick > c.totalRange * 0.3)) return { found: false, name: '' };
    // Каждое открытие — внутри предыдущего тела.
    if (!(c2.open >= c1.bodyBottom && c2.open <= c1.bodyTop)) return { found: false, name: '' };
    if (!(c3.open >= c2.bodyBottom && c3.open <= c2.bodyTop)) return { found: false, name: '' };
    // Ослабленные формы — это «отбитое наступление» / «торможение», а не солдаты.
    if (c3.body < c2.body && c2.body < c1.body) return { found: false, name: '' };
    if (c3.body <= c2.body * 0.5 || c3.isShortCandle) return { found: false, name: '' };

    return { found: true, name: 'ТРИ БЕЛЫХ СОЛДАТА' };
  }

  /** ЯС гл. 7 «отбитое наступление» (advance block): рост встречает сопротивление. */
  static isAdvanceBlock(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const prev = candles.slice(0, -3);
    if (![c1, c2, c3].every((c) => c.isBullish)) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    const shrinking = c3.body < c2.body && c2.body < c1.body;
    const longUpper = c2.upperWick > c2.totalRange * 0.3 && c3.upperWick > c3.totalRange * 0.3;
    if (!(shrinking || longUpper)) return { found: false, name: '' };
    return { found: true, name: 'ОТБИТОЕ НАСТУПЛЕНИЕ' };
  }

  /** ЯС гл. 7 «торможение / размышление» (stalled pattern): истощение сил быков. */
  static isStalled(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 2) return { found: false, name: '' };
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    const prev = candles.slice(0, -2);
    if (!(c1.isBullish && c2.isBullish)) return { found: false, name: '' };
    if (!this.isLongRelative(c1, this.relWindow(candles, candles.length - 2))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, this.relWindow(candles, candles.length - 2))) return { found: false, name: '' };
    // Малое тело «едет на плече» длинного: у верхней границы его тела.
    const tol = this.adaptiveTol(prev, 0.15);
    if (c2.bodyBottom < c1.bodyMid || c2.bodyTop < c1.bodyTop - tol) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    return { found: true, name: 'ТОРМОЖЕНИЕ' };
  }

  static isThreeBlackCrows(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const win = this.relWindow(candles, candles.length - 3);

    if (![c1, c2, c3].every((c) => c.isBearish && (this.isLongRelative(c, win) || c.isLongCandle))) {
      return { found: false, name: '' };
    }
    // гл. 6: последовательно понижающиеся закрытия, закрытия у минимумов сессии.
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    if ([c1, c2, c3].some((c) => c.lowerWick > c.totalRange * 0.3)) return { found: false, name: '' };
    if (!(c2.open >= c1.bodyBottom && c2.open <= c1.bodyTop)) return { found: false, name: '' };
    if (!(c3.open >= c2.bodyBottom && c3.open <= c2.bodyTop)) return { found: false, name: '' };
    if (!this.precededByRally(candles.slice(0, -3))) return { found: false, name: '' };

    let name = 'ТРИ ЧЁРНЫХ ВОРОНЫ';
    if (Math.abs(c2.open - c1.close) <= this.adaptiveTol(win, 0.1) && Math.abs(c3.open - c2.close) <= this.adaptiveTol(win, 0.1)) {
      name = 'ТРИ ОДИНАКОВЫЕ ВОРОНЫ';
    }
    return { found: true, name };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 6: ХАРАМИ / ХАРАМИ-КРЕСТ / ПИНЦЕТ / ПОЯСА / КОНТРАТАКА       *
   * ---------------------------------------------------------------- */
  static isHarami(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!this.isLongRelative(c1, this.relWindow([...prev, c1], prev.length + 1))) return { found: false, name: '' };
    if (!this.isSmallRelative(c2, [...prev.slice(-19), c1])) return { found: false, name: '' };
    // гл. 6: малое тело ЦЕЛИКОМ ВНУТРИ ТЕЛА первой свечи (тени могут выходить за пределы).
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };
    // Харами — замедление тренда: бычий только после спада, медвежий после роста.
    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ' };
    return { found: false, name: '' };
  }

  static isHaramiCross(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!this.isLongRelative(c1, this.relWindow([...prev, c1], prev.length + 1))) return { found: false, name: '' };
    if (!c2.isDoji) return { found: false, name: '' };
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };
    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ-КРЕСТ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ' };
    return { found: false, name: '' };
  }

  /**
   * ЯС гл. 6: пинцет — «как минимум две свечи с одинаковыми максимумами либо минимумами,
   * образованные телами, тенями и/или дожи, расположенные РЯДОМ ЛИБО НЕДАЛЕКО друг от друга».
   * Цвет не обязателен; обязателен трендовый контекст; зона S/R — усилитель (правило
   * множества приёмов, гл. II/10).
   */
  static isTweezerBottom(candles: Candle[], endIdx: number): { found: boolean; name: string } {
    if (endIdx < 1 || candles.length < 4) return { found: false, name: '' };
    const cur = candles[endIdx];
    const lookback = Math.min(4, endIdx);
    const tol = this.adaptiveTol(candles.slice(Math.max(0, endIdx - 20), endIdx + 1), 0.15);
    let partner: Candle | null = null;
    for (let k = 1; k <= lookback; k++) {
      const c = candles[endIdx - k];
      if (Math.abs(c.low - cur.low) <= tol) {
        partner = c;
        break;
      }
    }
    if (!partner) return { found: false, name: '' };
    const prev = candles.slice(0, endIdx - lookback);
    if (!this.precededByDecline(prev)) return { found: false, name: '' };

    let name = 'ПИНЦЕТ-ОСНОВАНИЕ';
    if (ZoneVoter.isNearSupport(cur.low, candles.slice(0, endIdx), 0.01, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (cur.isBullish || cur.isDoji) name += ' (ОТКАЗ)';
    return { found: true, name };
  }

  static isTweezerTop(candles: Candle[], endIdx: number): { found: boolean; name: string } {
    if (endIdx < 1 || candles.length < 4) return { found: false, name: '' };
    const cur = candles[endIdx];
    const lookback = Math.min(4, endIdx);
    const tol = this.adaptiveTol(candles.slice(Math.max(0, endIdx - 20), endIdx + 1), 0.15);
    let partner: Candle | null = null;
    for (let k = 1; k <= lookback; k++) {
      const c = candles[endIdx - k];
      if (Math.abs(c.high - cur.high) <= tol) {
        partner = c;
        break;
      }
    }
    if (!partner) return { found: false, name: '' };
    const prev = candles.slice(0, endIdx - lookback);
    if (!this.precededByRally(prev)) return { found: false, name: '' };

    let name = 'ПИНЦЕТ-ВЕРШИНА';
    if (ZoneVoter.isNearResistance(cur.high, candles.slice(0, endIdx), 0.01, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (cur.isBearish || cur.isDoji) name += ' (ОТКАЗ)';
    return { found: true, name };
  }

  /** ЯС гл. 6: захват за пояс — длинное тело, открытие на экстремуме сессии. */
  static isBullishBelt(candle: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (!(candle.isBullish && this.isLongRelative(candle, prev.slice(-20)))) return { found: false, name: '' };
    // «Белая свеча со срезанным основанием»: открытие на минимуме сессии.
    if (candle.open > candle.low + candle.totalRange * 0.05) return { found: false, name: '' };
    if (!this.precededByDecline(prev)) return { found: false, name: '' };

    let name = 'ЛИНИЯ ПОЯСА (БЫЧЬЯ)';
    if (ZoneVoter.isNearSupport(candle.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    return { found: true, name };
  }

  static isBearishBelt(candle: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (!(candle.isBearish && this.isLongRelative(candle, prev.slice(-20)))) return { found: false, name: '' };
    // «Чёрная свеча со срезанной вершиной»: открытие на максимуме сессии.
    if (candle.open < candle.high - candle.totalRange * 0.05) return { found: false, name: '' };
    if (!this.precededByRally(prev)) return { found: false, name: '' };

    let name = 'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)';
    if (ZoneVoter.isNearResistance(candle.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  /** ЯС гл. 6: контратака — ГЭПОВАЯ модель (вторая свеча открывается гэпом против тренда). */
  static isCounterattack(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    const closeTol = this.adaptiveTol([...prev.slice(-20), c1, c2], 0.1);
    if (Math.abs(c1.close - c2.close) > closeTol) return { found: false, name: '' };
    if (!(this.isLongRelative(c1, prev.slice(-20)) && this.isLongRelative(c2, [...prev.slice(-19), c1]))) {
      return { found: false, name: '' };
    }
    const need = c1.totalRange * 0.5;
    const gap = c2.open - c1.close;
    if (c1.isBearish && c2.isBullish && gap <= -need && this.precededByDecline(prev)) {
      return { found: true, name: 'КОНТРАТАКА (БЫЧЬЯ)' };
    }
    if (c1.isBullish && c2.isBearish && gap >= need && this.precededByRally(prev)) {
      return { found: true, name: 'КОНТРАТАКА (МЕДВЕЖЬЯ)' };
    }
    return { found: false, name: '' };
  }

  /**
   * ЯС гл. 7: РАЗДЕЛЕНИЕ — две КОНТРАСТНЫЕ свечи с одинаковыми ценами ОТКРЫТИЯ,
   * сигнал ПРОДОЛЖЕНИЯ существующего тренда; разделяющая белая свеча — бычий захват за пояс.
   */
  static isSeparatingLines(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    const tol = this.adaptiveTol([...prev.slice(-20), c1], 0.1);
    if (Math.abs(c1.open - c2.open) > tol) return { found: false, name: '' };
    const win = this.relWindow([...prev, c1], prev.length + 1);
    if (!(this.isLongRelative(c1, win) && this.isLongRelative(c2, [...win.slice(1), c1]))) {
      return { found: false, name: '' };
    }
    // Бычье разделение: чёрная → белая (открывается на минимуме) НА ФОНЕ РОСТА.
    if (c1.isBearish && c2.isBullish && c2.open <= c2.low + c2.totalRange * 0.05 && this.precededByRally(prev)) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (БЫЧЬЕ)' };
    }
    // Медвежье разделение: белая → чёрная (открывается на максимуме) НА ФОНЕ СПАДА.
    if (c1.isBullish && c2.isBearish && c2.open >= c2.high - c2.totalRange * 0.05 && this.precededByDecline(prev)) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)' };
    }
    return { found: false, name: '' };
  }

  /**
   * ЯС гл. 4: «ниже шеи / на шее / толчок» — медвежьи модели ПРОДОЛЖЕНИЯ спада.
   * Вторая (белая) свеча открывается ниже предыдущего закрытия и закрывается:
   *  «ниже шеи» — у минимума чёрной; «на шее» — чуть выше её закрытия;
   *  «толчок» — внутри тела, но ниже его середины.
   */
  static isNeckFamily(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    if (!(c1.isBearish && this.isLongRelative(c1, prev.slice(-20)))) return { found: false, name: '' };
    if (!(c2.isBullish && c2.body <= c1.body * 0.5)) return { found: false, name: '' };
    const openTol = this.adaptiveTol([...prev.slice(-20), c1], 0.15);
    if (c2.open > c1.close + openTol) return { found: false, name: '' };

    const tol = c1.totalRange * 0.05;
    if (Math.abs(c2.close - c1.low) <= tol) return { found: true, name: 'НИЖЕ ШЕИ' };
    if (c1.bodyBottom - tol <= c2.close && c2.close <= c1.bodyBottom + tol) return { found: true, name: 'НА ШЕЕ' };
    if (c1.bodyBottom < c2.close && c2.close < c1.bodyMid) return { found: true, name: 'ТОЛЧОК' };
    return { found: false, name: '' };
  }

  /** ЯС гл. 4: «толчок», возникший дважды в течение нескольких дней, — бычий сигнал. */
  static isDoubleThrustingBull(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 4) return { found: false, name: '' };
    for (let i = 0; i < 2; i++) {
      const a = candles[candles.length - 4 + i * 2];
      const b = candles[candles.length - 3 + i * 2];
      if (!(a.isBearish && b.isBullish && a.bodyBottom < b.close && b.close < a.bodyMid)) {
        return { found: false, name: '' };
      }
    }
    if (!this.precededByDecline(candles.slice(0, -4))) return { found: false, name: '' };
    return { found: true, name: 'ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)' };
  }

  /** ЯС гл. 6: две взлетевшие вороны — гэповая модель разворота на вершине. */
  static isTwoCrows(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    if (!(c1.isBullish && this.isLongRelative(c1, this.relWindow(candles, candles.length - 3)))) {
      return { found: false, name: '' };
    }
    if (!(c2.isBearish && c3.isBearish)) return { found: false, name: '' };
    if (c2.open <= c1.close) return { found: false, name: '' }; // гэп вверх
    if (c2.close <= c1.close) return { found: false, name: '' }; // закрытие выше закрытия белой
    if (!(c3.open > c2.open && c3.close < c2.close && c3.close > c1.close)) return { found: false, name: '' };
    if (!this.precededByRally(candles.slice(0, -3))) return { found: false, name: '' };

    let name = 'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ';
    if (ZoneVoter.isNearResistance(c3.close, candles.slice(0, -3), 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    return { found: true, name };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 6–7: БАШНИ, ТРИ ГОРЫ/РЕКИ, ТАТАМИ, ТРИ СТУПЕНИ               *
   * ---------------------------------------------------------------- */
  static isTowerTop(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(Math.max(0, candles.length - 11), candles.length - 1);
    if (!(candles[candles.length - 2].isBullish && candles[candles.length - 3].isBullish)) return { found: false, name: '' };
    if (!this.precededByRally(pre)) return { found: false, name: '' };
    if (!(last.isBearish && this.isLongRelative(last, this.relWindow(candles, candles.length - 1)))) {
      return { found: false, name: '' };
    }
    if (last.close >= Math.min(candles[candles.length - 2].low, candles[candles.length - 3].low)) {
      return { found: false, name: '' };
    }
    return { found: true, name: 'БАШЕННАЯ ВЕРШИНА' };
  }

  static isTowerBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(Math.max(0, candles.length - 11), candles.length - 1);
    if (!(candles[candles.length - 2].isBearish && candles[candles.length - 3].isBearish)) return { found: false, name: '' };
    if (!this.precededByDecline(pre)) return { found: false, name: '' };
    if (!(last.isBullish && this.isLongRelative(last, this.relWindow(candles, candles.length - 1)))) {
      return { found: false, name: '' };
    }
    if (last.close <= Math.max(candles[candles.length - 2].high, candles[candles.length - 3].high)) {
      return { found: false, name: '' };
    }
    return { found: true, name: 'БАШЕННОЕ ДНО' };
  }

  static isThreeMountains(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const { highs } = this.localExtremes(seg);
    if (highs.length < 3) return { found: false, name: '' };
    const h = highs.slice(-3);
    const top = Math.max(...h);
    const alignTol = this.adaptiveTol(seg, 0.3, top);
    if (!h.every((x) => Math.abs(x - top) <= alignTol)) return { found: false, name: '' };
    // гл. 6: последняя гора должна получить медвежье подтверждение другим свечным индикатором.
    const last = candles[candles.length - 1];
    if (!(last.isBearish && last.close < candles[candles.length - 2].close)) return { found: false, name: '' };
    return { found: true, name: 'ТРИ ГОРЫ (ВЕРШИНА)' };
  }

  static isThreeRivers(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const { lows } = this.localExtremes(seg);
    if (lows.length < 3) return { found: false, name: '' };
    const l = lows.slice(-3);
    const bot = Math.min(...l);
    const alignTol = this.adaptiveTol(seg, 0.3, bot);
    if (!l.every((x) => Math.abs(x - bot) <= alignTol)) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    if (!(last.isBullish && last.close > candles[candles.length - 2].close)) return { found: false, name: '' };
    return { found: true, name: 'ТРИ РЕКИ (ОСНОВАНИЕ)' };
  }

  /**
   * ЯС гл. 6 + глоссарий: «удержание на татами» — длинная белая, ЗАТЕМ малое чёрное тело
   * (в идеале после гэпа вверх), ещё 1–3 малых свечи в пределах диапазона первой,
   * и завершающая белая с закрытием выше максимума малых свечей.
   */
  static isMatHold(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const c0 = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const c4 = candles[candles.length - 1];
    if (!(c0.isBullish && this.isLongRelative(c0, this.relWindow(candles, candles.length - 5)))) {
      return { found: false, name: '' };
    }
    if (!this.precededByRally(candles.slice(0, -5))) return { found: false, name: '' };
    if (!small[0].isBearish) return { found: false, name: '' };
    for (const s of small) {
      if (!this.isSmallRelative(s, candles.slice(0, -5).slice(-20))) return { found: false, name: '' };
      if (s.high > c0.high || s.low < c0.low) return { found: false, name: '' };
    }
    if (!(c4.isBullish && this.isLongRelative(c4, this.relWindow(candles, candles.length - 1)))) {
      return { found: false, name: '' };
    }
    if (c4.close <= Math.max(...small.map((s) => s.high))) return { found: false, name: '' };
    if (c4.close <= c0.close) return { found: false, name: '' };

    let name = 'УДЕРЖАНИЕ НА ТАТАМИ';
    if (small[0].bodyBottom > c0.bodyTop) name += ' (ГЭП ВВЕРХ)';
    return { found: true, name };
  }

  /** ЯС гл. 7: три ступени — передышка внутри тренда; объём усиливает, но не обязателен. */
  static isRisingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const l = candles[candles.length - 1];
    if (!(f.isBullish && this.isLongRelative(f, this.relWindow(candles, candles.length - 5)))) {
      return { found: false, name: '' };
    }
    if (!(l.isBullish && this.isLongRelative(l, this.relWindow(candles, candles.length - 1)))) {
      return { found: false, name: '' };
    }
    if (l.close <= f.close) return { found: false, name: '' };
    const tol = this.adaptiveTol(candles.slice(0, -5), 0.15);
    for (const s of small) {
      if (s.high > f.high + tol || s.low < f.low - tol) return { found: false, name: '' };
      if (s.body > f.body * 0.5) return { found: false, name: '' };
    }
    if (small[2].close > small[0].close + tol) return { found: false, name: '' }; // дрейф ВНИЗ
    if (!this.precededByRally(candles.slice(0, -5))) return { found: false, name: '' };

    let name = 'ВОСХОДЯЩИЕ ТРИ МЕТОДА';
    if (VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  static isFallingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const small = candles.slice(candles.length - 4, candles.length - 1);
    const l = candles[candles.length - 1];
    if (!(f.isBearish && this.isLongRelative(f, this.relWindow(candles, candles.length - 5)))) {
      return { found: false, name: '' };
    }
    if (!(l.isBearish && this.isLongRelative(l, this.relWindow(candles, candles.length - 1)))) {
      return { found: false, name: '' };
    }
    if (l.close >= f.close) return { found: false, name: '' };
    const tol = this.adaptiveTol(candles.slice(0, -5), 0.15);
    for (const s of small) {
      if (s.high > f.high + tol || s.low < f.low - tol) return { found: false, name: '' };
      if (s.body > f.body * 0.5) return { found: false, name: '' };
    }
    if (small[2].close < small[0].close - tol) return { found: false, name: '' }; // дрейф ВВЕРХ
    if (!this.precededByDecline(candles.slice(0, -5))) return { found: false, name: '' };

    let name = 'НИСХОДЯЩИЕ ТРИ МЕТОДА';
    if (VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    return { found: true, name };
  }

  /**
   * ПРЕДПОЛОЖЕНИЕ (не описано в предоставленных главах Нисона): «лестничное дно» —
   * вспомогательная модель из справочников по свечам; вес понижен, приоритет не повышается.
   */
  static isLadderBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const [c1, c2, c3, c4, c5] = candles.slice(-5);
    if (!([c1, c2, c3].every((c) => c.isBearish))) return { found: false, name: '' };
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    if (!(c4.isBearish && c4.upperWick >= c4.totalRange * 0.3)) return { found: false, name: '' };
    if (!(c5.isBullish && c5.isLongCandle && c5.close > c4.high)) return { found: false, name: '' };
    if (!this.precededByDecline(candles.slice(0, -5))) return { found: false, name: '' };
    return { found: true, name: 'ЛЕСТНИЧНОЕ ДНО' };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 7: ГЭПОВЫЕ МОДЕЛИ (только фондовый рынок)                    *
   * ---------------------------------------------------------------- */
  static isGappingSideBySide(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c0 = candles[candles.length - 3];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    if (c0.isBearish && c1.open > c0.high && c1.isBullish && c2.isBullish) {
      if (
        Math.abs(c1.open - c2.open) / c1.open <= 0.005 &&
        Math.abs(c1.body - c2.body) <= Math.max(c1.body, c2.body) * 0.3
      ) {
        return { found: true, name: 'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ' };
      }
    }
    return { found: false, name: '' };
  }

  static isAbandonedBaby(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    if (!c2.isDoji) return { found: false, name: '' };
    if (c1.isBearish && c2.high < c1.low && c3.isBullish && c3.low > c2.high) {
      return { found: true, name: 'ПОКИНУТЫЙ МЛАДЕНЕЦ (НИЗ)' };
    }
    if (c1.isBullish && c2.low > c1.high && c3.isBearish && c3.high < c2.low) {
      return { found: true, name: 'ПОКИНУТЫЙ МЛАДЕНЕЦ (ВЕРХ)' };
    }
    return { found: false, name: '' };
  }

  static isTasuki(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    if (c1.isBullish && c2.isBullish && c2.open > c1.close && c3.isBearish && c1.close <= c3.close && c3.close <= c2.open) {
      return { found: true, name: 'ТАСУКИ ВОСХОДЯЩЕГО ГЭПА' };
    }
    if (c1.isBearish && c2.isBearish && c2.open < c1.close && c3.isBullish && c1.close >= c3.close && c3.close >= c2.open) {
      return { found: true, name: 'ТАСУКИ НИСХОДЯЩЕГО ГЭПА' };
    }
    return { found: false, name: '' };
  }

  static isGappingPlay(candles: Candle[]): { found: boolean; name: string } {
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 7) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-6, -1);
    // гл. 7: консолидация из узкотелых свечей (тело < 30% диапазона).
    if (!cons.every((c) => c.totalRange > 0 && c.body <= c.totalRange * 0.3)) return { found: false, name: '' };
    const consTop = Math.max(...cons.map((c) => c.high));
    const consBot = Math.min(...cons.map((c) => c.low));
    if (last.isBullish && last.open >= consTop) return { found: true, name: 'ГЭП НА МАКСИМУМАХ' };
    if (last.isBearish && last.open <= consBot) return { found: true, name: 'ГЭП НА МИНИМУМАХ' };
    return { found: false, name: '' };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 8/2: ДОДЖИ и «ВЫСОКАЯ ВОЛНА» — НЕ сигналы к сделке           *
   * ---------------------------------------------------------------- */
  static classifyDoji(candle: Candle): { found: boolean; name: string } {
    if (!candle.isDoji) return { found: false, name: '' };
    const r = candle.totalRange;
    if (r <= 0) return { found: false, name: '' };
    const longUpper = candle.upperWick > r * 0.4;
    const longLower = candle.lowerWick > r * 0.4;

    if (longLower && candle.upperWick < r * 0.1) return { found: true, name: 'ДОДЖИ-СТРЕКОЗА' };
    if (longUpper && candle.lowerWick < r * 0.1) return { found: true, name: 'НАДГРОБИЕ' };
    if (longUpper && longLower) {
      // ЯС гл. 8: длинноногая дожи; если открытие/закрытие в середине диапазона — «рикша».
      const mid = (candle.high + candle.low) / 2;
      const isRickshaw = Math.abs(candle.close - mid) <= r * 0.1;
      return { found: true, name: isRickshaw ? 'ДЛИННОНОГАЯ ДОДЖИ (РИКША)' : 'ДЛИННОНОГАЯ ДОДЖИ' };
    }
    return { found: true, name: 'ДОДЖИ' };
  }

  /** ЯС гл. 2 «Свечи „высокая волна“»: малое тело и очень длинные обе тени — «рынок потерял ориентацию». */
  static isHighWave(candle: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange <= 0) return { found: false, name: '' };
    if (candle.isDoji) return { found: false, name: '' }; // обрабатывается classifyDoji
    if (candle.body > candle.totalRange * 0.3) return { found: false, name: '' };
    if (!(candle.upperWick >= candle.totalRange * 0.3 && candle.lowerWick >= candle.totalRange * 0.3)) {
      return { found: false, name: '' };
    }
    if (!this.isSmallRelative(candle, prev.slice(-20))) return { found: false, name: '' };
    return { found: true, name: 'ВЫСОКАЯ ВОЛНА' };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 11: СПРУЖИНИВАНИЯ (spring / upthrust)                        *
   * ---------------------------------------------------------------- */
  static isSpring(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 25) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const base = Math.min(...candles.slice(-21, -1).map((c) => c.low));
    if (last.low < base && last.close > base && last.close > last.open) {
      return { found: true, name: 'СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)' };
    }
    return { found: false, name: '' };
  }

  static isUpthrust(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 25) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const top = Math.max(...candles.slice(-21, -1).map((c) => c.high));
    if (last.high > top && last.close < top && last.close < last.open) {
      return { found: true, name: 'ВЕРХНЕЕ СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ВЕРШИНЫ)' };
    }
    return { found: false, name: '' };
  }

  /* ---------------------------------------------------------------- *
   *  гл. 2/15: ОБЪЁМ — накопление/распределение, прорыв консолидации  *
   * ---------------------------------------------------------------- */
  static isVolSpin(candle: Candle, candles: Candle[]): { found: boolean; name: string } {
    const avg = VolumeAnalyzer.getAverageVolume(candles);
    if (!(avg > 0 && candle.volume > avg * 1.5)) return { found: false, name: '' };
    if (candle.totalRange <= 0 || candle.body > candle.totalRange * 0.3) return { found: false, name: '' };
    const seg = candles.slice(-20);
    const lo = Math.min(...seg.map((c) => c.low));
    const hi = Math.max(...seg.map((c) => c.high));
    if (hi <= lo) return { found: false, name: '' };
    const pos = (candle.close - lo) / (hi - lo);
    // гл. 2: малоподвижные цены + высокий объём у дна = накопление, у потолка = распределение.
    if (pos <= 0.3) return { found: true, name: 'НАКОПЛЕНИЕ' };
    if (pos >= 0.7) return { found: true, name: 'РАСПРЕДЕЛЕНИЕ' };
    return { found: false, name: '' };
  }

  static isConsolidationBreakout(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 7) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-5, -1);
    const small = cons.filter((c) => c.body <= c.totalRange * 0.5).length;
    if (small < 3) return { found: false, name: '' };
    const top = Math.max(...cons.map((c) => c.high));
    const bot = Math.min(...cons.map((c) => c.low));
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));
    const volOk = avg > 0 && last.volume > avg * 1.3;
    if (last.isBullish && last.isLongCandle && last.close > top && volOk) {
      return { found: true, name: 'ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)' };
    }
    if (last.isBearish && last.isLongCandle && last.close < bot && volOk) {
      return { found: true, name: 'ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)' };
    }
    return { found: false, name: '' };
  }

  /**
   * Ключевой разворот (ЯС глоссарий «день разворота»): сессия достигает нового
   * максимума/минимума, но закрывается выше/ниже ПРЕДЫДУЩЕЙ ЦЕНЫ ЗАКРЫТИЯ.
   * Закрытие за предыдущим экстремумом и высокий объём — усилители («выпуск пара», гл. 15).
   */
  static isKeyReversal(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 21) return { found: false, name: '' };
    const n = candles.length;
    const last = candles[n - 1];
    const prev = candles[n - 2];
    const seg = candles.slice(-21, -1);
    const lo = Math.min(...seg.map((c) => c.low));
    const hi = Math.max(...seg.map((c) => c.high));
    if (!this.isLongRelative(last, this.relWindow(candles, n - 1))) return { found: false, name: '' };

    const volumeOk = VolumeAnalyzer.isHighVolume(last, candles.slice(0, -1), 1.3);
    if (last.isBullish && last.low < lo && last.close > prev.close && this.precededByDecline(seg)) {
      let name = 'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)';
      if (last.close > prev.high) name += ' (ВНЕШНИЙ ДЕНЬ)';
      if (volumeOk) name += ' (ОБЪЁМ)';
      return { found: true, name };
    }
    if (last.isBearish && last.high > hi && last.close < prev.close && this.precededByRally(seg)) {
      let name = 'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)';
      if (last.close < prev.low) name += ' (ВНЕШНИЙ ДЕНЬ)';
      if (volumeOk) name += ' (ОБЪЁМ)';
      return { found: true, name };
    }
    return { found: false, name: '' };
  }

  /* ---------------------------------------------------------------- *
   *  Контекстные детекторы (не самостоятельные точки входа)           *
   * ---------------------------------------------------------------- */
  static isLevelTest(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 30) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(0, -1);
    const mid = (last.high + last.low) / 2;
    const closes = pre.map((c) => c.close);
    const m20 = ema(closes, 20);
    const m65 = ema(closes, 65);
    const m20Val = m20.length > 0 ? m20[m20.length - 1] : null;
    const m65Val = m65.length > 0 ? m65[m65.length - 1] : null;
    // ЯС гл. 13: скользящие средние (в т.ч. 65-дневная) работают как поддержка/сопротивление.
    const supHold =
      (m20Val !== null && last.low <= m20Val * 1.005 && last.close > m20Val) ||
      (m65Val !== null && last.low <= m65Val * 1.005 && last.close > m65Val) ||
      (ZoneVoter.isNearSupport(last.close, pre, 0.01, PATTERN_TF_KEY) && last.close > last.open);
    const resHold =
      (m20Val !== null && last.high >= m20Val * 0.995 && last.close < m20Val) ||
      (m65Val !== null && last.high >= m65Val * 0.995 && last.close < m65Val) ||
      (ZoneVoter.isNearResistance(last.close, pre, 0.01, PATTERN_TF_KEY) && last.close < last.open);

    if (supHold && (last.isBullish || last.close > mid)) return { found: true, name: 'ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)' };
    if (resHold && (last.isBearish || last.close < mid)) return { found: true, name: 'ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)' };
    return { found: false, name: '' };
  }

  /** ЯС гл. 2: длинные белые/чёрные тела в качестве поддержки/сопротивления при откатах. */
  static isTrendPullbackCandle(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 20) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(0, -1);
    if (last.totalRange <= 0 || last.body / last.totalRange < 0.6) return { found: false, name: '' };
    const pullbackWindow = pre.slice(-5);
    if (last.isBullish) {
      const pull = pullbackWindow[pullbackWindow.length - 1].close - pullbackWindow[0].close;
      if (pull >= 0) return { found: false, name: '' };
      if (last.close < Math.max(...pullbackWindow.map((c) => c.close))) return { found: false, name: '' };
      if (!this.precededByRally(pre.slice(0, -5))) return { found: false, name: '' };
      return { found: true, name: 'ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ' };
    }
    if (last.isBearish) {
      const pull = pullbackWindow[pullbackWindow.length - 1].close - pullbackWindow[0].close;
      if (pull <= 0) return { found: false, name: '' };
      if (last.close > Math.min(...pullbackWindow.map((c) => c.close))) return { found: false, name: '' };
      if (!this.precededByDecline(pre.slice(0, -5))) return { found: false, name: '' };
      return { found: true, name: 'ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ' };
    }
    return { found: false, name: '' };
  }
}
