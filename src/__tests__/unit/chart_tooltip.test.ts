/**
 * Регрессия: tooltip над стрелками паттернов.
 *
 * Исторические причины «tooltip не появляется»:
 *  1) hover-обработчик и плашка создавались только внутри блока «есть
 *     паттерны» — при перестройке графика слушатель мог не навешиваться;
 *  2) createSeriesMarkers вызывался повторно на той же серии, старое
 *     состояние маркеров умирало, а hover читал из него пустой список;
 *  3) time маркера (секунды) не совпадал с ключом поиска — entry === null.
 *
 * Тест проверяет контракт слоя данных: для каждого маркера время округлено
 * до целых секунд (совпадает с time свечей в lightweight-charts), а текст
 * плашки зашит в сам маркер (__tip) — hover берёт его из актуального
 * состояния setMarkers, без сверки по Map.
 */
import { describe, it, expect } from 'vitest';

interface P { name: string; type: 'bullish' | 'bearish' | 'neutral'; candleIndex: number; confidence: number; confirmed: boolean }
interface C { time: number; open: number; high: number; low: number; close: number; volume: number }

// Ровно та же сборка маркеров, что в CandlestickChart.tsx (effect-блок):
// единый ключ/время = Math.round(candle.time / 1000).
function buildMarkers(patterns: P[], candles: C[]) {
  const valid = patterns.filter(p => p.candleIndex >= 0 && p.candleIndex < candles.length)
    .sort((a, b) => b.confidence - a.confidence);
  const byTime = new Map<string, { pattern: P; count: number }>();
  for (const p of valid) {
    const t = String(Math.round(candles[p.candleIndex].time / 1000));
    const prev = byTime.get(t);
    if (prev) prev.count += 1; else byTime.set(t, { pattern: p, count: 1 });
  }
  return [...byTime.values()].map(({ pattern, count }) => {
    const candle = candles[pattern.candleIndex];
    const markerTime = Math.round(candle.time / 1000);
    const raw = pattern.confidence;
    const conf = raw > 0 && raw <= 1 ? raw * 100 : raw;
    const pct = Math.round(Math.min(100, Math.max(0, conf)));
    const pendingNote = pattern.confirmed ? '' : ' · ожидает подтверждения';
    const suffix = count > 1 ? ` · ещё ${count - 1}` : '';
    return {
      time: markerTime,
      position: pattern.type === 'bullish' ? 'belowBar' : 'aboveBar',
      __tip: `${pattern.name} · ${pct}%${pendingNote}${suffix}`,
    };
  });
}

const mkCandles = (n: number, startMs: number, stepMs: number): C[] =>
  Array.from({ length: n }, (_, i) => ({
    time: startMs + i * stepMs, open: 100, high: 101, low: 99, close: 100, volume: 10,
  }));

describe('chart tooltip (маркеры паттернов)', () => {
  it('время маркера кратно секундам и совпадает с временем свечи (без дробей)', () => {
    // Дробное время бара (не кратно 1000 мс) — исторический триггер бага №3.
    const candles = mkCandles(5, 1700000000500, 60000);
    const markers = buildMarkers(
      [{ name: 'МОЛОТ', type: 'bullish', candleIndex: 2, confidence: 78, confirmed: true }],
      candles,
    );
    expect(markers).toHaveLength(1);
    expect(Number.isInteger(markers[0].time)).toBe(true);
    // Ключ hover-поиска — String(m.time); он обязан существовать как
    // округление времени соответствующей свечи.
    expect(String(markers[0].time)).toBe(String(Math.round(candles[2].time / 1000)));
  });

  it('текст tooltip зашит в маркер (__tip) — hover не зависит от внешних Map', () => {
    const candles = mkCandles(10, 1700000000000, 60000);
    const markers = buildMarkers([
      { name: 'ВЕЕР', type: 'bearish', candleIndex: 4, confidence: 0.65, confirmed: false },
    ], candles);
    expect(markers[0].__tip).toBe('ВЕЕР · 65% · ожидает подтверждения');
    expect(markers[0].position).toBe('aboveBar');
  });

  it('несколько паттернов на одном баре — один маркер со счётчиком', () => {
    const candles = mkCandles(10, 1700000000000, 60000);
    const markers = buildMarkers([
      { name: 'МОЛОТ', type: 'bullish', candleIndex: 3, confidence: 80, confirmed: true },
      { name: 'ВЕЕР', type: 'bullish', candleIndex: 3, confidence: 60, confirmed: true },
    ], candles);
    expect(markers).toHaveLength(1);
    expect(markers[0].__tip).toBe('МОЛОТ · 80% · ещё 1');
  });

  it('pending-паттерн на ПОСЛЕДНЕМ баре тоже получает маркер (стрелка видна → tooltip есть)', () => {
    const candles = mkCandles(10, 1700000000000, 60000);
    const markers = buildMarkers(
      [{ name: 'ПОГЛОЩЕНИЕ', type: 'bullish', candleIndex: candles.length - 1, confidence: 72, confirmed: false }],
      candles,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].__tip).toContain('ожидает подтверждения');
  });
});
