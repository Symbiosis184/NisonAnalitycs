// Вынос из Analysis.tsx (реконструкция): секция зон поддержки/сопротивления
// активного таймфрейма (ZoneVoter, «уровень — это полоса», Нисон).
//
// ВНИМАНИЕ: Tailwind сканирует исходники статически — классы нельзя собирать
// динамически (`border-${color}-500` не сработает), поэтому варианты для
// поддержки/сопротивления перечислены явно.

import { Shield } from 'lucide-react';
import type { ZoneDTO } from '../../api/types';
import { formatPrice } from '../../utils/format';

const SIDE_STYLES = {
  support: {
    panel: 'border-green-500/20 bg-green-500/5',
    title: 'text-green-400',
    price: 'text-green-400',
    strongCard: 'border-green-500/30 bg-green-500/5',
    strongBadge: 'bg-green-500/10 text-green-400',
    label: 'поддержки',
  },
  resistance: {
    panel: 'border-red-500/20 bg-red-500/5',
    title: 'text-red-400',
    price: 'text-red-400',
    strongCard: 'border-red-500/30 bg-red-500/5',
    strongBadge: 'bg-red-500/10 text-red-400',
    label: 'сопротивления',
  },
} as const;

function ZoneList({ zones, side }: { zones: ZoneDTO[]; side: keyof typeof SIDE_STYLES }) {
  const s = SIDE_STYLES[side];
  return (
    <div className={`p-4 rounded-xl border ${s.panel}`}>
      <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${s.title}`}>
        <Shield className="w-4 h-4" />
        Зоны {s.label} (по Нисону)
      </h3>
      <div className="space-y-3">
        {zones.slice(0, 5).map((zone, idx: number) => (
          <div key={idx} className={`p-3 rounded-lg border ${
            zone.strong ? s.strongCard : 'border-gray-700/30 bg-gray-800/20'
          }`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className={`${s.price} font-mono text-lg`}>${formatPrice(zone.level)}{zone.halfWidth ? <span className="text-xs text-gray-400 ml-1">[{formatPrice(zone.level - zone.halfWidth)}–{formatPrice(zone.level + zone.halfWidth)}]</span> : null}</span>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <span className="text-xs text-gray-400">{zone.touches} касаний</span>
                {zone.strong && (
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${s.strongBadge}`}>
                    СИЛЬНАЯ
                  </span>
                )}
              </div>
            </div>
            <div className="text-xs text-gray-400">
              <div className="mb-1">Голосов: {zone.votes}</div>
              <div className="text-gray-400">
                {zone.reasons.map((reason: string, i: number) => (
                  <span key={i} className="inline-block mr-2">• {reason}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ZonesGrid({ report }: {
  report: { support: ZoneDTO[]; resistance: ZoneDTO[] };
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Поддержка */}
      <ZoneList zones={report.support} side="support" />
      {/* Сопротивление */}
      <ZoneList zones={report.resistance} side="resistance" />
    </div>
  );
}
