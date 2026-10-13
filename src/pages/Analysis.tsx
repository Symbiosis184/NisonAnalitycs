import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Activity, AlertTriangle, RefreshCw, Target, Shield, BarChart2 } from 'lucide-react';
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
  const confirmedPatterns = report.patterns.filter((p: any) => p.confirmed);
  const volumeRatio = report.candles.length > 0 
    ? report.candles[report.candles.length - 1].volume / 
      (report.candles.reduce((sum: number, c: any) => sum + c.volume, 0) / report.candles.length)
    : 1;

  const getConsensusColor = (score: number) => {
    if (score >= 4) return 'text-green-400 bg-green-500/10 border-green-500/20';
    if (score >= 2) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  };

  return (
    <div className="space-y-6">
      {/* Навигация */}
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Назад к обзору
      </Link>

      {/* Заголовок с ценой */}
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

        {/* Переключатель таймфреймов */}
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

      {/* 1. КОНТЕКСТ РЫНКА (по Нисону - сначала контекст) */}
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

      {/* 2. ГРАФИК */}
      <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
        <CandlestickChart
          candles={report.candles}
          height={500}
        />
      </div>

      {/* 3. КЛЮЧЕВЫЕ УРОВНИ S/R */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Поддержка */}
        <div className="p-4 rounded-xl border border-green-500/20 bg-green-500/5">
          <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Уровни поддержки
          </h3>
          <div className="space-y-2">
            {report.support.map((zone: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/30">
                <div>
                  <div className="font-mono text-white">${formatPrice(zone.level)}</div>
                  <div className="text-xs text-gray-500">{zone.reasons.join(', ')}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">{zone.votes} голосов</div>
                  {zone.strong && (
                    <div className="text-xs text-green-400 font-semibold">Сильная</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Сопротивление */}
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Уровни сопротивления
          </h3>
          <div className="space-y-2">
            {report.resistance.map((zone: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/30">
                <div>
                  <div className="font-mono text-white">${formatPrice(zone.level)}</div>
                  <div className="text-xs text-gray-500">{zone.reasons.join(', ')}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">{zone.votes} голосов</div>
                  {zone.strong && (
                    <div className="text-xs text-red-400 font-semibold">Сильная</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. ПАТТЕРНЫ С ПОДТВЕРЖДЕНИЕМ */}
      {report.patterns.length > 0 && (
        <div className="p-6 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            🕯️ Обнаруженные паттерны
            <span className="text-xs text-gray-500 font-normal ml-2">
              ({confirmedPatterns.length} подтверждено из {report.patterns.length})
            </span>
          </h3>
          <div className="space-y-3">
            {report.patterns.map((pattern: any, i: number) => (
              <div
                key={i}
                className={`p-4 rounded-lg border ${
                  pattern.confirmed 
                    ? pattern.type === 'bullish' 
                      ? 'bg-green-500/5 border-green-500/20' 
                      : 'bg-red-500/5 border-red-500/20'
                    : 'bg-gray-800/30 border-gray-700/50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-lg ${
                      pattern.type === 'bullish' ? 'text-green-400' :
                      pattern.type === 'bearish' ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {pattern.type === 'bullish' ? '▲' : pattern.type === 'bearish' ? '▼' : '◆'}
                    </span>
                    <div>
                      <div className={`text-sm font-semibold ${
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
                  <div className="flex items-center gap-2">
                    {pattern.confirmed && (
                      <span className="px-2 py-1 rounded bg-green-500/10 text-green-400 text-xs border border-green-500/20">
                        ✓ Подтверждён
                      </span>
                    )}
                    {pattern.hasVolume && (
                      <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">
                        📊 Объём
                      </span>
                    )}
                    {pattern.atLevel && (
                      <span className="px-2 py-1 rounded bg-purple-500/10 text-purple-400 text-xs border border-purple-500/20">
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
      )}

      {/* 5. ТОРГОВЫЕ СИГНАЛЫ */}
      {report.signals.length > 0 && (
        <div className="p-6 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-amber-400" />
            Торговые сигналы
            <span className="text-xs text-gray-500 font-normal ml-2">(R:R ≥ 2:1)</span>
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

                <div className="grid grid-cols-3 gap-4 text-sm mb-3">
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

                <div className="flex items-center justify-between text-xs border-t border-gray-800/50 pt-2">
                  <div>
                    <span className="text-gray-500">R:R </span>
                    <span className="text-white font-mono">1:{signal.rr.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Риск </span>
                    <span className="text-white font-mono">{(signal.risk * 100).toFixed(2)}%</span>
                  </div>
                  {signal.confirmed && (
                    <span className="px-2 py-1 rounded bg-green-500/10 text-green-400">
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

      {/* Индикаторы */}
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
