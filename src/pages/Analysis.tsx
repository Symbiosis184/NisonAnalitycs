import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Activity, AlertTriangle, RefreshCw, Target, Shield, BarChart2, CandlestickChart as ChartIcon } from 'lucide-react';
import { api, type AnalysisReport } from '../api/client';
import type { MultiTFZonesDTO } from '../api/types';
import CandlestickChart from '../components/CandlestickChart';
import { VolumeProfileChart, VolumeProfileNotes, DeltaChart, DeltaNotes } from '../components/VolumeProfilePanel';
import { WyckoffPhasePanel, PricePathCard, EdgeVerificationPanel } from '../components/MarketContextPanels';
import { Collapsible } from '../components/Collapsible';
import { formatPrice } from '../utils/format';
import { addSignal } from '../utils/signalJournal';
import { STATUS_LABEL } from '../utils/signal_lifecycle';
import { loadRiskSettings, saveRiskSettings, RISK_LIMITS } from '../utils/risk_settings';
import { isValidSymbol } from '../utils/validation';
import { describeNetworkError } from '../utils/http';
import type { RiskSettings } from '../api/types';

/** Аудит №10: панель ввода капитала и риска на сделку (значения нормализуются saveRiskSettings). */

/**
 * Зоны S/R на каждом таймфрейме (запрос: «зоны поддержки/сопротивления на каждом ТФ»).
 * Для каждого интервала уровни собираются ZoneVoter'ом с собственными параметрами
 * (толеранс, окно свингов, порог пробоя — см. ZONE_PARAMS), поэтому список зон
 * различается между ТФ. Активный ТФ анализа помечен бейджем.
 */
const TF_LABEL: Record<string, string> = {
  '15': '15м', '30': '30м', '60': '1ч', '1H': '1ч', '2H': '2ч', '4H': '4ч', D: '1Д', W: '1Н',
};

/** Краткие названия фаз Вайкоффа для бейджа свёрнутой секции */
const PHASE_SHORT: Record<string, string> = {
  accumulation: 'Накопление', markup: 'Рост', distribution: 'Распределение', markdown: 'Падение', transition: 'Переход',
};

function MultiTFZonesPanel({ rows, activeTf }: { rows: MultiTFZonesDTO[]; activeTf: string }) {
  if (!rows.length) return null;
  return (
    <Collapsible
      storageKey="multitf"
      icon={<Shield className="w-5 h-5 text-purple-400" />}
      title="Мульти-ТФ карта уровней S/R"
      badge={
        <>
          <span className="text-xs text-gray-500">{rows.length} ТФ</span>
          <span className="text-[10px] text-gray-600 hidden sm:inline">каждый ТФ — со своей калибровкой</span>
        </>
      }
    >
    <div className="p-3 rounded-lg bg-gray-800/40 border border-gray-700/50">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-700/50">
              <th className="py-1 pr-3 font-medium">ТФ</th>
              <th className="py-1 pr-3 font-medium">Масштаб</th>
              <th className="py-1 pr-3 font-medium">Сопротивления ↑</th>
              <th className="py-1 pr-3 font-medium">Поддержки ↓</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.timeframe} className="border-b border-gray-800/60 align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={`font-mono ${r.timeframe === activeTf ? 'text-amber-400 font-bold' : 'text-gray-300'}`}>
                    {TF_LABEL[r.timeframe] ?? r.timeframe}
                  </span>
                  {r.timeframe === activeTf && (
                    <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">активный</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{r.scale}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1.5">
                    {r.resistance.slice(0, 4).map((z) => (
                      <span key={z.level} title={`${z.reasons.join(', ')} · ${z.touches} касаний`}
                        className={`px-1.5 py-0.5 rounded font-mono border ${z.strong ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-gray-700 bg-gray-800/40 text-gray-400'}`}>
                        {formatPrice(z.level)}{z.halfWidth ? ` ±${formatPrice(z.halfWidth)}` : ''}{z.strong ? ' ★' : ''}
                      </span>
                    ))}
                    {!r.resistance.length && <span className="text-gray-600">—</span>}
                  </div>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {r.support.slice(0, 4).map((z) => (
                      <span key={z.level} title={`${z.reasons.join(', ')} · ${z.touches} касаний`}
                        className={`px-1.5 py-0.5 rounded font-mono border ${z.strong ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-gray-700 bg-gray-800/40 text-gray-400'}`}>
                        {formatPrice(z.level)}{z.halfWidth ? ` ±${formatPrice(z.halfWidth)}` : ''}{z.strong ? ' ★' : ''}
                      </span>
                    ))}
                    {!r.support.length && <span className="text-gray-600">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-gray-600">★ — сильная зона (≥3 голосов); ± — полуширина зоны (ATR-калиброванная, Нисон: уровень это полоса, а не линия).</p>
    </div>
    </Collapsible>
  );
}
function RiskSettingsPanel({ settings, onApply }: {
  settings: RiskSettings;
  onApply: (capitalUsd: number, riskPct: number) => void;
}) {
  const [capital, setCapital] = useState(String(settings.capitalUsd));
  const [risk, setRisk] = useState((settings.riskPct * 100).toFixed(1));
  return (
    <div className="mb-4 p-3 rounded-lg bg-gray-800/40 border border-gray-700/50 flex flex-wrap items-end gap-3 text-sm overflow-x-auto">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">Капитал, $ ({RISK_LIMITS.minCapital}–{RISK_LIMITS.maxCapital.toLocaleString('ru-RU')})</span>
        <input
          type="number" min={RISK_LIMITS.minCapital} max={RISK_LIMITS.maxCapital} value={capital}
          onChange={(e) => setCapital(e.target.value)}
          className="w-36 px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-white font-mono"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">Риск на сделку, % ({RISK_LIMITS.minRiskPct * 100}–{RISK_LIMITS.maxRiskPct * 100})</span>
        <input
          type="number" step="0.1" min={RISK_LIMITS.minRiskPct * 100} max={RISK_LIMITS.maxRiskPct * 100} value={risk}
          onChange={(e) => setRisk(e.target.value)}
          className="w-24 px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-white font-mono"
        />
      </label>
      <button
        onClick={() => onApply(Number(capital), Number(risk) / 100)}
        className="px-3 py-1.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-xs font-medium"
      >
        Применить
      </button>
      <span className="text-[11px] text-gray-500">Планы позиций пересчитаются для всех сигналов.</span>
    </div>
  );
}

export default function Analysis() {
  const rawSymbol = useParams<{ symbol: string }>().symbol;
  // Валидация symbol из URL: недопустивые значения не дойдут до внешних API-запросов
  const symbol = rawSymbol && isValidSymbol(rawSymbol) ? rawSymbol.trim().toUpperCase() : undefined;
  const [timeframe, setTimeframe] = useState('D');

  // Адаптивная высота графика: на узких экранах меньше, чтобы влезал без дабл-скролла
  const [chartHeight, setChartHeight] = useState(() =>
    typeof window !== 'undefined' ? (window.innerWidth < 480 ? 320 : window.innerWidth < 768 ? 400 : 500) : 500);
  useEffect(() => {
    const onResize = () => setChartHeight(window.innerWidth < 480 ? 320 : window.innerWidth < 768 ? 400 : 500);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  // Мульти-ТФ карта зон S/R (загружается отдельно от основного анализа)
  const [multiZones, setMultiZones] = useState<MultiTFZonesDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Визуализация: активный сигнал, чей «путь цены» оверлеем на профиле объёма
  const [activePathSignalIdx, setActivePathSignalIdx] = useState(0);
  // Аудит №10: риск-настройки пользователя (капитал/риск на сделку) — localStorage
  const [riskSettings, setRiskSettings] = useState(loadRiskSettings);
  const [showRiskPanel, setShowRiskPanel] = useState(false);

  const applyRiskSettings = (capitalUsd: number, riskPct: number) => {
    const clean = saveRiskSettings({ capitalUsd, riskPct });
    setRiskSettings(clean);
    // Пересчитываем планы позиций уже загруженных сигналов без нового сетевого запроса
    setReport((prev) => prev && ({
      ...prev,
      signals: prev.signals.map((s) => {
        const plan = api.planForSignal(s, clean);
        const next = { ...s };
        delete next.position_plan;
        return plan ? { ...next, position_plan: plan } : next;
      }),
    }));
  };

  const loadAnalysis = async () => {
    if (!symbol) return;
    
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAnalysis(symbol, timeframe);
      setReport(data);
    } catch (err) {
      console.error('Ошибка загрузки анализа:', err);
      setError(describeNetworkError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalysis();
  }, [symbol, timeframe]);

  // Мульти-ТФ карта зон: грузится параллельно с основным анализом, ошибки не блокируют страницу
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const tfs = ['15', '60', '4H', 'D', 'W'];
    if (!tfs.includes(timeframe)) tfs.push(timeframe);
    api.getMultiTimeframeZones(symbol, tfs)
      .then((rows) => { if (!cancelled) setMultiZones(rows); })
      .catch((err) => { console.error('Ошибка мульти-ТФ зон:', err); if (!cancelled) setMultiZones([]); });
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  // Автоматическое сохранение обнаруженных сигналов в журнал
  useEffect(() => {
    if (report && report.signals) {
      // Аудит №11: в журнал попадают сигналы со статусом pending (ожидает
      // подтверждения) и confirmed; invalidated/expired не записываем.
      report.signals.forEach((signal) => {
        const st = signal.lifecycle_status ?? (signal.confirmed ? 'confirmed' : 'pending');
        if (st === 'pending' || st === 'confirmed') {
          const result = addSignal({
            symbol: symbol || '',
            timeframe,
            pattern: signal.pattern,
            direction: signal.direction,
            entryPrice: signal.entry_price,
            stopLoss: signal.stop_loss,
            target: signal.target,
            riskReward: signal.rr,
            confidence: signal.quality * 100,
          });
          
          if (result) {
            console.log(`✓ Сигнал автоматически сохранён в журнал: ${signal.pattern} для ${symbol}`);
          }
        }
      });
    }
  }, [report, symbol, timeframe]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Загрузка анализа...</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 rounded-lg bg-red-500/10 border border-red-500/20">
        <AlertTriangle className="w-6 h-6 text-red-400 mb-2" />
        <p className="text-red-400 font-semibold">Ошибка</p>
        <p className="text-gray-400 text-sm mt-1">{error || 'Данные не найдены'}</p>
      </div>
    );
  }

  const baseAsset = symbol?.replace('USDT', '') || '';
  const isPositive = report.change_24h >= 0;
  const confirmedPatterns = report.patterns.filter((p) => p.confirmed);
  const volumeRatio = report.candles.length > 0 
    ? report.candles[report.candles.length - 1].volume / 
      (report.candles.reduce((sum: number, c) => sum + c.volume, 0) / report.candles.length)
    : 1;

  const getConsensusColor = (score: number) => {
    if (score >= 4) return 'text-green-400 bg-green-500/10 border-green-500/20';
    if (score >= 2) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  };

  // Сигналы с рассчитанным «путём цены» — для selectable-оверлея на профиле объёма
  const pathSignals = report.signals.filter((s) => s.path);
  const activePathSignal =
    activePathSignalIdx >= 0 ? pathSignals[Math.min(activePathSignalIdx, pathSignals.length - 1)] : undefined;

  return (
    <div className="space-y-6">
      {/* Навигация */}
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Назад к обзору
      </Link>

      {/* Заголовок с ценой */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{baseAsset}/USDT</h1>
            <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
              report.trend === 'ВОСХОДЯЩИЙ' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              report.trend === 'НИСХОДЯЩИЙ' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
              'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
            }`}>
              {report.trend}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            <span className="text-xl sm:text-2xl font-bold text-white">${formatPrice(report.price)}</span>
            <span className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {isPositive ? '+' : ''}{report.change_24h.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Переключатель таймфреймов */}
        <div className="flex gap-1 p-1 rounded-lg bg-gray-800/50 self-start overflow-x-auto max-w-full">
          {['15m', '1H', '4H', 'D'].map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                timeframe === tf
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* 1. КОНТЕКСТ РЫНКА (по Нисону - сначала контекст) */}
      <Collapsible
        storageKey="context"
        icon={<Activity className="w-5 h-5 text-sky-400" />}
        title="Контекст рынка"
        badge={
          <>
            <span className={`text-xs font-semibold ${
              report.regime === 'ВОСХОДЯЩИЙ' ? 'text-green-400' : report.regime === 'НИСХОДЯЩИЙ' ? 'text-red-400' : 'text-yellow-400'
            }`}>{report.regime}</span>
            <span className="text-xs text-gray-500">Consensus {report.consensus.score.toFixed(1)}/5 · Объём {volumeRatio.toFixed(2)}x</span>
          </>
        }
      >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Режим рынка */}
        <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Режим рынка
          </h3>
          <div className={`text-2xl font-bold ${
            report.regime === 'ВОСХОДЯЩИЙ' ? 'text-green-400' :
            report.regime === 'НИСХОДЯЩИЙ' ? 'text-red-400' : 'text-yellow-400'
          }`}>
            {report.regime}
          </div>
          <div className="text-xs text-gray-500 mt-1">{report.regime_description}</div>
        </div>

        {/* Consensus Score */}
        <div className={`p-4 rounded-xl border ${getConsensusColor(report.consensus.score)}`}>
          <h3 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
            <Target className="w-4 h-4" />
            Consensus Score
          </h3>
          <div className="text-2xl font-bold">
            {report.consensus.score.toFixed(1)}/5
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Уверенность: {report.consensus.confidence.toFixed(0)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {report.consensus.direction === 'buy' ? 'Бычий консенсус' :
             report.consensus.direction === 'sell' ? 'Медвежий консенсус' : 'Нейтральный'}
          </div>
        </div>

        {/* Объём */}
        <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            Объём
          </h3>
          <div className={`text-2xl font-bold ${
            volumeRatio > 1.5 ? 'text-green-400' :
            volumeRatio < 0.5 ? 'text-red-400' : 'text-white'
          }`}>
            {volumeRatio.toFixed(2)}x
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {volumeRatio > 1.5 ? 'Повышенный объём - подтверждение' :
             volumeRatio < 0.5 ? 'Низкий объём - слабость' : 'Нормальный объём'}
          </div>
        </div>
      </div>
      </Collapsible>

      {/* 2. ГРАФИК */}
      <Collapsible
        storageKey="chart"
        icon={<ChartIcon className="w-5 h-5 text-amber-400" />}
        title={`График ${baseAsset}/USDT · ${timeframe}`}
        badge={<span className="text-xs text-gray-500">{report.patterns.length} паттернов · {report.support.length + report.resistance.length} зон</span>}
      >
        <CandlestickChart
          candles={report.candles}
          patterns={report.patterns}
          support={report.support}
          resistance={report.resistance}
          height={chartHeight}
        />
      </Collapsible>

      {/* 2.5 КОНТЕКСТ РЫНКА: фазы Вайкоффа + профиль объёма с «путём цены» + дельта */}
      {(report.wyckoff || report.volume_profile || report.delta_summary) && (
        <Collapsible
          storageKey="vprofile"
          icon={<BarChart2 className="w-5 h-5 text-blue-400" />}
          title="Контекст рынка и объёма"
          badge={
            <>
              {report.wyckoff && (
                <span className="text-xs text-gray-500">
                  Вайкофф: {PHASE_SHORT[report.wyckoff.phase]} · {(report.wyckoff.confidence * 100).toFixed(0)}%
                </span>
              )}
              {report.delta_summary && (
                <span className={`text-xs font-mono ${report.delta_summary.cumulative_delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ΣΔ {report.delta_summary.cumulative_delta >= 0 ? '+' : ''}{Math.round(report.delta_summary.cumulative_delta).toLocaleString('ru-RU')}
                </span>
              )}
            </>
          }
        >
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {report.volume_profile && (
              <div className="lg:col-span-2 p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4" />
                    Профиль объёма · HVN/LVN · Value Area
                  </h3>
                  {pathSignals.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => setActivePathSignalIdx(-1)}
                        className={`px-2 py-0.5 rounded text-[11px] ${activePathSignalIdx === -1 ? 'bg-gray-700 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'}`}
                      >
                        без сигнала
                      </button>
                      {pathSignals.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => setActivePathSignalIdx(i)}
                          className={`px-2 py-0.5 rounded text-[11px] ${
                            activePathSignalIdx === i
                              ? (s.direction === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400')
                              : 'bg-gray-800/50 text-gray-400 hover:text-white'
                          }`}
                          title={`Показать путь цены: ${s.pattern}`}
                        >
                          {s.direction === 'long' ? '▲' : '▼'} {s.pattern}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <VolumeProfileChart
                  profile={report.volume_profile}
                  price={report.price}
                  signal={activePathSignal}
                />
                {activePathSignal?.path && (
                  <div className="mt-2 text-xs text-gray-400 leading-relaxed border-t border-gray-800/50 pt-2">
                    🛤️ {activePathSignal.path.description}
                  </div>
                )}
                {/* Текстовая расшифровка профиля — что означают узлы и как их читать */}
                <details className="mt-2 text-xs border-t border-gray-800/50 pt-2">
                  <summary className="cursor-pointer select-none text-gray-300 hover:text-white">
                    ℹ️ Как читать профиль объёма
                  </summary>
                  <VolumeProfileNotes profile={report.volume_profile} price={report.price} />
                </details>
              </div>
            )}
            {report.wyckoff && <WyckoffPhasePanel wyckoff={report.wyckoff} />}
          </div>
          {report.delta_summary && (
            <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
              <h3 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Дельта агрессии (покупатели − продавцы)
              </h3>
              <DeltaChart summary={report.delta_summary} />
              {/* Текстовая расшифровка: что означают столбцы/линия и что происходит сейчас */}
              <details className="mt-2 text-xs border-t border-gray-800/50 pt-2">
                <summary className="cursor-pointer select-none text-gray-300 hover:text-white">
                  ℹ️ Как читать дельту агрессии
                </summary>
                <div className="mt-2">
                  <DeltaNotes summary={report.delta_summary} priceChangePct={report.change_24h} />
                </div>
              </details>
            </div>
          )}
        </div>
        </Collapsible>
      )}

      {/* 3. КЛЮЧЕВЫЕ УРОВНИ S/R ПО МЕТОДОЛОГИИ НИСОНА */}
      <MultiTFZonesPanel rows={multiZones} activeTf={timeframe} />
      <Collapsible
        storageKey="zones"
        icon={<Shield className="w-5 h-5 text-green-400" />}
        title={`Зоны поддержки и сопротивления · ${timeframe}`}
        badge={
          <>
            <span className="text-xs text-green-400">↓ {report.support.length}</span>
            <span className="text-xs text-red-400">↑ {report.resistance.length}</span>
            <span className="text-xs text-gray-500">кластеризация + сила по касаниям (Нисон)</span>
          </>
        }
      >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Поддержка */}
        <div className="p-4 rounded-xl border border-green-500/20 bg-green-500/5">
          <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Зоны поддержки (по Нисону)
          </h3>
          <div className="space-y-3">
            {report.support.slice(0, 5).map((zone, idx: number) => (
              <div key={idx} className={`p-3 rounded-lg border ${
                zone.strong ? 'border-green-500/30 bg-green-500/5' : 'border-gray-700/30 bg-gray-800/20'
              }`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="text-green-400 font-mono text-lg">${formatPrice(zone.level)}{zone.halfWidth ? <span className="text-xs text-gray-500 ml-1">[{formatPrice(zone.level - zone.halfWidth)}–{formatPrice(zone.level + zone.halfWidth)}]</span> : null}</span>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="text-xs text-gray-500">{zone.touches} касаний</span>
                    {zone.strong && (
                      <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-400 text-xs font-semibold">
                        СИЛЬНАЯ
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  <div className="mb-1">Голосов: {zone.votes}</div>
                  <div className="text-gray-500">
                    {zone.reasons.map((reason: string, i: number) => (
                      <span key={i} className="inline-block mr-2">• {reason}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Сопротивление */}
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Зоны сопротивления (по Нисону)
          </h3>
          <div className="space-y-3">
            {report.resistance.slice(0, 5).map((zone, idx: number) => (
              <div key={idx} className={`p-3 rounded-lg border ${
                zone.strong ? 'border-red-500/30 bg-red-500/5' : 'border-gray-700/30 bg-gray-800/20'
              }`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="text-red-400 font-mono text-lg">${formatPrice(zone.level)}{zone.halfWidth ? <span className="text-xs text-gray-500 ml-1">[{formatPrice(zone.level - zone.halfWidth)}–{formatPrice(zone.level + zone.halfWidth)}]</span> : null}</span>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="text-xs text-gray-500">{zone.touches} касаний</span>
                    {zone.strong && (
                      <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 text-xs font-semibold">
                        СИЛЬНАЯ
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  <div className="mb-1">Голосов: {zone.votes}</div>
                  <div className="text-gray-500">
                    {zone.reasons.map((reason: string, i: number) => (
                      <span key={i} className="inline-block mr-2">• {reason}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </Collapsible>

      {/* 4. ТОЛЬКО ПОДТВЕРЖДЁННЫЕ ПАТТЕРНЫ (по Нисону) */}
      {confirmedPatterns.length > 0 && (
        <Collapsible
          storageKey="patterns"
          icon={<ChartIcon className="w-5 h-5 text-amber-400" />}
          title="Подтверждённые паттерны"
          badge={<span className="text-xs text-gray-500">{confirmedPatterns.length} из {report.patterns.length} · подтверждены объёмом/уровнем</span>}
        >
        <div className="p-6 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            🕯️ Подтверждённые паттерны
            <span className="text-xs text-gray-500 font-normal ml-2">
              ({confirmedPatterns.length} из {report.patterns.length})
            </span>
          </h3>
          <div className="space-y-3">
            {confirmedPatterns.map((pattern, i: number) => (
              <div
                key={i}
                className={`p-4 rounded-lg border ${
                  pattern.type === 'bullish' 
                    ? 'bg-green-500/5 border-green-500/20' 
                    : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                {/* Моб.: имя и бейджи в столбик (flex-col), на sm+ — строкой; бейжди не наезжают */}
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`text-lg ${
                      pattern.type === 'bullish' ? 'text-green-400' :
                      pattern.type === 'bearish' ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {pattern.type === 'bullish' ? '▲' : pattern.type === 'bearish' ? '▼' : '◆'}
                    </span>
                    <div className="min-w-0">
                      <div className={`truncate text-sm font-semibold ${
                        pattern.type === 'bullish' ? 'text-green-400' :
                        pattern.type === 'bearish' ? 'text-red-400' : 'text-gray-300'
                      }`}>
                        {pattern.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        Уверенность: {pattern.confidence}%
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 sm:justify-end">
                    <span className="whitespace-nowrap rounded border border-green-500/20 bg-green-500/10 px-2 py-1 text-xs text-green-400">
                      ✓ Подтверждён
                    </span>
                    {pattern.hasVolume && (
                      <span className="whitespace-nowrap rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
                        📊 Объём
                      </span>
                    )}
                    {pattern.atLevel && (
                      <span className="whitespace-nowrap rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-xs text-purple-400">
                        🎯 У уровня
                      </span>
                    )}
                  </div>
                </div>
                {pattern.story && (
                  <div className="text-xs text-gray-400 italic border-t border-gray-800/50 pt-2 mt-2">
                    📖 {pattern.story}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        </Collapsible>
      )}

      {/* 4.5 ВЕРИФИКАЦИЯ ПРЕИМУЩЕСТВА: когорты по режимам + деградация 90 дней */}
      {report.edge && <EdgeVerificationPanel edge={report.edge} />}

      {/* 5. ТОРГОВЫЕ СИГНАЛЫ — аудит №11: живой список со статусами жизненного цикла */}
      {report.signals.filter((s) => (s.lifecycle_status ?? (s.confirmed ? 'confirmed' : 'pending')) !== 'invalidated').length > 0 && (
        <Collapsible
          storageKey="signals"
          icon={<Target className="w-5 h-5 text-amber-400" />}
          title="Сценарии (Нисон: ожидание → подтверждение)"
          badge={
            <>
              <span className="text-xs text-green-400">✓ {report.signals.filter((s) => s.lifecycle_status === 'confirmed').length}</span>
              <span className="text-xs text-yellow-400">⏳ {report.signals.filter((s) => (s.lifecycle_status ?? 'pending') === 'pending').length}</span>
            </>
          }
        >
        <div className="p-6 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-amber-400" />
            Сценарии (Нисон: ожидание → подтверждение)
            <span className="text-xs text-gray-500 font-normal ml-2">
              подтверждено {report.signals.filter((s) => s.lifecycle_status === 'confirmed').length} · ждёт {report.signals.filter((s) => (s.lifecycle_status ?? 'pending') === 'pending').length} из {report.signals.length}
            </span>
            {/* Аудит №10: редактор риск-настроек для расчёта размера позиции */}
            <button
              onClick={() => setShowRiskPanel((v) => !v)}
              className="ml-auto px-2 py-1 rounded text-xs font-medium bg-gray-800/60 text-gray-300 hover:text-white border border-gray-700/50"
            >
              Риск: {(riskSettings.riskPct * 100).toFixed(1)}% · {riskSettings.capitalUsd.toLocaleString('ru-RU')} $
            </button>
          </h3>
          {showRiskPanel && (
            <RiskSettingsPanel settings={riskSettings} onApply={applyRiskSettings} />
          )}
          <div className="space-y-3">
            {report.signals.filter((signal) => (signal.lifecycle_status ?? (signal.confirmed ? 'confirmed' : 'pending')) !== 'invalidated').map((signal, idx: number) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border ${
                  signal.direction === 'long'
                    ? 'bg-green-500/5 border-green-500/20'
                    : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {signal.direction === 'long' ? (
                        <TrendingUp className="w-5 h-5 text-green-400" />
                      ) : (
                        <TrendingDown className="w-5 h-5 text-red-400" />
                      )}
                      <span className={`text-lg font-bold ${
                        signal.direction === 'long' ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {signal.direction === 'long' ? 'LONG' : 'SHORT'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">{signal.pattern}</p>
                  </div>
                  <div className="sm:text-right">
                    <div className="text-xs text-gray-500">Качество</div>
                    <div className={`text-lg font-bold ${
                      signal.quality >= 0.7 ? 'text-green-400' :
                      signal.quality >= 0.5 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {(signal.quality * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 text-sm mb-3 sm:grid-cols-3 sm:gap-4">
                  <div className="p-2 rounded bg-gray-800/30">
                    <div className="text-xs text-gray-500 mb-1">Вход</div>
                    <div className="font-mono text-white">${formatPrice(signal.entry_price)}</div>
                  </div>
                  <div className="p-2 rounded bg-gray-800/30">
                    <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      Стоп
                    </div>
                    <div className="font-mono text-red-400">${formatPrice(signal.stop_loss)}</div>
                  </div>
                  <div className="p-2 rounded bg-gray-800/30">
                    <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      Цель
                    </div>
                    <div className="font-mono text-green-400">${formatPrice(signal.target)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs border-t border-gray-800/50 pt-2">
                  <div>
                    <span className="text-gray-500">R:R </span>
                    <span className="text-white font-mono">1:{signal.rr.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Риск </span>
                    <span className="text-white font-mono">{(signal.risk * 100).toFixed(2)}%</span>
                  </div>
                  {signal.htf && (
                    <div title={`Тренд старшего ТФ (${signal.htf.timeframe}): ${signal.htf.trend}`}>
                      <span className="text-gray-500">HTF {signal.htf.timeframe} </span>
                      <span className={signal.htf.aligned ? 'text-green-400' : 'text-orange-400'}>
                        {signal.htf.aligned ? '✓ согласован' : '⚠ против'}
                      </span>
                    </div>
                  )}
                  {(() => {
                    const st = signal.lifecycle_status ?? (signal.confirmed ? 'confirmed' : 'pending');
                    const cls = st === 'confirmed' ? 'bg-green-500/10 text-green-400'
                      : st === 'pending' ? 'bg-yellow-500/10 text-yellow-400'
                      : 'bg-gray-500/10 text-gray-400';
                    return (
                      <span className={`px-2 py-1 rounded ${cls}`}>
                        {st === 'confirmed' ? '✓' : st === 'pending' ? '⏳' : '–'} {STATUS_LABEL[st]}
                      </span>
                    );
                  })()}
                </div>

                {/* «Путь цены» до цели: формальный RR vs adjusted RR, препятствия транзита */}
                {signal.path && (
                  <div className="mt-2">
                    <PricePathCard signal={signal} />
                  </div>
                )}

                {/* Аудит №10: план размера позиции по правилу фиксированного риска */}
                {signal.position_plan && (
                  <div className="mt-3 p-3 rounded-lg bg-gray-800/30 border border-gray-700/40">
                    <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      План позиции ({riskSettings.capitalUsd.toLocaleString('ru-RU')} $, риск {(riskSettings.riskPct * 100).toFixed(1)}%)
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-gray-500">Объём</div>
                        <div className="font-mono text-white">{signal.position_plan.qty.toFixed(6)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Номинал</div>
                        <div className="font-mono text-white">{Math.round(signal.position_plan.notional_usd).toLocaleString('ru-RU')} $</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Убыток по стопу</div>
                        <div className="font-mono text-red-400">
                          −{Math.round(signal.position_plan.worst_case_loss_usd).toLocaleString('ru-RU')} $
                          {' '}({signal.position_plan.worst_case_loss_pct.toFixed(2)}%)
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500">Издержки цикла</div>
                        <div className="font-mono text-yellow-400">{Math.round(signal.position_plan.cost_reserve_usd)} $</div>
                      </div>
                    </div>
                    {signal.position_plan.capped_by_notional && (
                      <div className="text-[11px] text-orange-400 mt-1">
                        ⚠ Объём ограничен потолком номинала — фактический риск меньше заявленного.
                      </div>
                    )}
                  </div>
                )}

                {signal.story && (
                  <div className="mt-3 p-3 rounded bg-gray-800/30 text-xs text-gray-400">
                    📖 {signal.story}
                  </div>
                )}

                <div className="mt-3 p-2 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-400">
                  ✓ Сигнал автоматически сохранён в журнал
                </div>
              </div>
            ))}
          </div>
        </div>
        </Collapsible>
      )}

      {/* Индикаторы */}
      <Collapsible
        storageKey="indicators"
        icon={<Activity className="w-5 h-5 text-sky-400" />}
        title="Индикаторы"
        badge={
          <>
            <span className="text-xs text-gray-500">RSI {report.rsi.toFixed(1)}</span>
            <span className="text-xs text-gray-500">MACD {report.macd.histogram.toFixed(2)}</span>
            <span className="text-xs text-gray-500">Тренд {(report.trend_strength * 100).toFixed(1)}%</span>
          </>
        }
      >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">RSI (14)</h3>
          <div className={`text-3xl font-bold ${
            report.rsi > 70 ? 'text-red-400' :
            report.rsi < 30 ? 'text-green-400' : 'text-white'
          }`}>
            {report.rsi.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {report.rsi > 70 ? 'Перекупленность' :
             report.rsi < 30 ? 'Перепроданность' : 'Нейтрально'}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">MACD</h3>
          <div className={`text-3xl font-bold ${
            report.macd.histogram > 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {report.macd.histogram.toFixed(2)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {report.macd.histogram > 0 ? 'Бычий моментум' : 'Медвежий моментум'}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Тренд</h3>
          <div className={`text-3xl font-bold ${
            report.trend === 'ВОСХОДЯЩИЙ' ? 'text-green-400' :
            report.trend === 'НИСХОДЯЩИЙ' ? 'text-red-400' : 'text-yellow-400'
          }`}>
            {report.trend_strength.toFixed(0)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Сила тренда
          </div>
        </div>
      </div>
      </Collapsible>

      {/* Дисклеймер */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className="text-amber-400">Внимание:</strong> Данный анализ основан на методологии Стива Нисона.
            Контекст рынка важнее отдельных паттернов. Всегда используйте подтверждение и управление рисками.
            Это не является финансовой рекомендацией.
          </p>
        </div>
      </div>
    </div>
  );
}
