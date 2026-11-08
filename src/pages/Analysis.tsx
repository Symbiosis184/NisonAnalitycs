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
import { BeyondCandlesticksPanel } from '../components/analysis/BeyondCandlesticksPanel';
import { SignalsSection, lifecycleOf } from '../components/analysis/SignalsSection';
import { Collapsible } from '../components/Collapsible';
import Seo from '../components/ui/Seo';
import { analysisMeta } from '../utils/seo';
import { EdgeVerificationPanel } from '../components/MarketContextPanels';
import { formatPrice } from '../utils/format';
import { loadRiskSettings, saveRiskSettings } from '../utils/risk_settings';
import { isValidSymbol } from '../utils/validation';
import { isStockSymbol } from '../api/market';
import { useI18n } from '../i18n';

export default function Analysis() {
  const { t, locale } = useI18n();
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

  const baseAsset = symbol?.replace('USDT', '') ?? ''; // 'BTCUSDT' -> 'BTC', 'AAPL:STOCK' -> 'AAPL'
  // Для акций ':STOCK' суффикс убираем, но рынок помним: заголовок 'AAPL', без '/USDT'
  const isStock = isStockSymbol(symbol);
  const displayPair = isStock ? baseAsset : `${baseAsset}/USDT`;
  // Все числовые поля отчёта пропускаем через num(): если бэкенд/прокси вернул
  // null/undefined/строку вместо числа, .toFixed()/операции давали бы NaN или
  // TypeError — а рендер объекта в JSX вызывает Minified React error #310.
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const change24h = num(report?.change_24h);
  const isPositive = change24h >= 0;

  // ── Mini-заголовок в шапке при прокрутке вниз ────────────────────────────
  // Когда родной заголовок карточки уходит под sticky-навигацию, в шапке
  // появляется пара + актуальная цена (живая с WebSocket, если есть тик <30с).
  // ВАЖНО: хук useStickyHeaderState вызывается БЕЗУСЛОВНО (в начале тела
  // компонента), а включается/выключается через параметр enabled. Если бы мы
  // делали `enabled ? useStickyHeaderState(true) : inert`, условный хук при
  // переходе loading→ready менял бы порядок hooks и React падал с ошибкой
  // #310 («Rendered fewer hooks than expected») — ровно так, как на проде.
  const hasReport = !loading && !error && !!report;
  const { anchorRef, scrolledPast } = useStickyHeaderState(hasReport);
  const { setBadge } = useHeaderBadge();

  // Данные бейджа + цена в заголовке — считаем лениво (без хуков), только
  // когда отчёт готов. currentPrice всегда число — иначе в шапке или в
  // заголовке мог появиться битый бейдж (#310).
  const livePriceFresh = !!liveCandle && Date.now() - liveCandle.ts < 30_000;
  let currentPrice = 0;
  let badgeTitle: string | null = null;
  let badgePrice: string | null = null;
  if (hasReport && report) {
    // Фолбэк цены: живая свеча → цена отчёта → последний закрытый бар → тик из URL.
    const lastClosedClose = report.candles.length > 0
      ? num(report.candles[report.candles.length - 1].close) : NaN;
    const tickFromSymbol = Number.parseFloat(symbol || '');
    const rawPrice = livePriceFresh ? num(liveCandle!.close) : num(report.price);
    currentPrice = Number.isFinite(rawPrice) && rawPrice > 0
      ? rawPrice
      : (Number.isFinite(lastClosedClose) && lastClosedClose > 0 ? lastClosedClose
        : (Number.isFinite(tickFromSymbol) ? tickFromSymbol : 0));
    badgeTitle = `${displayPair} · ${timeframe}`;
    badgePrice = `$${formatPrice(currentPrice)}`;
  }

  // setBadge вызывается ТОЛЬКО внутри эффекта и только plain-объектом строк —
  // это исключает «setState during render» и рендер не-строки в шапке (#310).
  useEffect(() => {
    if (!symbol || !scrolledPast || !badgeTitle || !badgePrice) {
      setBadge(null);
      return undefined;
    }
    setBadge({ title: badgeTitle, price: badgePrice, positive: isPositive });
    return () => setBadge(null);
  }, [scrolledPast, symbol, badgeTitle, badgePrice, isPositive, setBadge]);

  // Ранние выходы — ПОСЛЕ всех хуков компонента (см. правило хуков React).
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">{t('Загрузка анализа...')}</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 rounded-lg bg-red-500/10 border border-red-500/20">
        <AlertTriangle className="w-6 h-6 text-red-400 mb-2" />
        <p className="text-red-400 font-semibold">{t('Ошибка')}</p>
        <p className="text-gray-400 text-sm mt-1">{t(error || 'Данные не найдены')}</p>
      </div>
    );
  }

  const confirmedPatterns = report.patterns.filter((p) => p.confirmed);
  // Consensus может отсутствовать у старых кэшированных отчётов — защищаемся.
  const consensusScore = num(report.consensus?.score);
  const lastBarVolume = report.candles.length > 0 ? num(report.candles[report.candles.length - 1].volume) : 0;
  const avgVolume = report.candles.length > 0
    ? report.candles.reduce((sum: number, c) => sum + num(c.volume), 0) / report.candles.length
    : 0;
  const volumeRatio = (avgVolume > 0 && Number.isFinite(avgVolume)) ? lastBarVolume / avgVolume : 1;

  // Сигналы с рассчитанным «путём цены» — для selectable-оверлея на профиле объёма
  const pathSignals = report.signals.filter((s) => s.path);

  return (
    <div className="space-y-6">
      <Seo meta={analysisMeta(symbol!)} />
      {/* Навигация */}
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        {t('Назад к обзору')}
      </Link>

      {/* Заголовок с ценой */}
      <div ref={anchorRef} className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{displayPair}</h1>
            <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
              report.trend === 'ВОСХОДЯЩИЙ' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              report.trend === 'НИСХОДЯЩИЙ' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
              'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
            }`}>
              {t(report.trend)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            <span className="text-xl sm:text-2xl font-bold text-white">${formatPrice(currentPrice)}</span>
            {livePriceFresh && (
              <span className="animate-live-pulse inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-[11px] font-medium" title={t('Цена и свеча обновляются в реальном времени через WebSocket Bybit')}>
                <span className="relative flex w-1.5 h-1.5">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60 animate-ping" />
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-green-400" />
                </span>
                LIVE
              </span>
            )}
            <span className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {isPositive ? '+' : ''}{change24h.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Переключатель таймфреймов */}
        <div className="flex gap-1 p-1 rounded-lg bg-gray-800/50 self-start overflow-x-auto max-w-full">
          {/* Набор интервалов — настройка приложения и доступных источников данных. */}
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
        title={t('Контекст рынка')}
        badge={
          <>
            <span className={`text-xs font-semibold ${
              report.regime === 'ВОСХОДЯЩИЙ' ? 'text-green-400' : report.regime === 'НИСХОДЯЩИЙ' ? 'text-red-400' : 'text-yellow-400'
            }`}>{t(report.regime)}</span>
            <span className="text-xs text-gray-400">Consensus {consensusScore.toFixed(1)}/5 · {t('Объём')} {volumeRatio.toFixed(2)}x</span>
          </>
        }
      >
        <MarketContextSection report={report} volumeRatio={volumeRatio} />
      </Collapsible>

      {/* 2. ГРАФИК */}
      <Collapsible
        storageKey="chart"
        icon={<ChartIcon className="w-5 h-5 text-amber-400" />}
        title={`${t('График')} ${displayPair} · ${timeframe}`}
        badge={<span className="text-xs text-gray-400">{report.patterns.filter(p => p.confirmed && p.priceConfirmed === true && (p.priceDirection !== undefined || p.type !== 'neutral')).length}{t(' паттернов')}</span>}
      >
        <CandlestickChart
          candles={report.candles}
          patterns={report.patterns}
          signals={report.signals}
          support={report.support}
          resistance={report.resistance}
          gaps={report.gaps ?? []}
          height={chartHeight}
          live={liveCandle && Date.now() - liveCandle.ts < 30_000 ? liveCandle : null}
        />
      </Collapsible>

      {/* 2.5 КОНТЕКСТ РЫНКА: фазы Вайкоффа + профиль объёма с «путём цены» + дельта */}
      {(report.wyckoff || report.volume_profile || report.delta_summary) && (
        <Collapsible
          storageKey="vprofile"
          icon={<BarChart2 className="w-5 h-5 text-blue-400" />}
          title={t('Контекст рынка и объёма')}
          badge={
            <>
              {report.wyckoff && (
                <span className="text-xs text-gray-400">
                  {t('Вайкофф:')} {t(PHASE_SHORT[report.wyckoff.phase] ?? report.wyckoff.phase)} · {t('балл')} {(num(report.wyckoff.confidence) * 100).toFixed(0)}/100
                </span>
              )}
              {report.delta_summary && (
                <span className={`text-xs font-mono ${report.delta_summary.cumulative_delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ΣΔ {report.delta_summary.cumulative_delta >= 0 ? '+' : ''}{Math.round(report.delta_summary.cumulative_delta).toLocaleString(locale)}
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
        title={`${t('Зоны поддержки и сопротивления')} · ${timeframe}`}
        badge={
          <>
            <span className="text-xs text-green-400">↓ {report.support.length}</span>
            <span className="text-xs text-red-400">↑ {report.resistance.length}</span>
            <span className="text-xs text-gray-400">{t('кластеризация + эвристическая сила по касаниям')}</span>
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
          title={t('Подтверждённые паттерны')}
          badge={<span className="text-xs text-gray-400">{confirmedPatterns.length}{t(' из ')}{report.patterns.length} {t('· подтверждены закрытыми свечами')}</span>}
        >
          <ConfirmedPatternsList patterns={confirmedPatterns} total={report.patterns.length} timeframe={report.timeframe} />
        </Collapsible>
      )}

      {/* 4.5 ВЕРИФИКАЦИЯ ПРЕИМУЩЕСТВА: когорты по режимам + деградация 90 дней */}
      {report.edge && <EdgeVerificationPanel edge={report.edge} />}

      {/* 5. ТОРГОВЫЕ СИГНАЛЫ — аудит №11: живой список со статусами жизненного цикла */}
      {report.signals.filter((s) => lifecycleOf(s) !== 'invalidated').length > 0 && (
        <Collapsible
          storageKey="signals"
          icon={<Target className="w-5 h-5 text-amber-400" />}
          title={t('Свечные сценарии · подтверждение')}
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
        title={t('Индикаторы')}
        badge={
          <>
            <span className="text-xs text-gray-400">RSI {num(report.rsi).toFixed(1)}</span>
            <span className="text-xs text-gray-400">MACD {num(report.macd?.histogram).toFixed(2)}</span>
            <span className="text-xs text-gray-400">{t('Тренд')} {(num(report.trend_strength) * 100).toFixed(1)}%</span>
          </>
        }
      >
        <IndicatorsSection report={report} />
      </Collapsible>

      <Collapsible
        storageKey="beyond-candlesticks"
        icon={<BarChart2 className="w-5 h-5 text-violet-400" />}
        title={t('За гранью японских свечей')}
        badge={<span className="text-xs text-gray-400">{t('Индекс разницы · Three-line break · Renko · Kagi')}</span>}
      >
        <BeyondCandlesticksPanel candles={report.candles} />
      </Collapsible>

      {/* Дисклеймер */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className="text-amber-400">{t('Внимание:')}</strong> {t('Свечные модели — по С. Нисону; числовые фильтры, каскад ТФ и оценки — проектные эвристики.')}{' '}
            {t('Контекст рынка важнее отдельных паттернов. Всегда используйте подтверждение и управление рисками.')}{' '}
            {t('Это не является финансовой рекомендацией.')}
          </p>
        </div>
      </div>
    </div>
  );
}
