import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Activity, BarChart2, AlertCircle, RefreshCw, Target, Shield } from 'lucide-react';
import { api } from '../api/client';
import type { MarketOverviewItem as MarketOverview } from '../api/types';
import { formatPrice, formatVolume } from '../utils/format';
import { useBinanceWebSocket } from '../hooks/useBinanceWebSocket';
import { describeNetworkError } from '../utils/http';


const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
  'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT'
];

export default function Dashboard() {
  const [market, setMarket] = useState<MarketOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Обзор рынка по методологии Нисона</h1>
          <p className="text-sm text-gray-400 mt-1">
            Контекст → Паттерны → Подтверждение → Объём
          </p>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-gray-500">
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
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading && market.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50 animate-pulse">
              <div className="h-6 w-20 bg-gray-700 rounded mb-3" />
              <div className="h-8 w-32 bg-gray-700 rounded mb-2" />
              <div className="h-4 w-24 bg-gray-700 rounded" />
            </div>
          ))
        ) : (
          market.map((item) => {
            const isPositive = item.change_24h >= 0;
            const baseAsset = item.symbol.replace('USDT', '');
            const confirmedPatterns = item.patterns.filter(p => p.confirmed);
            const volumeRatio = item.avgVolume > 0 ? item.volume / item.avgVolume : 1;
            
            return (
              <Link
                key={item.symbol}
                to={`/analysis/${item.symbol}`}
                className="block p-4 rounded-xl border border-gray-800/60 bg-gradient-to-b from-[#131a2b] to-[#0f1524] hover:border-amber-500/30 transition-all group"
              >
                {/* Заголовок: Контекст рынка */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-white group-hover:text-amber-400 transition-colors">
                    {baseAsset}
                  </h3>
                  {getTrendIcon(item.trend)}
                </div>

                {/* Цена и изменение */}
                <div className="mb-3">
                  <div className="text-2xl font-bold text-white">
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
                  <div className="text-xs text-gray-500 mb-1">Режим рынка</div>
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
                    <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
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
                            <span className="text-green-400 text-[10px]">✓</span>
                          </div>
                          <span className="text-gray-500">{pattern.confidence}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Торговые сигналы */}
                {item.signals && item.signals.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                      <BarChart2 className="w-3 h-3" />
                      Торговые сигналы ({item.signals.length})
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
                            <span className="text-green-400 text-[10px]">✓</span>
                          </div>
                          <div className="text-gray-400 text-[10px]">{signal.pattern}</div>
                          <div className="flex items-center justify-between mt-1 text-[10px]">
                            <span className="text-gray-500">R:R 1:{signal.rr.toFixed(2)}</span>
                            <span className="text-gray-500">{(signal.quality * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Уровни S/R */}
                <div className="mb-3">
                  <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
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
                    <span className="text-gray-500">Объём</span>
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
      <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
        <h3 className="text-sm font-semibold text-white mb-3">📚 Методология Стива Нисона</h3>
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
