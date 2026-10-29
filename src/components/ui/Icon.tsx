// Единая SVG-иконка (Lucide) — замена эмодзи в UI для профессионального вида.
import {
  AlertTriangle, ArrowLeftRight, BarChart2, BookOpen, CandlestickChart,
  CheckCircle2, Clock, FlaskConical, Footprints, Info, ScrollText, Target, TrendingDown,
  TrendingUp, XOctagon, Zap,
} from 'lucide-react';

export type IconName =
  | 'check' | 'warning' | 'stop' | 'info'
  | 'trend-up' | 'trend-down' | 'range' | 'flash'
  | 'target' | 'volume' | 'flask' | 'book' | 'candle' | 'story' | 'path' | 'clock';

const ICONS: Record<IconName, typeof CheckCircle2> = {
  check: CheckCircle2,
  warning: AlertTriangle,
  stop: XOctagon,
  info: Info,
  'trend-up': TrendingUp,
  'trend-down': TrendingDown,
  range: ArrowLeftRight,
  flash: Zap,
  target: Target,
  volume: BarChart2,
  flask: FlaskConical,
  book: BookOpen,
  candle: CandlestickChart,
  story: ScrollText,
  path: Footprints,
  clock: Clock,
};

/** Инлайновая иконка: baseline-выравнивание рядом с текстом, размер по font-size (1em). */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  const Cmp = ICONS[name];
  return <Cmp className={`inline-block h-[1.15em] w-[1.15em] align-[-0.2em] shrink-0 ${className ?? ''}`} aria-hidden="true" />;
}
