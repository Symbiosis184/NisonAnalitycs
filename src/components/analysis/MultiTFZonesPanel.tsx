// Вынос из Analysis.tsx (реконструкция): карта уровней S/R на каждом
// таймфрейме (запрос: «зоны поддержки/сопротивления на каждом ТФ»).
// Для каждого интервала уровни собираются ZoneVoter'ом с собственными
// параметрами (толеранс, окно свингов, порог пробоя — см. ZONE_PARAMS),
// поэтому список зон различается между ТФ. Активный ТФ анализа помечен бейджем.

import { Shield } from 'lucide-react';
import type { MultiTFZonesDTO } from '../../api/types';
import { formatPrice } from '../../utils/format';
import { Collapsible } from '../Collapsible';

import { tfCanonical } from '../../api/client';

const TF_LABEL: Record<string, string> = {
  '15': '15м', '30': '30м', '60': '1ч', '1H': '1ч', '2H': '2ч', '4H': '4ч', D: '1Д', W: '1Н',
};

/** Сравнение ТФ в разных записях ('W' из зон vs '1W'/'w' из UI) через канон ORDER. */
const sameTf = (a: string, b: string) => tfCanonical(a) === tfCanonical(b);

export function MultiTFZonesPanel({ rows, activeTf }: { rows: MultiTFZonesDTO[]; activeTf: string }) {
  if (!rows.length) return null;
  return (
    <Collapsible
      storageKey="multitf"
      icon={<Shield className="w-5 h-5 text-purple-400" />}
      title="Мульти-ТФ карта уровней S/R"
      badge={
        <>
          <span className="text-xs text-gray-500">{rows.length} ТФ</span>
          <span className="text-[10px] text-gray-600 hidden sm:inline">каждый ТФ — со своей калибровкой</span>
        </>
      }
    >
    <div className="p-3 rounded-lg bg-gray-800/40 border border-gray-700/50">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-700/50">
              <th className="py-1 pr-3 font-medium">ТФ</th>
              <th className="py-1 pr-3 font-medium">Масштаб</th>
              <th className="py-1 pr-3 font-medium">Сопротивления ↑</th>
              <th className="py-1 pr-3 font-medium">Поддержки ↓</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.timeframe} className="border-b border-gray-800/60 align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={`font-mono ${sameTf(r.timeframe, activeTf) ? 'text-amber-400 font-bold' : 'text-gray-300'}`}>
                    {TF_LABEL[r.timeframe] ?? r.timeframe}
                  </span>
                  {sameTf(r.timeframe, activeTf) && (
                    <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">активный</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{r.scale}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1.5">
                    {r.resistance.slice(0, 4).map((z) => (
                      <span key={z.level} title={`${z.reasons.join(', ')} · ${z.touches} касаний`}
                        className={`px-1.5 py-0.5 rounded font-mono border ${z.strong ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-gray-700 bg-gray-800/40 text-gray-400'}`}>
                        {formatPrice(z.level)}{z.halfWidth ? ` ±${formatPrice(z.halfWidth)}` : ''}{z.strong ? ' ★' : ''}
                      </span>
                    ))}
                    {!r.resistance.length && <span className="text-gray-600">—</span>}
                  </div>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {r.support.slice(0, 4).map((z) => (
                      <span key={z.level} title={`${z.reasons.join(', ')} · ${z.touches} касаний`}
                        className={`px-1.5 py-0.5 rounded font-mono border ${z.strong ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-gray-700 bg-gray-800/40 text-gray-400'}`}>
                        {formatPrice(z.level)}{z.halfWidth ? ` ±${formatPrice(z.halfWidth)}` : ''}{z.strong ? ' ★' : ''}
                      </span>
                    ))}
                    {!r.support.length && <span className="text-gray-600">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-gray-600">★ — сильная зона (≥3 голосов); ± — полуширина зоны (ATR-калиброванная, Нисон: уровень это полоса, а не линия).</p>
    </div>
    </Collapsible>
  );
}
