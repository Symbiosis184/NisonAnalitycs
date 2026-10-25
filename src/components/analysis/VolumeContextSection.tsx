// Вынос из Analysis.tsx (реконструкция): секция «Контекст рынка и объёма» —
// профиль объёма с оверлеем «пути цены», фазы Вайкоффа, дельта агрессии.

import { Activity, BarChart2 } from 'lucide-react';
import { Icon } from '../../components/ui/Icon';
import type { AnalysisReport, SignalDTO } from '../../api/types';
import { VolumeProfileChart, VolumeProfileNotes, DeltaChart, DeltaNotes } from '../VolumeProfilePanel';
import { WyckoffPhasePanel } from '../MarketContextPanels';

/** Краткие названия фаз Вайкоффа для бейджа свёрнутой секции */
const PHASE_SHORT: Record<string, string> = {
  accumulation: 'Накопление', markup: 'Рост', distribution: 'Распределение', markdown: 'Падение', transition: 'Переход',
};

export function VolumeContextSection({ report, pathSignals, activePathSignalIdx, onSelectPathSignal }: {
  report: AnalysisReport;
  /** Сигналы с рассчитанным «путём цены» — для selectable-оверлея на профиле объёма */
  pathSignals: SignalDTO[];
  /** Индекс активного сигнала (-1 — «без сигнала») */
  activePathSignalIdx: number;
  onSelectPathSignal: (idx: number) => void;
}) {
  const activePathSignal =
    activePathSignalIdx >= 0 ? pathSignals[Math.min(activePathSignalIdx, pathSignals.length - 1)] : undefined;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {report.volume_profile && (
          <div className="panel lg:col-span-2 p-4 ">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
                <BarChart2 className="w-4 h-4" />
                Профиль объёма · HVN/LVN · Value Area
              </h3>
              {pathSignals.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => onSelectPathSignal(-1)}
                    className={`px-2 py-0.5 rounded text-[11px] ${activePathSignalIdx === -1 ? 'bg-gray-700 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'}`}
                  >
                    без сигнала
                  </button>
                  {pathSignals.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => onSelectPathSignal(i)}
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
                <Icon name="path" className="mr-1" />{activePathSignal.path.description}
              </div>
            )}
            {/* Текстовая расшифровка профиля — что означают узлы и как их читать */}
            <details className="mt-2 text-xs border-t border-gray-800/50 pt-2">
              <summary className="cursor-pointer select-none text-gray-300 hover:text-white">
                <Icon name="info" className="mr-1" />Как читать профиль объёма
              </summary>
              <VolumeProfileNotes profile={report.volume_profile} price={report.price} />
            </details>
          </div>
        )}
        {report.wyckoff && <WyckoffPhasePanel wyckoff={report.wyckoff} />}
      </div>
      {report.delta_summary && (
        <div className="panel p-4 ">
          <h3 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Дельта агрессии (покупатели − продавцы)
          </h3>
          <DeltaChart summary={report.delta_summary} />
          {/* Текстовая расшифровка: что означают столбцы/линия и что происходит сейчас */}
          <details className="mt-2 text-xs border-t border-gray-800/50 pt-2">
            <summary className="cursor-pointer select-none text-gray-300 hover:text-white">
              <Icon name="info" className="mr-1" />Как читать дельту агрессии
            </summary>
            <div className="mt-2">
              <DeltaNotes summary={report.delta_summary} priceChangePct={report.change_24h} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export { PHASE_SHORT };
