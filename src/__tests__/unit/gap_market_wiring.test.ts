import { describe, it, expect } from 'vitest';
import { Candle } from '../../utils/candle';
import { scanPatternCandidates } from '../../utils/pattern_scanner';
import { parseMarket } from '../../api/market';

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 1, open: o, high: h, low: l, close: cl, volume: v });
const sideBySide = [c(110, 111, 99, 100), c(111.5, 116, 111, 115.5), c(111.7, 116.1, 111.3, 115.6)];

describe('Рыночный контекст передаётся в общий сканер без глобального состояния', () => {
  it('суффикс :STOCK и явный market=stocks включают одну и ту же модель', () => {
    expect(parseMarket('AAPL:STOCK').market).toBe('stock');
    const stocks = scanPatternCandidates(sideBySide, { context: { market: 'stocks' } });
    const crypto = scanPatternCandidates(sideBySide, { context: { market: 'crypto' } });
    expect(stocks.some(p => p.name.startsWith('ГЭП СМЕЖНЫХ'))).toBe(true);
    expect(crypto.some(p => p.name.startsWith('ГЭП СМЕЖНЫХ'))).toBe(false);
  });
});
