// Визуализация многомерного объёма (запрос: «нужна визуализация»).
// 1) VolumeProfileChart — горизонтальный профиль объёма (HVN/LVN, POC, Value Area)
//    + оверлей «пути цены» сигнала: стоп → вход → цель с препятствиями на транзите.
// 2) DeltaChart — proxy-дельта по свечам окна + накопленная дельта (cumulative delta).
// Данные берутся из готового отчёта анализа (report.volume_profile / delta_summary / signals[].path).

import { memo } from 'react';
import { formatPrice } from '../utils/format';
import type { AnalysisReport, SignalDTO } from '../api/types';

const COLORS = {
  hvn: '#f59e0b',
  lvn: '#38bdf8',
  poc: '#a78bfa',
  va: 'rgba(148, 163, 184, 0.10)',
  grid: '#1e293b',
  text: '#94a3b8',
  long: '#22c55e',
  short: '#ef4444',
};

interface VPProps {
  profile: NonNullable<AnalysisReport['volume_profile']>;
  price: number;
  /** Активный сигнал: его «путь цены» оверлеем поверх профиля */
  signal?: SignalDTO;
}

/** Текстовая расшифровка профиля объёма (под графиком, см. «Как читать») */
export function VolumeProfileNotes({ profile, price }: Pick<VPProps, 'profile' | 'price'>) {
  const bins = profile.bins ?? [];
  const hvnPct = bins.length > 0
    ? (profile.hvn.reduce((s, n) => s + n.volume, 0) / Math.max(1e-9, bins.reduce((s, b) => s + b.volume, 0))) * 100
    : null;
  const lvnCount = profile.lvn.length;
  // Где сейчас цена относительно Value Area → канонический сценарий Стейдента
  const positionVsVa = price > profile.vah ? 'above' : price < profile.val ? 'below' : 'inside';
  const positionNote =
    positionVsVa === 'inside'
      ? `Цена внутри Value Area (~70% всего объёма окна) — рынок в равновесии. Наиболее вероятен возврат к POC («магнит ликвидности») и боковое движение между VAH и VAL: у VAL ищем отскок вверх, у VAH — вниз, а не торговлю на пробой.`
      : positionVsVa === 'above'
        ? `Цена ВЫШЕ Value Area — покупатели удерживают зону дисбаланса, пробой верхней границы зафиксирован. Откат к VAH при удержании выше него — потенциальная точка входа по тренду; если же свеча закроется обратно внутри VA, срабатывает стоп-реверс (правило 80% П. Стейдента): вероятен проход к противоположной границе VAL.`
        : `Цена НИЖЕ Value Area — продавцы контролируют ценовое открытие, нижняя граница пробита. Возврат внутрь VA маловероятен без роста дельты покупателей; VAH теперь — сильное сопротивление, а продолжение движения через LVN-«дыры» обычно проходит быстро и без откатов.`;

  return (
    <div className="mt-2 space-y-2 text-xs leading-relaxed text-gray-400">
      <p>
        Профиль показывает, на каких ценах за окно анализа реально торговался объём
        (в отличие от объёма по времени внизу графика свечей). Горизонтальная длина
        каждого бара = доля объёма на этом ценовом уровне.
      </p>
      <ul className="list-disc pl-4 space-y-1">
        <li>
          <span className="font-medium text-amber-400">HVN</span>
          {hvnPct !== null ? ` — пики объёма (${hvnPct.toFixed(0)}% всего объёма окна)` : ''}: здесь цена
          «застряла», много двусторонних сделок. Работают как магниты и зоны трения:
          подход к HVN обычно замедляет движение, пробой требует сильной дельты.
        </li>
        <li>
          <span className="font-medium text-sky-400">LVN</span> — «дыры» в профиле ({lvnCount} узлов): объём здесь почти не торговался,
          цены пролетают такие зоны быстро, откаты в них коротки. LVN между входом и
          целью — союзник транзита; LVN сразу за стопом — сигнал, что выбить вас будет трудно.
        </li>
        <li>
          <span className="font-medium text-violet-400">POC</span> (${formatPrice(profile.poc)}) — цена максимального объёма («справедливая цена» окна). В равновесном
          рынке притягивает цену обратно.
        </li>
        <li>
          <span className="font-medium text-gray-300">Value Area</span> (${formatPrice(profile.val)}–${formatPrice(profile.vah)}) — затенённая полоса ~70% объёма. Границы VA —
          естественные уровни для входов от границ и стопов.
        </li>
      </ul>
      <p className="rounded-lg border border-gray-800/60 bg-surface-base p-2 text-gray-300">{positionNote}</p>
      <p className="text-gray-500">
        Совпадение POC или границы VA с уровнем S/R мульти-ТФ карты резко повышает
        значимость зоны: два независимых метода указывают на одну цену.
      </p>
    </div>
  );
}

function VolumeProfileChartImpl({ profile, price, signal }: VPProps) {
  const bins = profile.bins ?? [];
  if (bins.length === 0) return null;

  const W = 760;
  const H = 360;
  const padL = 8, padR = 8, padT = 16, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const lo = Math.min(...bins.map((b) => b.low));
  const hi = Math.max(...bins.map((b) => b.high));
  const span = hi - lo || 1;
  const maxShare = Math.max(...bins.map((b) => b.share)) || 1;

  // цена → y (верх графика = максимум цены)
  const yOf = (p: number) => padT + (1 - (p - lo) / span) * plotH;
  const barW = (share: number) => Math.max(1, (share / maxShare) * plotW);

  const isHvn = (low: number, high: number) =>
    profile.hvn.some((n) => n.high > low && n.low < high);
  const isLvn = (low: number, high: number) =>
    profile.lvn.some((n) => n.high > low && n.low < high);

  // HVN — амбер (зоны трения), LVN — голубой («дыры»), обычный бином — slate
  const binColor = (b: { low: number; high: number }) => {
    if (isHvn(b.low, b.high)) return 'rgba(245, 158, 11, 0.75)';
    if (isLvn(b.low, b.high)) return 'rgba(56, 189, 248, 0.7)';
    return 'rgba(100, 116, 139, 0.35)';
  };

  const path = signal?.path;
  const dirColor = signal ? (signal.direction === 'long' ? COLORS.long : COLORS.short) : COLORS.text;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="Профиль объёма">
      {/* Value Area — затенённая зона ~70% объёма */}
      <rect x={padL} y={yOf(profile.vah)} width={plotW} height={Math.max(0, yOf(profile.val) - yOf(profile.vah))} fill={COLORS.va} />

      {/* Горизонтальные бары профиля */}
      {bins.map((b, i) => (
        <rect
          key={i}
          x={padL}
          y={yOf(b.high)}
          width={barW(b.share)}
          height={Math.max(1, yOf(b.low) - yOf(b.high) - 0.5)}
          fill={binColor(b)}
          rx={1}
        >
          <title>{`${formatPrice(b.low)}–${formatPrice(b.high)} · ${(b.share * 100).toFixed(1)}% объёма`}</title>
        </rect>
      ))}

      {/* POC */}
      <line x1={padL} y1={yOf(profile.poc)} x2={W - padR} y2={yOf(profile.poc)} stroke={COLORS.poc} strokeWidth={1.5} strokeDasharray="6 3" />
      <text x={W - padR} y={yOf(profile.poc) - 4} textAnchor="end" fontSize={10} fill={COLORS.poc}>POC ${formatPrice(profile.poc)}</text>

      {/* VAH / VAL */}
      <line x1={padL} y1={yOf(profile.vah)} x2={W - padR} y2={yOf(profile.vah)} stroke="#64748b" strokeWidth={1} strokeDasharray="2 3" />
      <text x={padL + 4} y={yOf(profile.vah) - 3} fontSize={9} fill={COLORS.text}>VAH ${formatPrice(profile.vah)}</text>
      <line x1={padL} y1={yOf(profile.val)} x2={W - padR} y2={yOf(profile.val)} stroke="#64748b" strokeWidth={1} strokeDasharray="2 3" />
      <text x={padL + 4} y={yOf(profile.val) + 10} fontSize={9} fill={COLORS.text}>VAL ${formatPrice(profile.val)}</text>

      {/* Текущая цена */}
      <line x1={padL} y1={yOf(price)} x2={W - padR} y2={yOf(price)} stroke="#e2e8f0" strokeWidth={1} />
      <text x={W - padR} y={yOf(price) + 11} textAnchor="end" fontSize={10} fill="#e2e8f0">Цена ${formatPrice(price)}</text>

      {/* Оверлей пути цены активного сигнала */}
      {signal && (
        <>
          {/* Коридор вход → цель */}
          <rect
            x={padL}
            y={Math.min(yOf(signal.entry_price), yOf(signal.target))}
            width={plotW}
            height={Math.abs(yOf(signal.target) - yOf(signal.entry_price))}
            fill={dirColor}
            opacity={0.07}
          />
          <line x1={padL} y1={yOf(signal.entry_price)} x2={W - padR} y2={yOf(signal.entry_price)} stroke={dirColor} strokeWidth={1.5} />
          <text x={padL + 4} y={yOf(signal.entry_price) - 3} fontSize={10} fill={dirColor}>Вход ${formatPrice(signal.entry_price)}</text>
          <line x1={padL} y1={yOf(signal.target)} x2={W - padR} y2={yOf(signal.target)} stroke={dirColor} strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={padL + 4} y={yOf(signal.target) - 3} fontSize={10} fill={dirColor}>Цель ${formatPrice(signal.target)}</text>
          <line x1={padL} y1={yOf(signal.stop_loss)} x2={W - padR} y2={yOf(signal.stop_loss)} stroke="#ef4444" strokeWidth={1} strokeDasharray="2 4" />
          <text x={W - padR} y={yOf(signal.stop_loss) - 3} textAnchor="end" fontSize={9} fill="#f87171">Стоп ${formatPrice(signal.stop_loss)}</text>

          {/* Препятствия на транзите (S/R-зоны и HVN-кластеры) */}
          {(path?.obstacles ?? []).map((o, i) => (
            <g key={i}>
              <line x1={padL} y1={yOf(o.level)} x2={W - padR} y2={yOf(o.level)} stroke={o.kind === 'hvn' ? COLORS.hvn : '#fb7185'} strokeWidth={1} strokeDasharray="1 3" />
              <circle cx={padL + plotW * 0.5} cy={yOf(o.level)} r={3} fill={o.kind === 'hvn' ? COLORS.hvn : '#fb7185'}>
                <title>{`${o.kind === 'hvn' ? 'HVN-узел' : 'S/R-зона'} ${formatPrice(o.level)} · сила ${(o.strength * 100).toFixed(0)}% · ${o.detail}`}</title>
              </circle>
            </g>
          ))}
        </>
      )}

      {/* Легенда */}
      <g fontSize={9} fill={COLORS.text}>
        <rect x={padL} y={H - 12} width={8} height={8} fill="rgba(245, 158, 11, 0.75)" />
        <text x={padL + 11} y={H - 5}>HVN (трение)</text>
        <rect x={padL + 82} y={H - 12} width={8} height={8} fill="rgba(56, 189, 248, 0.7)" />
        <text x={padL + 93} y={H - 5}>LVN (дыра — быстрый проход)</text>
        <line x1={padL + 230} y1={H - 8} x2={padL + 246} y2={H - 8} stroke={COLORS.poc} strokeDasharray="5 3" />
        <text x={padL + 250} y={H - 5}>POC · Value Area 70%</text>
        {signal && (
          <>
            <line x1={padL + 380} y1={H - 8} x2={padL + 396} y2={H - 8} stroke={dirColor} strokeWidth={2} />
            <text x={padL + 400} y={H - 5}>Путь цены: {signal.pattern}</text>
          </>
        )}
      </g>
    </svg>
  );
}

interface DeltaProps {
  summary: NonNullable<AnalysisReport['delta_summary']>;
}

const TREND_LABEL_RU: Record<string, string> = { rising: 'растёт ↗', falling: 'падает ↘', flat: 'плоско →' };

// ── Подробная текстовая расшифровка дельты-графика ────────────────────────────
// Поясняет каждую метрику и формирует динамический вывод «что сейчас происходит»,
// чтобы панель читалась как готовый комментарий аналитика, а не набор чисел.

type DeltaSummary = NonNullable<AnalysisReport['delta_summary']>;
type DeltaPoint = NonNullable<DeltaSummary['points']>[number];

function classifyImbalance(p: DeltaPoint, maxAbs: number): 'strong' | 'weak' | null {
  if (!p.imbalance) return null;
  return Math.abs(p.delta) >= 0.6 * maxAbs ? 'strong' : 'weak';
}

function divergenceNote(summary: DeltaSummary, priceChangePct?: number): string | null {
  if (priceChangePct === undefined || Math.abs(priceChangePct) < 0.3) return null;
  const cum = summary.cumulative_delta;
  const trendUp = summary.delta_trend === 'rising';
  const priceUp = priceChangePct > 0;
  // Дивергенция: цена идёт в одну сторону, накопленная агрессия — в другую
  if (priceUp && (cum < 0 || summary.delta_trend === 'falling')) {
    return `⚠️ Бычья дивергенция: цена выросла за окно (${priceUp ? '+' : ''}${priceChangePct.toFixed(1)}%), но дельта отрицательная / падает — рост делают пассивные лимитки, а не агрессивный спрос. По Нисону такое движение хрупкое: без подтверждения объёмом на пробое ему не доверяем.`;
  }
  if (!priceUp && (cum > 0 || trendUp)) {
    return `⚠️ Медвежья дивергенция: цена снизилась (${priceChangePct.toFixed(1)}%), но покупатели агрессивно подбирают (ΣΔ > 0 / дельта растёт). Часто это признак поглощения предложения — кандидат на разворот вверх после подтверждения следующей свечой.`;
  }
  if (priceUp && cum > 0 && trendUp) {
    return '✅ Подтверждённый рост: цена и накопленная дельта идут вместе — спрос агрессивный и настоящий, движению можно доверять.';
  }
  if (!priceUp && cum < 0 && summary.delta_trend === 'falling') {
    return '✅ Подтверждённое снижение: продавцы давят и ценой, и дельтой — отскоки без смены знака ΣΔ лучше рассматривать как повод для шорта, а не разворот.';
  }
  return null;
}

export function DeltaNotes({ summary, priceChangePct }: { summary: DeltaSummary; priceChangePct?: number }) {
  const points = summary.points ?? [];
  if (points.length === 0) return null;
  const maxAbs = Math.max(...points.map((p) => Math.abs(p.delta))) || 1;

  const strongBuy = points.filter((p) => classifyImbalance(p, maxAbs) === 'strong' && p.imbalance === 'buy').length;
  const strongSell = points.filter((p) => classifyImbalance(p, maxAbs) === 'strong' && p.imbalance === 'sell').length;
  const lastN = points.slice(-Math.min(8, points.length));
  const recentSum = lastN.reduce((s, p) => s + p.delta, 0);
  const div = divergenceNote(summary, priceChangePct);

  return (
    <div className="text-xs text-gray-400 leading-relaxed space-y-2">
      <p className="text-gray-300 font-medium">Как читать этот график</p>
      <ul className="list-disc list-inside space-y-1">
        <li>
          <span className="text-green-400 font-medium">Зелёный столбец</span> — за свечу агрессия покупателей превысила агрессию продавцов (покупали по рынку / «били в аск»).{' '}
          <span className="text-red-400 font-medium">Красный</span> — наоборот, продавали в рынок. Высота столбца = величина перевеса.
        </li>
        <li>
          <span className="text-green-500 font-medium">Насыщенные зелёные / <span className="text-red-500">насыщенные красные</span></span> — дисбаланс агрессии (перевес одной стороны ≥3:1 внутри бара). За окном найдено:{' '}
          <b className="text-white">{strongBuy}</b> бычьих и <b className="text-white">{strongSell}</b> медвежьих сильных дисбалансов. Их скопление у уровня поддержки — типичное «всасывание» предложения по Нисону; у сопротивления — активность распределения.
        </li>
        <li>
          <span className="text-amber-400 font-medium">Жёлтая линия</span> — накопленная дельта (сумма всех Δ слева направо). Растёт = рынок чистят покупатели; падает = продавцы; плоская при движении цены = работу делает пассивная сторона (тонкая ликвидность).
        </li>
        <li>
          <b className="text-gray-300">CLV (Close Location Value)</b> — где внутри диапазона свечи закрылась цена: <span className="text-green-400">+1</span> — у самого максимума (покупатели дожали бар), <span className="text-red-400">−1</span> — у минимума, <span className="text-gray-300">0</span> — в середине. Средний CLV окна: <span className={summary.avg_clv >= 0 ? 'text-green-400' : 'text-red-400'}><b>{summary.avg_clv.toFixed(2)}</b></span> — {summary.avg_clv >= 0.2 ? 'закрытия жмутся к вершинам свечей, buyers держат финал каждого бара' : summary.avg_clv <= -0.2 ? 'закрытия у оснований свечей — продавцы закрывают бары на минимумах, давление реальное' : 'закрытия в середине диапазонов — ни одна сторона не продавила итог бара (борьба/флэт)'}.
        </li>
        <li>
          <b className="text-gray-300">Последние {lastN.length} баров:</b> ΣΔ {recentSum >= 0 ? <span className="text-green-400">+{Math.round(recentSum).toLocaleString('ru-RU')}</span> : <span className="text-red-400">{Math.round(recentSum).toLocaleString('ru-RU')}</span>} — {recentSum >= 0 ? 'на свежем участке спрос перевешивает' : 'на свежем участке перевешивает предложение'} (важнее всей линии: показывает, кто контролирует рынок прямо сейчас).
        </li>
      </ul>
      {div && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">{div}</p>
      )}
      <p className="text-gray-500 italic">
        ⚠️ Proxy-оценка по OHLCV: тикового стакана/ленты Bybit здесь нет, поэтому дельта вычисляется из формы свечи (тело + позиция закрытия + объём). Она надёжна для оценки перекоса агрессии и дивергенций, но абсолютные числа не равны биржевой дельте из footprint-терминалов. Правило Нисона сохраняется: любой сигнал подтверждается только на следующей свече.
      </p>
    </div>
  );
}

function DeltaChartImpl({ summary }: DeltaProps) {
  const points = summary.points ?? [];
  if (points.length === 0) return null;

  const W = 760;
  const H = 220;
  const padL = 8, padR = 46, padT = 12, padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxAbs = Math.max(...points.map((p) => Math.abs(p.delta))) || 1;
  const barW = Math.max(2, plotW / points.length - 2);
  const zeroY = padT + plotH / 2;
  const yOfDelta = (d: number) => zeroY - (d / maxAbs) * (plotH / 2);

  // Накопленная дельта (cumulative delta line)
  let cum = 0;
  const cums = points.map((p) => (cum += p.delta));
  const cumMax = Math.max(...cums.map(Math.abs)) || 1;
  const cumPath = cums
    .map((v, i) => `${padL + (i / Math.max(1, cums.length - 1)) * plotW},${padT + (1 - (v / cumMax + 1) / 2) * plotH}`)
    .join(' ');

  const buySharePct = (summary.buy_pressure_share * 100).toFixed(0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="Дельта агрессии">
        <line x1={padL} y1={zeroY} x2={padL + plotW} y2={zeroY} stroke={COLORS.grid} />
        {/* Столбцы proxy-дельты по свечам */}
        {points.map((p, i) => {
          const x = padL + (i / points.length) * plotW;
          const y = p.delta >= 0 ? yOfDelta(p.delta) : zeroY;
          const h = Math.abs(yOfDelta(p.delta) - zeroY);
          const col = p.imbalance === 'buy' ? '#16a34a' : p.imbalance === 'sell' ? '#dc2626' : p.delta >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)';
          return (
            <rect key={i} x={x} y={y} width={barW} height={Math.max(1, h)} fill={col} rx={1}>
              <title>{`Δ ${p.delta.toFixed(0)} · CLV ${p.clv.toFixed(2)}${p.imbalance ? ` · дисбаланс: ${p.imbalance}` : ''}`}</title>
            </rect>
          );
        })}
        {/* Накопленная дельта */}
        <polyline points={cumPath} fill="none" stroke="#fbbf24" strokeWidth={1.8} />
        <text x={W - padR + 4} y={padT + 8} fontSize={9} fill="#fbbf24">Σ Δ</text>
        <text x={W - padR + 4} y={padT + 20} fontSize={9} fill={COLORS.text}>{(summary.cumulative_delta / 1000).toFixed(1)}k</text>
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span title="Сумма proxy-дельт за окно (агрессия покупателей минус продавцов)">
          Накопленная дельта:{' '}
          <span className={summary.cumulative_delta >= 0 ? 'text-green-400' : 'text-red-400'}>
            {summary.cumulative_delta >= 0 ? '+' : ''}{Math.round(summary.cumulative_delta).toLocaleString('ru-RU')}
          </span>
        </span>
        <span>Доля бычьих свечей: <span className="text-white font-mono">{buySharePct}%</span></span>
        <span title="Средний Close Location Value: закрытия у вершин (+) или оснований (−) диапазона">
          Средний CLV: <span className={summary.avg_clv >= 0 ? 'text-green-400' : 'text-red-400'}>{summary.avg_clv.toFixed(2)}</span>
        </span>
        <span>Тренд дельты: <span className="text-amber-400">{TREND_LABEL_RU[summary.delta_trend] ?? summary.delta_trend}</span></span>
        <span className="text-gray-600">* proxy-оценка по OHLCV (без тикового footprint)</span>
      </div>
    </div>
  );
}

// Оптимизация: SVG-профили дорогие; memo отсекает ре-рендер на live-тикках страницы.
export const VolumeProfileChart = memo(VolumeProfileChartImpl);

// Оптимизация: SVG-профили дорогие; memo отсекает ре-рендер на live-тикках страницы.
export const DeltaChart = memo(DeltaChartImpl);
