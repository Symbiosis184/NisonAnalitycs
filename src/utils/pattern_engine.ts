import { Candle } from './candle';
import { ema } from './indicators';
import { ZoneVoter, timeframeKey, type TimeframeKey } from './zone_voter';
import { findSwings } from './levels';

/** Глубина окна свинг-детектора по временному масштабу (синхронно с ZONE_PARAMS в zone_voter). */
const SWING_SPAN_BY_TF: Record<TimeframeKey, number> = {
  scalp: 2, intraday: 3, swing: 3, position: 4,
};

export class SupportResistance {
  /**
   * FIX ТФ-аудита (канон Нисона, гл. 11): зоны на каждом ТФ должны быть СВОИ —
   * не только по толерансу кластеризации, но и по структуре экстремумов.
   * Окно свинга раньше было захардкожено (lookback=50, span по умолчанию),
   * из-за чего на 15-минутке уровни строились по более грубой структуре.
   * Теперь span зависит от масштаба: scalp=2, intraday/swing=3, position=4.
   */
  static findLevels(candles: Candle[], lookback: number = 50, tfKey: TimeframeKey = 'swing'): { support: number[]; resistance: number[] } {
    const swings = findSwings(candles, lookback, SWING_SPAN_BY_TF[tfKey]);
    const support = swings.filter(s => s.type === 'low').map(s => s.level);
    const resistance = swings.filter(s => s.type === 'high').map(s => s.level);
    return { support, resistance };
  }

  /**
   * Близость к зоне делегируется ZoneVoter — единому источнику истины об зонах
   * (гл. 11: уровень — это ЗОНА [level ± halfWidth], ширина привязана к ATR ТФ).
   * Собственный «процентный допуск» класса убран: он расходился с
   * каноном и зависел от переданного числа, а не от масштаба графика.
   */
  static isNearSupport(price: number, candles: Candle[], tfKey: TimeframeKey = 'swing', wickLow?: number): boolean {
    return ZoneVoter.isNearSupport(price, candles, undefined, tfKey, wickLow);
  }

  static isNearResistance(price: number, candles: Candle[], tfKey: TimeframeKey = 'swing', wickHigh?: number): boolean {
    return ZoneVoter.isNearResistance(price, candles, undefined, tfKey, wickHigh);
  }
}

export class VolumeAnalyzer {
  static getAverageVolume(candles: Candle[], period: number = 20): number {
    if (candles.length < period) return 0;
    const recent = candles.slice(-period);
    return recent.reduce((s, c) => s + c.volume, 0) / period;
  }
  
  static isHighVolume(candle: Candle, candles: Candle[], multiplier: number = 1.3): boolean {
    const prevCandles = candles.slice(0, -1);
    const avg = this.getAverageVolume(prevCandles);
    return avg > 0 && candle.volume > avg * multiplier;
  }
}

/**
* ТФ-контекст детектора (дефолт — 'D', чтобы существующие тесты не изменились).
* Нисон: уровень — это зона, а ширина зоны и толеранс зависят от таймфрейма.
* Без проброса ТФ молот на 15м проверялся бы «у поддержки» с дневным масштабом.
*/
let PATTERN_TF_KEY: TimeframeKey = 'swing';
/** Установить временнóй масштаб для всех проверок близости к зонам S/R. */
export function setPatternTimeframe(tf: string): void {
  PATTERN_TF_KEY = timeframeKey(tf);
}
/** Текущий ТФ-ключ детектора (для тестов/отладки). */
export function getPatternTimeframe(): TimeframeKey {
  return PATTERN_TF_KEY;
}

/**
 * Рыночный контекст: 'crypto' (по умолчанию) | 'stocks'.
 * Нисон писал преимущественно по акциям и фьючерсам, где гэпы — обычное явление.
 * Криптовалюты торгуются 24/7, поэтому разрывов между закрытием и следующим
 * открытием практически нет: чисто гэповые модели (гл. 7: гэп смежных белых,
 * тасуки гэповых направлений, гэп на максимумах/минимумах, покинутый младенец)
 * на крипте детектировать нельзя — они отключены до расширения дашборда до
 * акций. В звёздах/татнами гэп остаётся необязательным усилением для обоих
 * рынков (см. isMorningStar/isEveningStar/isMatHold).
 */
type MarketKind = 'crypto' | 'stocks';
let CURRENT_MARKET: MarketKind = 'crypto';
/** Переключить рынок (при добавлении акций вызвать setMarket('stocks')). */
export function setMarket(market: MarketKind): void {
  CURRENT_MARKET = market;
}
export function getMarket(): MarketKind {
  return CURRENT_MARKET;
}
/** Гэповые модели активны только для фондового рынка. */
function GAP_PATTERNS_ENABLED(): boolean {
  return CURRENT_MARKET === 'stocks';
}

export class PatternDetector {
  static getFormationBounds(patternName: string, candles: Candle[], endIdx: number) {
    if (endIdx < 0 || endIdx >= candles.length) {
      const c = candles[endIdx];
      return {
        patternCandlesCount: 1,
        patternStartIdx: endIdx,
        patternEndIdx: endIdx,
        patternLow: c.low,
        patternHigh: c.high
      };
    }
    
    const p = patternName.toUpperCase();
    
    // Звёзды (утренняя/вечерняя) — трёхсвечные формации, обрабатываются ниже
    if (['МОЛОТ', 'ПОВЕШЕННЫЙ', 'ДОДЖИ', 'СТРЕКОЗА', 'НАДГРОБИЕ', 'ПЕРЕВЁРНУТЫЙ МОЛОТ'].some(k => p.includes(k))) {
      const c = candles[endIdx];
      return {
        patternCandlesCount: 1,
        patternStartIdx: endIdx,
        patternEndIdx: endIdx,
        patternLow: c.low,
        patternHigh: c.high
      };
    }
    
    if (['ПОГЛОЩЕНИЕ', 'ЗАВЕСА', 'ПРОСВЕТ', 'ХАРАМИ', 'ПИНЦЕТ', 'ПОЯСА', 'КОНТРАТАКА', 'РАЗДЕЛЕНИЕ', 'ШЕИ', 'ТОЛЧОК'].some(k => p.includes(k))) {
      const startIdx = Math.max(0, endIdx - 1);
      const c1 = candles[startIdx];
      const c2 = candles[endIdx];
      return {
        patternCandlesCount: 2,
        patternStartIdx: startIdx,
        patternEndIdx: endIdx,
        patternLow: Math.min(c1.low, c2.low),
        patternHigh: Math.max(c1.high, c2.high)
      };
    }
    
    if (['СОЛДАТА', 'ВОРОНА', 'ЗВЕЗДА', 'ТАТАМИ', 'ТОЛЧОК'].some(k => p.includes(k))) {
      const startIdx = Math.max(0, endIdx - 2);
      const formationCandles = candles.slice(startIdx, endIdx + 1);
      return {
        patternCandlesCount: 3,
        patternStartIdx: startIdx,
        patternEndIdx: endIdx,
        patternLow: Math.min(...formationCandles.map(c => c.low)),
        patternHigh: Math.max(...formationCandles.map(c => c.high))
      };
    }
    
    const c = candles[endIdx];
    return {
      patternCandlesCount: 1,
      patternStartIdx: endIdx,
      patternEndIdx: endIdx,
      patternLow: c.low,
      patternHigh: c.high
    };
  }

  /**
   * Бычий контекст для молота/звезды по Нисону (гл. 4-5): свеча — часть
   * ЛОКАЛЬНОГО МИНИМУМА: её ДНО (low) — новый минимальный уровень окна ~8 свечей,
   * а закрытие ОТСКАКИВАЕТ от него вверх (не ниже середины диапазона).
   * Прежняя оценка «close в нижней трети» отвергалась самими же корректными
   * молотами: у них close как раз высоко после отскока (гл. 4: молот = отказ
   * у дна с возвратом покупателей).
   */
  private static atLocalLow(candle: Candle, prevCandles: Candle[]): boolean {
    if (prevCandles.length < 5) return true; // нехватка данных - не штрафуем
    const seg = [...prevCandles.slice(-8), candle];
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    if (hi <= lo) return true;
    // FIX канона (гл. 4): «локальное дно» — это ОТКАТ к нижней границе окна, а не обязанность
    // обновить абсолютный минимум (требование low == min отвергало молоты, которые
    // тестировали СУЩЕСТВУЮЩУЮ зону поддержки, не пробивая её — именно так Нисон
    // и описывает отказ: цена приходит к прежнему дну и отскакивает).
    const nearBottom = candle.low <= lo + (hi - lo) * 0.15;
    // FIX канона: молот сам рисует дно тенью, поэтому «дно окна» вычисляется
    // БЕЗ его low (иначе глубина тени сама растягивает окно и условие
    // nearBottom разрывается изнутри). Достаточно закрытия в верхней половине.
    const segNoSelf = prevCandles.slice(-8);
    const lo2 = Math.min(...segNoSelf.map(c => c.low));
    const hi2 = Math.max(...segNoSelf.map(c => c.high));
    const atPriorBottom = candle.low <= lo2 + (hi2 - lo2) * 0.35; // пришёл к прежнему дну
    // FIX (SOL/USDT 1H, молот 24.10 17:00 UTC): отказ от прежнего дна может быть
    // выполнен ТЕНЬЮ без обновления минимума — low свечи остаётся ВЫШЕ полосы
    // пред-окна (дно нарисовала предыдущая свеча). Канон (гл. 4): «приход к
    // прежнему дну» — это ОТКАТ в нижнюю часть окна, а не обязательное касание
    // его пола: значимо, что тень вернула цену в верх тела после пробоя вниз,
    // т.е. close/тело остались не глубже 35% окна ИЛИ тень вошла в полосу дна.
    const priorBand = lo2 + (hi2 - lo2) * 0.35;
    const bodyAtPriorBottom = Math.min(candle.open, candle.close) <= priorBand ||
                               candle.lowerWick >= candle.body * 2 && candle.low <= hi2;
    // FIX канона (гл. 4): тело молота расположено В ВЕРХНЕЙ части диапазона —
    // закрытие не ниже середины свечи (это же условие проверяется в isHammer).
    // Прежнее «bounced» сравнивало close с серединой ОКНА: при длинном нисходящем
    // сегменте оно отвергало корректные молоты, закрывшиеся у локального дна.
    const bodyInUpperHalf = candle.close >= (candle.high + candle.low) / 2;
    return (nearBottom || atPriorBottom || bodyAtPriorBottom) && bodyInUpperHalf;
  }

  /**
   * Медвежий аналог (гл. 4-5): вершина свечи — максимум окна, закрытие
   * откатилось вниз (падающая звезда/повешенный = отказ у потолка).
   */
  private static atLocalHigh(candle: Candle, prevCandles: Candle[]): boolean {
    if (prevCandles.length < 5) return true;
    const seg = [...prevCandles.slice(-8), candle];
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    if (hi <= lo) return true;
    // Зеркальный FIX: вершина = подход к потолку окна (не обязательный новый max).
    const nearTop = candle.high >= hi - (hi - lo) * 0.15;
    // FIX канона (гл. 4-5): тело звезды/повешенного — в НИЖНЕЙ части диапазона
    // (закрытие не выше середины самой свечи). Прежнее «rejected» сравнивало
    // close с серединой ОКНА и отвергало корректные звезды на растущем сегменте.
    const bodyInLowerHalf = candle.close <= (candle.high + candle.low) / 2;
    return nearTop && bodyInLowerHalf;
  }

  static isHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    // FIX канона (гл. 2/4): «малое тело» у Нисона — ОТНОСИТЕЛЬНО предыдущих свечей.
    // Корректная формулировка: тело молота мало по сравнению с телами ПРЕДШЕСТВУЮЩИХ
    // свечей тренда, но главное — само тело должно быть МАЛЫМ относительно ДИАПАЗОНА
    // свечи (проверка выше: ≤45%). Прежнее сравнение «body > avgBody(последних 10)»
    // ломало эталонную ситуацию Нисона: после серии микро-свечей (затишье/флэт)
    // любое нормальное малотелое тело отвергалось, хотя именно так и выглядит
    // молот, завершающий спокойное снижение.
    const avgBodyH = prevCandles.slice(-10).reduce((a, c) => a + c.body, 0) / Math.min(10, prevCandles.length || 1);
    if (avgBodyH > 0 && candle.body > Math.max(avgBodyH * 3, candle.totalRange * 0.45)) return { found: false, name: '' };
    // Канон (рис. 4.7): нижняя тень НЕ МЕНЕЕ двух тел; верхняя тень отсутствует
    // или несущественна; тело в ВЕРХНЕЙ части свечи.
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    // FIX канон-аудита: молот по Нисону — тело в ВЕРХНЕЙ части диапазона.
    // Прежнее условие (низ тела выше середины) отбрасывало классические бычьи
    // молоты; корректная проверка: close не ниже середины свечи.
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    // Молот - РАЗВОРОТНАЯ свеча: требует дна (локальный минимум + опора).
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    
    // ГЛАВНОЕ ПОДТВЕРЖДЕНИЕ ПО КАНОНУ (гл. 4): молот — это ОТКАЗ У ЗОНЫ ПОДДЕРЖКИ.
    // Тень сама по себе не сигнал; без опоры это просто длинная нижняя тень.
    // FIX канона: уровень тестируется ИМЕННО ТЕНЬЮ — передаём low свечи как
    // wick-касание (раньше проверка шла только по close/low КАК ЦЕНЕ, и молот,
    // чья тень вошла в зону при закрытии выше её края, не детектировался).
    const nearSupport = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.low) ||
                        ZoneVoter.isNearSupport(candle.low, prevCandles, 0.01, PATTERN_TF_KEY);
    if (!nearSupport) return { found: false, name: '' };
    // Объём/MA20 — дополнительные подтверждения (усиливают имя, но не заменяют зону).
    const volumeOk = VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3);
    const maOk = m20 !== null && Math.abs(candle.low - m20) <= m20 * 0.01;
    
    let name = 'МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (volumeOk) name += ' (ОБЪЁМ)'; else if (maOk) name += ' (MA20)';
    
    return { found: true, name };
  }

  static isImperfectHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.5) return { found: false, name: '' };
    // Канон (гл. 4): нижняя тень молота — не МЕНЬШЕ двух тел; тело в верхней части.
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.close < (candle.high + candle.low) / 2) return { found: false, name: '' };
    // Несовершенный молот (рис. 4.8-4.9) всё равно молот: только у дна.
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    
    // FIX канона: уровень тестируется тенью — low свечи как wick-касание.
    const nearSupport = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.low) ||
                        ZoneVoter.isNearSupport(candle.low, prevCandles, 0.01, PATTERN_TF_KEY);
    
    if (!nearSupport) return { found: false, name: '' };
    
    return { found: true, name: 'МОЛОТ (НЕСОВЕРШЕННЫЙ)' };
  }

  static isInvertedHammer(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    
    const closes = prevCandles.map(c => c.close);
    const m20Arr = ema(closes, 20);
    const m20 = m20Arr.length > 0 ? m20Arr[m20Arr.length - 1] : null;
    
    // FIX канона: уровень тестируется тенью — low свечи как wick-касание.
    const nearSupport = ZoneVoter.isNearSupport(candle.close, prevCandles, 0.01, PATTERN_TF_KEY, candle.low) ||
                        ZoneVoter.isNearSupport(candle.low, prevCandles, 0.01, PATTERN_TF_KEY);
    
    // Канон (гл. 5): верхняя тень не менее двух тел, нижняя несущественна,
    // тело в НИЖНЕЙ части свечи; свеча стоит у локального дна.
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > candle.bodyMid) return { found: false, name: '' };
    if (!this.atLocalLow(candle, prevCandles)) return { found: false, name: '' };
    // Без опоры это просто свеча с длинной верхней тенью, не сигнал Нисона.
    if (!nearSupport) return { found: false, name: '' };
    
    let name = 'ПЕРЕВЁРНУТЫЙ МОЛОТ';
    if (ZoneVoter.isNearSupport(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    
    return { found: true, name };
  }

  static isHangingMan(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.lowerWick < candle.body * 2) return { found: false, name: '' };
    if (candle.upperWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close < candle.bodyMid) return { found: false, name: '' };
    // Повешенный = форма молота, но на ВЕРШИНЕ роста (гл. 4). Вне вершины
    // это просто свеча с длинной тенью — по Нисону сигнала нет.
    if (!this.atLocalHigh(candle, prevCandles)) return { found: false, name: '' };
    
    let name = 'ПОВЕШЕННЫЙ';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    
    return { found: true, name };
  }

  static isShootingStar(candle: Candle, prevCandles: Candle[]): { found: boolean; name: string } {
    if (candle.totalRange === 0) return { found: false, name: '' };
    if (candle.body > candle.totalRange * 0.45) return { found: false, name: '' };
    if (candle.upperWick < candle.body * 2) return { found: false, name: '' };
    if (candle.lowerWick > candle.totalRange * 0.2) return { found: false, name: '' };
    if (candle.close > candle.bodyMid) return { found: false, name: '' };
    // Падающая звезда — разворот ПОСЛЕ РОСТА: требует локального максимума (гл. 5).
    if (!this.atLocalHigh(candle, prevCandles)) return { found: false, name: '' };
    
    let name = 'ПАДАЮЩАЯ ЗВЕЗДА';
    if (ZoneVoter.isNearResistance(candle.close, prevCandles, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(candle, prevCandles, 1.3)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

/** Контекст тренда по Нисону: разворотный сигнал действителен только после движения против него. */
  private static precededByDecline(prev: Candle[]): boolean {
    const seg = prev.slice(-6);
    if (seg.length < 3) return true; // нет истории — не блокируем
    const first = seg[0].close, last = seg[seg.length - 1].close;
    const lo = Math.min(...seg.map(c => c.low));
    return last <= first * 0.997 || last <= lo * 1.02;
  }

  private static precededByRally(prev: Candle[]): boolean {
    const seg = prev.slice(-6);
    if (seg.length < 3) return true;
    const first = seg[0].close, last = seg[seg.length - 1].close;
    const hi = Math.max(...seg.map(c => c.high));
    return last >= first * 1.003 || last >= hi * 0.98;
  }

  static isBullishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBullish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    // Канон (гл. 6): поглощение — РАЗВОРОТ после спада; вне спада это continuation-шум.
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    
    let name = 'БЫЧЬЕ ПОГЛОЩЕНИЕ';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isBearishEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish || c1.isDoji)) return { found: false, name: '' };
    if (!c2.isBearish || !c2.isEngulfing(c1)) return { found: false, name: '' };
    // Канон (гл. 6): медвежье поглощение — разворот ПОСЛЕ РОСТА.
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    
    let name = 'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    if (VolumeAnalyzer.isHighVolume(c2, prev, 1.5)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  /**
   * Свеча «на новом экстремуме окна» с АДАПТИВНЫМ допуском по Нисону:
   * фиксированные 0.1% одинаково бессмысленны на BTC-дневке и на волатильной
   * монете, поэтому допуск = max(0.1% цены, 0.25 × среднего диапазона окна).
   * Возвает true, если значение формирует дно/потолок предшествующего окна
   * (или касается его в пределах доли ATR — Нисон: уровень это зона, не линия).
   */
  private static makesNewExtreme(value: number, window: Candle[], isLow: boolean): boolean {
    if (window.length === 0) return true;
    const ref = isLow ? Math.min(...window.map(c => c.low)) : Math.max(...window.map(c => c.high));
    const avgRange = window.reduce((s, c) => s + (c.high - c.low), 0) / window.length;
    const tol = Math.max(ref * 0.001, avgRange * 0.25);
    return isLow ? value <= ref + tol : value >= ref - tol;
  }

  /**
   * Адаптивный критерий «длинной» свечи (FIX канон-аудита, гл. 2):
   * Нисон определяет long candle как заметно бо́льшую по отношению к ПРЕДШЕСТВУЮЩИМ
   * свечам, а не по абсолютной доле тела своего диапазона. Прежнее условие
   * body > 0.6×range отбрасывало настоящие длинные свечи с умеренными тенями
   * и принимало маленькие «болванки» на тихом рынке. Теперь: тело ≥ 1.5× медианы
   * тел предшествующего окна И ≥ 45% собственного диапазона.
   */
  private static isLongRelative(candle: Candle, window: Candle[]): boolean {
    if (window.length < 3) return candle.isLongCandle || candle.body > candle.totalRange * 0.45;
    const bodies = window.map(c => c.body).sort((a, b) => a - b);
    const med = bodies[Math.floor(bodies.length / 2)];
    return candle.body > candle.totalRange * 0.45 && med > 0 && candle.body >= med * 1.5;
  }

  /** Окно предшественников для относительной оценки длины (до 20 закрытых свечей). */
  private static relWindow(candles: Candle[], beforeIdx: number): Candle[] {
    return candles.slice(Math.max(0, beforeIdx - 20), beforeIdx);
  }

  /**
   * КАНОН Нисона (гл. 2/5): small body / star — это тело, МАЛОЕ ПО ОТНОШЕНИЮ
   * К ПРЕДШЕСТВУЮЩИМ свечам, а не обязательно к собственному диапазону
   * (звёзды с длинными тенями имеют тело <10% своего range, но доji-подобные
   * «короткие» свечи могут иметь тело 40–50% диапазона). Прежнее абсолютное
   * правило body < 0.3×range отбрасывало настоящие звёзды крипты. Теперь:
   * тело ≤ 40% медианы тел окна ИЛИ классическое узкотелое свечение.
   */
  private static isSmallRelative(candle: Candle, window: Candle[]): boolean {
    if (candle.isShortCandle || candle.isDoji) return true;
    if (window.length < 3) return false;
    const bodies = window.map(c => c.body).sort((a, b) => a - b);
    const med = bodies[Math.floor(bodies.length / 2)];
    return med > 0 && candle.body <= med * 0.4;
  }

  static isMorningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    const winMS = this.relWindow(candles, candles.length - 3);
    // FIX канон-аудита (гл. 5): утренняя звезда — разворот ПОСЛЕ СПАДА: закрытие
    // первой свечи обязано находиться в НИЖНЕЙ ТРЕТИ диапазона предшествующих
    // ~10 свечей (контекст задаёт сама первая свеча паттерна, а не окно до неё).
    const ctxMS = candles.slice(Math.max(0, candles.length - 13), candles.length - 2);
    if (ctxMS.length >= 4) {
      const ctxHi = Math.max(...ctxMS.map(x => x.high));
      const ctxLo = Math.min(...ctxMS.map(x => x.low));
      if (ctxHi > ctxLo && c1.close > ctxLo + (ctxHi - ctxLo) * 0.34) return { found: false, name: '' };
    }
    if (!(c1.isBearish && this.isLongRelative(c1, winMS))) return { found: false, name: '' };
    // FIX канона (гл. 2/5): «звезда» — малое тело ОТНОСИТЕЛЬНО предшествующих свечей.
    if (!this.isSmallRelative(c2, winMS)) return { found: false, name: '' };
    // FIX канон-аудита (гл. 5): третья свеча открывается ВЫШЕ закрытия второй
    // (гэп вверх от малой свечи — решимость покупателей с открытия) и закрывается
    // в верхней половине тела первой свечи; длина — относительная.
    if (!(c3.isBullish && this.isLongRelative(c3, winMS))) return { found: false, name: '' };
    if (c3.open <= c2.close) return { found: false, name: '' };
    if (c3.close <= c1.bodyMid) return { found: false, name: '' };
    // Канон (гл. 5): вторая свеча — small-свеча НИЖЕ тела первой (её ЗАКРЫТИЕ
    // под нижним уровнем медвежьей свечи — настоящий гэп по Нисону, рис. 5.1).
    // Допуск 0.3% диапазона первой: на крипте строгие гэпы редки (см. имя с ГЭПОМ).
    if (c2.close > c1.bodyBottom + c1.totalRange * 0.003) return { found: false, name: '' };
    
    // Утренняя звезда — разворот ПОСЛЕ СПАДА (гл. 5): минимум второй свечи —
    // новый локальный дно окна, а третья свеча закрывается ВЫШЕ середины первой
    // (уже проверено) и выше дна — покупатели вернули контроль.
    // FIX канон-аудита: допуск «нового дна» адаптивный (доля ATR), а не
    // фиксированные 0.1% — раньше на волатильных монетах паттерн не детектировался.
    {
      const seg = candles.slice(Math.max(0, candles.length - 11), candles.length - 2);
      if (!this.makesNewExtreme(c2.low, seg, true)) return { found: false, name: '' };
    }

    let name = c2.isDoji ? 'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА' : 'УТРЕННЯЯ ЗВЕЗДА';
    // Гэп по Нисону усиливает паттерн, но не является обязательным условием
    // (на крипте гэпы редки) — отмечаем его как доп. силу (FIX канон-аудита).
    // FIX канон-аудита: гэп Нисона измеряется по ТЕЛАМ/закрытиям, а не «open<close»
    // первой пары; теперь строгий гэп — часть условия, метка ставится по факту.
    if (c2.high < c1.bodyBottom) name += ' (ГЭП ВНИЗ)';
    else if (c3.open > c2.close) name += ' (ГЭП ВВЕРХ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isEveningStar(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    const winES = this.relWindow(candles, candles.length - 3);
    // FIX канон-аудита (гл. 5): вечерняя звезда — разворот ПОСЛЕ РОСТА: закрытие
    // первой белой свечи — в ВЕРХНЕЙ ТРЕТИ диапазона предшествующих ~10 свечей.
    const ctxES = candles.slice(Math.max(0, candles.length - 13), candles.length - 2);
    if (ctxES.length >= 4) {
      const ctxHi = Math.max(...ctxES.map(x => x.high));
      const ctxLo = Math.min(...ctxES.map(x => x.low));
      if (ctxHi > ctxLo && c1.close < ctxHi - (ctxHi - ctxLo) * 0.34) return { found: false, name: '' };
    }
    if (!(c1.isBullish && this.isLongRelative(c1, winES))) return { found: false, name: '' };
    // FIX канона (гл. 2/5): «звезда» — малое тело ОТНОСИТЕЛЬНО предшествующих свечей.
    if (!this.isSmallRelative(c2, winES)) return { found: false, name: '' };
    // FIX канон-аудита (гл. 5): зеркально утренней — третья открывается НИЖЕ
    // закрытия второй (гэп вниз), закрытие — в нижней половине тела первой свечи.
    if (!(c3.isBearish && this.isLongRelative(c3, winES))) return { found: false, name: '' };
    if (c3.open >= c2.close) return { found: false, name: '' };
    if (c3.close >= c1.bodyMid) return { found: false, name: '' };
    // Канон (гл. 5): вторая свеча — small-свеча ВЫШЕ тела первой (закрытие над
    // верхним уровнем белой свечи — гэп по Нисону, рис. 5.3), с тем же допуском.
    if (c2.close < c1.bodyTop - c1.totalRange * 0.003) return { found: false, name: '' };
    // Вечерняя звезда — разворот ПОСЛЕ РОСТА (гл. 5): максимум второй свечи —
    // новый локальный потолок окна, третья свеча уводит цену вниз от него.
    // FIX канон-аудита: адаптивный допуск потолка (см. makesNewExtreme).
    {
      const seg = candles.slice(Math.max(0, candles.length - 11), candles.length - 2);
      if (!this.makesNewExtreme(c2.high, seg, false)) return { found: false, name: '' };
    }
    
    let name = c2.isDoji ? 'ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА' : 'ВЕЧЕРНЯЯ ЗВЕЗДА';
    if (c2.low > c1.bodyTop) name += ' (ГЭП ВВЕРХ)';
    else if (c3.open < c2.close) name += ' (ГЭП ВНИЗ)';
    if (VolumeAnalyzer.isHighVolume(c3, candles.slice(0, -1), 1.3)) name += ' (ОБЪЁМ)';
    
    return { found: true, name };
  }

  static isThreeWhiteSoldiers(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    const winSW = this.relWindow(candles, candles.length - 3);
    if (!([c1, c2, c3].every(c => c.isBullish && (this.isLongRelative(c, winSW) || c.isLongCandle)))) return { found: false, name: '' };
    // FIX канон-аудита (гл. 7): солдаты — закрытие ВЫШЕ ЗАКРЫТИЯ предыдущей свечи
    // (не обязательно выше её ВЕРШИНЫ: высокие тени отвергали настоящих солдат),
    // верхние тени короткие (иначе это уже advance to a block).
    if ([c1, c2, c3].some(c => c.upperWick > c.totalRange * 0.3)) return { found: false, name: '' };
    // Каждое открытие — внутри предыдущего тела (без гэпа).
    if (!(c2.open >= c1.bodyBottom && c2.open <= c1.bodyTop)) return { found: false, name: '' };
    if (!(c3.open >= c2.bodyBottom && c3.open <= c2.bodyTop)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ БЕЛЫХ СОЛДАТА' };
  }

  static isThreeBlackCrows(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    const winBC = this.relWindow(candles, candles.length - 3);
    if (!([c1, c2, c3].every(c => c.isBearish && (this.isLongRelative(c, winBC) || c.isLongCandle)))) return { found: false, name: '' };
    // FIX канон-аудита (гл. 7): вороны — закрытие НИЖЕ ЗАКРЫТИЯ предыдущей свечи
    // (зеркальноSoldiers: требование «ниже минимума» отвергало настоящих воронов
    // с глубокими нижними тенями), нижние тени коротки.
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    if ([c1, c2, c3].some(c => c.lowerWick > c.totalRange * 0.3)) return { found: false, name: '' };
    // Открытия внутри предыдущих тел.
    if (!(c2.open >= c1.bodyBottom && c2.open <= c1.bodyTop)) return { found: false, name: '' };
    if (!(c3.open >= c2.bodyBottom && c3.open <= c2.bodyTop)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ ЧЁРНЫХ ВОРОНЫ' };
  }

  static classifyDoji(candle: Candle): { found: boolean; name: string } {
    if (!candle.isDoji) return { found: false, name: '' };
    
    if (candle.lowerWick > candle.totalRange * 0.4 && candle.upperWick < candle.totalRange * 0.1) {
      return { found: true, name: 'ДОДЖИ-СТРЕКОЗА' };
    }
    if (candle.upperWick > candle.totalRange * 0.4 && candle.lowerWick < candle.totalRange * 0.1) {
      return { found: true, name: 'НАДГРОБИЕ' };
    }
    return { found: true, name: 'ДОДЖИ' };
  }

  static isSpring(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 25) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    const base = Math.min(...candles.slice(-21, -1).map(c => c.low));
    
    if (last.low < base && last.close > base && last.close > last.open) {
      return { found: true, name: 'СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)' };
    }
    
    return { found: false, name: '' };
  }

  static isTowerTop(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    if (!(candles[candles.length - 2].isBullish && candles[candles.length - 3].isBullish)) return { found: false, name: '' };
    // Канон (гл. 7): башенная вершина — разворот ПОСЛЕ РОСТА: предшествующее
    // окно (~9 свечей до длинной медвежьей) должно расти к потолку.
    {
      const pre = candles.slice(Math.max(0, candles.length - 11), candles.length - 1);
      if (pre.length >= 3) {
        const hi = Math.max(...pre.map(c => c.high));
        const lo = Math.min(...pre.map(c => c.low));
        const lastPre = pre[pre.length - 1];
        if (!(lastPre.close >= lo + (hi - lo) * 0.6 && hi > lo)) return { found: false, name: '' };
      }
    }
    
    const last = candles[candles.length - 1];
    // FIX канон-аудита (гл. 7): финальная свеча башни — заметно крупнее предшественниц.
    if (!(last.isBearish && (this.isLongRelative(last, this.relWindow(candles, candles.length - 1)) || last.isLongCandle))) return { found: false, name: '' };
    if (last.close >= Math.min(candles[candles.length - 2].low, candles[candles.length - 3].low)) return { found: false, name: '' };
    
    return { found: true, name: 'БАШЕННАЯ ВЕРШИНА' };
  }

  static isTowerBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 6) return { found: false, name: '' };
    if (!(candles[candles.length - 2].isBearish && candles[candles.length - 3].isBearish)) return { found: false, name: '' };
    // Канон (гл. 7): башенное дно — разворот ПОСЛЕ ПАДЕНИЯ: окно до длинной
    // бычьей свечи должно снижаться ко дну.
    {
      const pre = candles.slice(Math.max(0, candles.length - 11), candles.length - 1);
      if (pre.length >= 3) {
        const hi = Math.max(...pre.map(c => c.high));
        const lo = Math.min(...pre.map(c => c.low));
        const lastPre = pre[pre.length - 1];
        if (!(lastPre.close <= lo + (hi - lo) * 0.4 && hi > lo)) return { found: false, name: '' };
      }
    }
    
    const last = candles[candles.length - 1];
    if (!(last.isBullish && (this.isLongRelative(last, this.relWindow(candles, candles.length - 1)) || last.isLongCandle))) return { found: false, name: '' };
    if (last.close <= Math.max(candles[candles.length - 2].high, candles[candles.length - 3].high)) return { found: false, name: '' };
    
    return { found: true, name: 'БАШЕННОЕ ДНО' };
  }

  static isThreeMountains(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const highs: number[] = [];
    
    for (let i = 2; i < seg.length - 2; i++) {
      if (seg[i].high > seg[i-1].high && seg[i].high > seg[i-2].high &&
          seg[i].high > seg[i+1].high && seg[i].high > seg[i+2].high) {
        highs.push(seg[i].high);
      }
    }
    
    if (highs.length < 3) return { found: false, name: '' };
    const h = highs.slice(-3);
    const top = Math.max(...h);
    // FIX канон-аудита (гл. 7): допуск выравнивания гор — доля ATR, не 1%.
    const avgR = seg.reduce((a, c) => a + (c.high - c.low), 0) / seg.length;
    const alignTol = Math.max(top * 0.001, avgR * 0.3);
    if (!h.every(x => Math.abs(x - top) <= alignTol)) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    if (!(last.isBearish && last.close < candles[candles.length - 2].close)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ ГОРЫ (ВЕРШИНА)' };
  }

  static isThreeRivers(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 12) return { found: false, name: '' };
    const seg = candles.length >= 40 ? candles.slice(-40) : candles;
    const lows: number[] = [];
    
    for (let i = 2; i < seg.length - 2; i++) {
      if (seg[i].low < seg[i-1].low && seg[i].low < seg[i-2].low &&
          seg[i].low < seg[i+1].low && seg[i].low < seg[i+2].low) {
        lows.push(seg[i].low);
      }
    }
    
    if (lows.length < 3) return { found: false, name: '' };
    const l = lows.slice(-3);
    const bot = Math.min(...l);
    const avgRr = seg.reduce((a, c) => a + (c.high - c.low), 0) / seg.length;
    const alignTolr = Math.max(bot * 0.001, avgRr * 0.3);
    if (!l.every(x => Math.abs(x - bot) <= alignTolr)) return { found: false, name: '' };
    
    const last = candles[candles.length - 1];
    if (!(last.isBullish && last.close > candles[candles.length - 2].close)) return { found: false, name: '' };
    
    return { found: true, name: 'ТРИ РЕКИ (ОСНОВАНИЕ)' };
  }

  static isHarami(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!c1.isLongCandle) return { found: false, name: '' };
    if (c2.body > c1.body * 0.4) return { found: false, name: '' };
    // Канон (гл. 6): малое тело целиком ВНУТРИ ТЕЛА первой свечи (не диапазона).
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };
    
    // Канон (гл. 6): харами — замедление тренда: бычий только после спада, медвежий после роста.
    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ' };
    
    return { found: false, name: '' };
  }

  static isHaramiCross(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!c1.isLongCandle || !c2.isDoji) return { found: false, name: '' };
    if (!(c2.bodyTop <= c1.bodyTop && c2.bodyBottom >= c1.bodyBottom)) return { found: false, name: '' };
    
    // Канон (гл. 6): харами-крест — замедление тренда; вне тренда это нейтральный доджи.
    if (c1.isBearish && this.precededByDecline(prev)) return { found: true, name: 'БЫЧИЙ ХАРАМИ-КРЕСТ' };
    if (c1.isBullish && this.precededByRally(prev)) return { found: true, name: 'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ' };
    
    return { found: false, name: '' };
  }

  static isTweezerBottom(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && c2.isBullish)) return { found: false, name: '' };
    // FIX канон-аудита (гл. 6): совпадение экстремумов — в пределах доли ATR,
    // а не фиксированных 0.4% цены (на волатильных монетах паттерн терялся).
    const tolB = Math.max(c1.low * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.15);
    if (Math.abs(c1.low - c2.low) > tolB) return { found: false, name: '' };
    // Пинцет-низ по Нисону — отказ на ОДНОМ уровне дважды: без зоны S это шум.
    if (!ZoneVoter.isNearSupport(c2.low, prev, 0.01, PATTERN_TF_KEY)) return { found: false, name: '' };
    
    return { found: true, name: 'ПИНЦЕТ (НИЗ)' };
  }

  static isTweezerTop(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish && c2.isBearish)) return { found: false, name: '' };
    const tolT = Math.max(c1.high * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.15);
    if (Math.abs(c1.high - c2.high) > tolT) return { found: false, name: '' };
    if (!ZoneVoter.isNearResistance(c2.high, prev, 0.01, PATTERN_TF_KEY)) return { found: false, name: '' };
    
    return { found: true, name: 'ПИНЦЕТ (ВЕРХ)' };
  }

  static isDarkCloudCover(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBullish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBearish && c2.isLongCandle)) return { found: false, name: '' };
    // Канон (гл. 6): разворот после роста — требуется восходящий контекст.
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    // FIX канон-аудита (гл. 6, Dark Cloud Cover): модель ГЭПОВАЯ — вторая свеча
    // открывается ВЫШЕ предыдущего закрытия (строго, без допуска вниз). Мягкий
    // допуск превращал любую красную свечу после роста в «завесу».
    if (c2.open <= c1.close) return { found: false, name: '' };
    if (c2.close >= c1.bodyMid || c2.close <= c1.open) return { found: false, name: '' };
    
    let name = 'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ';
    if (ZoneVoter.isNearResistance(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    
    return { found: true, name };
  }

  static isPiercingPattern(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBullish && c2.isLongCandle)) return { found: false, name: '' };
    // Канон (гл. 6): разворот после спада — требуется нисходящий контекст.
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    // FIX канон-аудита (гл. 6, Piercing Line / «Lightning at the Well»): модель
    // ГЭПОВАЯ — открытие НИЖЕ предыдущего закрытия (строго, без допуска). Без
    // гэпа у Нисона это лишь слабый сигнал; требование гэпа восстановлено по книге.
    if (c2.open >= c1.close) return { found: false, name: '' };
    if (c2.close <= c1.bodyMid || c2.close >= c1.open) return { found: false, name: '' };
    
    let name = 'ПРОСВЕТ В ОБЛАКАХ';
    if (ZoneVoter.isNearSupport(c2.close, prev, 0.015, PATTERN_TF_KEY)) name += ' (У ПОДДЕРЖКИ)';
    
    return { found: true, name };
  }

  static isBullishBelt(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c2.isBullish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.lowerWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (c2.open >= c1.close) return { found: false, name: '' };
    // Пояс — разворот после спада (гл. 6).
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    
    return { found: true, name: 'ЛИНИЯ ПОЯСА (БЫЧЬЯ)' };
  }

  static isBearishBelt(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    if (!(c2.isBearish && c2.isLongCandle)) return { found: false, name: '' };
    if (c2.upperWick > c2.totalRange * 0.05) return { found: false, name: '' };
    if (c2.open <= c1.close) return { found: false, name: '' };
    // Медвежий пояс — разворот после роста (гл. 6).
    if (!this.precededByRally(prev)) return { found: false, name: '' };
    
    return { found: true, name: 'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)' };
  }

  static isCounterattack(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    // Канон Нисона (гл. 6): контратака — ГЭПОВАЯ модель: обе свечи открываются
    // гэпом против тренда и закрываются на одном уровне. На крипте гэпов нет →
    // паттерн отключён (активен только для акций, см. setMarket). Совпадение
    // закрытий без встречных гэпов сигналом не является.
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    const closeTol = Math.max(c1.close * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.1);
    if (Math.abs(c1.close - c2.close) > closeTol) return { found: false, name: '' };
    if (!(c1.isLongCandle && c2.isLongCandle)) return { found: false, name: '' };
    const need = c1.totalRange * 0.5;
    const gap = c2.open - c1.close;
    
    // FIX канон-аудита (гл. 6): контратака — разворотная пауза ТРЕНДА: бычья
    // только после спада, медвежья только после роста; вне контекста это
    // случайное совпадение закрытий.
    if (c1.isBearish && c2.isBullish && gap <= -need && this.precededByDecline(prev)) {
      return { found: true, name: 'КОНТРАТАКА (БЫЧЬЯ)' };
    }
    if (c1.isBullish && c2.isBearish && gap >= need && this.precededByRally(prev)) {
      return { found: true, name: 'КОНТРАТАКА (МЕДВЕЖЬЯ)' };
    }
    
    return { found: false, name: '' };
  }

  static isSeparatingLines(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    // Канон (гл. 6): ОБЕ свечи одного направления, вторая открывается по открытию первой.
    if (Math.abs(c1.open - c2.open) > Math.max(c1.open * 0.001, ((c1.totalRange + c2.totalRange) / 2) * 0.1)) return { found: false, name: '' };
    const winSL = this.relWindow(prev, prev.length - 1);
    if (!(this.isLongRelative(c1, winSL) && this.isLongRelative(c2, [...winSL.slice(1), c1]))) return { found: false, name: '' };
    
    // FIX канон-аудита (гл. 6): разделение — продолжение СУЩЕСТВУЮЩЕГО тренда:
    // бычье после спада, медвежье после роста.
    if (c1.isBearish && c2.isBearish && c2.open <= c2.low + c2.totalRange * 0.05 && this.precededByDecline(prev)) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (БЫЧЬЕ)' };
    }
    if (c1.isBullish && c2.isBullish && c2.open >= c2.high - c2.totalRange * 0.05 && this.precededByRally(prev)) {
      return { found: true, name: 'РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)' };
    }
    
    return { found: false, name: '' };
  }

  static isNeckFamily(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    // FIX канон-аудита (гл. 6): «ниже шеи / на шее / толчок» — БЫЧЬИ модели
    // продолжения нисходящего тренда (медвежья длинная, затем бычья отскок-свеча).
    if (!this.precededByDecline(prev)) return { found: false, name: '' };
    if (!(c1.isBearish && c1.isLongCandle)) return { found: false, name: '' };
    if (!(c2.isBullish && c2.body <= c1.body * 0.5)) return { found: false, name: '' };
    
    const tol = c1.totalRange * 0.05;
    if (Math.abs(c2.close - c1.low) <= tol) {
      return { found: true, name: 'НИЖЕ ШЕИ' };
    }
    if (c1.bodyBottom - tol <= c2.close && c2.close <= c1.bodyBottom + tol) {
      return { found: true, name: 'НА ШЕЕ' };
    }
    if (c1.bodyBottom < c2.close && c2.close < c1.bodyMid) {
      return { found: true, name: 'ТОЛЧОК' };
    }
    
    return { found: false, name: '' };
  }

  static isDoubleThrustingBull(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 4) return { found: false, name: '' };
    
    for (let i = 0; i < 2; i++) {
      const a = candles[candles.length - 4 + i * 2];
      const b = candles[candles.length - 3 + i * 2];
      if (!(a.isBearish && b.isBullish && a.bodyBottom < b.close && b.close < a.bodyMid)) {
        return { found: false, name: '' };
      }
    }
    
    return { found: true, name: 'ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)' };
  }

  static isGappingSideBySide(candles: Candle[]): { found: boolean; name: string } {
    // Гэповые модели (гл. 7): на крипте гэпы практически отсутствуют (рынок 24/7),
    // поэтому включаются только при расширении дашборда до акций (market='stocks').
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 3) return { found: false, name: '' };
    const c0 = candles[candles.length - 3];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    
    // Канон (гл. 7): после медвежьей свечи ГЭП ВВЕРХ (открытие второй выше
    // МАКСИМУМА первой — разрыв по всему диапазону), две СХОДНЫЕ бычьи свечи.
    if (c0.isBearish && c1.open > c0.high && c1.isBullish && c2.isBullish) {
      if (Math.abs(c1.open - c2.open) / c1.open <= 0.005 && 
          Math.abs(c1.body - c2.body) <= Math.max(c1.body, c2.body) * 0.3) {
        return { found: true, name: 'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ' };
      }
    }
    
    return { found: false, name: '' };
  }

  static isRisingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const s1 = candles[candles.length - 4];
    const s2 = candles[candles.length - 3];
    const s3 = candles[candles.length - 2];
    const l = candles[candles.length - 1];
    
    if (!(f.isBullish && f.isLongCandle && l.isBullish && l.isLongCandle)) return { found: false, name: '' };
    if (l.close <= f.close) return { found: false, name: '' };
    
    // Канон (гл. 7): пауза — малые тела внутри диапазона первой с дрейфом вниз.
    for (const s of [s1, s2, s3]) {
      if (s.high > f.high || s.low < f.low || s.body > f.body * 0.5) {
        return { found: false, name: '' };
      }
    }
    if (s3.close > s1.close * 1.02) return { found: false, name: '' };
    
    if (!VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) return { found: false, name: '' };
    
    return { found: true, name: 'ВОСХОДЯЩИЕ ТРИ МЕТОДА' };
  }

  static isFallingThree(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const f = candles[candles.length - 5];
    const s1 = candles[candles.length - 4];
    const s2 = candles[candles.length - 3];
    const s3 = candles[candles.length - 2];
    const l = candles[candles.length - 1];
    
    if (!(f.isBearish && f.isLongCandle && l.isBearish && l.isLongCandle)) return { found: false, name: '' };
    if (l.close >= f.close) return { found: false, name: '' };
    
    // Канон (гл. 7): пауза с дрейфом вверх внутри диапазона первой медвежьей.
    for (const s of [s1, s2, s3]) {
      if (s.high > f.high || s.low < f.low || s.body > f.body * 0.5) {
        return { found: false, name: '' };
      }
    }
    if (s3.close < s1.close * 0.98) return { found: false, name: '' };
    
    if (!VolumeAnalyzer.isHighVolume(l, candles.slice(0, -1), 1.3)) return { found: false, name: '' };
    
    return { found: true, name: 'НИСХОДЯЩИЕ ТРИ МЕТОДА' };
  }

  static isMatHold(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const c0 = candles[candles.length - 5];
    const c1 = candles[candles.length - 4];
    const c2 = candles[candles.length - 3];
    const c3 = candles[candles.length - 2];
    const c4 = candles[candles.length - 1];
    
    if (!(c0.isBullish && c0.isLongCandle)) return { found: false, name: '' };
    if (!(c1.isBearish && c1.isShortCandle)) return { found: false, name: '' };
    
    // Канон (гл. 7): три малые свечи остаются ВНУТРИ ТЕЛА первой длинной свечи.
    for (const s of [c1, c2, c3]) {
      if (s.body > c0.body * 0.5) return { found: false, name: '' };
      if (s.bodyTop > c0.bodyTop || s.bodyBottom < c0.bodyBottom) return { found: false, name: '' };
    }
    
    if (!(c4.isBullish && c4.isLongCandle)) return { found: false, name: '' };
    if (c4.close <= Math.max(c1.high, c2.high, c3.high)) return { found: false, name: '' };
    
    return { found: true, name: 'УДЕРЖАНИЕ НА ТАТАМИ' };
  }

  static isLadderBottom(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 5) return { found: false, name: '' };
    const c1 = candles[candles.length - 5];
    const c2 = candles[candles.length - 4];
    const c3 = candles[candles.length - 3];
    const c4 = candles[candles.length - 2];
    const c5 = candles[candles.length - 1];
    
    if (!([c1, c2, c3].every(c => c.isBearish))) return { found: false, name: '' };
    if (!(c2.close < c1.close && c3.close < c2.close)) return { found: false, name: '' };
    if (!(c4.isBearish && c4.upperWick >= c4.totalRange * 0.3)) return { found: false, name: '' };
    if (!(c5.isBullish && c5.isLongCandle && c5.close > c4.high)) return { found: false, name: '' };
    
    return { found: true, name: 'ЛЕСТНИЧНОЕ ДНО' };
  }

  static isTwoCrows(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 3) return { found: false, name: '' };
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    if (!(c1.isBullish && (this.isLongRelative(c1, this.relWindow(candles, candles.length - 3)) || c1.isLongCandle))) return { found: false, name: '' };
    if (!(c2.isBearish && c3.isBearish)) return { found: false, name: '' };
    if (c2.open <= c1.close) return { found: false, name: '' };
    if (c2.close <= c1.close) return { found: false, name: '' };
    if (!(c3.open > c2.open && c3.close < c2.close && c3.close > c1.close)) return { found: false, name: '' };
    
    let name = 'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ';
    if (ZoneVoter.isNearResistance(c3.close, candles.slice(0, -3), 0.015, PATTERN_TF_KEY)) name += ' (У СОПРОТИВЛЕНИЯ)';
    
    return { found: true, name };
  }

  static isAbandonedBaby(candles: Candle[]): { found: boolean; name: string } {
    // Гэповая модель (гл. 7): на крипте отключена, активна только для акций.
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
    // Гэповые тасуки (гл. 7): на крипте отключены, активны только для акций.
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
    // Гэп на максимумах/минимумах (гл. 7): на крипте отключён, активен только для акций.
    if (!GAP_PATTERNS_ENABLED()) return { found: false, name: '' };
    if (candles.length < 7) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-6, -1);
    
    // Канон гл. 7: консолидация из узкотелых свечей (body < 30% диапазона).
    // Не полагаемся на isShortCandle (абсолютный порог тела) — фикстура с
    // микротелью должна проходить и при малом ATR серии.
    if (!cons.every(c => c.totalRange > 0 && c.body <= c.totalRange * 0.3)) return { found: false, name: '' };
    
    const consTop = Math.max(...cons.map(c => c.high));
    const consBot = Math.min(...cons.map(c => c.low));
    
    if (last.isBullish && last.open >= consTop) {
      return { found: true, name: 'ГЭП НА МАКСИМУМАХ' };
    }
    if (last.isBearish && last.open <= consBot) {
      return { found: true, name: 'ГЭП НА МИНИМУМАХ' };
    }
    
    return { found: false, name: '' };
  }

  static isConsolidationBreakout(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 7) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const cons = candles.slice(-5, -1);
    
    const small = cons.filter(c => c.body <= c.totalRange * 0.5).length;
    if (small < 3) return { found: false, name: '' };
    
    const top = Math.max(...cons.map(c => c.high));
    const bot = Math.min(...cons.map(c => c.low));
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

  static isKeyReversal(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 21) return { found: false, name: '' };
    const n = candles.length;
    const last = candles[n - 1];
    const prev = candles[candles.length - 2];
    const seg = candles.slice(-21, -1);
    
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    const avg = VolumeAnalyzer.getAverageVolume(candles.slice(0, -1));
    
    if (!(last.isLongCandle && avg > 0 && last.volume > avg * 1.3)) {
      return { found: false, name: '' };
    }
    
    // Канон (гл. 4, 7): бычий key reversal — новый ЛОКАЛЬНЫЙ МИНИМУМ (low ниже
    // min окна) и закрытие ВЫШЕ предыдущего максимума; медвежий — зеркально.
    // FIX канон-аудита: прежнее допущение ±5% от экстремума превращало паттерн
    // в «обычный день»; добавлены трендовый контекст и относительная длина свечи.
    const winKR = this.relWindow(candles, n - 1);
    if (!this.isLongRelative(last, winKR)) return { found: false, name: '' };
    if (last.isBullish && last.low < lo && last.close > prev.high && this.precededByDecline(seg)) {
      return { found: true, name: 'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)' };
    }
    if (last.isBearish && last.high > hi && last.close < prev.low && this.precededByRally(seg)) {
      return { found: true, name: 'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)' };
    }
    
    return { found: false, name: '' };
  }

  static isLastEngulfing(c1: Candle, c2: Candle, prev: Candle[]): { found: boolean; name: string } {
    const eng = c2.bodyTop >= c1.bodyTop && c2.bodyBottom <= c1.bodyBottom && c2.body > c1.body;
    if (!eng) return { found: false, name: '' };
    
    // FIX канон-аудита (гл. 6): у основания последняя атака ПОКУПАТЕЛЕЙ — т.е.
    // чёрная затем поглощающая БЕЛАЯ в нисходящем тренде; у вершины — наоборот.
    // Прежний код присваивал имена зеркально неверно и не требовал контекста.
    if (c1.isBearish && c2.isBullish && this.precededByDecline(prev)) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)' };
    }
    if (c1.isBullish && c2.isBearish && this.precededByRally(prev)) {
      return { found: true, name: 'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)' };
    }
    
    return { found: false, name: '' };
  }

  static isVolSpin(candle: Candle, candles: Candle[]): { found: boolean; name: string } {
    const avg = VolumeAnalyzer.getAverageVolume(candles);
    if (!(avg > 0 && candle.volume > avg * 1.5)) return { found: false, name: '' };
    if (candle.totalRange <= 0 || candle.body > candle.totalRange * 0.3) return { found: false, name: '' };
    
    const seg = candles.slice(-20);
    const lo = Math.min(...seg.map(c => c.low));
    const hi = Math.max(...seg.map(c => c.high));
    if (hi <= lo) return { found: false, name: '' };
    
    const pos = (candle.close - lo) / (hi - lo);
    if (pos <= 0.3) return { found: true, name: 'НАКОПЛЕНИЕ' };
    if (pos >= 0.7) return { found: true, name: 'РАСПРЕДЕЛЕНИЕ' };
    
    return { found: false, name: '' };
  }

  static isLevelTest(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 30) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(0, -1);
    const mid = (last.high + last.low) / 2;
    
    const closes = pre.map(c => c.close);
    const m20 = ema(closes, 20);
    const m65 = ema(closes, 65);
    const m20Val = m20.length > 0 ? m20[m20.length - 1] : null;
    const m65Val = m65.length > 0 ? m65[m65.length - 1] : null;
    
    const supHold = (m20Val !== null && last.low <= m20Val * 1.005 && last.close > m20Val) ||
                    (m65Val !== null && last.low <= m65Val * 1.005 && last.close > m65Val) ||
                    (ZoneVoter.isNearSupport(last.close, pre, 0.01, PATTERN_TF_KEY) && last.close > last.open);
    
    const resHold = (m20Val !== null && last.high >= m20Val * 0.995 && last.close < m20Val) ||
                    (m65Val !== null && last.high >= m65Val * 0.995 && last.close < m65Val) ||
                    (ZoneVoter.isNearResistance(last.close, pre, 0.01, PATTERN_TF_KEY) && last.close < last.open);
    
    if (supHold && (last.isBullish || last.close > mid)) {
      return { found: true, name: 'ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)' };
    }
    if (resHold && (last.isBearish || last.close < mid)) {
      return { found: true, name: 'ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)' };
    }
    
    return { found: false, name: '' };
  }

  static isTrendPullbackCandle(candles: Candle[]): { found: boolean; name: string } {
    if (candles.length < 20) return { found: false, name: '' };
    const last = candles[candles.length - 1];
    const pre = candles.slice(0, -1);
    
    const bodyRatio = last.body / last.totalRange;
    if (bodyRatio < 0.6) return { found: false, name: '' };
    
    const pullbackWindow = pre.slice(-5);
    
    if (last.isBullish) {
      const pull = pullbackWindow[pullbackWindow.length - 1].close - pullbackWindow[0].close;
      if (pull >= 0) return { found: false, name: '' };
      if (last.close < Math.max(...pullbackWindow.map(c => c.close))) {
        return { found: false, name: '' };
      }
      return { found: true, name: 'ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ' };
    }
    
    if (last.isBearish) {
      const pull = pullbackWindow[pullbackWindow.length - 1].close - pullbackWindow[0].close;
      if (pull <= 0) return { found: false, name: '' };
      if (last.close > Math.min(...pullbackWindow.map(c => c.close))) {
        return { found: false, name: '' };
      }
      return { found: true, name: 'ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ' };
    }
    
    return { found: false, name: '' };
  }
}
