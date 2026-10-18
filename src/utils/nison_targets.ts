// Цели по канону Стива Нисона («Японские свечи», гл. 4–6).
//
// Контекст аудита (замечание пользователя): ATR-стопы/цели — не методология Нисона.
// Нисон нигде не использует индикаторы для выхода; его логика чисто структурная:
//   • стоп = экстремум свечной формации (низ/верх модели);
//   • цель = ближайший значимый ценовой ориентир — максимум/минимум предшествующего
//     тренда, вершина/основание консолидации или зона поддержки/сопротивления.
//
// ATR здесь применяется ТОЛЬКО в двух «не-сигнальных» ролях, что честно отражено
// в названиях и комментариях:
//   1) noiseFloor — отсечь зоны, лежащие внутри шума (это риск-менеджмент, а не сигнал);
//   2) maxRiskPct — аварийный лимит ширины стопа (защита позиции, вне методологии).
// Если структурная цель не найдена — сигнал НЕ генерируется (Нисон учится ждать
// явного уровня), а не подменяется абстрактным «3×ATR».

import { Candle } from './candle';
import { atr } from './indicators';
import { ZoneVoter, timeframeKey } from './zone_voter';

export interface StructuralTarget {
  level: number;      // цена цели
  kind: 'zone' | 'swing';
  detail: string;     // человекочитаемое описание для UI/story
}

/** Ориентиры структуры рынка: экстремумы последних `lookback` свечей перед паттерном. */
export function collectSwingLevels(
  closedCandles: Candle[],
  direction: 'long' | 'short',
  lookback = 60,
): number[] {
  const n = closedCandles.length;
  if (n < 5) return [];
  const start = Math.max(0, n - lookback);
  const out: number[] = [];
  for (let i = start + 1; i <= n - 2; i++) {
    const c = closedCandles[i];
    const prev = closedCandles[i - 1];
    const next = closedCandles[i + 1];
    if (direction === 'long') {
      // локальный максимум (fractal high) — естественная цель для лонга
      if (c.high > prev.high && c.high >= next.high) out.push(c.high);
    } else {
      // локальный минимум (fractal low) — естественная цель для шорта
      if (c.low < prev.low && c.low <= next.low) out.push(c.low);
    }
  }
  return out;
}

/**
 * Ближайшая структурная цель в направлении сделки.
 * Приоритет по Нисону: сильная S/R-зона, затем свинг-экстремум.
 * Зоны/свинги ближе `noiseFloor` к цене входа считаются шумом и игнорируются.
 * Возвращает null, если значимого уровня нет — сигнал тогда не допускается.
 */
export function nearestStructuralTarget(
  entryPrice: number,
  direction: 'long' | 'short',
  closedCandles: Candle[],
  opts?: { noiseFloor?: number; maxReward?: number; timeframe?: string },
): StructuralTarget | null {
  const noiseFloor = opts?.noiseFloor ?? Math.max(entryPrice * 0.01, atr(closedCandles, 14));
  const maxReward = opts?.maxReward ?? entryPrice * 0.20;

  // FIX ТФ-аудита: зоны собираются с параметрами того таймфрейма, на котором
  // строится цель (раньше всегда использовались дневные настройки).
  const zones = ZoneVoter.collect(entryPrice, closedCandles, timeframeKey(opts?.timeframe ?? 'D'));
  const zoneLevels =
    direction === 'long' ? zones.resistance.filter((z) => z.strong) : zones.support.filter((z) => z.strong);

  const candidates: Array<{ level: number; kind: 'zone' | 'swing'; detail: string }> = [
    ...zoneLevels.map((z) => ({
      level: z.level,
      kind: 'zone' as const,
      detail: direction === 'long' ? 'зона сопротивления' : 'зона поддержки',
    })),
    ...collectSwingLevels(closedCandles, direction).map((level) => ({
      level,
      kind: 'swing' as const,
      detail: direction === 'long' ? 'максимум предшествующего движения' : 'минимум предшествующего движения',
    })),
  ];

  const inRange = candidates.filter((cand) => {
    const dist = direction === 'long' ? cand.level - entryPrice : entryPrice - cand.level;
    return dist >= noiseFloor && dist <= maxReward;
  });

  if (inRange.length === 0) return null;

  // Ближайший значимый уровень; при равенстве приоритет у S/R-зоны (Нисон: уровни важнее фракталов)
  inRange.sort((a, b) => {
    const da = Math.abs(a.level - entryPrice);
    const db = Math.abs(b.level - entryPrice);
    if (da !== db) return da - db;
    return Number(a.kind === 'zone') < Number(b.kind === 'zone') ? -1 : 1;
  });

  const best = inRange[0];
  return { level: best.level, kind: best.kind, detail: best.detail };
}
