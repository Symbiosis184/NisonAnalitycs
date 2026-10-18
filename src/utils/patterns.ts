import { Candle } from './candle';
import { PatternDetector, SupportResistance, setPatternTimeframe } from './pattern_engine';
import { ZoneVoter, timeframeKey } from './zone_voter';

export interface PatternResult {
  name: string;
  type: 'бычий' | 'медвежий' | 'нейтральный';
  candleIndex: number;
  confidence: number;
  confirmed: boolean;
  hasVolume: boolean;
  atLevel: boolean;
}

/**
 * Окно отображения паттернов (последние N свечей). Раньше движок возвращал
 * максимум 10 паттернов, отсортированных по уверенности ПО ВСЕЙ истории —
 * из-за на графике «пропадали» свежие формации (старые срабатывания имели
 * больше шансов накопить бонусы объёма/уровня) и возникало ощущение ложных
 * меток в прошлом. Теперь: сначала отсекаем глубокую историю, затем
 * ранжируем по свежести → подтверждению → уверенности.
 */
export const PATTERN_DISPLAY_WINDOW = 80;

/** Сортировка для отображения: свежие → подтверждённые → уверенные. */
export function sortPatternsForDisplay<T extends { candleIndex: number; confirmed: boolean; confidence: number }>(
  patterns: T[],
  totalCandles: number,
): T[] {
  return [...patterns]
    .filter(p => p.candleIndex >= totalCandles - PATTERN_DISPLAY_WINDOW)
    .sort(
      (a, b) =>
        b.candleIndex - a.candleIndex ||
        Number(b.confirmed) - Number(a.confirmed) ||
        b.confidence - a.confidence,
    );
}

export function detectPatterns(candles: Candle[], timeframe: string = 'D'): PatternResult[] {
  try {
  // ТФ-калибровка зон: вся цепочка isNearSupport/isNearResistance внутри детекторов
  // будет использовать параметры масштаба выбранного интервала.
  setPatternTimeframe(timeframe);
  const patterns: PatternResult[] = [];
  
  // По Нисону: проверяем все свечи, а не только последние 20
  // Паттерн должен быть подтверждён следующей свечой
  for (let i = 1; i < candles.length - 1; i++) {
    const candle = candles[i];
    const prev = candles.slice(0, i);
    const next = candles[i + 1]; // Следующая свеча для подтверждения
    
    const checks: Array<{ found: boolean; name: string; type: 'бычий' | 'медвежий' | 'нейтральный'; patternCandles: number }> = [];
    
    // Односвечные
    const hammer = PatternDetector.isHammer(candle, prev);
    if (hammer.found) checks.push({ ...hammer, patternCandles: 1, type: 'бычий' });
    
    const imperfectHammer = PatternDetector.isImperfectHammer(candle, prev);
    if (imperfectHammer.found) checks.push({ ...imperfectHammer, patternCandles: 1, type: 'бычий' });
    
    const invertedHammer = PatternDetector.isInvertedHammer(candle, prev);
    if (invertedHammer.found) checks.push({ ...invertedHammer, patternCandles: 1, type: 'бычий' });
    
    const hangingMan = PatternDetector.isHangingMan(candle, prev);
    if (hangingMan.found) checks.push({ ...hangingMan, patternCandles: 1, type: 'медвежий' });
    
    const shootingStar = PatternDetector.isShootingStar(candle, prev);
    if (shootingStar.found) checks.push({ ...shootingStar, patternCandles: 1, type: 'медвежий' });
    
    const doji = PatternDetector.classifyDoji(candle);
    if (doji.found) checks.push({ ...doji, patternCandles: 1, type: 'нейтральный' });
    
    const spring = PatternDetector.isSpring(candles.slice(0, i + 1));
    if (spring.found) checks.push({ ...spring, patternCandles: 1, type: 'бычий' });
    
    // Двухсвечные
    if (i > 0) {
      const c1 = candles[i - 1];
      
      const bullishEngulfing = PatternDetector.isBullishEngulfing(c1, candle, prev);
      if (bullishEngulfing.found) checks.push({ ...bullishEngulfing, patternCandles: 2, type: 'бычий' });
      
      const bearishEngulfing = PatternDetector.isBearishEngulfing(c1, candle, prev);
      if (bearishEngulfing.found) checks.push({ ...bearishEngulfing, patternCandles: 2, type: 'медвежий' });
      
      const harami = PatternDetector.isHarami(c1, candle, prev);
      if (harami.found) {
        const type = harami.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
        checks.push({ ...harami, patternCandles: 2, type });
      }
      
      const haramiCross = PatternDetector.isHaramiCross(c1, candle, prev);
      if (haramiCross.found) {
        const type = haramiCross.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
        checks.push({ ...haramiCross, patternCandles: 2, type });
      }
      
      const tweezerBottom = PatternDetector.isTweezerBottom(c1, candle, prev);
      if (tweezerBottom.found) checks.push({ ...tweezerBottom, patternCandles: 2, type: 'бычий' });
      
      const tweezerTop = PatternDetector.isTweezerTop(c1, candle, prev);
      if (tweezerTop.found) checks.push({ ...tweezerTop, patternCandles: 2, type: 'медвежий' });
      
      const darkCloud = PatternDetector.isDarkCloudCover(c1, candle, prev);
      if (darkCloud.found) checks.push({ ...darkCloud, patternCandles: 2, type: 'медвежий' });
      
      const piercing = PatternDetector.isPiercingPattern(c1, candle, prev);
      if (piercing.found) checks.push({ ...piercing, patternCandles: 2, type: 'бычий' });
      
      const bullishBelt = PatternDetector.isBullishBelt(c1, candle, prev);
      if (bullishBelt.found) checks.push({ ...bullishBelt, patternCandles: 2, type: 'бычий' });
      
      const bearishBelt = PatternDetector.isBearishBelt(c1, candle, prev);
      if (bearishBelt.found) checks.push({ ...bearishBelt, patternCandles: 2, type: 'медвежий' });
      
      const counterattack = PatternDetector.isCounterattack(c1, candle, prev);
      if (counterattack.found) {
        const type = counterattack.name.includes('БЫЧЬЯ') ? 'бычий' : 'медвежий';
        checks.push({ ...counterattack, patternCandles: 2, type });
      }
      
      const separating = PatternDetector.isSeparatingLines(c1, candle, prev);
      if (separating.found) {
        const type = separating.name.includes('БЫЧЬЕ') ? 'бычий' : 'медвежий';
        checks.push({ ...separating, patternCandles: 2, type });
      }
      
      // FIX канон-аудита (гл. 6): «ниже шеи / на шее / толчок» — БЫЧЬИ модели
      // продолжения после спада; прежняя маркировка «медвежий» противоречила Нисону.
      const neck = PatternDetector.isNeckFamily(c1, candle, prev);
      if (neck.found) checks.push({ ...neck, patternCandles: 2, type: 'бычий' });
    }
    
    // Трёхсвечные
    if (i >= 2) {
      const morningStar = PatternDetector.isMorningStar(candles.slice(0, i + 1));
      if (morningStar.found) checks.push({ ...morningStar, patternCandles: 3, type: 'бычий' });
      
      const eveningStar = PatternDetector.isEveningStar(candles.slice(0, i + 1));
      if (eveningStar.found) checks.push({ ...eveningStar, patternCandles: 3, type: 'медвежий' });
      
      const threeWhite = PatternDetector.isThreeWhiteSoldiers(candles.slice(0, i + 1));
      if (threeWhite.found) checks.push({ ...threeWhite, patternCandles: 3, type: 'бычий' });
      
      const threeBlack = PatternDetector.isThreeBlackCrows(candles.slice(0, i + 1));
      if (threeBlack.found) checks.push({ ...threeBlack, patternCandles: 3, type: 'медвежий' });
      
      const towerTop = PatternDetector.isTowerTop(candles.slice(0, i + 1));
      if (towerTop.found) checks.push({ ...towerTop, patternCandles: 3, type: 'медвежий' });
      
      const towerBottom = PatternDetector.isTowerBottom(candles.slice(0, i + 1));
      if (towerBottom.found) checks.push({ ...towerBottom, patternCandles: 3, type: 'бычий' });
      
      const threeMountains = PatternDetector.isThreeMountains(candles.slice(0, i + 1));
      if (threeMountains.found) checks.push({ ...threeMountains, patternCandles: 3, type: 'медвежий' });
      
      const threeRivers = PatternDetector.isThreeRivers(candles.slice(0, i + 1));
      if (threeRivers.found) checks.push({ ...threeRivers, patternCandles: 3, type: 'бычий' });
      
      const twoCrows = PatternDetector.isTwoCrows(candles.slice(0, i + 1));
      if (twoCrows.found) checks.push({ ...twoCrows, patternCandles: 3, type: 'медвежий' });
      
      const abandonedBaby = PatternDetector.isAbandonedBaby(candles.slice(0, i + 1));
      if (abandonedBaby.found) {
        const type = abandonedBaby.name.includes('НИЗ') ? 'бычий' : 'медвежий';
        checks.push({ ...abandonedBaby, patternCandles: 3, type });
      }
      
      const tasuki = PatternDetector.isTasuki(candles.slice(0, i + 1));
      if (tasuki.found) {
        const type = tasuki.name.includes('ВОСХОДЯЩЕГО') ? 'бычий' : 'медвежий';
        checks.push({ ...tasuki, patternCandles: 3, type });
      }
      
      const doubleThrusting = PatternDetector.isDoubleThrustingBull(candles.slice(0, i + 1));
      if (doubleThrusting.found) checks.push({ ...doubleThrusting, patternCandles: 3, type: 'бычий' });
      
      const gappingSideBySide = PatternDetector.isGappingSideBySide(candles.slice(0, i + 1));
      if (gappingSideBySide.found) checks.push({ ...gappingSideBySide, patternCandles: 3, type: 'бычий' });
    }
    
    // Пятисвечные
    if (i >= 4) {
      const risingThree = PatternDetector.isRisingThree(candles.slice(0, i + 1));
      if (risingThree.found) checks.push({ ...risingThree, patternCandles: 5, type: 'бычий' });
      
      const fallingThree = PatternDetector.isFallingThree(candles.slice(0, i + 1));
      if (fallingThree.found) checks.push({ ...fallingThree, patternCandles: 5, type: 'медвежий' });
      
      const matHold = PatternDetector.isMatHold(candles.slice(0, i + 1));
      if (matHold.found) checks.push({ ...matHold, patternCandles: 5, type: 'бычий' });
      
      const ladderBottom = PatternDetector.isLadderBottom(candles.slice(0, i + 1));
      if (ladderBottom.found) checks.push({ ...ladderBottom, patternCandles: 5, type: 'бычий' });
    }
    
    // Шестисвечные
    if (i >= 5) {
      const gappingPlay = PatternDetector.isGappingPlay(candles.slice(0, i + 1));
      if (gappingPlay.found) {
        const type = gappingPlay.name.includes('МАКСИМУМАХ') ? 'бычий' : 'медвежий';
        checks.push({ ...gappingPlay, patternCandles: 6, type });
      }
    }
    
    // Специальные паттерны
    const consolidationBreakout = PatternDetector.isConsolidationBreakout(candles.slice(0, i + 1));
    if (consolidationBreakout.found) {
      const type = consolidationBreakout.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
      checks.push({ ...consolidationBreakout, patternCandles: 1, type });
    }
    
    const keyReversal = PatternDetector.isKeyReversal(candles.slice(0, i + 1));
    if (keyReversal.found) {
      const type = keyReversal.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
      checks.push({ ...keyReversal, patternCandles: 1, type });
    }
    
    const lastEngulfing = PatternDetector.isLastEngulfing(
      i > 0 ? candles[i - 1] : candle,
      candle,
      prev
    );
    if (lastEngulfing.found) {
      const type = lastEngulfing.name.includes('ОСНОВАНИЕ') ? 'бычий' : 'медвежий';
      checks.push({ ...lastEngulfing, patternCandles: 2, type });
    }
    
    const volSpin = PatternDetector.isVolSpin(candle, candles.slice(0, i + 1));
    if (volSpin.found) {
      const type = volSpin.name.includes('НАКОПЛЕНИЕ') ? 'бычий' : 'медвежий';
      checks.push({ ...volSpin, patternCandles: 1, type });
    }
    
    const levelTest = PatternDetector.isLevelTest(candles.slice(0, i + 1));
    if (levelTest.found) {
      const type = levelTest.name.includes('БЫЧИЙ') ? 'бычий' : 'медвежий';
      checks.push({ ...levelTest, patternCandles: 1, type });
    }
    
    const trendPullback = PatternDetector.isTrendPullbackCandle(candles.slice(0, i + 1));
    if (trendPullback.found) {
      const type = trendPullback.name.includes('БЕЛАЯ') ? 'бычий' : 'медвежий';
      checks.push({ ...trendPullback, patternCandles: 1, type });
    }
    
    // Обработка найденных паттернов
    for (const check of checks) {
      const patternStartIdx = i - check.patternCandles + 1;
      const patternEndIdx = i;
      const lastPatternCandle = candles[patternEndIdx]; // Последняя свеча паттерна
      
      // Защита от отрицательного индекса
      const safeStartIdx = Math.max(0, patternStartIdx);
      
      // Подтверждение по Нисону: следующая свеча должна закрыть выше максимума (для бычьих)
      // или ниже минимума (для медвежьих) ВСЕГО паттерна
      const patternHigh = Math.max(...candles.slice(safeStartIdx, patternEndIdx + 1).map(c => c.high));
      const patternLow = Math.min(...candles.slice(safeStartIdx, patternEndIdx + 1).map(c => c.low));
      
      const confirmed = next ? (
        check.type === 'бычий' ? next.isBullish && next.close > patternHigh :
        check.type === 'медвежий' ? next.isBearish && next.close < patternLow :
        false
      ) : false;
      
      // Правильный расчёт среднего объёма с защитой от деления на ноль
      const volumePeriod = Math.min(20, prev.length);
      const hasVolume = volumePeriod > 0 && candle.volume > (prev.slice(-volumePeriod).reduce((s, c) => s + c.volume, 0) / volumePeriod) * 1.3;
      
      let confidence = 50;
      if (check.patternCandles === 3) confidence = 65;
      else if (check.patternCandles === 2 && check.name.includes('ПОГЛОЩЕНИЕ')) confidence = 62;
      else if (check.name.includes('ЗВЕЗДА')) confidence = 63;
      
      // Проверка близости к уровню поддержки/сопротивления
      const atLevel = check.type === 'бычий' 
        ? ZoneVoter.isNearSupport(candle.close, prev, 0.015, timeframeKey(timeframe))
        : check.type === 'медвежий'
        ? ZoneVoter.isNearResistance(candle.close, prev, 0.015, timeframeKey(timeframe))
        : false;
      
      if (confirmed) confidence += 15;
      if (hasVolume) confidence += 8;
      if (atLevel) confidence += 7;
      if (check.name.includes('ОБЪЁМ')) confidence += 5;
      if (check.name.includes('ПОДДЕРЖКИ') || check.name.includes('СОПРОТИВЛЕНИЯ')) confidence += 5;
      
      confidence = Math.min(92, confidence);
      
      patterns.push({
        name: check.name,
        type: check.type,
        candleIndex: i,
        confidence,
        confirmed,
        hasVolume,
        atLevel,
      });
    }
  }
  
  const unique = patterns.filter((p, idx, arr) => 
    arr.findIndex(x => x.name === p.name && x.candleIndex === p.candleIndex) === idx
  );
  
  // FIX (жалоба «не все паттерны отображаются»): раньше бралось 10 лучших по
  // уверенности ПО ВСЕЙ истории — свежие формации вытеснялись старыми с
  // накопленными бонусами объёма/уровня. Теперь: окно последних свечей +
  // ранжирование по свежести → подтверждению → уверенности, лимит 24.
  const filtered = unique.filter(p => p.confidence >= 55);

  return sortPatternsForDisplay(filtered, candles.length).slice(0, 24);
  } finally {
    // Не оставляем глобальный ТФ-контекст «загрязнённым»: прямые вызовы
    // PatternDetector.isXxx вне detectPatterns должны видеть нейтральный дефолт.
    setPatternTimeframe('D');
  }
}

export function patternStory(pattern: string): string {
  const p = pattern.toUpperCase();
  
  if (p.includes('ДЛИННАЯ') && p.includes('ОТКАТЕ')) {
    return 'Длинная свеча на откате в тренде: после локального отката покупатели (продавцы) вернули инициативу одним сильным движением; вход по направлению тренда (гл. 4).';
  }
  if (p.includes('ТЕСТ ПОДДЕРЖКИ') || p.includes('ТЕСТ СОПРОТИВЛЕНИЯ')) {
    return 'Тест уровня в тренде: свеча коснулась MA/зоны тенью и закрылась в пользу тренда — уровень защищён покупателями (продавцами); классическая точка входа по Нисону на откате (гл. 11, 13).';
  }
  if (p.includes('КЛЮЧЕВОЙ РАЗВОРОТ')) {
    return 'Ключевой разворотный день: длинная свеча на повышенном объёме закрылась за экстремум предыдущей у границы диапазона — базовый сигнал начала тренда, когда молот и поглощение не сформировались (гл. 4, 15).';
  }
  if (p.includes('СПРУЖИНИВАНИЕ')) {
    return 'Ложный пробой минимума с возвратом внутрь диапазона: продавцы не удержали новые минимумы — бычий сигнал из зоны «ва» (гл. 11).';
  }
  if (p.includes('ПРОРЫВ КОНСОЛИДАЦИИ')) {
    return 'Зона «ва» прорвана длинной свечой на повышенном объёме: после передышки инициатива перешла к прорвавшей стороне — сигнал продолжения в направлении прорыва (гл. 7).';
  }
  if (p.includes('ПЕРЕВЁРНУТЫЙ МОЛОТ')) {
    return 'Малое тело внизу и длинная верхняя тень после снижения: медведи не удержали минимумы, ждём бычьего подтверждения (гл. 5).';
  }
  if (p.includes('НЕСОВЕРШЕННЫЙ')) {
    return 'Несовершенный молот (тело больше идеального, тень короче): по Нисону (рис. 4.8–4.9) такая свеча работает как разворотная, если есть опора (зона, объём, MA) и подтверждение следующей свечой.';
  }
  if (p.includes('МОЛОТ')) {
    return 'Длинная нижняя тень и малое тело у верха диапазона: продавцов выкупили к закрытию — попытка нащупать дно (гл. 4).';
  }
  if (p.includes('ПОВЕШЕННЫЙ')) {
    return 'Та же форма, но в росте: рынок уязвим к атакам продавцов, нужно подтверждение (гл. 4).';
  }
  if (p.includes('ПАДАЮЩАЯ ЗВЕЗДА')) {
    return 'Попытка штурма высот не удалась: цена вернулась к открытию после взлёта — быки истощены (гл. 5).';
  }
  if (p.includes('ПОГЛОЩЕНИЕ')) {
    return 'Второе тело полностью перекрыло первое: инициатива перешла к новой стороне (гл. 4).';
  }
  if (p.includes('ЗАВЕСА')) {
    return 'Открытие выше максимума и закрытие ниже середины белого тела: быки потеряли контроль (гл. 4).';
  }
  if (p.includes('ПРОСВЕТ')) {
    return 'Белая свеча перекрыла больше половины чёрной после гэпа вниз: давление продавцов ослабло (гл. 4).';
  }
  if (p.includes('ЗВЕЗДА')) {
    return 'Малое тело после длинной свечи — равновесие сил; третья свеча подтверждает разворот (гл. 5).';
  }
  if (p.includes('ХАРАМИ')) {
    return 'Пауза тренда: малое тело внутри длинного — перемирие быков и медведей (гл. 6).';
  }
  if (p.includes('ДОДЖИ')) {
    return 'Открытие и закрытие совпали: нерешительность; на вершине после длинной белой свечи особенно опасна (гл. 8).';
  }
  if (p.includes('СОЛДАТА')) {
    return 'Три белые свечи с растущими закрытиями в зоне низких цен: рынок набирает силу (гл. 7).';
  }
  if (p.includes('ВОРОН')) {
    return 'Три чёрные свечи с падающими закрытиями: «у плохих новостей есть крылья» (гл. 6).';
  }
  if (p.includes('ПИНЦЕТ')) {
    return 'Повторная проверка экстремума: уровень держит, вторичный сигнал разворота (гл. 6).';
  }
  if (p.includes('ГОРЫ') || p.includes('БУДД')) {
    return 'Три безуспешных штурма уровня: тройная вершина (гл. 6).';
  }
  if (p.includes('РЕКИ')) {
    return 'Три теста минимумов: основание достигнуто после подъёма выше промежуточных пиков (гл. 6).';
  }
  if (p.includes('БАШЕН')) {
    return 'Башня: длинные свечи до и после консолидации — резкая смена тренда (гл. 6).';
  }
  if (['ТАСУКИ', 'ТАТАМИ', 'ГЭП', 'СТУПЕН', 'РАЗДЕЛЕНИЕ', 'ПОЯСА', 'ШЕИ', 'ТОЛЧОК'].some(k => p.includes(k))) {
    return 'Модель продолжения: передышка перед новой волной основного тренда (гл. 6–7).';
  }
  
  return 'Модель предупреждает о вероятном завершении предыдущей тенденции; ждём подтверждения (гл. 4).';
}
