import { describe, it, expect, afterEach } from 'vitest';
import { PatternDetector, setMarket, getMarket } from '../../utils/pattern_engine';
import { Candle } from '../../utils/candle';

// Хелпер: свеча с явным гэпом (открытие выше предыдущего максимума)
const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: Date.now(), open: o, high: h, low: l, close: cl, volume: v });

// Идеальные гэповые данные (акционный профиль):
// медвежья длинная, затем ГЭП ВВЕРХ от максимума и две одинаковые бычьи свечи
const sideBySide = [c(110, 111, 99, 100), c(111.5, 116, 111, 115.5), c(111.7, 116.1, 111.3, 115.6)];
// тасуки восходящего гэпа: бычья, бычья с гэпом вверх, медвежья ОТКАТЫВАЕТСЯ
// в гэп и закрывается НИЖЕ открытия второй (канон гл. 7 — возврат к гэпу)
const tasuki = [c(100, 106, 99.5, 105.5), c(107, 112, 106.5, 111.5), c(111, 111.5, 103, 106)];
// покинутый младенец (низ): doji полностью ниже тела через гэпы с обеих сторон
const baby = [c(110, 110.5, 105, 105.2), c(103, 103.5, 102.5, 103), c(104.5, 110, 104.2, 109.5)];
// гэп на максимумах: длинная медвежья, затем 6 узкотелых свечей консолидации
// (body < 30% range — small bodies по канону гл. 7) + финальная бычья,
// открывшаяся гэпом вверх от вершины консолидации
const gapPlay = [c(110, 111, 99, 100), c(100.4, 101, 100, 100.5), c(100.5, 101.2, 100.2, 100.4), c(100.4, 101.1, 100.1, 100.3), c(100.3, 101, 100, 100.2), c(100.2, 100.9, 99.9, 100.4), c(100.4, 100.7, 100.1, 100.3), c(103, 106, 102.8, 105.5)];

describe('Гэповые паттерны: крипто vs акции (Нисон писал для рынков с гэпами)', () => {
  afterEach(() => setMarket('crypto'));

  it('по умолчанию рынок — крипта', () => {
    expect(getMarket()).toBe('crypto');
  });

  it('на крипте чисто-гэповые модели не детектируются', () => {
    setMarket('crypto');
    expect(PatternDetector.isGappingSideBySide(sideBySide).found).toBe(false);
    expect(PatternDetector.isTasuki(tasuki).found).toBe(false);
    expect(PatternDetector.isAbandonedBaby(baby).found).toBe(false);
    expect(PatternDetector.isGappingPlay(gapPlay).found).toBe(false);
  });

  it('после setMarket("stocks") те же данные детектируются — код сохранён для расширения до акций', () => {
    setMarket('stocks');
    expect(PatternDetector.isGappingSideBySide(sideBySide).found).toBe(true);
    expect(PatternDetector.isAbandonedBaby(baby).found).toBe(true);
    expect(PatternDetector.isGappingPlay(gapPlay).found).toBe(true);
    expect(PatternDetector.isTasuki(tasuki).found).toBe(true);
  });

  it('контратака на крипте отключена (канон гл. 6: это гэповая модель)', () => {
    setMarket('crypto');
    const prev = [c(112, 113, 110, 111), c(111, 111.5, 108, 108.5), c(108.5, 109, 105, 105.5), c(105.5, 106, 102, 102.5)];
    const c1 = c(102.5, 103, 96, 96.5); // длинная медвежья
    const c2 = c(95.5, 101, 95, 96.6);  // длинная бычья, закрытие = закрытию c1, но БЕЗ встречных гэпов
    expect(PatternDetector.isCounterattack(c1, c2, prev).found).toBe(false);
  });
});
