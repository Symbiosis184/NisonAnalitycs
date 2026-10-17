// Строгие типы отчёта анализа — единый контракт между движками (utils/*),
// API-слоем (api/client.ts) и UI (pages/*, components/*).
// Поля соответствуют реальным источникам данных: PatternResult, Signal, Zone.

import type { TrendContext } from '../utils/trend_detection';

/** Свеча в сериализованном виде (то, что уходит в UI/чарт) */
export interface CandleDTO {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Тип паттерна для UI (маппинг русской классификации Нисона) */
export type PatternDirection = 'bullish' | 'bearish' | 'neutral';

/** Найденная свечная формация (из PatternDetector / detectPatterns) */
export interface PatternDTO {
  name: string;
  type: PatternDirection;
  candleIndex: number;
  confidence: number;
  confirmed: boolean;
  hasVolume: boolean;
  atLevel: boolean;
  /** Краткое «повествование» по методологии книги */
  story: string;
}

/** Торговый сигнал (из SignalGenerator) */
export interface SignalDTO {
  direction: 'long' | 'short';
  pattern: string;
  entry_price: number;
  stop_loss: number;
  target: number;
  risk: number;
  rr: number;
  quality: number;
  timestamp: number;
  confirmed: boolean;
  /** Жизненный цикл по Нисону (аудит №11): pending/confirmed/invalidated/expired */
  lifecycle_status?: 'pending' | 'confirmed' | 'invalidated' | 'expired';
  story: string;
  /** Контекст старшего таймфрейма (аудит №9): тренд на HTF в момент сигнала */
  htf?: {
    timeframe: string;
    trend: Regime;
    aligned: boolean; // сигнал совпадает с трендом HTF (или HTF = БОКОВИК — нейтрально)
  };
  /** План размера позиции по правилу фиксированного риска (аудит №10, utils/position_sizing) */
  position_plan?: PositionPlanDTO;
}

/** Настройки риск-менеджмента пользователя (localStorage «nison_risk_settings») */
export interface RiskSettings {
  capitalUsd: number; // депозит в USDT
  riskPct: number;    // риск на сделку, доля капитала (0.01 = 1%)
}

/** План позиции по правилу фиксированного риска (utils/position_sizing) */
export interface PositionPlanDTO {
  risk_usd: number;          // заявленный риск в USDT
  stop_distance_pct: number; // расстояние до стопа, % от входа
  qty: number;               // размер позиции в базовом активе
  notional_usd: number;      // номинал позиции
  cost_reserve_usd: number;  // резерв на комиссии+слиппедж полного цикла
  worst_case_loss_usd: number; // реальный убыток по стопу (риск + издержки)
  worst_case_loss_pct: number; // то же, % капитала
  capped_by_notional: boolean;
  leverage: number;
}

/** Зона поддержки/сопротивления с «голосами» (из ZoneVoter) */
export interface ZoneDTO {
  level: number;
  votes: number;
  strong: boolean;
  reasons: string[];
  touches: number;
  lastTouch?: number;
}

/** Консенсус-оценка направления */
export interface ConsensusDTO {
  score: number;        // 0–5
  direction: 'buy' | 'sell' | 'neutral';
  confidence: number;   // 0–100
}

/** Анализ тренда (детекция старта тренда по книге Нисона) */
export interface TrendAnalysisDTO {
  trendStart: {
    detected: boolean;
    trend: TrendContext | null;
    reasons: string[];
    confidence: number;
  };
  bookTrend: TrendContext;
}

export type Regime = TrendContext;

/** Сводная статистика эмпирического бэктеста паттерна (utils/backtest) */
export interface BacktestSummaryDTO {
  pattern: string;
  direction: 'long' | 'short';
  total_trades: number;
  win_rate_net: number;   // % прибыльных сделок ПОСЛЕ издержек
  win_rate_gross: number; // % прибыльных сделок ДО издержек (для сравнения)
  expectancy_r: number;   // средний net R на сделку
  profit_factor: number;
  total_net_r: number;
  max_drawdown_r: number;
  costs_drag_r: number;   // суммарные издержки в R
}

/** Полный отчёт анализа одного инструмента */
export interface AnalysisReport {
  symbol: string;
  timeframe: string;
  price: number;
  change_24h: number;
  trend: Regime;
  trend_strength: number;
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  ema20: number;
  ema50: number;
  ema200: number;
  candles: CandleDTO[];
  patterns: PatternDTO[];
  signals: SignalDTO[];
  support: ZoneDTO[];
  resistance: ZoneDTO[];
  regime: Regime;
  regime_description: string;
  consensus: ConsensusDTO;
  trend_analysis: TrendAnalysisDTO;
  /** Бэктест-сводка по найденным сигналам (заглушка до подключения движка — П.3) */
  backtest?: BacktestSummaryDTO[];
  generated: number;
}

/** Карточка инструмента для обзора рынка (Dashboard) */
export interface MarketOverviewItem {
  symbol: string;
  price: number;
  change_24h: number;
  trend: Regime;
  regime: Regime;
  patterns: Array<Pick<PatternDTO, 'name' | 'type' | 'confirmed' | 'confidence'>>;
  signals: Array<Pick<SignalDTO, 'direction' | 'pattern' | 'entry_price' | 'stop_loss' | 'target' | 'risk' | 'rr' | 'quality' | 'confirmed'>>;
  support: number[];
  resistance: number[];
  volume: number;
  avgVolume: number;
  consensus: ConsensusDTO;
}
