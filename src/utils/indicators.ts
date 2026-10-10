import { Candle } from './candle';

export function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  
  let prev = values[0];
  result.push(prev);
  
  for (let i = 1; i < values.length; i++) {
    const current = (values[i] - prev) * multiplier + prev;
    result.push(current);
    prev = current;
  }
  
  return result;
}

export function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  
  return result;
}

export function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < period; i++) {
    result.push(NaN);
  }
  
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - (100 / (1 + rs)));
  
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }
  
  return result;
}

export function macd(closes: number[], fast: number = 12, slow: number = 26, signal: number = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  
  return {
    macd: macdLine,
    signal: signalLine,
    histogram
  };
}

export function atr(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    trueRanges.push(tr);
  }
  
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = [atr];
  
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }
  
  return atr;
}

export function pivotLevels(candles: Candle[]) {
  const last = candles[candles.length - 1];
  const pivot = (last.high + last.low + last.close) / 3;
  
  return {
    support: [
      pivot * 2 - last.high,
      pivot - (last.high - last.low),
    ],
    resistance: [
      pivot * 2 - last.low,
      pivot + (last.high - last.low),
    ]
  };
}

export function detectTrend(price: number, ema20: number, ema50: number, ema200: number): 'бычий' | 'медвежий' | 'нейтральный' {
  if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
    return 'бычий';
  } else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
    return 'медвежий';
  }
  return 'нейтральный';
}

export function generateSignal(price: number, rsiVal: number, macdHist: number, ema20: number, ema50: number) {
  let score = 0;
  
  if (price > ema20) score += 1;
  if (price > ema50) score += 1;
  if (ema20 > ema50) score += 1;
  if (rsiVal < 30) score += 2;
  else if (rsiVal > 70) score -= 2;
  else if (rsiVal < 50) score += 0.5;
  else score -= 0.5;
  if (macdHist > 0) score += 1;
  else score -= 1;
  
  const confidence = Math.min(95, 50 + Math.abs(score) * 8);
  
  let signal = 'Держать';
  if (score >= 3) signal = 'Сильная покупка';
  else if (score >= 1.5) signal = 'Покупка';
  else if (score <= -3) signal = 'Сильная продажа';
  else if (score <= -1.5) signal = 'Продажа';
  
  return { signal, confidence };
}
