// gaps.ts — детекция гэпов по канону Стива Нисона («Японские свечи», гл. 7).
// Гэп = разрыв между ЗАКРЫТИЕМ предыдущей сессии и ОТКРЫТИЕМ текущей:
//   восходящий: open(i) > close(i-1);  нисходящий: open(i) < close(i-1).
// Это «гэп от закрытия» — базовое определение книги (в отличие от более
// строгого «разрыва по всему диапазону», который требуется внутри отдельных
// моделей — см. pattern_engine.ts, там свои проверки).
//
// Закрытие гэпа (fill) по Нисону: гэп считается закрытым, если цена ПОСЛЕ
// бара-гэпа прошла весь диапазон разрыва bottom..top (низ и верх зоны
// побывали в торговом диапазоне одной последующей свечи).
//
// Рыночный контекст: криптовалюты торгуются 24/7 — гэпов от закрытия у них
// практически нет, поэтому на крипте гэпы не рисуем (см. GAP_PATTERNS_ENABLED
// в pattern_engine.ts и market в detectGaps). Для акций рынок открывается с
// гэпом каждую сессию; чтобы не превращать график в кашу из крошечных щелей,
// применяется минимальный порог размера — микрогэпы (меньше 1% прайса)
// не интересны: они зашумляют график и не несут информации по Нисону.

import type { CandleDTO, GapDTO } from '../api/types';

/** Минимальный размер гэпа (% от prevClose): микрогэпы игнорируются. */
export const MIN_GAP_PCT = 1.0;

/** Сколько последних гэпов отдавать на график (остальные — шум истории). */
export const MAX_DISPLAY_GAPS = 15;

/**
 * Детектировать гэпы по массиву свечей (time в мс, как в CandleDTO/report.candles).
 * `market` — тип рынка из parseMarket(): 'stock' | 'crypto'. На крипте всегда [].
 */
export function detectGaps(
  candles: Array<Pick<CandleDTO, 'time' | 'open' | 'high' | 'low' | 'close'>>,
  market: 'stock' | 'crypto',
): GapDTO[] {
  if (market !== 'stock') return []; // 24/7 рынок: гэпов от закрытия нет
  const gaps: GapDTO[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (!(prev.close > 0) || !(cur.open > 0)) continue;
    const pct = ((cur.open - prev.close) / prev.close) * 100;
    if (pct >= MIN_GAP_PCT) {
      gaps.push(mkGap(cur, prev.close, cur.open, 'up', pct));
    } else if (pct <= -MIN_GAP_PCT) {
      gaps.push(mkGap(cur, prev.close, cur.open, 'down', -pct));
    }
  }
  // Статус fill: гэп закрыт, если ЛЮБАЯ свеча после бара-гэпа пересекла
  // весь диапазон [bottom..top] разрыва.
  for (const g of gaps) {
    g.unfilled = !candles.some(
      (c) => c.time > g.time && c.high >= g.top && c.low <= g.bottom,
    );
  }
  return gaps.slice(-MAX_DISPLAY_GAPS);
}

function mkGap(
  bar: Pick<CandleDTO, 'time' | 'open'>,
  prevClose: number,
  open: number,
  direction: 'up' | 'down',
  pct: number,
): GapDTO {
  return {
    time: bar.time,
    prevClose,
    open,
    top: Math.max(prevClose, open),
    bottom: Math.min(prevClose, open),
    direction,
    pct,
    unfilled: true, // пересчитывается выше
  };
}
