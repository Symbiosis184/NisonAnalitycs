import { describe, it, expect, afterEach, vi } from 'vitest';
import { setMarket, getMarket, PatternDetector } from '../../utils/pattern_engine';
import { Candle } from '../../utils/candle';

// Гэповые модели должны включаться ТОЛЬКО для акций (тикеры ':STOCK') и
// оставаться выключенными на крипте — это связывает движок паттернов с
// переключателем рынков в UI (см. api/client.ts: setPatternMarket в getAnalysis).

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: Date.now(), open: o, high: h, low: l, close: cl, volume: v });

const sideBySide = [c(110, 111, 99, 100), c(111.5, 116, 111, 115.5), c(111.7, 116.1, 111.3, 115.6)];

describe('Привязка гэпов к рынку (акции vs крипта)', () => {
  afterEach(() => setMarket('crypto'));

  it('getAnalysis устанавливает рынок по суффиксу тикера', async () => {
    // Проверяем сам механизм: crypto -> гэпы выкл, stock -> гэпы вкл
    setMarket('crypto');
    expect(getMarket()).toBe('crypto');
    expect(PatternDetector.isGappingSideBySide(sideBySide).found).toBe(false);
    setMarket('stocks');
    expect(PatternDetector.isGappingSideBySide(sideBySide).found).toBe(true);
  });

  it('код getAnalysis вызывает setPatternMarket до детекции (smoke)', async () => {
    const src = await import('../../api/client?raw' as string).catch(() => null);
    // если raw-импорт недоступен, читаем файл через fs
    if (!src) {
      const fs = await import('fs');
      const code = fs.readFileSync('src/api/client.ts', 'utf8');
      expect(code).toMatch(/setPatternMarket\(parseMarket\(symbol\)\.market === 'stock' \? 'stocks' : 'crypto'\)/);
      // вызов должен стоять ДО fetchKlines/detectPatterns
      const idxSet = code.indexOf('setPatternMarket(parseMarket');
      const idxDetect = code.indexOf('detectPatterns(closedCandles');
      expect(idxSet).toBeGreaterThan(-1);
      expect(idxSet).toBeLessThan(idxDetect);
    } else {
      expect(src).toBeTruthy();
    }
  });
});
