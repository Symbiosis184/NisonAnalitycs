import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Activity, BarChart2, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { formatPrice, formatVolume } from '../utils/format';

interface MarketOverview {
  symbol: string;
  price: number;
  change_24h: number;
  trend: string;
  signal: string | null;
  rsi: number;
  volume: number;
}

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
  'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT'
];

export default function Dashboard() {
  const [market, setMarket] = useState<MarketOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

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
      setError('Не удалось загрузить данные с Bybit API. Проверьте подключение к интернету.');
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Обзор рынка</h1>
          <p className="text-sm text-gray-400 mt-1">
            {lastUpdate && `Обновлено: ${lastUpdate.toLocaleTimeString('ru-RU')}`}
          </p>
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
            
            return (
              <Link
                key={item.symbol}
                to={`/analysis/${item.symbol}`}
                className="block p-4 rounded-xl border border-gray-800/60 bg-gradient-to-b from-[#131a2b] to-[#0f1524] hover:border-amber-500/30 transition-all group"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-white group-hover:text-amber-400 transition-colors">
                    {baseAsset}
                  </h3>
                  {getTrendIcon(item.trend)}
                </div>

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

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Тренд</span>
                    <span className={`font-medium ${getTrendColor(item.trend)}`}>
                      {item.trend}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">RSI</span>
                    <span className={`font-mono ${
                      item.rsi > 70 ? 'text-red-400' :
                      item.rsi < 30 ? 'text-green-400' : 'text-gray-300'
                    }`}>
                      {item.rsi.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Объём</span>
                    <span className="font-mono text-gray-300">
                      {formatVolume(item.volume)}
                    </span>
                  </div>
                  {item.signal && (
                    <div className="pt-2 border-t border-gray-800/50">
                      <div className="flex items-center gap-2">
                        <BarChart2 className="w-3 h-3 text-amber-400" />
                        <span className="text-amber-400 font-medium text-xs">
                          {item.signal}
                        </span>
                      </div>
                    </div>
                  )}
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
    </div>
  );
}
