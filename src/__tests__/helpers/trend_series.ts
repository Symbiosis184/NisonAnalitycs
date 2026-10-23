// Аудит №12: вспомогательные генераторы серий для тестов качества сигналов.
import { Candle } from '../../utils/candle';

let t = 1_700_000_000;

export const mkCandle = (open: number, high: number, low: number, close: number, volume = 100): Candle =>
  new Candle({ time: ++t, open, high, low, close, volume });

/** Ровный нисходящий тренд из n свечей (медвежьи тела, без теней). */
export function makeDowntrend(n: number, start = 300, step = 2, volume = 100): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    out.push(mkCandle(price, price + 0.5, price - step + 0.5, price - step, volume));
    price -= step;
  }
  return out;
}

/** Ровный восходящий тренд. */
export function makeUptrend(n: number, start = 100, step = 2, volume = 100): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    out.push(mkCandle(price, price + step - 0.5, price - 0.5, price + step, volume));
    price += step;
  }
  return out;
}
