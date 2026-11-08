import { describe, it, expect, vi } from 'vitest';
import { Candle } from '../../utils/candle';
import { scanPatternCandidates } from '../../utils/pattern_scanner';
import { parseMarket } from '../../api/market';
import { fetchMarketOverviewBatch } from '../../api/bybit';

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 1, open: o, high: h, low: l, close: cl, volume: v });
const sideBySide = [
  ...Array.from({ length: 6 }, (_, i) => {
    const open = 80 + i * 2;
    return c(open, open + 2.4, open - 0.3, open + 2);
  }),
  c(100, 105, 99.5, 104.5),
  c(106, 112, 105.5, 111.5),
  c(106, 112.2, 105.6, 111.7),
];

describe('Рыночный контекст передаётся в общий сканер без глобального состояния', () => {
  it('суффикс :STOCK и явный market=stocks включают одну и ту же модель', () => {
    expect(parseMarket('AAPL:STOCK').market).toBe('stock');
    const stocks = scanPatternCandidates(sideBySide, { context: { market: 'stocks' } });
    const crypto = scanPatternCandidates(sideBySide, { context: { market: 'crypto' } });
    expect(stocks.some(p => p.name.startsWith('ГЭП СМЕЖНЫХ'))).toBe(true);
    expect(crypto.some(p => p.name.startsWith('ГЭП СМЕЖНЫХ'))).toBe(false);
  });
});

describe('Пакетная загрузка обзора рынка', () => {
  it('отдаёт первую готовую карточку до завершения остальных запросов', async () => {
    let finishSecond!: () => void;
    const secondPending = new Promise<void>((resolve) => { finishSecond = resolve; });
    const visible: string[] = [];

    const batch = fetchMarketOverviewBatch<string>([
      async () => 'BTCUSDT',
      async () => {
        await secondPending;
        return 'ETHUSDT';
      },
    ], undefined, (item) => visible.push(item));

    await vi.waitFor(() => expect(visible).toEqual(['BTCUSDT']));
    finishSecond();
    await expect(batch).resolves.toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(visible).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});
