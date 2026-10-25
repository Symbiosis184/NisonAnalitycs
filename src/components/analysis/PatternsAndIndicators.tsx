// Вынос из Analysis.tsx (реконструкция): секции «Паттерны» и «Индикаторы».

import type { AnalysisReport } from '../../api/types';
import type { PatternDTO } from '../../api/types';

export function ConfirmedPatternsList({ patterns, total }: { patterns: PatternDTO[]; total: number }) {
  return (
    <div className="panel p-6 ">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        🕯️ Подтверждённые паттерны
        <span className="text-xs text-gray-400 font-normal ml-2">
          ({patterns.length} из {total})
        </span>
      </h3>
      <div className="space-y-3">
        {patterns.map((pattern, i: number) => (
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
                  <div className="text-xs text-gray-400">
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
  );
}

export function IndicatorsSection({ report }: { report: AnalysisReport }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="panel p-4 ">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">RSI (14)</h3>
        <div className={`text-3xl font-bold ${
          report.rsi > 70 ? 'text-red-400' :
          report.rsi < 30 ? 'text-green-400' : 'text-white'
        }`}>
          {report.rsi.toFixed(1)}
        </div>
        {/* Честная зональная классификация: extremes — это <20/>80, а не 30/70 */}
        <div className="text-xs text-gray-400 mt-1">
          {report.rsi >= 80 ? 'Экстремальная перекупленность' :
           report.rsi > 70 ? 'Зона перекупленности' :
           report.rsi <= 20 ? 'Экстремальная перепроданность' :
           report.rsi < 30 ? 'Зона перепроданности' : 'Нейтральная зона (30–70)'}
        </div>
        <div className="text-xs text-gray-600 mt-2 leading-relaxed">
          ⚠️ По Нисону RSI — только контекст. В сильном тренде перекупленность
          сохраняется долго и сама по себе НЕ сигнал на продажу.
        </div>
      </div>

      <div className="panel p-4 ">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">MACD</h3>
        {/* Гистограмма в абсолюте масштабо-зависима: для BTC $100k «1.23» ничего
            не значит. Показываем знак гистограммы + её отношение к цене в %. */}
        <div className={`text-3xl font-bold ${
          report.macd.histogram > 0 ? 'text-green-400' : 'text-red-400'
        }`}>
          {((report.macd.histogram / Math.max(report.price, 1e-9)) * 100).toFixed(3)}%
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {report.macd.histogram > 0 ? 'Бычий импульс' : 'Медвежий импульс'}
          {' · '}гистограмма от цены
        </div>
        <div className="text-xs text-gray-600 mt-2 leading-relaxed">
          ⚠️ Контекстный индикатор (лагирует). Вход по Нисону определяется
          свечами + объёмом + уровнями, а не MACD.
        </div>
      </div>

      <div className="panel p-4 ">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">Тренд</h3>
        <div className={`text-3xl font-bold ${
          report.trend === 'ВОСХОДЯЩИЙ' ? 'text-green-400' :
          report.trend === 'НИСХОДЯЩИЙ' ? 'text-red-400' : 'text-yellow-400'
        }`}>
          {(report.trend_strength * 100).toFixed(1)}%
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Сила направленного движения ({report.trend})
        </div>
        <div className="text-xs text-gray-600 mt-2 leading-relaxed">
          Метрика: КПД пути цены за последние 20 баров (net move ÷ суммарные
          диапазоны). ~0% — флэт/шум; 40%+ — чистое направленное движение.
        </div>
      </div>
    </div>
  );
}
