import type { ReactNode } from 'react';

/**
 * Этап 3 «Glass Terminal 2.0» — UI-примитивы.
 * Только визуальный слой: методика Нисона не затрагивается.
 */

export function Card({
  children,
  className = '',
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div className={`panel ${hover ? 'panel-hover' : ''} ${className}`}>
      {children}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  active:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pending:  'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  win:      'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  loss:     'bg-rose-500/15 text-rose-300 border-rose-500/30',
  closed:   'bg-slate-500/15 text-slate-300 border-slate-500/30',
  expired:  'bg-slate-500/15 text-slate-400 border-slate-500/25',
  invalidated: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
  neutral:  'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: keyof typeof BADGE_TONES | string;
  children: ReactNode;
  className?: string;
}) {
  const toneClass = BADGE_TONES[tone] ?? BADGE_TONES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium leading-none ${toneClass} ${className}`}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  tone = '',
  className = '',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string; // доп. класс цвета значения, напр. 'text-emerald-400'
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-2xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${tone || 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}
