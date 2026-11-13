import { describe, expect, it } from 'vitest';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';

// C4 (ЗГ гл. 2 «Длинные белые тела»; ЯС гл. 6 «Захват за пояс»): принцип
// относительности длинного тела канонический. В isBullishBelt / isBearishBelt /
// isCounterattack гейт — OR-комбинация (isLongRelative(...) || isLongCandle),
// как в isDarkCloudCover. Тест проверяет, что свеча с телом 70% своего
// диапазона (проходит абсолютный порог isLongCandle: body > 0.6·range), но
// МЕНЬШЕ медианы предшествующих тел, НЕ отбрасывается детектором из-за
// относительной меры — то есть относительная проверка не ужесточает гейт
// сверх книжного требования «длинное тело».
const c = (time: number, open: number, high: number, low: number, close: number) =>
  new Candle({ time, open, high, low, close, volume: 100 });

describe('C4: относительная длина тела в поясах и контратаке', () => {
  // Нисходящий контекст для бычьего пояса: 20 баров со спадающими закрытиями.
  const decline: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    const top = 300 - i * 5;
    decline.push(c(i, top, top + 1, top - 9, top - 10)); // чёрные, тело 10
  }

  it('бычий пояс: тело 70% диапазона (< медианы предыдущих тел) проходит по OR-гейту', () => {
    // range 10 → body 7 = 70% диапазона; 7 < med(≈10) → isLongRelative === false,
    // но isLongCandle === true (7 > 0.6·10). Абсолютного порога достаточно.
    const c1 = decline[decline.length - 1];
    const c2 = c(21, 190, 200, 190, 197); // белая, нижняя тень = 0
    // Контроль: свеча с телом 50% диапазона не проходит НИ по одной мере —
    // гейт длины работает и не превращается в константу true.
    const prevRelOnly = PatternDetector.isBullishBelt(
      c1, c(21, 190, 200, 190, 195), decline, // body 5 = 0.5·range → не длинная
    );
    expect(prevRelOnly.found).toBe(false);
    const det = PatternDetector.isBullishBelt(c1, c2, decline);
    expect(det.found).toBe(true);
    expect(det.name).toContain('ЛИНИЯ ПОЯСА (БЫЧЬЯ)');
  });

  it('медвежий пояс: зеркальный кейс (тело 70% диапазона при росте контекста)', () => {
    const rally: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      const bot = 100 + i * 5;
      rally.push(c(i, bot, bot + 10, bot + 1, bot + 10)); // белые, тело 10
    }
    const c1 = rally[rally.length - 1];
    const c2 = c(21, 200, 200, 190, 193); // чёрная, верхняя тень = 0
    const det = PatternDetector.isBearishBelt(c1, c2, rally);
    expect(det.found).toBe(true);
    expect(det.name).toContain('ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)');
  });

  it('контратака (стоки): обе свечи с телом 70% диапазона проходят по OR-гейту', () => {
    const decline2: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      const top = 300 - i * 5;
      decline2.push(c(i, top, top + 1, top - 9, top - 10));
    }
    // Чёрная с гэпом вниз, затем белая, закрывающаяся на уровне закрытия чёрной.
    const c1 = c(21, 200, 201, 190, 193); // чёрная: range 11, body 7 ≈ 64%... нужна >60%
    const c2 = c(22, 185, 193, 184, 193); // белая: range 9, body 8 ≈ 89%
    const det = PatternDetector.isCounterattack(c1, c2, decline2, { market: 'stocks' });
    expect(det.found).toBe(true);
    expect(det.name).toBe('КОНТРАТАКА (БЫЧЬЯ)');
  });
});
