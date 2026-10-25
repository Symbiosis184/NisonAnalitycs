import { describe, it, expect } from 'vitest';

describe('logo markup order (Analytics)', () => {
  it('source JSX spells Analyt -> candle-i -> sr-only ics (candle = last i, not s)', async () => {
    const src = await import('./components/Layout?raw');
    const code = src.default as string;
    const iAnalyt = code.indexOf('Analyt');
    const iCandle = code.indexOf('candle-i');
    const iIcs = code.indexOf('>ics<', iCandle);
    expect(iAnalyt).toBeGreaterThan(-1);
    expect(iCandle).toBeGreaterThan(iAnalyt);
    expect(iIcs).toBeGreaterThan(iCandle);
    // запрещённые прежние ошибки: свеча в середине слова (Anal[свеча]ytics) или вместо последней буквы s (Analysi[свеча])
    expect(code).not.toMatch(/Anal\s*\n?\s*\{\/\*[^*]*\*\/\}\s*\n\s*<span[\s\S]{0,80}candle-i/);
    expect(code).not.toMatch(/Analysi\s*\n?\s*<span[^>]*candle-i/);
    // слово целиком читается как Analytics: видимая часть + скрытое окончание
    const visible = code.slice(iAnalyt, iIcs + 6).replace(/\{\{?\/\*[\s\S]*?\*\/\}?}/g, '');
    expect(visible).toContain('Analyt');
    expect(visible).toContain('ics');
  });
});
