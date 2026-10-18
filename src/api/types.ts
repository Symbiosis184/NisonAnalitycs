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
  /** «Путь цены» до цели (запрос: контекст рынка, utils/price_path) */
  path?: {
    distance_pct: number;
    path_quality: number;      // 0..1 — чистота пути
    adjusted_rr: number;       // RR с учётом препятствий на транзите
    obstacles: Array<{ level: number; kind: 'zone' | 'hvn'; strength: number; detail: string }>;
    first_obstacle_pct: number | null;
    description: string;
  };
  /** Фаза цикла Вайкоффа (utils/wyckoff) */
  phase?: {
    phase: 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'transition';
    confidence: number;
    position_in_range: number;
    range_low: number;
    range_high: number;
    description: string;
  };
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
  /** Фаза цикла Вайкоффа по всему инструменту (запрос: контекст рынка, utils/wyckoff) */
  wyckoff?: {
    phase: 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'transition';
    confidence: number;
    position_in_range: number;
    range_low: number;
    range_high: number;
    range_width_atr: number;
    vol_skew_high_low: number;
    description: string;
  };
  /** Профиль объёма (utils/volume_profile): POC/VAH/VAL + узлы HVN/LVN */
  volume_profile?: {
    poc: number;
    vah: number;
    val: number;
    hvn: Array<{ low: number; high: number; volume: number }>;
    lvn: Array<{ low: number; high: number; volume: number }>;
    /** Полная гистограмма профиля для визуализации (горизонтальные бары по ценам) */
    bins?: Array<{ low: number; high: number; volume: number; share: number }>;
  };
  /** Сводка дельты/агрессии за окно (proxy-оценка по OHLCV, utils/volume_profile) */
  delta_summary?: {
    cumulative_delta: number;
    buy_pressure_share: number;
    avg_clv: number;
    delta_trend: 'rising' | 'falling' | 'flat';
    /** Поминутная proxy-дельта окна — для столбчатого графика и накопленной кривой */
    points?: Array<{ time: number; delta: number; clv: number; imbalance: 'buy' | 'sell' | null }>;
  };
  consensus: ConsensusDTO;
  trend_analysis: TrendAnalysisDTO;
  /** Бэктест-сводка по найденным сигналам (заглушка до подключения движка — П.3) */
  backtest?: BacktestSummaryDTO[];
  /** Верификация преимущества (utils/edge_verification): деградация + когорты режимов */
  edge?: EdgeReportDTO;
  generated: number;
}

/** Когорта эффективности по режиму рынка (utils/edge_verification.statsByRegime) */
export interface EdgeCohortDTO {
  cohort: 'trend' | 'range' | 'volatile-breakout';
  label: string;
  trades: number;
  wins: number;
  win_rate: number;      // %
  ci_low: number;        // % (Wilson CI)
  ci_high: number;       // %
  avg_net_r: number;     // expectancy, R/сделка
  total_net_r: number;
  exp_ci_low: number;    // 95% CI expectancy в R
  exp_ci_high: number;
  has_edge: boolean;
}

/** Отчёт о деградации за последние 90 дней vs история (utils/edge_verification.detectDegradation) */
export interface DegradationDTO {
  window_days: number;
  recent_trades: number;
  history_trades: number;
  recent_expectancy: number | null;
  history_expectancy: number | null;
  delta: number | null;
  z_score: number | null;
  p_value: number | null;
  degraded: boolean;
  insufficient_data: boolean;
  note: string;
}

/** Сводный вердикт edge (utils/edge_verification.edgeVerdict) */
export interface EdgeReportDTO {
  verdict: 'positive-edge' | 'no-edge' | 'edge-degrading' | 'insufficient';
  summary: string;
  best_cohort: string | null;
  cohorts: EdgeCohortDTO[];
  degradation: DegradationDTO;
  /** Источник статистики: эмпирический бэктест на истории инструмента */
  source: 'backtest';
  sample_trades: number;
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
