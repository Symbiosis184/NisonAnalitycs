import { fetchKlines, fetch24hTicker } from './bybit';
import { Candle } from '../utils/candle';
import { ema, rsi, macd, detectTrend, generateSignal } from '../utils/indicators';
import { detectPatterns, patternStory } from '../utils/patterns';
import { signalGenerator } from '../utils/signal_generator';
import { ZoneVoter } from '../utils/zone_voter';
import { detectTrendStart, getTrendMacro, type TrendContext } from '../utils/trend_detection';
import { planPosition, toPlanDTO } from '../utils/position_sizing';
import { loadRiskSettings } from '../utils/risk_settings';
import type {
  AnalysisReport,
  CandleDTO,
  ConsensusDTO,
  MarketOverviewItem,
  PatternDTO,
  PatternDirection,
  PositionPlanDTO,
  Regime,
  RiskSettings,
  SignalDTO,
} from './types';

export type { AnalysisReport } from './types';

const toRegime = (trend: 'бычий' | 'медвежий' | 'нейтральный'): Regime =>
  trend === 'бычий' ? 'ВОСХОДЯЩИЙ' : trend === 'медвежий' ? 'НИСХОДЯЩИЙ' : 'БОКОВИК';

const toPatternDirection = (type: 'бычий' | 'медвежий' | 'нейтральный'): PatternDirection =>
  type === 'бычий' ? 'bullish' : type === 'медвежий' ? 'bearish' : 'neutral';

/** Старший таймфрейм для контекста (аудит №9). Неизвестные ТФ → null (без HTF-слоя). */
export function higherTimeframe(tf: string): string | null {
  const map: Record<string, string> = { '1': '15', '5': '30', '15': '1H', '30': '4H', '1H': '4H', '4H': 'D', D: 'W' };
  return map[tf] ?? null;
}

export class ApiClient {
  async getAnalysis(symbol: string, timeframe: string = 'D'): Promise<AnalysisReport> {
    const klines = await fetchKlines(symbol, timeframe, 250);
    const ticker = await fetch24hTicker(symbol).catch(() => null);

    const candles = klines.map((k) => new Candle({
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
    const apiPatterns: PatternDTO[] = detectedPatterns.map(p => ({
      name: p.name,
      type: toPatternDirection(p.type),
      candleIndex: p.candleIndex,
      confidence: p.confidence,
      confirmed: p.confirmed,
      hasVolume: p.hasVolume,
      atLevel: p.atLevel,
      story: patternStory(p.name),
    }));
    
    // Генерация торговых сигналов через SignalGenerator
    const detectedSignals = signalGenerator.findSignals(candles, timeframe);

    // Аудит №10: план размера позиции по правилу фиксированного риска.
    // Настройки (капитал/риск) берутся из localStorage; риск-расчёт учитывает издержки цикла.
    const riskSettings = loadRiskSettings();
    // Аудит №9: контекст старшего ТФ (HTF) — отдельный запрос кэшируется http-слоем.
    const htfTf = higherTimeframe(timeframe);
    let htfCandles: Candle[] | null = null;
    try {
      if (!htfTf) throw new Error('no HTF mapping');
      const htfKlines = await fetchKlines(symbol, htfTf, 250);
      htfCandles = htfKlines.map((k) => new Candle({
        time: k.openTime, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
      }));
    } catch {
      htfCandles = null; // нет HTF-данных — не блокируем основной отчёт (fallback в UI)
    }
    const htfTrend: TrendContext | null = htfCandles ? getTrendMacro(htfCandles, currentPrice) : null;

    const apiSignals: SignalDTO[] = detectedSignals.map(s => {
      const plan = toPlanDTO(planPosition({
        capitalUsd: riskSettings.capitalUsd,
        riskPct: riskSettings.riskPct,
        entryPrice: s.entryPrice,
        stopPrice: s.stopLoss,
      }));
      const htf = (htfTrend && htfTf) ? {
        timeframe: htfTf,
        trend: htfTrend,
        aligned: htfTrend === 'БОКОВИК'
          || (s.direction === 'long' && htfTrend === 'ВОСХОДЯЩИЙ')
          || (s.direction === 'short' && htfTrend === 'НИСХОДЯЩИЙ'),
      } : undefined;
      return {
        direction: s.direction,
        pattern: s.pattern,
        entry_price: s.entryPrice,
        stop_loss: s.stopLoss,
        target: s.target,
        risk: s.risk,
        rr: s.rr,
        quality: s.quality,
        timestamp: s.timestamp,
        confirmed: s.confirmed,
        lifecycle_status: s.status,
        story: s.story,
        ...(htf ? { htf } : {}),
        ...(plan ? { position_plan: plan } : {}),
      };
    });
    
    // priceChange/priceChangePercent в fetch24hTicker уже числа (не строки)
    const change24h = ticker ? ticker.priceChange : currentPrice - candles[candles.length - 2].close;
    const changePercent = ticker ? ticker.priceChangePercent : (change24h / candles[candles.length - 2].close) * 100;

    const regime = toRegime(trend);
    const consensusDirection: ConsensusDTO['direction'] =
      signal.toLowerCase().includes('покупка') ? 'buy'
        : signal.toLowerCase().includes('продажа') ? 'sell'
          : 'neutral';

    return {
      symbol,
      timeframe,
      price: currentPrice,
      change_24h: changePercent,
      trend: regime,
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
      candles: candles.map((c): CandleDTO => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      patterns: apiPatterns,
      signals: apiSignals,
      support: zones.support,
      resistance: zones.resistance,
      regime,
      regime_description: `Тренд: ${trend}`,
      consensus: {
        score: confidence / 20,
        direction: consensusDirection,
        confidence,
      },
      trend_analysis: {
        // Реальная детекция старта тренда (движок trend_detection)
        trendStart: detectTrendStart(candles, currentPrice),
        bookTrend: regime,
      },
      generated: Date.now(),
    };
  }
  
  async getMarketOverview(): Promise<MarketOverviewItem[]> {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT'];
    
    const results = await Promise.all(
      symbols.map(async (symbol): Promise<MarketOverviewItem | null> => {
        try {
          const analysis = await this.getAnalysis(symbol, 'D');
          
          // Рассчитываем средний объём
          const volumes = analysis.candles.map((c) => c.volume);
          const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
          
          // Извлекаем подтверждённые паттерны
          const confirmedPatterns = analysis.patterns
            .filter((p) => p.confirmed)
            .map((p) => ({
              name: p.name,
              type: p.type,
              confirmed: p.confirmed,
              confidence: p.confidence,
            }));
          
          // Извлекаем уровни поддержки/сопротивления
          const supportLevels = analysis.support.map((s) => s.level);
          const resistanceLevels = analysis.resistance.map((r) => r.level);
          
          // Извлекаем подтверждённые сигналы
          const confirmedSignals = analysis.signals
            .filter((s) => s.confirmed)
            .map((s) => ({
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
    
    return results.filter((r): r is MarketOverviewItem => r !== null);
  }

  /** Аудит №10: пересчёт плана позиции под конкретный капитал/риск (для UI-калькулятора). */
  planForSignal(signal: SignalDTO, settings: RiskSettings): PositionPlanDTO | undefined {
    return toPlanDTO(planPosition({
      capitalUsd: settings.capitalUsd,
      riskPct: settings.riskPct,
      entryPrice: signal.entry_price,
      stopPrice: signal.stop_loss,
    }));
  }
}

export const api = new ApiClient();

// Тестовый хук: подмена источника данных анализа (по умолчанию — реальный ApiClient).
let analysisProvider: ApiClient | { getAnalysis(symbol: string, timeframe?: string): Promise<AnalysisReport> } = api;
export function __setAnalysisProvider(p: typeof analysisProvider) {
  const prev = analysisProvider;
  analysisProvider = p;
  return () => { analysisProvider = prev; };
}

class ApiClientFacade {
  getAnalysis(symbol: string, timeframe: string = 'D') {
    return analysisProvider.getAnalysis(symbol, timeframe);
  }
  getMarketOverview() {
    return api.getMarketOverview();
  }
  planForSignal(signal: SignalDTO, settings: RiskSettings) {
    return api.planForSignal(signal, settings);
  }
}

export const apiProxy = new ApiClientFacade();
