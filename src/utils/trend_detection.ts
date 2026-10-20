import { Candle } from './candle';
import { ema, rsi } from './indicators';

export type TrendContext = 'ВОСХОДЯЩИЙ' | 'НИСХОДЯЩИЙ' | 'БОКОВИК';

export function getTrendContext(candles: Candle[]): TrendContext {
  if (candles.length < 20) return 'БОКОВИК';
  
  const closes = candles.map(c => c.close);
  const ema10 = ema(closes, 10);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  
  const last = candles[candles.length - 1];
  const lastEma10 = ema10[ema10.length - 1];
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  
  if (last.close > lastEma10 && lastEma10 > lastEma20 && lastEma20 > lastEma50) {
    return 'ВОСХОДЯЩИЙ';
  } else if (last.close < lastEma10 && lastEma10 < lastEma20 && lastEma20 < lastEma50) {
    return 'НИСХОДЯЩИЙ';
  }
  
  return 'БОКОВИК';
}

export function getTrendMacro(candles: Candle[], price: number): TrendContext {
  if (candles.length < 65) return 'БОКОВИК';
  
  const closes = candles.map(c => c.close);
  const ma65 = ema(closes, 65);
  const ma65Val = ma65[ma65.length - 1];
  
  if (price > ma65Val) {
    return 'ВОСХОДЯЩИЙ';
  } else if (price < ma65Val) {
    return 'НИСХОДЯЩИЙ';
  }
  
  return 'БОКОВИК';
}

export function detectTrendStart(candles: Candle[], price: number): {
  detected: boolean;
  trend: 'ВОСХОДЯЩИЙ' | 'НИСХОДЯЩИЙ' | null;
  reasons: string[];
  confidence: number;
} {
  if (candles.length < 40) {
    return { detected: false, trend: null, reasons: [], confidence: 0 };
  }
  
  const bull: string[] = [];
  const bear: string[] = [];
  
  // 1) Свечной разворотный сигнал
  const closes = candles.map(c => c.close);
  // BUG FIX: вместо rsi() вызывалась ema() — «RSI» фактически был EMA(14) в ценовых
  // единицах, пороги 30/70 срабатывали произвольно (зависели от цены инструмента).
  const rsiValues = rsi(closes, 14);
  const lastRsi = rsiValues[rsiValues.length - 1];
  
  if (lastRsi < 30) {
    bull.push('свечной сигнал в основании (гл. 4–6)');
  } else if (lastRsi > 70) {
    bear.push('свечной сигнал на вершине (гл. 4–6)');
  }
  
  // 2) Пробой уровня на объёме
  const avgVolume = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const lastVolume = candles[candles.length - 1].volume;
  
  if (lastVolume > avgVolume * 1.5) {
    const lastCandle = candles[candles.length - 1];
    const prevHigh = Math.max(...candles.slice(-10, -1).map(c => c.high));
    const prevLow = Math.min(...candles.slice(-10, -1).map(c => c.low));
    
    if (lastCandle.close > prevHigh) {
      bull.push(`пробой сопротивления ${prevHigh.toFixed(2)} на объёме (гл. 7, 15)`);
    } else if (lastCandle.close < prevLow) {
      bear.push(`пробой поддержки ${prevLow.toFixed(2)} на объёме (гл. 7, 15)`);
    }
  }
  
  // 3) Полярность уровней
  const levels = findLevels(candles);
  const lastClose = candles[candles.length - 1].close;
  
  for (const r of levels.resistance) {
    if (lastClose > r && candles.slice(-3).every(c => c.close > r * 0.995)) {
      bull.push('полярность: пробитый уровень стал поддержкой (гл. 11)');
      break;
    }
  }
  
  for (const s of levels.support) {
    if (lastClose < s && candles.slice(-3).every(c => c.close < s * 1.005)) {
      bear.push('полярность: пробитый уровень стал сопротивлением (гл. 11)');
      break;
    }
  }
  
  // 4) Окна (гэпы)
  for (let i = candles.length - 15; i < candles.length - 1; i++) {
    const prev = candles[i];
    const curr = candles[i + 1];
    
    if (curr.low > prev.high && price > (prev.high + curr.low) / 2) {
      bull.push('окно вверх открыто и не закрыто (гл. 7)');
      break;
    }
    if (curr.high < prev.low && price < (prev.low + curr.high) / 2) {
      bear.push('окно вниз открыто и не закрыто (гл. 7)');
      break;
    }
  }
  
  // 5) MA65 и пересечения
  const ma65 = ema(closes, 65);
  const ma65Val = ma65[ma65.length - 1];
  const ma65Prev = ma65[ma65.length - 6];
  
  if (price > ma65Val && ma65Val > ma65Prev && candles.slice(-12, -1).some(c => c.close <= ma65Val)) {
    bull.push('цена выше MA65, средняя развернулась вверх (гл. 13)');
  }
  if (price < ma65Val && ma65Val < ma65Prev && candles.slice(-12, -1).some(c => c.close >= ma65Val)) {
    bear.push('цена ниже MA65, средняя развернулась вниз (гл. 13)');
  }
  
  const ma10 = ema(closes, 10);
  const ma10Val = ma10[ma10.length - 1];
  const ma10Prev = ma10[ma10.length - 4];
  
  if (ma10Val > ma65Val && ma65Val >= ma10Prev) {
    bull.push('золотой крест MA10/MA65 (гл. 13)');
  }
  if (ma10Val < ma65Val && ma65Val <= ma10Prev) {
    bear.push('мёртвый крест MA10/MA65 (гл. 13)');
  }
  
  // 6) Дивергенция RSI
  const recent = candles.slice(-20);
  const prev = candles.slice(-40, -20);
  
  const recentHigh = Math.max(...recent.map(c => c.high));
  const prevHigh = Math.max(...prev.map(c => c.high));
  const recentLow = Math.min(...recent.map(c => c.low));
  const prevLow = Math.min(...prev.map(c => c.low));
  
  const recentRsi = rsiValues.slice(-20);
  const prevRsi = rsiValues.slice(-40, -20);
  const recentRsiVal = recentRsi[recentRsi.length - 1];
  const prevRsiVal = prevRsi[prevRsi.length - 1];
  
  if (recentHigh > prevHigh && recentRsiVal < prevRsiVal - 5) {
    bear.push('медвежья дивергенция у перекупленности (гл. 14)');
  }
  if (recentLow < prevLow && recentRsiVal > prevRsiVal + 5) {
    bull.push('бычья дивергенция у перепроданности (гл. 14)');
  }
  
  // 7) Рост объёма
  const recentVolume = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
  const prevVolume = candles.slice(-10, -5).reduce((s, c) => s + c.volume, 0) / 5;
  const oiRatio = prevVolume > 0 ? recentVolume / prevVolume : 1;
  const chg = candles[candles.length - 1].close - candles[candles.length - 5].close;
  
  if (oiRatio > 1.05 && chg > 0) {
    bull.push('объём растёт вместе с ценой (гл. 15)');
  }
  if (oiRatio > 1.05 && chg < 0) {
    bear.push('объём растёт при падении цены (гл. 15)');
  }
  
  // 8) Спружинивание
  const supOld = Math.min(...candles.slice(-25, -5).map(c => c.low));
  const resOld = Math.max(...candles.slice(-25, -5).map(c => c.high));
  
  if (candles.slice(-5).some(c => c.low < supOld) && candles[candles.length - 1].close > supOld) {
    bull.push('нижнее спружинивание: ложный пробой и возврат (гл. 11)');
  }
  if (candles.slice(-5).some(c => c.high > resOld) && candles[candles.length - 1].close < resOld) {
    bear.push('верхнее спружинивание: ложный пробой и возврат (гл. 11)');
  }
  
  const TREND_START_MIN_VOTES = 3;
  
  if (bull.length >= TREND_START_MIN_VOTES && bull.length > bear.length) {
    const confidence = Math.min(100, (bull.length / 8) * 100);
    return { detected: true, trend: 'ВОСХОДЯЩИЙ', reasons: bull, confidence };
  }
  if (bear.length >= TREND_START_MIN_VOTES && bear.length > bull.length) {
    const confidence = Math.min(100, (bear.length / 8) * 100);
    return { detected: true, trend: 'НИСХОДЯЩИЙ', reasons: bear, confidence };
  }
  
  return { detected: false, trend: null, reasons: [], confidence: 0 };
}

function findLevels(candles: Candle[], lookback: number = 50) {
  const recent = candles.slice(-lookback);
  const support: number[] = [];
  const resistance: number[] = [];
  
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];
    
    if (c.low < recent[i - 1].low && c.low < recent[i - 2].low &&
        c.low < recent[i + 1].low && c.low < recent[i + 2].low) {
      support.push(c.low);
    }
    
    if (c.high > recent[i - 1].high && c.high > recent[i - 2].high &&
        c.high > recent[i + 1].high && c.high > recent[i + 2].high) {
      resistance.push(c.high);
    }
  }
  
  return { support, resistance };
}
