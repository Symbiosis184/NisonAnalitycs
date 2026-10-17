import { describe, it, expect } from 'vitest';
import {
  assertValidSymbol,
  isValidSymbol,
  isValidTimeframe,
  clampNumber,
  sanitizeText,
} from '../../utils/validation';

describe('assertValidSymbol', () => {
  it('принимает корректные тикеры и нормализует регистр', () => {
    expect(assertValidSymbol('BTCUSDT')).toBe('BTCUSDT');
    expect(assertValidSymbol('btcusdt')).toBe('BTCUSDT');
    expect(assertValidSymbol(' BTCUSDT ')).toBe('BTCUSDT');
  });

  it('отклоняет инъекции параметров URL', () => {
    const malicious = [
      'BTCUSDT&interval=D',
      'BTCUSDT#',
      'BTC/USDT',
      'BTCUSDT\nX-Header: evil',
      "BTC'OR'1'='1",
      '<script>alert(1)</script>',
      '',
      'AB', // слишком короткий
      'A'.repeat(21), // слишком длинный
    ];
    for (const s of malicious) {
      expect(() => assertValidSymbol(s)).toThrow();
    }
  });

  it('отклоняет не-строки', () => {
    expect(() => assertValidSymbol(null)).toThrow();
    expect(() => assertValidSymbol(undefined)).toThrow();
    expect(() => assertValidSymbol(123)).toThrow();
    expect(() => assertValidSymbol({})).toThrow();
  });

  it('isValidSymbol — мягкая версия без исключения', () => {
    expect(isValidSymbol('BTCUSDT')).toBe(true);
    expect(isValidSymbol('bad symbol!')).toBe(false);
    expect(isValidSymbol(null)).toBe(false);
  });
});

describe('isValidTimeframe', () => {
  it('whitelist таймфреймов', () => {
    for (const tf of ['1m', '5m', '15m', '30m', '1H', '4H', '1D', 'D', '1W', 'W']) {
      expect(isValidTimeframe(tf)).toBe(true);
    }
    expect(isValidTimeframe('2m')).toBe(false);
    expect(isValidTimeframe('`touch /tmp/x`')).toBe(false);
    expect(isValidTimeframe(60 as any)).toBe(false);
  });
});

describe('clampNumber', () => {
  it('клампит в диапазон и фолбэкается на NaN/Infinity', () => {
    expect(clampNumber(5, 1, 10, 99)).toBe(5);
    expect(clampNumber(-5, 1, 10, 99)).toBe(1);
    expect(clampNumber(500, 1, 10, 99)).toBe(10);
    expect(clampNumber(NaN, 1, 10, 99)).toBe(99);
    expect(clampNumber(Infinity, 1, 10, 99)).toBe(99);
    expect(clampNumber('7', 1, 10, 99)).toBe(7);
    expect(clampNumber('abc', 1, 10, 99)).toBe(99);
    expect(clampNumber(null, 1, 10, 99)).toBe(1); // Number(null)=0 → клампится к min
    expect(clampNumber(undefined, 1, 10, 99)).toBe(99); // undefined → fallback
  });
});

describe('sanitizeText', () => {
  it('удаляет управляющие символы и обрезает длину', () => {
    expect(sanitizeText('hello\u0000world', 100)).toBe('helloworld');
    expect(sanitizeText('a\r\nb', 100)).toBe('ab');
    expect(sanitizeText('x'.repeat(200), 50)).toHaveLength(50);
    expect(sanitizeText(123 as any, 50, 'fallback')).toBe('fallback');
  });
});
