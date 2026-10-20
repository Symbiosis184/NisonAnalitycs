import { fetchKlines, fetch24hTicker, fetchInstrumentInfo } from './bybit';
import { Candle } from '../utils/candle';
import { ema, rsi, macd } from '../utils/indicators';
import { detectPatterns, patternStory } from '../utils/patterns';
import { signalGenerator } from '../utils/signal_generator';
import { ZoneVoter, timeframeKey } from '../utils/zone_voter';
import { detectTrendStart, getTrendContext, getTrendMacro, type TrendContext } from '../utils/trend_detection';
import { detectRegime } from '../utils/regime';
import { planPosition, toPlanDTO } from '../utils/position_sizing';
import { loadRiskSettings } from '../utils/risk_settings';
import { detectPhase } from '../utils/wyckoff';
import { buildVolumeProfile, summarizeDelta } from '../utils/volume_profile';
import { runBacktest, type FormationBounds } from '../utils/backtest';
import { tagTradesByRegime, detectDegradation, statsByRegime, edgeVerdict } from '../utils/edge_verification';
import { aggregateConsensus } from '../utils/consensus';
import type {
  AnalysisReport,
  MultiTFZonesDTO,
  CandleDTO,
  ConsensusDTO,
  EdgeReportDTO,
  MarketOverviewItem,
  PatternDTO,
  PatternDirection,
  PositionPlanDTO,
  Regime,
  RiskSettings,
  SignalDTO,
} from './types';

export type { AnalysisReport } from './types';

const toPatternDirection = (type: 'бычий' | 'медвежий' | 'нейтральный'): PatternDirection =>
  type === 'бычий' ? 'bullish' : type === 'медвежий' ? 'bearish' : 'neutral';

/**
 * Верификация преимущества (edge) на истории инструмента (запрос пользователя, пункт 3):
 * one-at-a-time прогон генератора по закрытым свечам → эмпирический бэктест →
 * когорты по режимам рынка + мониторинг деградации за последние 90 дней.
 * Только данные до момента каждой сделки — без lookahead. Возвращает null, если
 * наблюдений слишком мало для честного вывода (UI покажет статус ожидания).
 */
function computeEdgeReport(candles: Candle[], timeframe: string): EdgeReportDTO | null {
  const MIN_EVENTS = 5; // минимум срабатываний для запуска тяжёлого прогона
  try {
    // 1) Собираем «свежие» срабатывания детектора (signal formed at candle i).
    const events: Array<{ i: number; pattern: string; direction: 'long' | 'short'; bounds: FormationBounds }> = [];
    for (let i = 60; i < candles.length; i++) {
      const sigs = signalGenerator.findSignals(candles.slice(0, i + 1), timeframe);
      for (const s of sigs) {
        if (s.meta.patternEndIdx !== i) continue;
        events.push({
          i,
          pattern: s.pattern,
          direction: s.direction,
          bounds: { patternLow: s.meta.patternLow, patternHigh: s.meta.patternHigh },
        });
      }
      if (events.length > 400) break; // страховка от quadratic-стоимости на длинных окнах
    }
    if (events.length < MIN_EVENTS) return null;

    // 2) Один общий прогон: детектор возвращает границы того события, чья свеча — текущая.
    const detect = (_hist: Candle[], idx: number): FormationBounds | null => {
      const hit = events.find((e) => e.i === idx);
      return hit ? hit.bounds : null;
    };
    const res = runBacktest(candles, { detect, direction: 'long', maxHoldingBars: 60 });
    if (res.trades.length < MIN_EVENTS) return null;

    // 3) Режим рынка на момент входа каждой сделки (только история ДО входа).
    const tagged = tagTradesByRegime(candles, res.trades);
    const cohorts = statsByRegime(tagged);
    // entryTime в бэктесте наследует candle.time — в миллисекундах (bybit openTime), isMs=true
    const degradation = detectDegradation(res.trades.map((t) => ({ entryTime: t.entryTime, netR: t.netR })), Date.now(), true);
    const verdict = edgeVerdict(cohorts, degradation);

    return {
      verdict: verdict.verdict,
      summary: verdict.summary,
      best_cohort: verdict.bestCohort ? verdict.bestCohort.label : null,
      cohorts: cohorts.map((c) => ({
        cohort: c.cohort,
        label: c.label,
        trades: c.trades,
        wins: c.wins,
        win_rate: c.winRate,
        ci_low: c.ciLow,
        ci_high: c.ciHigh,
        avg_net_r: c.avgNetR,
        total_net_r: c.totalNetR,
        exp_ci_low: c.expectancy.ciLow,
        exp_ci_high: c.expectancy.ciHigh,
        has_edge: c.hasEdge,
      })),
      degradation: {
        window_days: degradation.windowDays,
        recent_trades: degradation.recentTrades,
        history_trades: degradation.historyTrades,
        recent_expectancy: degradation.recentExpectancy,
        history_expectancy: degradation.historyExpectancy,
        delta: degradation.delta,
        z_score: degradation.zScore,
        p_value: degradation.pValue,
        degraded: degradation.degraded,
        insufficient_data: degradation.insufficientData,
        note: degradation.note,
      },
      source: 'backtest',
      sample_trades: res.trades.length,
    };
  } catch {
    return null; // edge-статистика не должна ронять основной отчёт
  }
}

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
    
    // По канону Нисона сигнальная логика НЕ строится на индикаторах
    // (EMA/RSI/MACD — только визуальный контекст). Consensus считается ниже
    // по подтверждённым сценариям (свечи + объём + уровни S/R).
    // Режим рынка/тренд — структурный: свинги HH/HL vs LH/LL (гл. 13), MA — вторичны.
    const trend = getTrendContext(candles);
    // Сила тренда — структурная (по Нисону): насколько выражен направленный
    // импульс относительно шума. Считается по последним 20 барам: суммарное
    // перемещение цены (net move) против суммарных внутрибарных диапазонов.
    // Направленный тренд => близко к 100%; флэт/шум => близко к 0%.
    // Раньше использовалась дивергенция EMA20/EMA50 с коэффициентом ×4: при
    // spread <0.05% округление до целого давало вечные «0%» даже в тренде.
    const dirWindow = candles.slice(-21);
    let netMove = 0;
    let pathLength = 0;
    for (let i = 1; i < dirWindow.length; i++) {
      netMove += Math.abs(dirWindow[i].close - dirWindow[i - 1].close);
      pathLength += dirWindow[i].high - dirWindow[i].low;
    }
    const efficiency = pathLength > 0 ? Math.abs(dirWindow[dirWindow.length - 1].close - dirWindow[0].close) / netMove : 0;
    const directionalShare = pathLength > 0 ? netMove / pathLength : 0;
    const rawStrength = Math.min(100, Math.max(0, ((efficiency + directionalShare) / 2) * 100));
    // Сила тренда — без floor-подмены: в боковике она действительно ~0,
    // и UI обязан это честно показывать (десятичный формат), а не рисовать
    // искусственные «1%». Раньше из-за округления до целого все значения
    // <0.5 превращались в 0, а захардкоженный floor=1 маскировал реальные данные.
    const trendStrengthPct = Math.min(100, Math.max(0, rawStrength));
    
    // Определение зон поддержки/сопротивления по методологии Нисона
    const zones = ZoneVoter.collect(currentPrice, candles, timeframeKey(timeframe));
    
    // Детекция паттернов по Нисону
    const detectedPatterns = detectPatterns(candles, timeframe);
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
    
    // Многомерный объём + фазовый контекст (запрос пользователя): профиль объёма
    // (POC/VA/HVN/LVN), proxy-дельта агрессии и фаза Вайкоффа. Считаются по закрытым
    // свечам до текущего момента — без lookahead.
    const vprofile = buildVolumeProfile(candles, 120);
    const deltaSummary = summarizeDelta(candles, 60);

    // Верификация преимущества (пункт 3 запроса): когорты по режимам + деградация 90д.
    // Считается на той же истории без lookahead; при нехватке наблюдений — null.
    const edgeReport = computeEdgeReport(candles, timeframe);

    // Генерация торговых сигналов через SignalGenerator
    // opts.context включает «путь цены» (S/R-зоны + HVN) и фазы Вайкоффа в фильтрацию RR.
    const marketPhase = detectPhase(candles);
    const detectedSignals = signalGenerator.findSignals(candles, timeframe, {
      context: { zones, volumeBands: vprofile.bands },
    });

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
        ...(s.path ? {
          path: {
            distance_pct: s.path.distancePct,
            path_quality: s.path.pathQuality,
            adjusted_rr: s.path.adjustedRR,
            obstacles: s.path.obstacles.map((o) => ({ level: o.level, kind: o.kind, strength: o.strength, detail: o.detail })),
            first_obstacle_pct: s.path.toFirstObstaclePct,
            description: s.path.description,
          },
        } : {}),
        ...(s.phase ? {
          phase: {
            phase: s.phase.phase,
            confidence: s.phase.confidence,
            position_in_range: s.phase.positionInRange,
            range_low: s.phase.rangeLow,
            range_high: s.phase.rangeHigh,
            description: s.phase.description,
          },
        } : {}),
      };
    });
    
    // priceChange/priceChangePercent в fetch24hTicker уже числа (не строки)
    const change24h = ticker ? ticker.priceChange : currentPrice - candles[candles.length - 2].close;
    const changePercent = ticker ? ticker.priceChangePercent : (change24h / candles[candles.length - 2].close) * 100;

    // Режим рынка: структурный тренд (свинги HH/HL, гл. 13) + волатильность ATR.
    // БОКОВИК классифицируется как 'range'; при высокой относительной волатильности —
    // 'volatile-breakout' (шум, риск ложных пробоев).
    const regimeInfo = detectRegime(candles);
    const regime: Regime = trend;
    const regimeLabel =
      regime === 'БОКОВИК' ? 'Боковик (флэт)' : regime === 'ВОСХОДЯЩИЙ' ? 'Восходящий тренд' : 'Нисходящий тренд';
    const regimeDescription =
      regime === 'БОКОВИК'
        ? `Режим: ${regimeLabel}. Структура вершин/впадин не сформирована — разворотные паттерны надёжны только у границ диапазона (уровни S/R), продолжение тренда торговать нельзя.`
        : `Режим: ${regimeLabel}. Подтверждённые свинги ${trend === 'ВОСХОДЯЩИЙ' ? 'HH/HL' : 'LH/LL'}${
            regimeInfo.regime === 'volatile-breakout' ? '; повышенная волатильность (ATR выше среднего) — риск шумовых ложных пробоев' : ''
          }.`;

    // Consensus по Нисону: свечные паттерны + объём + уровни S/R.
    // Агрегируем ПОДТВЁЖДЁННЫЕ разворотные сценарии последних 20 баров.
    // Консенсус = СОГЛАСИЕ факторов в одну сторону, а не сумма голосов
    // (см. src/utils/consensus.ts): противоречивые long+short гасят друг друга
    // и дают низкий балл — раньше «много шума» давало 5/5 («с ума сошёл»).
    const freshCut = candles.length - 20;
    const freshConfirmed = detectedSignals.filter((s) => {
      if (s.status !== 'confirmed') return false;
      const endIdx = s.meta?.patternEndIdx ?? -1;
      return endIdx >= 0 ? endIdx >= freshCut : true;
    });
    const consensus = aggregateConsensus(
      freshConfirmed.map((s) => ({ direction: s.direction, quality: s.quality })),
    );
    const consensusScore = consensus.score;
    const consensusDirection = consensus.direction;
    const consensusConfidence = consensus.confidence;

    return {
      symbol,
      timeframe,
      price: currentPrice,
      change_24h: changePercent,
      trend: regime,
      trend_strength: trendStrengthPct / 100,
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
      regime_description: regimeDescription,
      wyckoff: {
        phase: marketPhase.phase,
        confidence: marketPhase.confidence,
        position_in_range: marketPhase.positionInRange,
        range_low: marketPhase.rangeLow,
        range_high: marketPhase.rangeHigh,
        range_width_atr: marketPhase.rangeWidthAtr,
        vol_skew_high_low: marketPhase.volSkewHighLow,
        description: marketPhase.description,
      },
      volume_profile: {
        poc: vprofile.poc,
        vah: vprofile.vah,
        val: vprofile.val,
        hvn: vprofile.hvn.map((b) => ({ low: b.low, high: b.high, volume: b.volume })),
        lvn: vprofile.lvn.map((b) => ({ low: b.low, high: b.high, volume: b.volume })),
        bins: vprofile.bins.map((b) => ({ low: b.low, high: b.high, volume: b.volume, share: b.share })),
      },
      delta_summary: {
        cumulative_delta: deltaSummary.cumulativeDelta,
        buy_pressure_share: deltaSummary.buyPressureShare,
        avg_clv: deltaSummary.avgClv,
        delta_trend: deltaSummary.deltaTrend,
        points: deltaSummary.points.map((p) => ({ time: p.time, delta: p.delta, clv: p.clv, imbalance: p.imbalance })),
      },
      consensus: {
        score: consensusScore,
        direction: consensusDirection,
        confidence: consensusConfidence,
      },
      trend_analysis: {
        // Реальная детекция старта тренда (движок trend_detection)
        trendStart: detectTrendStart(candles, currentPrice),
        bookTrend: regime,
      },
      ...(edgeReport ? { edge: edgeReport } : {}),
      generated: Date.now(),
    };
  }
  
  /**
   * Зоны S/R на нескольких ТФ одновременно (запрос пользователя: «зоны поддержки/
   * сопротивления на каждом ТФ»). Для каждого интервала зоны собираются своими
   * параметрами (толеранс, окно свингов, порог пробоя — см. ZONE_PARAMS), поэтому
   * список уровней различается между ТФ, а не копируется с дневного графика.
   */
  async getMultiTimeframeZones(
    symbol: string,
    timeframes: string[] = ['15', '1H', '4H', 'D', 'W']
  ): Promise<MultiTFZonesDTO[]> {
    const results = await Promise.all(
      timeframes.map(async (tf): Promise<MultiTFZonesDTO | null> => {
        try {
          const klines = await fetchKlines(symbol, tf, 250);
          const candles = klines.map((k) => new Candle({
            time: k.openTime, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
          }));
          if (candles.length < 30) return null;
          const price = candles[candles.length - 1].close;
          const zones = ZoneVoter.collect(price, candles, timeframeKey(tf));
          return {
            timeframe: tf,
            scale: timeframeKey(tf),
            price,
            support: zones.support,
            resistance: zones.resistance,
          };
        } catch (err) {
          console.error(`Ошибка расчёта зон для ${symbol} ${tf}:`, err);
          return null;
        }
      })
    );
    return results.filter((r): r is MultiTFZonesDTO => r !== null);
  }

  /**
   * Анализ произвольного инструмента с дашборда: проверяем существование
   * тикера на Bybit (спот, USDT-пары), нормализуем символ (TAO -> TAOUSDT)
   * и возвращаем карточку в формате MarketOverviewItem.
   */
  async analyzeCustomSymbol(rawSymbol: string): Promise<MarketOverviewItem> {
    const base = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!base) throw new Error('Введите название криптовалюты, например TAO или ARB');
    const symbol = base.endsWith('USDT') ? base : `${base}USDT`;

    // Проверяем наличие инструмента через instruments-info (кэш/троттлинг общие)
    const info = await fetchInstrumentInfo(symbol);
    if (!info || !info.is_trading) {
      throw new Error(`Инструмент ${symbol} не найден среди спотовых USDT-пар Bybit`);
    }

    let overview: MarketOverviewItem;
    try {
      overview = await this.buildOverviewItem(symbol);
    } catch {
      throw new Error(`Не удалось получить данные по ${symbol}. Попробуйте ещё раз.`);
    }
    return overview;
  }

  /** Одна карчка обзора рынка для конкретного символа (переиспользуется дашбордом). */
  private async buildOverviewItem(symbol: string): Promise<MarketOverviewItem> {
    const analysis = await this.getAnalysis(symbol, 'D');
    const volumes = analysis.candles.map((c) => c.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const confirmedPatterns = analysis.patterns
      .filter((p) => p.confirmed)
      .map((p) => ({ name: p.name, type: p.type, confirmed: p.confirmed, confidence: p.confidence }));
    const supportLevels = analysis.support.map((s) => s.level);
    const resistanceLevels = analysis.resistance.map((r) => r.level);
    const confirmedSignals = analysis.signals
      .filter((s) => s.confirmed)
      .map((s) => ({
        direction: s.direction, pattern: s.pattern, entry_price: s.entry_price,
        stop_loss: s.stop_loss, target: s.target, risk: s.risk, rr: s.rr,
        quality: s.quality, confirmed: s.confirmed,
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
