import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Activity, AlertTriangle, RefreshCw, Target, Shield } from 'lucide-react';
import { api, type AnalysisReport } from '../api/client';
import CandlestickChart from '../components/CandlestickChart';
import { formatPrice } from '../utils/format';

export default function Analysis() {
  const { symbol } = useParams<{ symbol: string }>();
  const [timeframe, setTimeframe] = useState('D');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalysis = async () => {
    if (!symbol) return;
    
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAnalysis(symbol, timeframe);
      setReport(data);
    } catch (err) {
      console.error('Ошибка загрузки анализа:', err);
      setError('Не удалось загрузить анализ. Проверьте подключение к интернету.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalysis();
  }, [symbol, timeframe]);

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

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Назад к обзору
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">{baseAsset}/USDT</h1>
            <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
              report.trend === 'ВОСХОДЯЩИЙ' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              report.trend === 'НИСХОДЯЩИЙ' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
              'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
            }`}>
              {report.trend}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-2xl font-bold text-white">${formatPrice(report.price)}</span>
            <span className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {isPositive ? '+' : ''}{report.change_24h.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="flex gap-1 p-1 rounded-lg bg-gray-800/50">
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

      <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
        <CandlestickChart
          candles={report.candles}
          height={500}
        />
      </div>

      {/* Торговые сигналы */}
      {report.signals.length > 0 && (
        <div className="p-6 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-amber-400" />
            Торговые сигналы
          </h3>
          <div className="space-y-3">
            {report.signals.map((signal: any, idx: number) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border ${
                  signal.direction === 'long'
                    ? 'bg-green-500/5 border-green-500/20'
                    : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
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
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Качество</div>
                    <div className={`text-lg font-bold ${
                      signal.quality >= 0.7 ? 'text-green-400' :
                      signal.quality >= 0.5 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {(signal.quality * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Вход</div>
                    <div className="font-mono text-white">${formatPrice(signal.entry_price)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      Стоп
                    </div>
                    <div className="font-mono text-red-400">${formatPrice(signal.stop_loss)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      Цель
                    </div>
                    <div className="font-mono text-green-400">${formatPrice(signal.target)}</div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-800/50 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-gray-500">R:R </span>
                    <span className="text-white font-mono">1:{signal.rr.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Риск </span>
                    <span className="text-white font-mono">{(signal.risk * 100).toFixed(2)}%</span>
                  </div>
                  {signal.confirmed && (
                    <span className="px-2 py-1 rounded bg-green-500/10 text-green-400 text-xs">
                      ✓ Подтверждён
                    </span>
                  )}
                </div>

                {signal.story && (
                  <div className="mt-3 p-3 rounded bg-gray-800/30 text-xs text-gray-400">
                    📖 {signal.story}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Паттерны */}
      {report.patterns.length > 0 && (
        <div className="p-6 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            🕯️ Обнаруженные паттерны
            <span className="text-xs text-gray-500 font-normal ml-2">({report.patterns.length})</span>
          </h3>
          <div className="space-y-2">
            {report.patterns.map((pattern: any, i: number) => (
              <div
                key={i}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border ${
                  pattern.type === 'bullish' ? 'bg-green-500/5 border-green-500/20' :
                  pattern.type === 'bearish' ? 'bg-red-500/5 border-red-500/20' :
                  'bg-gray-500/5 border-gray-500/20'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm ${
                    pattern.type === 'bullish' ? 'text-green-400' :
                    pattern.type === 'bearish' ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {pattern.type === 'bullish' ? '▲' : pattern.type === 'bearish' ? '▼' : '◆'}
                  </span>
                  <span className={`text-sm font-medium ${
                    pattern.type === 'bullish' ? 'text-green-400' :
                    pattern.type === 'bearish' ? 'text-red-400' : 'text-gray-300'
                  }`}>
                    {pattern.name}
                  </span>
                  {pattern.confirmed && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                      ✓ подтверждён
                    </span>
                  )}
                  {pattern.hasVolume && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      📊 объём
                    </span>
                  )}
                  {pattern.atLevel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      🎯 у уровня
                    </span>
                  )}
                  <span className="text-xs text-gray-500 ml-1">
                    {pattern.confidence}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Консенсус</h3>
          <div className={`text-3xl font-bold ${
            report.consensus.confidence >= 70 ? 'text-green-400' :
            report.consensus.confidence >= 50 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {report.consensus.confidence.toFixed(0)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {report.consensus.direction === 'buy' ? 'Бычий' :
             report.consensus.direction === 'sell' ? 'Медвежий' : 'Нейтральный'}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-400 leading-relaxed">
          <strong className="text-amber-400">Внимание:</strong> Данный анализ сгенерирован алгоритмически и предназначен только для образовательных целей.
          Это не является финансовой рекомендацией. Всегда проводите собственное исследование перед принятием торговых решений.
        </p>
      </div>
    </div>
  );
}
