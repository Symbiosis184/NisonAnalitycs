// Многомерный объём (запрос пользователя: «объёмного контекста»).
//
// 1) Volume Profile — распределение объёма по ценовым уровням за окно.
//    Строится гистограмма (равные ценовые корзины), выделяются:
//      POC  — Point of Control, корзина с максимальным объёмом;
//      VA   — Value Area ≈ 70% объёма вокруг POC; её границы VAH/VAL;
//      HVN  — High Volume Nodes — локальные пики профиля (зоны «притяжения»/трения);
//      LVN  — Low Volume Nodes — локальные провалы («дыры»: цена проходит быстро).
//
// 2) Дельта и дисбалансы агрессии. По OHLCV-свече без тиковой ленты дельту
//    восстанавливают стандартными консервативными оценками:
//      • signed volume: бычья свеча → +volume, медвежья → −volume (proxy delta);
//      • Close Location Value (CLV): где закрылась свеча в своём диапазоне;
//      • imbalance: тело свечи против теней — перекос агрессии одной стороны
//        (bullish imbalance: close у highs при слабом upper wick и т.д.).
//    Это ЧЕСТНАЯ оценка (proxy), а не реальный footprint — так и подписано в API.
//
// Используется: signal_quality (объём подтверждения паттерна), price_path (HVN/LVN),
// client.ts (публичный профиль для UI).

import type { Candle } from './candle';

export interface VolumeProfileBin {
  low: number;
  high: number;
  volume: number;
  /** доля от общего объёма окна 0..1 */
  share: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  poc: number;              // Point of Control (цена — середина пиковой корзины)
  pocVolume: number;
  vah: number;              // Value Area High
  val: number;              // Value Area Low
  hvn: VolumeProfileBin[];  // локальные максимумы профиля (пики)
  lvn: VolumeProfileBin[];  // локальные минимумы внутри диапазона (провалы)
  totalVolume: number;
  /** Готово для price_path.evaluatePricePath: вес = volume / max bin volume */
  bands: Array<{ low: number; high: number; weight: number }>;
}

/**
 * Построение профиля объёма по последним `lookback` свечам.
 * Объём свечи распределяется равномерно по корзине(ам), которых касается её диапазон.
 */
export function buildVolumeProfile(candles: Candle[], lookback = 120, binCount = 40): VolumeProfile {
  const data = candles.slice(-Math.max(10, lookback));
  const empty: VolumeProfile = {
    bins: [], poc: 0, pocVolume: 0, vah: 0, val: 0, hvn: [], lvn: [],
    totalVolume: 0, bands: [],
  };
  if (data.length === 0) return empty;

  const lo = Math.min(...data.map((c) => c.low));
  const hi = Math.max(...data.map((c) => c.high));
  if (!(hi > lo)) return { ...empty, bins: [], bands: [] };

  const size = (hi - lo) / binCount;
  const vols = new Array<number>(binCount).fill(0);

  for (const c of data) {
    const startBin = Math.min(binCount - 1, Math.max(0, Math.floor((c.low - lo) / size)));
    const endBin = Math.min(binCount - 1, Math.max(0, Math.floor((c.high - lo) / size)));
    const span = endBin - startBin + 1;
    const per = c.volume / span; // равномерное распределение объёма по затронутым корзинам
    for (let b = startBin; b <= endBin; b++) vols[b] += per;
  }

  const totalVolume = vols.reduce((a, b) => a + b, 0) || 1;
  const bins: VolumeProfileBin[] = vols.map((v, i) => ({
    low: lo + i * size,
    high: lo + (i + 1) * size,
    volume: v,
    share: v / totalVolume,
  }));

  // POC — самый объёмный бином
  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;

  // Value Area: расширяемся от POC, пока не соберём >= 70% объёма
  let acc = bins[pocIdx].volume;
  let up = pocIdx;
  let dn = pocIdx;
  while (acc / totalVolume < 0.7 && (up < bins.length - 1 || dn > 0)) {
    const upV = up < bins.length - 1 ? bins[up + 1].volume : -1;
    const dnV = dn > 0 ? bins[dn - 1].volume : -1;
    if (upV >= dnV) { up++; acc += bins[up].volume; }
    else { dn--; acc += bins[dn].volume; }
  }

  // HVN/LVN: локальные экстремумы сглаженного профиля (окно ±1)
  const hvn: VolumeProfileBin[] = [];
  const lvn: VolumeProfileBin[] = [];
  for (let i = 1; i < bins.length - 1; i++) {
    const v = bins[i].volume;
    if (v > 0 && v >= bins[i - 1].volume && v > bins[i + 1].volume && v / bins[pocIdx].volume >= 0.5) {
      hvn.push(bins[i]);
    }
    if (i > dn && i < up && v <= bins[i - 1].volume && v < bins[i + 1].volume) {
      lvn.push(bins[i]);
    }
  }

  const maxVol = bins[pocIdx].volume || 1;
  return {
    bins,
    poc: (bins[pocIdx].low + bins[pocIdx].high) / 2,
    pocVolume: bins[pocIdx].volume,
    vah: bins[up].high,
    val: bins[dn].low,
    hvn,
    lvn,
    totalVolume,
    bands: bins.map((b) => ({ low: b.low, high: b.high, weight: b.volume / maxVol })),
  };
}

// ---------------------------------------------------------------------------
// Дельта и дисбалансы агрессии (proxy по OHLCV)
// ---------------------------------------------------------------------------

export interface DeltaPoint {
  time: number;
  /** Оценка дельты за свечу (положительная — преобладание агрессии покупателей) */
  delta: number;
  /** CLV ∈ [−1..1]:close у highs → +1, у lows → −1 */
  clv: number;
  /** Дисбаланс агрессии: 'buy' | 'sell' | null */
  imbalance: 'buy' | 'sell' | null;
}

export interface DeltaSummary {
  points: DeltaPoint[];
  /** Суммарная дельта окна */
  cumulativeDelta: number;
  /** Доля бычьих дельт-свечей 0..1 */
  buyPressureShare: number;
  /** Средний |CLV| — сила направления закрытий */
  avgClv: number;
  /** Последний тренд дельты: рост/падение за вторую половину окна относительно первой */
  deltaTrend: 'rising' | 'falling' | 'flat';
}

/**
 * Одна свеча → proxy-дельта. Консервативная модель:
 *  signed = volume * (2*CLV_weighted), где вклад тела (направление close vs open)
 *  и вклад позиции закрытия в диапазоне. Диапазон: [−volume .. +volume].
 */
export function candleDelta(c: Candle): { delta: number; clv: number; imbalance: 'buy' | 'sell' | null } {
  const range = c.high - c.low;
  const clv = range > 0 ? (2 * ((c.close - c.low) / range) - 1) : 0;
  const bodyDir = c.close > c.open ? 1 : c.close < c.open ? -1 : 0;
  const bodyRatio = range > 0 ? c.body / range : 0;
  // взвешенная оценка: направление тела × его доля + позиция закрытия (CLV)
  const delta = c.volume * Math.min(1, Math.max(-1, bodyDir * bodyRatio * 0.8 + clv * 0.6));

  // Дисбаланс агрессии: выраженный перекос тела/закрытия против теневой стороны
  let imbalance: 'buy' | 'sell' | null = null;
  if (range > 0) {
    if (clv >= 0.7 && c.upperWick / range <= 0.15) imbalance = 'buy';
    else if (clv <= -0.7 && c.lowerWick / range <= 0.15) imbalance = 'sell';
  }
  return { delta, clv, imbalance };
}

/** Сводка дельты по окну свечей. */
export function summarizeDelta(candles: Candle[], lookback = 60): DeltaSummary {
  const data = candles.slice(-Math.max(5, lookback));
  const points: DeltaPoint[] = data.map((c) => {
    const d = candleDelta(c);
    return { time: c.time, delta: d.delta, clv: d.clv, imbalance: d.imbalance };
  });
  const cumulativeDelta = points.reduce((s, p) => s + p.delta, 0);
  const buyCandles = points.filter((p) => p.delta > 0).length;
  const buyPressureShare = points.length > 0 ? buyCandles / points.length : 0.5;
  const avgClv = points.length > 0
    ? points.reduce((s, p) => s + p.clv, 0) / points.length
    : 0;

  const half = Math.floor(points.length / 2);
  const first = points.slice(0, half).reduce((s, p) => s + p.delta, 0);
  const second = points.slice(half).reduce((s, p) => s + p.delta, 0);
  const scale = Math.max(Math.abs(first), Math.abs(second), 1);
  const rel = (second - first) / scale;
  const deltaTrend: DeltaSummary['deltaTrend'] = rel > 0.2 ? 'rising' : rel < -0.2 ? 'falling' : 'flat';

  return {
    points,
    cumulativeDelta,
    buyPressureShare,
    avgClv,
    deltaTrend,
  };
}
