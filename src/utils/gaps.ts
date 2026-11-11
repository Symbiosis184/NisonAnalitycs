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
  // P3-5: внутренний тип хранит индекс открывающего бара для однопроходного
  // расчёта статусов; наружу отдаётся чистый GapDTO (срез в конце).
  const gaps: Array<GapDTO & { _gapIndex: number }> = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (!(prev.high > 0) || !(prev.low > 0) || !(cur.high > 0) || !(cur.low > 0)) continue;
    // Разрыв диапазонов (канон Нисона), а не open-vs-close.
    if (cur.low > prev.high) {
      const bottom = prev.high;
      const top = cur.low;
      const pct = ((top - bottom) / bottom) * 100;
      if (pct >= MIN_GAP_PCT) gaps.push(mkGap(prev, cur, i, bottom, top, 'up', pct));
    } else if (cur.high < prev.low) {
      const bottom = cur.high;
      const top = prev.low;
      const pct = ((top - bottom) / bottom) * 100;
      if (pct >= MIN_GAP_PCT) gaps.push(mkGap(prev, cur, i, bottom, top, 'down', pct));
    }
  }
  // P3-5: статусы заполнений за один обратный проход O(n + g) вместо
  // O(n·m) (filter+some по «хвосту» для каждого гэпа). Идём с конца массива и
  // поддерживаем экстремумы low/high/close на суффиксе; первый гэп (самый
  // поздний) получает их напрямую, каждый следующий — от более раннего индекса
  // (bar, открывший гэп, исключён из проверки так же, как раньше time > g.time).
  let minLow = Infinity;
  let maxHigh = -Infinity;
  let minClose = Infinity;
  let maxClose = -Infinity;
  let scanFrom = candles.length - 1;
  for (let gi = gaps.length - 1; gi >= 0; gi--) {
    const g = gaps[gi];
    for (let j = scanFrom; j > g._gapIndex; j--) {
      const c = candles[j];
      if (c.low < minLow) minLow = c.low;
      if (c.high > maxHigh) maxHigh = c.high;
      if (c.close < minClose) minClose = c.close;
      if (c.close > maxClose) maxClose = c.close;
    }
    g.filled = g.direction === 'up' ? minLow <= g.bottom : maxHigh >= g.top;
    g.broken = g.direction === 'up' ? minClose < g.bottom : maxClose > g.top;
    g.unfilled = !g.filled;
    scanFrom = g._gapIndex;
  }
  return gaps.slice(-MAX_DISPLAY_GAPS).map(({ _gapIndex, ...dto }) => dto as GapDTO);
}

function mkGap(
  prev: Pick<CandleDTO, 'close'>,
  bar: Pick<CandleDTO, 'time' | 'open'>,
  gapIndex: number,
  bottom: number,
  top: number,
  direction: 'up' | 'down',
  pct: number,
): GapDTO & { _gapIndex: number } {
  return {
    time: bar.time,
    // P3-4: поле соответствует своему имени — РЕАЛЬНОЕ close предыдущего бара
    // (раньше сюда писалась нижняя граница зоны, что вводило в заблуждение).
    // Потребители (zone_voter, CandlestickChart, gaps_render.test) читают
    // только top/bottom/direction/pct/time/filled/broken — семантика не изменилась.
    prevClose: prev.close,
    // P3-4 (документация контракта): у окон Нисона «гэп-бара» нет цены
    // открытия внутри разрыва; поле open сохраняет исторический смысл —
    // ВЕРХНЯЯ граница зоны гэпа (не open бара).
    open: top,
    top,
    bottom,
    direction,
    pct,
    unfilled: true,
    filled: false,
    broken: false,
    // служебное: индекс бара, открывшего гэп (для однопроходного статуса)
    _gapIndex: gapIndex,
  };
}
