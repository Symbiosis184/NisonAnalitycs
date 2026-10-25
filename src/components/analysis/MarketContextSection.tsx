// Вынос из Analysis.tsx (реконструкция): панели контекста рынка
// (режим, Consensus Score, объём) + каскад таймфреймов (бета).

import { Activity, BarChart2, Target } from 'lucide-react';
import type { AnalysisReport } from '../../api/types';

const getConsensusColor = (score: number) => {
  if (score >= 4) return 'text-green-400 bg-green-500/10 border-green-500/20';
  if (score >= 2) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
};

export function MarketContextSection({ report, volumeRatio }: {
  report: AnalysisReport;
  volumeRatio: number;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Режим рынка */}
      <div className="panel p-4 ">
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
        <div className="text-xs text-gray-400 mt-1">{report.regime_description}</div>
        {/* Бета: каскад таймфреймов (по Нисону контекст задаёт старший ТФ).
            Голоса идут от старшего к младшему; направление определяет первый
            ТФ с выраженной структурой; «↑ подтверждён» — согласен ещё более
            старший интервал. */}
        {report.trend_analysis.cascade && report.trend_analysis.cascade.votes.length > 1 && (
          <div className="mt-3 pt-3 border-t border-gray-800/60">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Каскад ТФ · бета
              </span>
              {!report.trend_analysis.cascade.higherConfirmed && report.trend_analysis.cascade.context !== 'БОКОВИК' && (
                <span className="text-[11px] text-amber-400" title="Нет подтверждения на ТФ старше того, что дало направление">
                  ⚠ не подтверждён сверху
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {report.trend_analysis.cascade.votes.map((v) => (
                <span
                  key={v.timeframe}
                  title={`Тренд на ${v.timeframe}: ${v.trend}`}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                    v.trend === 'ВОСХОДЯЩИЙ' ? 'text-green-400 border-green-500/30 bg-green-500/5' :
                    v.trend === 'НИСХОДЯЩИЙ' ? 'text-red-400 border-red-500/30 bg-red-500/5' :
                    'text-yellow-400 border-yellow-500/30 bg-yellow-500/5'
                  } ${v.timeframe === report.trend_analysis.cascade!.decidedByTimeframe ? 'ring-1 ring-sky-400/50' : ''}`}
                >
                  {v.timeframe}: {v.trend === 'ВОСХОДЯЩИЙ' ? '▲' : v.trend === 'НИСХОДЯЩИЙ' ? '▼' : '→'}
                </span>
              ))}
            </div>
          </div>
        )}
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
        <div className="text-xs text-gray-400 mt-1">
          {report.consensus.direction === 'buy' ? 'Бычий консенсус' :
           report.consensus.direction === 'sell' ? 'Медвежий консенсус' : 'Нейтральный'}
        </div>
        {/* Расшифровка: по Нисону консенсус — согласие факторов, а не количество сигналов */}
        <p className="text-[11px] leading-relaxed text-gray-400 mt-2 border-t border-gray-800/60 pt-2">
          Оценка согласия подтверждённых свечных сценариев (последние 20 баров) в одну сторону.
          Противоречивые сигналы (long+short одновременно) дают низкий балл даже при их большом
          количестве — это шум, а не консенсус. Высокая оценка = несколько независимых паттернов,
          усиленных объёмом и уровнями S/R.
        </p>
      </div>

      {/* Объём */}
      <div className="panel p-4 ">
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
        <div className="text-xs text-gray-400 mt-1">
          {volumeRatio > 1.5 ? 'Повышенный объём - подтверждение' :
           volumeRatio < 0.5 ? 'Низкий объём - слабость' : 'Нормальный объём'}
        </div>
      </div>
    </div>
  );
}
