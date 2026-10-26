import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Activity, AlertTriangle, RefreshCw, Target, Shield, BarChart2, CandlestickChart as ChartIcon } from 'lucide-react';
import { api } from '../api/client';
import CandlestickChart from '../components/CandlestickChart';
import { useBybitLiveCandle } from '../hooks/useBybitLiveCandle';
import { useAnalysisData } from '../hooks/useAnalysisData';
import { useAutoJournalSignals } from '../hooks/useAutoJournalSignals';
import { useResponsiveChartHeight } from '../hooks/useResponsiveChartHeight';
import { useStickyHeaderState } from '../hooks/useStickyHeaderState';
import { useHeaderBadge } from '../components/Layout';
import { MultiTFZonesPanel } from '../components/analysis/MultiTFZonesPanel';
import { MarketContextSection } from '../components/analysis/MarketContextSection';
import { VolumeContextSection, PHASE_SHORT } from '../components/analysis/VolumeContextSection';
import { ZonesGrid } from '../components/analysis/ZonesSection';
import { ConfirmedPatternsList, IndicatorsSection } from '../components/analysis/PatternsAndIndicators';
import { SignalsSection, lifecycleOf } from '../components/analysis/SignalsSection';
import { Collapsible } from '../components/Collapsible';
import Seo from '../components/ui/Seo';
import { analysisMeta } from '../utils/seo';
import { EdgeVerificationPanel } from '../components/MarketContextPanels';
import { formatPrice } from '../utils/format';
import { loadRiskSettings, saveRiskSettings } from '../utils/risk_settings';
import { isValidSymbol } from '../utils/validation';

export default function Analysis() {
  const rawSymbol = useParams<{ symbol: string }>().symbol;
  // Валидация symbol из URL: недопустивые значения не дойдут до внешних API-запросов
  const symbol = rawSymbol && isValidSymbol(rawSymbol) ? rawSymbol.trim().toUpperCase() : undefined;
  const [timeframe, setTimeframe] = useState('D');

  // Адаптивная высота графика: на узких экранах меньше, чтобы влезал без дабл-скролла
  const chartHeight = useResponsiveChartHeight();
  const { report, setReport, multiZones, loading, error, loadAnalysis } = useAnalysisData(symbol, timeframe);
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

  // ── Живая цена и свеча через WebSocket Bybit (kline-поток спота) ──────────
  // Обновляет заголовок цены и последний бар графика в реальном времени без
  // REST-поллинга. По закрытию бара — автоматический полный реанализ.
  const [lastBarCloseTs, setLastBarCloseTs] = useState(0);
  const liveCandle = useBybitLiveCandle(symbol, timeframe, () => setLastBarCloseTs(Date.now()));
  useEffect(() => {
    if (lastBarCloseTs === 0 || !symbol) return;
    const t = setTimeout(() => { loadAnalysis({ force: true }); }, 1500); // даём бирже зафиксировать бар
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBarCloseTs, symbol, timeframe]);

  // Автоматическое сохранение обнаруженных сигналов в журнал
  useAutoJournalSignals(report?.signals, symbol, timeframe);

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

  // ── Mini-заголовок в шапке при прокрутке вниз ────────────────────────────
  // Когда родной заголовок карточки уходит под sticky-навигацию, в шапке
  // появляется пара + актуальная цена (живая с WebSocket, если есть тик <30с).
  const { anchorRef, scrolledPast } = useStickyHeaderState(true);
  const { setBadge } = useHeaderBadge();
  const livePriceFresh = !!liveCandle && Date.now() - liveCandle.ts < 30_000;
  const currentPrice = livePriceFresh ? liveCandle!.close : report.price;
  useEffect(() => {
    if (!symbol) return undefined;
    setBadge(scrolledPast
      ? { title: `${baseAsset}/USDT · ${timeframe}`, price: `$${formatPrice(currentPrice)}`, positive: isPositive }
      : null);
    return () => setBadge(null);
  }, [scrolledPast, symbol, baseAsset, timeframe, currentPrice, isPositive, setBadge]);

  const confirmedPatterns = report.patterns.filter((p) => p.confirmed);
  const volumeRatio = report.candles.length > 0 
    ? report.candles[report.candles.length - 1].volume / 
      (report.candles.reduce((sum: number, c) => sum + c.volume, 0) / report.candles.length)
    : 1;

  // Сигналы с рассчитанным «путём цены» — для selectable-оверлея на профиле объёма
  const pathSignals = report.signals.filter((s) => s.path);

  return (
    <div className="space-y-6">
      <Seo meta={analysisMeta(symbol!)} />
      {/* Навигация */}
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Назад к обзору
      </Link>

      {/* Заголовок с ценой */}
      <div ref={anchorRef} className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
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
            <span className="text-xl sm:text-2xl font-bold text-white">${formatPrice(currentPrice)}</span>
            {livePriceFresh && (
              <span className="animate-live-pulse inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-[11px] font-medium" title="Цена и свеча обновляются в реальном времени через WebSocket Bybit">
                <span className="relative flex w-1.5 h-1.5">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60 animate-ping" />
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-green-400" />
                </span>
                LIVE
              </span>
            )}
            <span className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {isPositive ? '+' : ''}{report.change_24h.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Переключатель таймфреймов */}
        <div className="flex gap-1 p-1 rounded-lg bg-gray-800/50 self-start overflow-x-auto max-w-full">
          {/* Нисон: 30m — минимальный разрешённый ТФ (гл. 8), W — макро-тренд (недельные уровни и MA13/26W) */}
          {['30m', '1H', '4H', 'D', 'W'].map((tf) => (
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
            <span className="text-xs text-gray-400">Consensus {report.consensus.score.toFixed(1)}/5 · Объём {volumeRatio.toFixed(2)}x</span>
          </>
        }
      >
        <MarketContextSection report={report} volumeRatio={volumeRatio} />
      </Collapsible>

      {/* 2. ГРАФИК */}
      <Collapsible
        storageKey="chart"
        icon={<ChartIcon className="w-5 h-5 text-amber-400" />}
        title={`График ${baseAsset}/USDT · ${timeframe}`}
        badge={<span className="text-xs text-gray-400">{report.patterns.length} паттернов · {report.support.length + report.resistance.length} зон</span>}
      >
        <CandlestickChart
          candles={report.candles}
          patterns={report.patterns}
          signals={report.signals}
          support={report.support}
          resistance={report.resistance}
          height={chartHeight}
          live={liveCandle && Date.now() - liveCandle.ts < 30_000 ? liveCandle : null}
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
                <span className="text-xs text-gray-400">
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
          <VolumeContextSection
            report={report}
            pathSignals={pathSignals}
            activePathSignalIdx={activePathSignalIdx}
            onSelectPathSignal={setActivePathSignalIdx}
          />
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
            <span className="text-xs text-gray-400">кластеризация + сила по касаниям (Нисон)</span>
          </>
        }
      >
        <ZonesGrid report={report} />
      </Collapsible>

      {/* 4. ТОЛЬКО ПОДТВЕРЖДЁННЫЕ ПАТТЕРНЫ (по Нисону) */}
      {confirmedPatterns.length > 0 && (
        <Collapsible
          storageKey="patterns"
          icon={<ChartIcon className="w-5 h-5 text-amber-400" />}
          title="Подтверждённые паттерны"
          badge={<span className="text-xs text-gray-400">{confirmedPatterns.length} из {report.patterns.length} · подтверждены объёмом/уровнем</span>}
        >
          <ConfirmedPatternsList patterns={confirmedPatterns} total={report.patterns.length} />
        </Collapsible>
      )}

      {/* 4.5 ВЕРИФИКАЦИЯ ПРЕИМУЩЕСТВА: когорты по режимам + деградация 90 дней */}
      {report.edge && <EdgeVerificationPanel edge={report.edge} />}

      {/* 5. ТОРГОВЫЕ СИГНАЛЫ — аудит №11: живой список со статусами жизненного цикла */}
      {report.signals.filter((s) => lifecycleOf(s) !== 'invalidated').length > 0 && (
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
          <SignalsSection
            report={report}
            riskSettings={riskSettings}
            showRiskPanel={showRiskPanel}
            onToggleRiskPanel={() => setShowRiskPanel((v) => !v)}
            onApplyRisk={applyRiskSettings}
          />
        </Collapsible>
      )}

      {/* Индикаторы */}
      <Collapsible
        storageKey="indicators"
        icon={<Activity className="w-5 h-5 text-sky-400" />}
        title="Индикаторы"
        badge={
          <>
            <span className="text-xs text-gray-400">RSI {report.rsi.toFixed(1)}</span>
            <span className="text-xs text-gray-400">MACD {report.macd.histogram.toFixed(2)}</span>
            <span className="text-xs text-gray-400">Тренд {(report.trend_strength * 100).toFixed(1)}%</span>
          </>
        }
      >
        <IndicatorsSection report={report} />
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
