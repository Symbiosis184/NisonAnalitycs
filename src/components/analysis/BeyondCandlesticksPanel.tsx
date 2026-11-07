import { useMemo, useState } from 'react';
import type { CandleDTO } from '../../api/types';
import {
  disparityIndex,
  kagi,
  renko,
  threeLineBreak,
  type ChartDirection,
} from '../../utils/beyond_candlesticks';
import { formatPrice } from '../../utils/format';
import { useI18n } from '../../i18n';

type Method = 'disparity' | 'break' | 'renko' | 'kagi';

const W = 800;
const H = 270;
const PAD_X = 54;
const PAD_Y = 22;

function scale(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * 0.08;
  min -= padding;
  max += padding;
  return {
    min,
    max,
    x: (index: number, count: number) => PAD_X + index * (W - 2 * PAD_X) / Math.max(1, count - 1),
    y: (value: number) => PAD_Y + (max - value) * (H - 2 * PAD_Y) / (max - min),
  };
}

function Axis({ min, max }: { min: number; max: number }) {
  return (
    <>
      {[0, 0.5, 1].map(ratio => {
        const value = min + (max - min) * (1 - ratio);
        const y = PAD_Y + ratio * (H - 2 * PAD_Y);
        return (
          <g key={ratio}>
            <line x1={PAD_X} x2={W - PAD_X} y1={y} y2={y} stroke="#334155" strokeDasharray="3 5" />
            <text x={PAD_X - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11">
              {formatPrice(value)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="flex h-56 items-center justify-center text-sm text-gray-500">{text}</div>;
}

export function BeyondCandlesticksPanel({ candles }: { candles: CandleDTO[] }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<Method>('disparity');
  const [period, setPeriod] = useState(13);
  const [brickPct, setBrickPct] = useState(1);
  const [kagiType, setKagiType] = useState<'fixed' | 'percent'>('percent');
  const [kagiValue, setKagiValue] = useState(2);
  const points = useMemo(
    () => candles.map(c => ({ time: c.time, close: c.close })).filter(c => Number.isFinite(c.close)),
    [candles],
  );
  const lastPrice = points[points.length - 1]?.close ?? 0;
  const brickSize = Math.max(lastPrice * brickPct / 100, Number.EPSILON);

  const disparity = useMemo(
    () => method === 'disparity' ? disparityIndex(points, period) : [],
    [method, points, period],
  );
  const lastDisparity = disparity[disparity.length - 1]?.disparity ?? NaN;
  const breakLines = useMemo(
    () => method === 'break' ? threeLineBreak(points) : [],
    [method, points],
  );
  const bricks = useMemo(
    () => method === 'renko' && lastPrice > 0 ? renko(points, brickSize) : [],
    [method, points, brickSize, lastPrice],
  );
  const kagiSegments = useMemo(
    () => method === 'kagi' ? kagi(points, { type: kagiType, value: kagiValue }) : [],
    [method, points, kagiType, kagiValue],
  );

  const methods: Array<{ id: Method; label: string }> = [
    { id: 'disparity', label: t('Индекс разницы') },
    { id: 'break', label: 'Three-line break' },
    { id: 'renko', label: 'Renko' },
    { id: 'kagi', label: 'Kagi' },
  ];
  const color = (direction: ChartDirection) => direction === 'up' ? '#34d399' : '#fb7185';

  return (
    <div className="panel p-4 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-800/50 p-1">
          {methods.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMethod(item.id)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                method === item.id ? 'bg-sky-500/20 text-sky-300' : 'text-gray-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          {method === 'disparity' && (
            <label>{t('Период SMA')}
              <input
                aria-label={t('Период SMA')}
                type="number" min={1} step={1} value={period}
                onChange={e => setPeriod(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                className="ml-2 w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
              />
            </label>
          )}
          {method === 'renko' && (
            <label>{t('Кирпич, % от текущей цены')}
              <input
                aria-label={t('Кирпич, % от текущей цены')}
                type="number" min={0.01} step={0.1} value={brickPct}
                onChange={e => setBrickPct(Math.max(0.01, Number(e.target.value) || 0.01))}
                className="ml-2 w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
              />
            </label>
          )}
          {method === 'kagi' && (
            <>
              <select
                aria-label={t('Тип порога Kagi')}
                value={kagiType}
                onChange={e => setKagiType(e.target.value as 'fixed' | 'percent')}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
              >
                <option value="percent">{t('Процентный')}</option>
                <option value="fixed">{t('Фиксированный')}</option>
              </select>
              <input
                aria-label={t('Порог разворота Kagi')}
                type="number" min={0.01} step={kagiType === 'percent' ? 0.1 : 1} value={kagiValue}
                onChange={e => setKagiValue(Math.max(0.01, Number(e.target.value) || 0.01))}
                className="w-24 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
              />
              <span>{kagiType === 'percent' ? '%' : t('ед. цены')}</span>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-800 bg-gray-950/40">
        {method === 'disparity' && (() => {
          const valid = disparity.filter(p => Number.isFinite(p.disparity));
          const s = scale([...valid.map(p => p.disparity), 0]);
          if (!s || valid.length < 2) return <EmptyChart text={t('Нужно больше закрытых баров для полного окна SMA')} />;
          const path = valid.map((p, i) => `${i === 0 ? 'M' : 'L'}${s.x(i, valid.length)},${s.y(p.disparity)}`).join(' ');
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label={t('График индекса разницы')}>
              <Axis min={s.min} max={s.max} />
              <line x1={PAD_X} x2={W - PAD_X} y1={s.y(0)} y2={s.y(0)} stroke="#64748b" />
              <path d={path} fill="none" stroke="#38bdf8" strokeWidth={2.2} />
            </svg>
          );
        })()}

        {method === 'break' && (() => {
          const s = scale(breakLines.flatMap(l => [l.startPrice, l.endPrice]));
          if (!s || breakLines.length === 0) return <EmptyChart text={t('Закрытия ещё не вышли за базовую цену')} />;
          const step = (W - 2 * PAD_X) / Math.max(1, breakLines.length);
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label="Three-line break">
              <Axis min={s.min} max={s.max} />
              {breakLines.map((line, i) => {
                const x1 = PAD_X + i * step;
                const x2 = x1 + step;
                return <g key={i} stroke={color(line.direction)} strokeWidth={2.5}>
                  <line x1={x1} x2={x2} y1={s.y(line.startPrice)} y2={s.y(line.startPrice)} />
                  <line x1={x2} x2={x2} y1={s.y(line.startPrice)} y2={s.y(line.endPrice)} />
                </g>;
              })}
            </svg>
          );
        })()}

        {method === 'renko' && (() => {
          const s = scale(bricks.flatMap(b => [b.open, b.close]));
          if (!s || bricks.length === 0) return <EmptyChart text={t('Движение закрытия ещё не достигло размера кирпича')} />;
          const step = (W - 2 * PAD_X) / Math.max(1, bricks.length);
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label="Renko">
              <Axis min={s.min} max={s.max} />
              {bricks.map((brick, i) => {
                const y = s.y(Math.max(brick.open, brick.close));
                const height = Math.max(1, Math.abs(s.y(brick.open) - s.y(brick.close)));
                return <rect
                  key={i} x={PAD_X + i * step + 1} y={y}
                  width={Math.max(1, step - 2)} height={height}
                  fill={color(brick.direction)} fillOpacity={0.75}
                />;
              })}
            </svg>
          );
        })()}

        {method === 'kagi' && (() => {
          const s = scale(kagiSegments.flatMap(segment => [segment.startPrice, segment.endPrice]));
          if (!s || kagiSegments.length === 0) return <EmptyChart text={t('Движение закрытия ещё не достигло порога Kagi')} />;
          const step = (W - 2 * PAD_X) / Math.max(1, kagiSegments.length);
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label="Kagi">
              <Axis min={s.min} max={s.max} />
              {kagiSegments.map((segment, i) => {
                const x1 = PAD_X + i * step;
                const x2 = x1 + step;
                return <g key={i} stroke={color(segment.direction)} strokeWidth={segment.style === 'yang' ? 4 : 1.8}>
                  <line x1={x1} x2={x2} y1={s.y(segment.startPrice)} y2={s.y(segment.startPrice)} />
                  <line x1={x2} x2={x2} y1={s.y(segment.startPrice)} y2={s.y(segment.endPrice)} />
                </g>;
              })}
            </svg>
          );
        })()}
      </div>

      <div className="mt-3 flex flex-col gap-1 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {method === 'disparity' && `${t('Отклонение close от SMA')} ${period}; ${t('последнее')}: ${Number.isFinite(lastDisparity) ? lastDisparity.toFixed(2) + '%' : '—'}`}
          {method === 'break' && `${t('Линий')}: ${breakLines.length}`}
          {method === 'renko' && `${t('Кирпичей')}: ${bricks.length} · ${t('фиксированный размер')}: ${formatPrice(brickSize)}`}
          {method === 'kagi' && `${t('Отрезков')}: ${kagiSegments.length} · ${t('толстая линия — ян, тонкая — инь')}`}
        </span>
        <span>{t('Построение по закрытиям; само по себе не является торговым сигналом.')}</span>
      </div>
    </div>
  );
}
