/**
 * Контракт типов NisonAnalytics (П.2 из паспорта работ).
 * Единый источник правды для данных свечей, сигналов, журнала и бэктеста.
 */

/** Свеча OHLCV (Bybit kline / Binance klines в нормализованном виде). */
export interface Candle {
  /** Метка времени открытия свечи, мс с начала эпохи. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Объём базовой валюты. */
  volume: number;
}

export type Side = 'long' | 'short';

export type Timeframe = '15' | '60' | '240' | '1D' | '1W';

/** Результат волевого голосования индикаторов ZoneVoter (методология Нисона). */
export interface ZoneVote {
  zoneLow: number;
  zoneHigh: number;
  /** Голоса «за» уровень (мажоритарное правило Нисона). */
  votesFor: number;
  votesAgainst: number;
  confirmed: boolean;
}

/** Паттерн японских свечей по Стиву Нисону. */
export interface CandlePattern {
  /** Стабильный детерминированный ID (utils/pattern_ids.ts). */
  id: string;
  name: string;
  side: Side;
  /** Индекс свечи подтверждения в массиве свечей. */
  index: number;
  strength: 'weak' | 'medium' | 'strong';
  note?: string;
}

/** Активные торговые настройки пользователя (настраиваются в UI). */
export interface TradeSettings {
  capital: number;
  /** Доля капитала на сделку, % (правило 1% риска). */
  riskPct: number;
  /** Дистанция стопа в ATR. */
  stopAtrMult: number;
  /** Комиссия за сторону сделки, доля от цены (Bybit taker ≈ 0.055%, круглый 0.1%). */
  feeRate: number;
  /** Проскальзывание за сторону, доля от цены. */
  slippageRate: number;
}

export const DEFAULT_TRADE_SETTINGS: TradeSettings = {
  capital: 10_000,
  riskPct: 1,
  stopAtrMult: 1.5,
  feeRate: 0.001,
  slippageRate: 0.0005,
};

/** Стоп по ATR + расчёт размера позиции (правило 1% риска) — п.1 бэклога. */
export interface RiskPlan {
  atr: number;
  stopPrice: number;
  stopAtrMult: number;
  feeRate: number;
  slippageRate: number;
  capital: number;
  riskPct: number;
  /** Абсолютный риск на сделку в валюте капитала. */
  riskAmount: number;
  /** Расстояние до стопа на 1 единицу инструмента (цена). */
  stopDistance: number;
  /** Размер позиции в единицах инструмента. */
  positionQty: number;
  /** Позиция в деньгах (qty × entry). */
  positionValue: number;
  /** Брутто-убыток при выбитом стопе (без издержек). */
  grossStopLoss: number;
  /** Издержки полного цикла (вход+выход): комиссии + проскальзывание. */
  costs: number;
  /** Чистый убыток при выбитом стопе. */
  netStopLoss: number;
}

/** Запись журнала сигналов (localStorage `nison.journal.v1`). */
export interface JournalEntry {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  side: Side;
  patternName: string;
  /** Стабильный ID паттерна — связывает журнал с бэктестом (П.7). */
  patternId: string;
  entryPrice: number;
  stopPrice: number;
  /** Размер позиции в единицах инструмента (пусто для старых записей без сайзинга). */
  qty?: number;
  createdAt: number;
  closedAt?: number;
  exitPrice?: number;
  status: 'open' | 'closed';
  /** Брутто-P&L в % к цене входа (заполняется движком). */
  grossPnlPct?: number;
  /** Нетто-P&L с учётом комиссий и проскальзывания — п.2 бэклога. */
  netPnlPct?: number;
  netPnlMoney?: number;
  /** Итоговые издержки записи, доля от цены входа. */
  costsPct?: number;
}

/** Одна смоделированная сделка движка бэктеста — п.3 бэклога. */
export interface BacktestTrade {
  patternName: string;
  side: Side;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  /** Причина выхода. */
  exitReason: 'stop' | 'tp' | 'time';
  barsHeld: number;
  grossR: number;
  costR: number;
  netR: number;
}

export interface BacktestParams {
  stopAtrMult: number;
  /** Тейк-профит в R (относительно риска до стопа). 0 = выход только по времени. */
  tpR: number;
  /** Максимум свечей в сделке, если ни стоп, ни TP не выбиты. */
  maxBars: number;
  feeRate: number;
  slippageRate: number;
}

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgNetR: number;
  expectancy: number;
  profitFactor: number;
  totalNetR: number;
  maxDrawdownR: number;
  byPattern: Record<string, { trades: number; winRate: number; avgNetR: number }>;
}

export interface BacktestResult {
  params: BacktestParams;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
}
