import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Activity, BarChart2, AlertCircle, RefreshCw, Target, Shield, Search, X, BookOpen } from 'lucide-react';
import { api } from '../api/client';
import type { MarketOverviewItem as MarketOverview } from '../api/types';
import { formatPrice, formatVolume } from '../utils/format';
import { useBinanceWebSocket } from '../hooks/useBinanceWebSocket';
import { describeNetworkError } from '../utils/http';


const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
  'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT'
];

/** Тело карточки инструмента — переиспользуется для топ-8 и произвольного тикера. */
function MarketCardBody({ item }: { item: MarketOverview }) {
  const isPositive = item.change_24h >= 0;
  const baseAsset = item.symbol.replace('USDT', '');
  const confirmedPatterns = item.patterns.filter(p => p.confirmed);
  const volumeRatio = item.avgVolume > 0 ? item.volume / item.avgVolume : 1;
  const getTrendIcon = (trend: string) => {
    if (trend === 'ВОСХОДЯЩИЙ') return <TrendingUp className="w-4 h-4 text-green-400" />;
    if (trend === 'НИСХОДЯЩИЙ') return <TrendingDown className="w-4 h-4 text-red-400" />;
    return <Activity className="w-4 h-4 text-yellow-400" />;
  };
  const getTrendColor = (trend: string) => {
    if (trend === 'ВОСХОДЯЩИЙ') return 'text-green-400';
    if (trend === 'НИСХОДЯЩИЙ') return 'text-red-400';
    return 'text-yellow-400';
  };
  const getConsensusColor = (score: number) => {
    if (score >= 4) return 'text-green-400 bg-green-500/10 border-green-500/20';
    if (score >= 2) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  };
  return (
    <>
      {/* Заголовок: Контекст рынка */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-amber-400 transition-colors">
          {baseAsset}
        </h3>
        {getTrendIcon(item.trend)}
      </div>

      {/* Цена и изменение */}
      <div className="mb-3">
        <div className="text-xl sm:text-2xl font-bold text-white break-all">
          ${formatPrice(item.price)}
        </div>
        <div className={`flex items-center gap-1 text-sm font-medium ${
          isPositive ? 'text-green-400' : 'text-red-400'
        }`}>
          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {isPositive ? '+' : ''}{item.change_24h.toFixed(2)}%
        </div>
      </div>

      {/* Режим рынка */}
      <div className="mb-3 p-2 rounded-lg bg-gray-800/30">
        <div className="text-xs text-gray-400 mb-1">Режим рынка</div>
        <div className={`text-sm font-medium ${getTrendColor(item.regime)}`}>
          {item.regime}
        </div>
      </div>

      {/* Consensus Score */}
      <div className={`mb-3 p-2 rounded-lg border ${getConsensusColor(item.consensus.score)}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400">Consensus</div>
            <div className="text-lg font-bold">
              {item.consensus.score.toFixed(1)}/5
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">Уверенность</div>
            <div className="text-lg font-bold">
              {item.consensus.confidence.toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* Только подтверждённые паттерны (по Нисону) */}
      {confirmedPatterns.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Target className="w-3 h-3" />
            Подтверждённые паттерны ({confirmedPatterns.length})
          </div>
          <div className="space-y-1">
            {confirmedPatterns.slice(0, 2).map((pattern, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1">
                  <span className={`font-medium ${
                    pattern.type === 'bullish' ? 'text-green-400' :
                    pattern.type === 'bearish' ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {pattern.type === 'bullish' ? '▲' : pattern.type === 'bearish' ? '▼' : '◆'} {pattern.name}
                  </span>
                  <span className="text-green-400 text-[11px]">✓</span>
                </div>
                <span className="text-gray-400">{pattern.confidence}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Сценарии */}
      {item.signals && item.signals.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <BarChart2 className="w-3 h-3" />
            Сценарии ({item.signals.length})
          </div>
          <div className="space-y-1">
            {item.signals.slice(0, 2).map((signal, idx) => (
              <div key={idx} className={`p-2 rounded text-xs ${
                signal.direction === 'long' ? 'bg-green-500/5 border border-green-500/20' : 'bg-red-500/5 border border-red-500/20'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    {signal.direction === 'long' ? (
                      <TrendingUp className="w-3 h-3 text-green-400" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-red-400" />
                    )}
                    <span className={`font-medium ${
                      signal.direction === 'long' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {signal.direction === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                  </div>
                  <span className="text-green-400 text-[11px]">✓</span>
                </div>
                <div className="text-gray-400 text-[11px]">{signal.pattern}</div>
                <div className="flex items-center justify-between mt-1 text-[11px]">
                  <span className="text-gray-400">R:R 1:{signal.rr.toFixed(2)}</span>
                  <span className="text-gray-400">{(signal.quality * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Уровни S/R */}
      <div className="mb-3">
        <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
          <Shield className="w-3 h-3" />
          Ключевые уровни
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-green-400 mb-1">Поддержка</div>
            {item.support.slice(0, 2).map((level, idx) => (
              <div key={idx} className="font-mono text-gray-300">
                ${formatPrice(level)}
              </div>
            ))}
          </div>
          <div>
            <div className="text-red-400 mb-1">Сопротивление</div>
            {item.resistance.slice(0, 2).map((level, idx) => (
              <div key={idx} className="font-mono text-gray-300">
                ${formatPrice(level)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Объём */}
      <div className="pt-2 border-t border-gray-800/50">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Объём</span>
          <span className={`font-mono ${
            volumeRatio > 1.5 ? 'text-green-400' :
            volumeRatio < 0.5 ? 'text-red-400' : 'text-gray-300'
          }`}>
            {formatVolume(item.volume)}
            {volumeRatio > 1.5 && ' ↑'}
            {volumeRatio < 0.5 && ' ↓'}
          </span>
        </div>
      </div>
    </>
  );
}


export default function Dashboard() {
  const [market, setMarket] = useState<MarketOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Поиск произвольной крипты
  const [query, setQuery] = useState('');
  const [customCard, setCustomCard] = useState<MarketOverview | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    const base = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!base) return;
    setCustomLoading(true);
    setCustomError(null);
    try {
      const item = await api.analyzeCustomSymbol(base);
      setCustomCard(item);
    } catch (err) {
      setCustomCard(null);
      setCustomError(err instanceof Error ? err.message : 'Ошибка анализа');
    } finally {
      setCustomLoading(false);
    }
  };

  // WebSocket для real-time цен
  const symbols = market.map(m => m.symbol);
  const realTimePrices = useBinanceWebSocket(symbols);

  // Обновляем цены в market данными из WebSocket
  useEffect(() => {
    if (Object.keys(realTimePrices).length > 0) {
      setMarket(prev => prev.map(item => {
        const rtPrice = realTimePrices[item.symbol];
        if (rtPrice) {
          return {
            ...item,
            price: rtPrice.price,
            change_24h: rtPrice.priceChangePercent,
          };
        }
        return item;
      }));
    }
  }, [realTimePrices]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await api.getMarketOverview();
      
      if (data.length === 0) {
        throw new Error('Не удалось получить данные с Bybit API');
      }
      
      setMarket(data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Ошибка загрузки:', err);
      setError(describeNetworkError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-white leading-tight">Обзор рынка<span className="hidden sm:inline"> по методологии Нисона</span></h1>
          <p className="text-sm text-gray-400 mt-1">
            Контекст → Паттерны → Подтверждение → Объём
          </p>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-gray-400">
              {lastUpdate && `Обновлено: ${lastUpdate.toLocaleTimeString('ru-RU')}`}
            </p>
            {Object.keys(realTimePrices).length > 0 && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                Real-time
              </span>
            )}
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="self-start sm:self-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {/* Поиск произвольной криптовалюты */}
      <div className="p-4 rounded-xl border border-gray-800/60 bg-surface-panel/50">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze(); }}
              placeholder="Введите тикер, например TAO, ARB, PEPE…"
              maxLength={20}
              className="w-full pl-9 pr-9 py-2.5 rounded-lg bg-gray-900/60 border border-gray-700/60 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-amber-500/50"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setCustomCard(null); setCustomError(null); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-300"
                aria-label="Очистить"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={handleAnalyze}
            disabled={customLoading || !query.trim()}
            className="px-5 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-medium text-sm transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {customLoading ? 'Анализируем…' : 'Анализировать'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Анализ любой спотовой USDT-пары Bybit по методологии Нисона. Нажмите Enter или «Анализировать», затем кликните по карточке для полного анализа.
        </p>
        {customError && (
          <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{customError}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-400">Ошибка загрузки</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {loading && market.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-gray-800/60 bg-surface-panel/50 animate-pulse">
              <div className="h-6 w-20 bg-gray-700 rounded mb-3" />
              <div className="h-8 w-32 bg-gray-700 rounded mb-2" />
              <div className="h-4 w-24 bg-gray-700 rounded" />
            </div>
          ))
        ) : (
          [
            ...(customCard ? [{ ...customCard, __custom: true }] : []),
            ...market,
          ].map((item) => {
            return (
              <Link
                key={item.symbol}
                to={`/analysis/${item.symbol}`}
                className={`block p-3 sm:p-4 rounded-xl border bg-gradient-to-b from-[#131a2b] to-[#0f1524] hover:border-amber-500/30 transition-all group ${
                  '__custom' in item && item.__custom ? 'border-amber-500/40 ring-1 ring-amber-500/20' : 'border-gray-800/60'
                }`}
              >
                {'__custom' in item && item.__custom && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] uppercase tracking-wide text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                      Ваш запрос
                    </span>
                    <button
                      onClick={(e) => { e.preventDefault(); setCustomCard(null); }}
                      className="p-0.5 text-gray-400 hover:text-gray-300"
                      aria-label="Убрать карточку"
                      title="Убрать"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <MarketCardBody item={item} />
              </Link>
            );
          })
        )}
      </div>

      {!loading && market.length === 0 && !error && (
        <div className="text-center py-12">
          <Activity className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Нет данных для отображения</p>
        </div>
      )}
      {/* Легенда методологии */}
      <div className="p-4 rounded-xl border border-gray-800/60 bg-surface-panel/50">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><BookOpen className="w-4 h-4 text-gray-400" aria-hidden="true" /> Методология Стива Нисона</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-amber-400 font-semibold mb-1">1. Контекст</div>
            <div className="text-gray-400">Определяем тренд и режим рынка. Торгуем только в направлении тренда.</div>
          </div>
          <div>
            <div className="text-amber-400 font-semibold mb-1">2. Паттерны</div>
            <div className="text-gray-400">Ищем свечные паттерны в контексте тренда. Паттерны без контекста не работают.</div>
          </div>
          <div>
            <div className="text-amber-400 font-semibold mb-1">3. Подтверждение</div>
            <div className="text-gray-400">Каждый паттерн должен быть подтверждён следующей свечой или объёмом.</div>
          </div>
          <div>
            <div className="text-amber-400 font-semibold mb-1">4. Правило множества</div>
            <div className="text-gray-400">Минимум 3 независимых сигнала для входа. Consensus score показывает силу.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
