// Визуализация контекста рынка и верификации преимущества (запрос: «нужна визуализация»).
// 1) WyckoffPhasePanel — шкала цикла Вайкоффа (4 фазы + переход), позиция цены
//    в диапазоне, объёмный перекос «effort vs result».
// 2) PricePathCard — «путь цены» сигнала: формальный RR vs adjusted RR, препятствия
//    на транзите (S/R-зоны и HVN), качество пути.
// 3) EdgeVerificationPanel — когорты эффективности по режимам рынка (тренд/флэт/
//    волатильность) с CI expectancy + мониторинг деградации за последние 90 дней.

import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import type { AnalysisReport, EdgeCohortDTO, SignalDTO } from '../api/types';
import { formatPrice } from '../utils/format';

type Phase = NonNullable<AnalysisReport['wyckoff']>['phase'];

const PHASE_META: Record<Phase, { label: string; color: string }> = {
  accumulation: { label: 'Накопление', color: '#22c55e' },
  markup: { label: 'Рост', color: '#38bdf8' },
  distribution: { label: 'Распределение', color: '#f59e0b' },
  markdown: { label: 'Падение', color: '#ef4444' },
  transition: { label: 'Переход', color: '#94a3b8' },
};

/** Циклическая последовательность фаз для наглядной шкалы. */
const CYCLE: Phase[] = ['accumulation', 'markup', 'distribution', 'markdown'];

interface WProps {
  wyckoff: NonNullable<AnalysisReport['wyckoff']>;
}

export function WyckoffPhasePanel({ wyckoff }: WProps) {
  const meta = PHASE_META[wyckoff.phase];
  // Позиция цены в диапазоне: 0 = низ консолидации, 1 = верх
  const posPct = Math.round(wyckoff.position_in_range * 100);

  return (
    <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
      <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
        🌀 Фаза цикла Вайкоффа
        <span
          className="ml-auto px-2 py-0.5 rounded text-xs font-semibold"
          style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
        >
          {meta.label} · {(wyckoff.confidence * 100).toFixed(0)}%
        </span>
      </h3>

      {/* Шкала цикла: 4 сегмента, активный подсвечен */}
      <div className="flex gap-1 mb-3">
        {CYCLE.map((ph) => {
          const m = PHASE_META[ph];
          const active = ph === wyckoff.phase;
          return (
            <div
              key={ph}
              className={`flex-1 rounded-md px-1.5 py-1.5 text-center text-[10px] sm:text-xs font-medium transition-colors ${active ? '' : 'opacity-40'}`}
              style={active ? { backgroundColor: `${m.color}25`, color: m.color, boxShadow: `inset 0 0 0 1px ${m.color}60` } : { color: m.color }}
              title={PHASE_META[ph].label}
            >
              {m.label}
            </div>
          );
        })}
      </div>

      {/* Позиция цены внутри диапазона консолидации */}
      <div className="mb-1 flex justify-between text-[11px] text-gray-500 font-mono">
        <span>Диапазон: ${formatPrice(wyckoff.range_low)}</span>
        <span>${formatPrice(wyckoff.range_high)}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-gray-800 overflow-visible mb-1">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white"
          style={{ left: `calc(${posPct}% - 7px)`, backgroundColor: meta.color }}
          title={`Цена в ${posPct}% диапазона`}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 mt-2">
        <span title="Ширина диапазона в единицах ATR: значимость консолидации">
          Ширина: <span className="text-gray-300 font-mono">{wyckoff.range_width_atr.toFixed(1)} ATR</span>
        </span>
        <span title="Отношение среднего объёма на верхах диапазона к объёму на низах (>1 — перекос вверх)">
          Объёмный перекос ↕: <span className={wyckoff.vol_skew_high_low >= 1 ? 'text-green-400' : 'text-red-400'}>{wyckoff.vol_skew_high_low.toFixed(2)}</span>
        </span>
        <span>
          Позиция в диапазоне: <span className="text-gray-300 font-mono">{posPct}%</span>
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-2 italic leading-relaxed">{wyckoff.description}</p>
    </div>
  );
}

interface PathProps {
  signal: SignalDTO;
}

/** Карточка «пути цены»: чем отличается честный adjusted RR от формального. */
export function PricePathCard({ signal }: PathProps) {
  const path = signal.path;
  if (!path) return null;
  const dirColor = signal.direction === 'long' ? 'text-green-400' : 'text-red-400';
  const qualityPct = Math.round(path.path_quality * 100);
  const qualityColor = qualityPct >= 70 ? 'bg-green-500' : qualityPct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  const rrDrop = signal.rr - path.adjusted_rr;

  return (
    <div className="mt-3 p-3 rounded-lg bg-gray-800/30 border border-gray-700/40">
      <div className="text-xs text-gray-500 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-gray-400">🛤️ Путь цены до цели</span>
        <span>
          Формальный R:R <span className="font-mono text-white">1:{signal.rr.toFixed(2)}</span>
          {' → '}
          <span className={`font-mono font-semibold ${dirColor}`}>1:{path.adjusted_rr.toFixed(2)}</span>
          {rrDrop > 0.05 && <span className="text-orange-400 ml-1">(−{rrDrop.toFixed(2)} из-за транзита)</span>}
        </span>
      </div>

      {/* Полоса качества пути */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 rounded-full bg-gray-700/60 overflow-hidden">
          <div className={`h-full ${qualityColor}`} style={{ width: `${qualityPct}%` }} />
        </div>
        <span className="text-[11px] font-mono text-gray-400">чистота пути {qualityPct}%</span>
      </div>

      <div className="text-[11px] text-gray-500 mb-2">
        Дистанция до цели: <span className="text-gray-300 font-mono">{path.distance_pct.toFixed(2)}%</span>
        {path.first_obstacle_pct !== null && (
          <> · первое препятствие через <span className="text-orange-400 font-mono">{path.first_obstacle_pct.toFixed(2)}%</span></>
        )}
      </div>

      {path.obstacles.length > 0 && (
        <ul className="space-y-1">
          {path.obstacles.slice(0, 4).map((o, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px]">
              <span className={`shrink-0 mt-0.5 inline-block w-2 h-2 rounded-full ${o.kind === 'hvn' ? 'bg-amber-500' : 'bg-rose-400'}`} />
              <span className="text-gray-400">
                <span className="font-mono text-gray-300">${formatPrice(o.level)}</span>
                {' '}· {o.kind === 'hvn' ? 'HVN-узел профиля' : 'S/R-зона'} (сила {(o.strength * 100).toFixed(0)}%)
                {' '}· <span className="text-gray-500">{o.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-gray-500 italic mt-2">{path.description}</p>
    </div>
  );
}

const VERDICT_META: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  'positive-edge': { label: 'Преимущество подтверждено', cls: 'border-green-500/30 bg-green-500/5 text-green-400', icon: CheckCircle2 },
  'edge-degrading': { label: 'Edge затухает', cls: 'border-orange-500/30 bg-orange-500/5 text-orange-400', icon: TrendingDown },
  'no-edge': { label: 'Преимущество не подтверждено', cls: 'border-red-500/30 bg-red-500/5 text-red-400', icon: AlertTriangle },
  insufficient: { label: 'Недостаточно данных', cls: 'border-gray-600/40 bg-gray-700/10 text-gray-400', icon: AlertTriangle },
};

/** Горизонтальная полоса expectancy когорты со шкалой CI (центральная ось = 0 R). */
function CohortBar({ c }: { c: EdgeCohortDTO }) {
  // Масштабируем по максимуму |CI| среди концов, минимум ±0.5R
  const maxAbs = Math.max(Math.abs(c.exp_ci_low), Math.abs(c.exp_ci_high), Math.abs(c.avg_net_r), 0.5);
  const toPct = (v: number) => ((v / maxAbs + 1) / 2) * 100;
  const zeroX = 50;
  const lo = toPct(c.exp_ci_low);
  const hi = toPct(c.exp_ci_high);
  const mean = toPct(c.avg_net_r);
  const color = c.has_edge ? '#22c55e' : c.avg_net_r >= 0 ? '#eab308' : '#ef4444';

  return (
    <div className="py-2 border-t border-gray-800/50 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs mb-1">
        <span className="font-medium text-gray-300">{c.label}</span>
        <span className="text-gray-500">
          сделок <span className="text-gray-300 font-mono">{c.trades}</span>
          {' · '}WR <span className="text-gray-300 font-mono">{c.win_rate.toFixed(0)}%</span> [{c.ci_low.toFixed(0)}–{c.ci_high.toFixed(0)}]
        </span>
        {c.has_edge ? (
          <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 text-[10px] font-bold">EDGE ✓</span>
        ) : (
          <span className="px-1.5 py-0.5 rounded bg-gray-700/40 text-gray-400 text-[10px]">n/d</span>
        )}
      </div>
      {/* CI-полоса */}
      <div className="relative h-3 rounded bg-gray-800/60">
        <div className="absolute top-0 bottom-0 w-px bg-gray-600" style={{ left: `${zeroX}%` }} title="0 R" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full opacity-50"
          style={{ left: `${Math.min(lo, hi)}%`, width: `${Math.abs(hi - lo)}%`, backgroundColor: color }}
          title={`95% CI expectancy: ${c.exp_ci_low.toFixed(2)}…${c.exp_ci_high.toFixed(2)} R`}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-black/40"
          style={{ left: `calc(${mean}% - 5px)`, backgroundColor: color }}
          title={`Expectancy: ${c.avg_net_r >= 0 ? '+' : ''}${c.avg_net_r.toFixed(2)} R/сделку`}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-600 font-mono mt-0.5">
        <span>{(-maxAbs).toFixed(1)} R</span>
        <span className={c.avg_net_r >= 0 ? 'text-green-400' : 'text-red-400'}>
          {c.avg_net_r >= 0 ? '+' : ''}{c.avg_net_r.toFixed(2)} R/сд · Σ {c.total_net_r >= 0 ? '+' : ''}{c.total_net_r.toFixed(1)} R
        </span>
        <span>+{maxAbs.toFixed(1)} R</span>
      </div>
    </div>
  );
}

interface EProps {
  edge: NonNullable<AnalysisReport['edge']>;
}

export function EdgeVerificationPanel({ edge }: EProps) {
  const v = VERDICT_META[edge.verdict] ?? VERDICT_META.insufficient;
  const Icon = v.icon;
  const d = edge.degradation;

  return (
    <div className="p-6 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
      <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-amber-400" />
        Верификация преимущества (edge)
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Эмпирический бэктест детектора на истории инструмента ({edge.sample_trades} сделок, без lookahead).
        Cлева — где преимущество реально, справа — не деградирует ли оно сейчас.
      </p>

      {/* Вердикт */}
      <div className={`flex items-start gap-3 p-3 rounded-lg border mb-4 ${v.cls}`}>
        <Icon className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">{v.label}</div>
          <div className="text-xs text-gray-400 mt-1 leading-relaxed">{edge.summary}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Когорты по режимам */}
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-2">Эффективность по режимам рынка</h4>
          {edge.cohorts.length > 0 ? (
            edge.cohorts.map((c) => <CohortBar key={c.cohort} c={c} />)
          ) : (
            <p className="text-xs text-gray-500">Ни одна когорта не набрала наблюдений.</p>
          )}
          <p className="text-[10px] text-gray-600 mt-2">
            Точка — средний net R когорты, полоса — 95% CI. EDGE = CI целиком выше нуля при n ≥ 20.
          </p>
        </div>

        {/* Деградация 90 дней vs история */}
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-2">
            Мониторинг деградации · последние {d.window_days} дней
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div className="p-2 rounded bg-gray-800/40">
              <div className="text-gray-500 mb-1">Окно ({d.recent_trades} сд.)</div>
              <div className={`font-mono text-base font-bold ${d.recent_expectancy === null ? 'text-gray-600' : d.recent_expectancy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {d.recent_expectancy === null ? '—' : `${d.recent_expectancy >= 0 ? '+' : ''}${d.recent_expectancy.toFixed(2)} R`}
              </div>
            </div>
            <div className="p-2 rounded bg-gray-800/40">
              <div className="text-gray-500 mb-1">История ({d.history_trades} сд.)</div>
              <div className={`font-mono text-base font-bold ${d.history_expectancy === null ? 'text-gray-600' : d.history_expectancy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {d.history_expectancy === null ? '—' : `${d.history_expectancy >= 0 ? '+' : ''}${d.history_expectancy.toFixed(2)} R`}
              </div>
            </div>
          </div>

          {/* Визуальное сравнение двух expectancy на общей шкале */}
          {d.recent_expectancy !== null && d.history_expectancy !== null && (() => {
            const maxAbs = Math.max(Math.abs(d.recent_expectancy), Math.abs(d.history_expectancy), 0.5);
            const bar = (v: number, label: string, color: string) => {
              const pct = (Math.abs(v) / maxAbs) * 50;
              return (
                <div className="flex items-center gap-2 text-[11px] mb-1">
                  <span className="w-16 text-gray-500 shrink-0">{label}</span>
                  <div className="relative flex-1 h-2.5 bg-gray-800/60 rounded">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-gray-600" />
                    <div
                      className="absolute top-0 bottom-0 rounded"
                      style={{
                        left: v >= 0 ? '50%' : `${50 - pct}%`,
                        width: `${pct}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono shrink-0" style={{ color }}>{v >= 0 ? '+' : ''}{v.toFixed(2)} R</span>
                </div>
              );
            };
            return (
              <div className="mb-3">
                {bar(d.history_expectancy, 'История', '#64748b')}
                {bar(d.recent_expectancy, `Окно ${d.window_days}д`, d.degraded ? '#ef4444' : '#eab308')}
              </div>
            );
          })()}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 mb-2 font-mono">
            <span>Δ = {d.delta === null ? '—' : `${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(2)} R`}</span>
            <span>z = {d.z_score === null ? '—' : d.z_score.toFixed(2)}</span>
            <span>p = {d.p_value === null ? '—' : d.p_value.toFixed(3)}</span>
          </div>
          <p className={`text-xs leading-relaxed ${d.degraded ? 'text-red-400' : d.insufficient_data ? 'text-gray-500' : 'text-green-400'}`}>
            {d.degraded && '⚠ '}{d.note}
          </p>
        </div>
      </div>
    </div>
  );
}
