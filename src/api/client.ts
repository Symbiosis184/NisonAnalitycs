import { fetchKlines, fetch24hTicker } from './bybit';
import { Candle } from '../utils/candle';
import { ema, rsi, macd, pivotLevels, detectTrend, generateSignal } from '../utils/indicators';
import { detectPatterns, patternStory } from '../utils/patterns';
import { signalGenerator } from '../utils/signal_generator';
import { ZoneVoter } from '../utils/zone_voter';

export interface AnalysisReport {
  symbol: string;
  timeframe: string;
  price: number;
  change_24h: number;
  trend: string;
  trend_strength: number;
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  ema20: number;
  ema50: number;
  ema200: number;
  candles: any[];
  patterns: any[];
  signals: any[];
  support: any[];
  resistance: any[];
  volume_profile: any;
  regime: string;
  regime_description: string;
  consensus: any;
  radar: any;
  trend_analysis: any;
  quality_filter: any;
  multiTimeframe: any;
  divergences: any;
  assetProfile: any;
  backtest: any;
  btcCorrelation: any;
  fibonacci: any;
  generated: number;
}

export class ApiClient {
  async getAnalysis(symbol: string, timeframe: string = 'D'): Promise<AnalysisReport> {
    const klines = await fetchKlines(symbol, timeframe, 250);
    const ticker = await fetch24hTicker(symbol).catch(() => null);
    
    const candles = klines.map((k: any) => new Candle({
      time: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
    
    const closes = candles.map((c: Candle) => c.close);
    const currentPrice = closes[closes.length - 1];
    
    const ema20Arr = ema(closes, 20);
    const ema50Arr = ema(closes, 50);
    const ema200Arr = ema(closes, Math.min(200, closes.length - 1));
    const rsiArr = rsi(closes, 14);
    const macdData = macd(closes);
    
    const ema20 = ema20Arr[ema20Arr.length - 1];
    const ema50 = ema50Arr[ema50Arr.length - 1];
    const ema200 = ema200Arr[ema200Arr.length - 1];
    const rsiVal = rsiArr[rsiArr.length - 1];
    const macdLast = macdData.macd[macdData.macd.length - 1];
    const signalLast = macdData.signal[macdData.signal.length - 1];
    const histLast = macdData.histogram[macdData.histogram.length - 1];
    
    const trend = detectTrend(currentPrice, ema20, ema50, ema200);
    const { signal, confidence } = generateSignal(currentPrice, rsiVal, histLast, ema20, ema50);
    
    // Определение зон поддержки/сопротивления по методологии Нисона
    const zones = ZoneVoter.collect(currentPrice, candles);
    
    // Детекция паттернов по Нисону
    const detectedPatterns = detectPatterns(candles);
    const apiPatterns = detectedPatterns.map(p => ({
      name: p.name,
      type: p.type === 'бычий' ? 'bullish' : p.type === 'медвежий' ? 'bearish' : 'neutral',
      candleIndex: p.candleIndex,
      confidence: p.confidence,
      confirmed: p.confirmed,
      hasVolume: p.hasVolume,
      atLevel: p.atLevel,
      story: patternStory(p.name),
    }));
    
    // Генерация торговых сигналов через SignalGenerator
    const detectedSignals = signalGenerator.findSignal(candles, timeframe);
    const apiSignals = detectedSignals ? [{
      direction: detectedSignals.direction,
      pattern: detectedSignals.pattern,
      entry_price: detectedSignals.entryPrice,
      stop_loss: detectedSignals.stopLoss,
      target: detectedSignals.target,
      risk: detectedSignals.risk,
      rr: detectedSignals.rr,
      quality: detectedSignals.quality,
      timestamp: detectedSignals.timestamp,
      confirmed: detectedSignals.confirmed,
      story: detectedSignals.story,
    }] : [];
    
    const change24h = ticker ? parseFloat(ticker.priceChange) : currentPrice - candles[candles.length - 2].close;
    const changePercent = ticker ? parseFloat(ticker.priceChangePercent) : (change24h / candles[candles.length - 2].close) * 100;
    
    return {
      symbol,
      timeframe,
      price: currentPrice,
      change_24h: changePercent,
      trend: trend === 'бычий' ? 'ВОСХОДЯЩИЙ' : trend === 'медвежий' ? 'НИСХОДЯЩИЙ' : 'БОКОВИК',
      trend_strength: confidence / 100,
      rsi: isNaN(rsiVal) ? 50 : rsiVal,
      macd: {
        value: macdLast,
        signal: signalLast,
        histogram: histLast,
      },
      ema20,
      ema50,
      ema200,
      candles: candles.map((c: Candle) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      patterns: apiPatterns,
      signals: apiSignals,
      support: zones.support.map((zone) => ({
        level: zone.level,
        votes: zone.votes,
        strong: zone.strong,
        reasons: zone.reasons,
        touches: zone.touches,
        lastTouch: zone.lastTouch,
      })),
      resistance: zones.resistance.map((zone) => ({
        level: zone.level,
        votes: zone.votes,
        strong: zone.strong,
        reasons: zone.reasons,
        touches: zone.touches,
        lastTouch: zone.lastTouch,
      })),
      volume_profile: null,
      regime: trend === 'бычий' ? 'ВОСХОДЯЩИЙ' : trend === 'медвежий' ? 'НИСХОДЯЩИЙ' : 'БОКОВИК',
      regime_description: `Тренд: ${trend}`,
      consensus: {
        score: confidence / 20,
        direction: signal.toLowerCase().includes('покупка') ? 'buy' : signal.toLowerCase().includes('продажа') ? 'sell' : 'neutral',
        confidence,
      },
      radar: null,
      trend_analysis: {
        trendStart: {
          detected: false,
          trend: null,
          reasons: [],
        },
        threeLineBreak: {
          trend: 'БОКОВИК',
          reversalIdx: null,
        },
        bookTrend: trend === 'бычий' ? 'ВОСХОДЯЩИЙ' : trend === 'медвежий' ? 'НИСХОДЯЩИЙ' : 'БОКОВИК',
      },
      quality_filter: null,
      multiTimeframe: null,
      divergences: null,
      assetProfile: null,
      backtest: null,
      btcCorrelation: null,
      fibonacci: null,
      generated: Date.now(),
    };
  }
  
  async getMarketOverview(): Promise<any[]> {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT'];
    
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const analysis = await this.getAnalysis(symbol, 'D');
          
          // Рассчитываем средний объём
          const volumes = analysis.candles.map((c: any) => c.volume);
          const avgVolume = volumes.reduce((sum: number, v: number) => sum + v, 0) / volumes.length;
          
          // Извлекаем подтверждённые паттерны
          const confirmedPatterns = analysis.patterns
            .filter((p: any) => p.confirmed)
            .map((p: any) => ({
              name: p.name,
              type: p.type,
              confirmed: p.confirmed,
              confidence: p.confidence,
            }));
          
          // Извлекаем уровни поддержки/сопротивления
          const supportLevels = analysis.support.map((s: any) => s.level);
          const resistanceLevels = analysis.resistance.map((r: any) => r.level);
          
          // Извлекаем подтверждённые сигналы
          const confirmedSignals = analysis.signals
            .filter((s: any) => s.confirmed)
            .map((s: any) => ({
              direction: s.direction,
              pattern: s.pattern,
              entry_price: s.entry_price,
              stop_loss: s.stop_loss,
              target: s.target,
              risk: s.risk,
              rr: s.rr,
              quality: s.quality,
              confirmed: s.confirmed,
            }));
          
          return {
            symbol,
            price: analysis.price,
            change_24h: analysis.change_24h,
            trend: analysis.trend,
            regime: analysis.regime,
            patterns: confirmedPatterns,
            signals: confirmedSignals,
            support: supportLevels,
            resistance: resistanceLevels,
            volume: analysis.candles[analysis.candles.length - 1]?.volume || 0,
            avgVolume,
            consensus: analysis.consensus,
          };
        } catch (err) {
          console.error(`Ошибка получения данных для ${symbol}:`, err);
          return null;
        }
      })
    );
    
    return results.filter((r): r is any => r !== null);
  }
}

export const api = new ApiClient();
