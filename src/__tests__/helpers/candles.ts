import { Candle } from '../../utils/candle';

export interface CandleSpec {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

let seq = 0;

/** Создаёт экземпляр Candle с автоинкрементным time. */
export function c(open: number, high: number, low: number, close: number, volume = 100): Candle {
  return new Candle({ time: ++seq, open, high, low, close, volume });
}

/** Массив одинаковых «нейтральных» свечей (для заполнения истории). */
export function flat(count: number, price = 100, volume = 100): Candle[] {
  const arr: Candle[] = [];
  for (let i = 0; i < count; i++) {
    // маленькое тело, симметричные тени — не является ни длинной, ни короткой свечой-разворотом
    arr.push(c(price - 0.05, price + 0.3, price - 0.3, price + 0.05, volume));
  }
  return arr;
}

/** Комбинирует историю из плоских свечей и набора «ручных» свечей в конце. */
export function series(specs: CandleSpec[], fillerCount = 25, fillerPrice = 100): Candle[] {
  const out = flat(fillerCount, fillerPrice);
  for (const s of specs) {
    out.push(new Candle({ time: ++seq, open: s.open, high: s.high, low: s.low, close: s.close, volume: s.volume ?? 100 }));
  }
  return out;
}
