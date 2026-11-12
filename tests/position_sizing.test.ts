/**
 * Тесты П.1 — Position Sizing (ATR + правило 1% риска).
 */
import { describe, it, expect } from 'vitest';
import { computeRiskPlan, formatQty } from '../src/analysis/position_sizing';
import { DEFAULT_TRADE_SETTINGS, type TradeSettings } from '../src/analysis/types';

const S = (over: Partial<TradeSettings> = {}): TradeSettings => ({
  ...DEFAULT_TRADE_SETTINGS,
  ...over,
});

describe('computeRiskPlan (правило 1% риска по ATR)', () => {
  it('лонг: qty = risk / (stopAtrMult × ATR)', () => {
    const p = computeRiskPlan({ entryPrice: 50_000, side: 'long', atr: 500, settings: S() });
    // stopDistance = 1.5×500 = 750; riskAmount = 10000×1% = 100 → qty = 100/750
    expect(p.stopDistance).toBeCloseTo(750);
    expect(p.riskAmount).toBeCloseTo(100);
    expect(p.positionQty).toBeCloseTo(100 / 750);
    expect(p.stopPrice).toBeCloseTo(49_250);
    expect(p.grossStopLoss).toBeCloseTo(100); // риск ровно 1% капитала
  });

  it('шорт: стоп выше входа', () => {
    const p = computeRiskPlan({ entryPrice: 50_000, side: 'short', atr: 400, settings: S() });
    expect(p.stopPrice).toBeCloseTo(50_000 + 600);
    expect(p.positionQty).toBeCloseTo(100 / 600);
  });

  it('издержки полного цикла = qty×entry×2×(fee+slip), netStopLoss > grossStopLoss', () => {
    const p = computeRiskPlan({ entryPrice: 100, side: 'long', atr: 2, settings: S() });
    // qty = 100/3; value = 100/3×100; costs = value×2×0.0015
    const expectedCosts = (100 / 3) * 100 * 2 * (0.001 + 0.0005);
    expect(p.costs).toBeCloseTo(expectedCosts);
    expect(p.netStopLoss).toBeGreaterThan(p.grossStopLoss);
    expect(p.netStopLoss).toBeCloseTo(p.grossStopLoss + p.costs);
  });

  it('риск не зависит от цены актива при фиксированном ATR-стопе (1% всегда 1%)', () => {
    const a = computeRiskPlan({ entryPrice: 100, side: 'long', atr: 5, settings: S() });
    const b = computeRiskPlan({ entryPrice: 90_000, side: 'long', atr: 5, settings: S() });
    expect(a.riskAmount).toBeCloseTo(b.riskAmount);
  });

  it('валидация: бросает на нулевом ATR, отрицательной цене, нулевом капитале', () => {
    expect(() => computeRiskPlan({ entryPrice: 100, side: 'long', atr: 0, settings: S() })).toThrow();
    expect(() => computeRiskPlan({ entryPrice: -1, side: 'long', atr: 5, settings: S() })).toThrow();
    expect(() => computeRiskPlan({ entryPrice: NaN, side: 'long', atr: 5, settings: S() })).toThrow();
    expect(() =>
      computeRiskPlan({ entryPrice: 100, side: 'long', atr: 5, settings: S({ capital: 0 }) }),
    ).toThrow();
  });

  it('стоп лонга не уходит в минус — явная ошибка вместо молчаливой заглушки', () => {
    expect(() =>
      computeRiskPlan({ entryPrice: 10, side: 'long', atr: 8, settings: S({ stopAtrMult: 2 }) }),
    ).toThrow(/отрицательн/i);
  });

  it('formatQty: адаптивная точность и безопасный NaN', () => {
    expect(formatQty(NaN)).toBe('—');
    expect(formatQty(0.000123456)).toMatch(/0[,.]0001/);
    // 1234.5 → «1 235» (неразрывный пробел как разделитель тысяч в ru-RU)
    expect(formatQty(1234.5).replace(/\u00A0/g, ' ')).toBe('1 235');
  });
});
