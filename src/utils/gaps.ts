// gaps.ts — детекция гэпов по канону Стива Нисона («Японские свечи», гл. 7).
//
// Ключевая идея главы: гэп для Нисона — это РАЗРЫВ ДИАПАЗОНОВ, а не просто
// разница закрытия и открытия. Гэп существует только тогда, когда У ВТОРОЙ
// СВЕЧИ НЕТ ОБЩЕЙ ЦЕНЫ с первой:
//   восходящий: low(i)  > high(i-1)
//   нисходящий: high(i) < low(i-1)
// Именно поэтому overnight-открытия американских акций (обычно ±0.1–0.5%)
// НЕ являются гэпами: тело/тени следующей свечи почти всегда перекрывают
// previous close — общего ценового диапазона нет. Старая версия модуля
// считала «gap от закрытия» (open vs prevClose ≥ 1%) и превращала график
// акций в кашу из горизонтальных полос — теперь используется строгий канон.
//
// Размер окна (% от цены) считается по ширине самого разрыва
// (gap_top - gap_bottom). Числовой фильтр ширины относится к проекту.
//
// Заполнение окна (fill): последующий диапазон достиг дальней границы зоны.
// Окончательный прорыв (break) — отдельное событие: закрытие ниже основания
// восходящего окна либо выше вершины нисходящего. Внутрисессионный прокол сам
// по себе не означает окончательного прорыва.
//
// Рыночный контекст: на непрерывном криптовалютном рынке отображение окон
// отключено правилом проекта (см. также GAP_PATTERNS_ENABLED в pattern_engine.ts).
// Порог MIN_GAP_PCT — проектный фильтр микрогэпов, а не книжный числовой закон.

import type { CandleDTO, GapDTO } from '../api/types';

/** Минимальная ширина разрыва (% от цены): микрогэпы игнорируются. */
export const MIN_GAP_PCT = 1.0;

/** Сколько последних гэпов отдавать на график (остальные — шум истории). */
export const MAX_DISPLAY_GAPS = 8;

/**
 * Детектировать гэпы по массиву свечей (time в мс, как в CandleDTO/report.candles).
 * `market` — тип рынка из parseMarket(): 'stock' | 'crypto'. На крипте всегда [].
 */
export function detectGaps(
  candles: Array<Pick<CandleDTO, 'time' | 'open' | 'high' | 'low' | 'close'>>,
  market: 'stock' | 'crypto',
): GapDTO[] {
  if (market !== 'stock') return []; // проектное отключение окон для криптовалют
  const gaps: GapDTO[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (!(prev.high > 0) || !(prev.low > 0) || !(cur.high > 0) || !(cur.low > 0)) continue;
    // Разрыв диапазонов (канон Нисона), а не open-vs-close.
    if (cur.low > prev.high) {
      const bottom = prev.high;
      const top = cur.low;
      const pct = ((top - bottom) / bottom) * 100;
      if (pct >= MIN_GAP_PCT) gaps.push(mkGap(cur, bottom, top, 'up', pct));
    } else if (cur.high < prev.low) {
      const bottom = cur.high;
      const top = prev.low;
      const pct = ((top - bottom) / bottom) * 100;
      if (pct >= MIN_GAP_PCT) gaps.push(mkGap(cur, bottom, top, 'down', pct));
    }
  }
  for (const g of gaps) {
    const later = candles.filter((c) => c.time > g.time);
    g.filled = later.some((c) => g.direction === 'up'
      ? c.low <= g.bottom
      : c.high >= g.top);
    g.broken = later.some((c) => g.direction === 'up'
      ? c.close < g.bottom
      : c.close > g.top);
    g.unfilled = !g.filled;
  }
  return gaps.slice(-MAX_DISPLAY_GAPS);
}

function mkGap(
  bar: Pick<CandleDTO, 'time' | 'open'>,
  bottom: number,
  top: number,
  direction: 'up' | 'down',
  pct: number,
): GapDTO {
  return {
    time: bar.time,
    prevClose: bottom, // нижняя граница зоны (совместимость поля)
    open: top,         // верхняя граница зоны
    top,
    bottom,
    direction,
    pct,
    unfilled: true,
    filled: false,
    broken: false,
  };
}
