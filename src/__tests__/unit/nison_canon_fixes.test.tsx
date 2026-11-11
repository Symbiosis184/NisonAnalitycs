// Регрессии методологического канон-аудита (ЯС/ЗГ Стива Нисона).
// Каждый блок закрепляет исправление одной задачи P0/P1 отдельным тестом.
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render } from '@testing-library/react';
import { Candle } from '../../utils/candle';
import { PatternDetector } from '../../utils/pattern_engine';
import {
  getPatternId, requiresNextCandleConfirmation, getPatternCandleCount, isReversalPatternName,
} from '../../utils/pattern_ids';
import { aggregateConsensus } from '../../utils/consensus';
import { nearestStructuralTarget, collectSwingLevels } from '../../utils/nison_targets';
import { ZoneVoter } from '../../utils/zone_voter';
import { translateString } from '../../i18n/dictionaries';
import { MarketContextSection } from '../../components/analysis/MarketContextSection';

const sig = (direction: 'long' | 'short', quality: number) => ({ direction, quality });

// Контекст рынка «акции» (как в nison_audit_regressions.test.ts): гэп-модели
// оцениваются со строгой рыночной семантикой разрывов.
const STOCKS = { market: 'stocks' as const };

const cc = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: v });

/** Восходящий зигзаг (HH/HL) — аналог генератора из nison_trend_filter.test.ts. */
const zigUp = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    if (phase < 4) cl += step; else cl -= step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

/** Нисходящий зигзаг (LH/LL). */
const zigDown = (n: number, start: number, step: number) => {
  const a: Candle[] = [];
  let cl = start;
  for (let i = 0; i < n; i++) {
    const phase = i % 6;
    if (phase < 4) cl -= step; else cl += step * 0.7;
    a.push(new Candle({ time: 1000 + i, open: cl, high: cl + 1, low: cl - 1, close: cl, volume: 100 }));
  }
  return a;
};

describe('P0-1: повешенный (гл. 4 ЯС, «Молот и повешенный»)', () => {
  // Повешенный имеет ту же форму, что молот: малое тело в ВЕРХНЕЙ части
  // диапазона, длинная нижняя тень; отличается только контекстом (после роста).
  // До фикса atLocalHigh (тело внизу) и close >= mid (тело вверху) взаимно
  // исключались — модель не детектировалась никогда при prev.length >= 5.
  const hangingShape = (lastClose: number): Candle =>
    cc(lastClose - 0.4, lastClose + 0.2, lastClose - 3.4, lastClose - 0.1);

  it('после подтверждённого роста детектится', () => {
    const prev = zigUp(30, 100, 0.6);
    const res = PatternDetector.isHangingMan(hangingShape(prev[prev.length - 1].close), prev);
    expect(res.found).toBe(true);
    expect(res.name).toContain('ПОВЕШЕННЫЙ');
  });

  it('та же свеча после спада НЕ детектится (нет контекста роста)', () => {
    const prev = zigDown(30, 150, 0.6);
    const res = PatternDetector.isHangingMan(hangingShape(prev[prev.length - 1].close), prev);
    expect(res.found).toBe(false);
  });
});

describe('P0-2: ниже шеи / на шее (гл. 4 ЯС, «Другие модели разворота»)', () => {
  // По книге: «ниже шеи» — белая свеча закрывается вблизи МИНИМУМА предыдущего
  // дня; «на шее» — ЧУТЬ ВЫШЕ ЦЕНЫ ЗАКРЫТИЯ предыдущего дня. До фикса привязки
  // были перепутаны (у медвежьей свечи low <= close).
  // getSwingTrend требует минимум 2 подтверждённых экстремума каждого типа,
  // поэтому зигзаг берём длиной 20 баров (12 баров дают только по одному HH/HL).
  const prevDecline = zigDown(20, 130, 1); // НИСХОДЯЩИЙ swing, финальный close ≈ 120.2
  const black = cc(110, 110.5, 99, 100); // длинная медвежья: тело 10, диапазон 11.5

  it('закрытие белой у минимума чёрной → НИЖЕ ШЕИ', () => {
    const white = cc(98.8, 99.4, 98.6, 99.3); // малое бычье тело, close ≈ c1.low (99)
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НИЖЕ ШЕИ');
  });

  it('закрытие белой чуть выше закрытия чёрной → НА ШЕЕ', () => {
    // По книге «на шее»: белая ОТКРЫВАЕТСЯ ниже минимума предыдущего дня,
    // но закрывается чуть выше его ЦЕНЫ ЗАКРЫТИЯ (гэп вниз на открытии).
    const white = cc(98.5, 100.6, 98.4, 100.4); // тело 1.9 ≤ 5, close в [99.425; 101.35]
    const res = PatternDetector.isNeckFamily(black, white, prevDecline);
    expect(res.found).toBe(true);
    expect(res.name).toBe('НА ШЕЕ');
  });
});

describe('P0-3: гэп смежных свечей (гл. 7 ЯС, «Окна»/продолжения)', () => {
  // По книге: бычья форма — гэп вверх и две БЕЛЫЕ свечи после роста;
  // медвежья — гэп вниз и две ЧЁРНЫЕ свечи после спада. Прежняя реализация
  // требовала белых свечей в обеих ветках (нисходящая называлась
  // «ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)»). Вариант B по решению владельца:
  // легаси-поведение сохранено методом isGappingSideBySideLegacy под прежним
  // именем, каноническая медвежья форма получила имя «ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ».
  const STOCKS = { market: 'stocks' as const };
  // getSwingTrend требует >=2 подтверждённых экстремумов каждого типа; при 12
  // барах истории после отсечения slice(0,-3) окно слишком короткое — берём 24.
  const declineHistory = zigDown(24, 130, 2); // финальный close ≈ 120 → далее свеча ~104
  const gapBlackPair = [
    ...declineHistory,
    cc(104, 104.3, 94, 94.5),   // длинная медвежья перед гэпом
    cc(92, 92.4, 83, 83.5),     // гэп вниз (high 92.4 < low 94), чёрная
    cc(91.9, 92.3, 83.2, 83.9), // близкое открытие/тело, чёрная
  ];

  it('гэп вниз + две чёрные свечи после спада → ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ', () => {
    const res = PatternDetector.isGappingSideBySide(gapBlackPair, STOCKS);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ');
  });

  it('та же фикстура с белыми свечами → не находится (канонический метод)', () => {
    const whitePair = [
      ...declineHistory,
      cc(104, 104.3, 94, 94.5),
      cc(92, 92.4, 83, 92.3),     // белая в гэпе вниз (high 92.4 < low 94)
      cc(92.1, 92.6, 83.1, 92.4), // белая, близкие открытия/тела (|Δopen|/92 ≈ 0.1% < 0.5%)
    ];
    expect(PatternDetector.isGappingSideBySide(whitePair, STOCKS).found).toBe(false);
    // Легаси-алиас сохраняет прежнее поведение ради неизменных тест-контрактов:
    expect(PatternDetector.isGappingSideBySideLegacy(whitePair, STOCKS).name)
      .toBe('ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)');
  });

  it('новый ID зарегистрирован: подтверждение следующей свечой, размерность 3', () => {
    expect(getPatternId('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe('SIDE_BY_SIDE_GAP_BLACK_DOWN');
    expect(requiresNextCandleConfirmation('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe(true);
    expect(getPatternCandleCount('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe(3);
    expect(isReversalPatternName('ГЭП СМЕЖНЫХ ЧЁРНЫХ СВЕЧЕЙ')).toBe(false); // продолжение
  });
});

// P1-4 (вариант, согласованный с владельцем): consensus.test.ts фиксирует
// confidence, НЕ зависимый от качества (3 сигнала quality=0 → 95), поэтому
// формула не меняется. Вместо этого метрика в UI переименована в «Широта
// согласия» и отображается как балл /95, а не процент — см. ЗГ, «правило
// множества технических приёмов»: количество без качества консенсуса не образует.
describe('P1-4: широта согласия — метрика без знака процента', () => {
  it('три сигнала quality=0 одного направления: формула закреплена тестом → 95/95 (не вероятность)', () => {
    const r = aggregateConsensus([sig('long', 0), sig('long', 0), sig('long', 0)]);
    // Формулу менять нельзя (consensus.test.ts). Смысл снимает UI-переименование.
    expect(r.confidence).toBe(95);
  });

  it('RU/EN строки: прежний процентный ярлык удалён, новый — «Широта согласия» без %', () => {
    expect(translateString('Согласие сигналов', 'en')).not.toBe('Signal agreement');
    expect(translateString('Согласие сигналов:', 'en')).not.toBe('Signal agreement:');
    expect(translateString('Широта согласия', 'en')).toBe('Agreement breadth');
    expect(translateString('Широта согласия:', 'en')).toBe('Agreement breadth:');
  });

  it('UI рендерит метрику как N/95, а не N%', () => {
    const report = {
      regime: 'БОКОВИК', regime_description: '', trend_analysis: { cascade: null },
      consensus: { score: 4.5, confidence: 95, direction: 'buy' },
      volumeAnalysis: null,
    } as any;
    const { container } = render(<MarketContextSection report={report} volumeRatio={1} />);
    expect(container.textContent).toContain('95/95');
    expect(container.textContent).not.toContain('95%');
    expect(container.textContent).toContain('Широта согласия');
  });
});

// ─── P1-1 (вариант A): завеса/просвет на крипте при open ≈ prevClose ───
describe('P1-1: Завеса из тёмных облаков / Просвет в облаках — адаптивный допуск', () => {
  const up = zigUp(24, 100, 3);   // подтверждённый рост
  const down = zigDown(24, 200, 3); // подтверждённый спад

  it('крипта: белая свеча с открытием ровно по close предыдущей + глубокое проникновение → завеса срабатывает', () => {
    const c1 = cc(170, 180, 169.5, 179);   // бычья длинная
    const c2 = cc(179, 179.5, 168, 171);   // чёрная: open == close1 (без гэпа), закрытие ниже bodyMid
    const res = PatternDetector.isDarkCloudCover(c1, c2, [...up, c1], { market: 'crypto' } as any);
    expect(res.found).toBe(true);
    expect(res.name).not.toContain('(ГЭП'); // метка гэпа только при настоящем разрыве
  });

  it('акции: настоящий гэп выше максимума → метка «(ГЭП ВЫШЕ МАКСИМУМА)»', () => {
    const c1 = cc(170, 180, 169.5, 179);
    const c2 = cc(181, 182, 170, 173);     // open > high1, low > high1? low=170 <= 180 → гэп по open
    const res = PatternDetector.isDarkCloudCover(c1, c2, [...up, c1], STOCKS);
    expect(res.found).toBe(true);
    expect(res.name).toContain('(ГЭП ВЫШЕ МАКСИМУМА)');
  });

  it('открытие НИЖЕ close больше чем на допуск → reject (граница nison_audit_regressions сохранена)', () => {
    const firstWhite = cc(100, 111, 99.5, 110);
    expect(PatternDetector.isDarkCloudCover(firstWhite, cc(109, 111, 101, 102), up, STOCKS).found).toBe(false);
    expect(PatternDetector.isDarkCloudCover(firstWhite, cc(110.5, 112, 101, 102), up, STOCKS).found).toBe(true);
  });

  it('крипта: чёрная свеча с открытием по close предыдущей + глубокое проникновение → просвет срабатывает', () => {
    const c1 = cc(130, 130.5, 119, 120);   // медвежья длинная
    const c2 = cc(120, 129, 119.5, 128);   // белая: open == close1, закрытие выше bodyMid
    const res = PatternDetector.isPiercingPattern(c1, c2, [...down, c1], { market: 'crypto' } as any);
    expect(res.found).toBe(true);
    expect(res.name).not.toContain('(ГЭП');
  });

  it('просвет: открытие ВЫШЕ close больше чем на допуск → reject (граница теста сохранена)', () => {
    const firstBlack = cc(110, 110.5, 99, 100);
    expect(PatternDetector.isPiercingPattern(firstBlack, cc(101, 109, 100.5, 108), down, STOCKS).found).toBe(false);
    expect(PatternDetector.isPiercingPattern(firstBlack, cc(99.5, 109, 99, 108), down, STOCKS).found).toBe(true);
  });
});

describe('P1-2: nearestStructuralTarget — приоритет S/R-зоны над свингом при равном расстоянии', () => {
  // ЯС, глава «Поддержка и сопротивление»: уровни S/R — ключевые ориентиры,
  // фрактальные экстремумы вторичны. Компаратор был инвертирован (fix #P1-2).
  const mk = (o: number, h: number, l: number, cl: number) =>
    new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume: 100 });

  it('зона и свинг на одинаковом расстоянии → возвращается kind === zone', () => {
    // Фикстура гарантированно даёт свинг-хай на 40.5 (локальный максимум).
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(mk(39.5, 40, 39, 39.5));
    candles.push(mk(39.5, 40.5, 39, 40.4)); // fractal high = 40.5
    candles.push(mk(40.4, 40.4, 39.2, 39.3));
    const sw = collectSwingLevels(candles, 'long');
    expect(sw).toContain(40.5);

    // Сильная S/R-зона ровно на том же уровне 40.5 мокируется через ZoneVoter.collect
    // (построение естественно «сильной» зоны из ≥3 независимых голосов в фикстуре
    // нестабильно зависит от внутренних эвристик голосовалки).
    const spy = vi.spyOn(ZoneVoter, 'collect').mockReturnValue({
      support: [],
      resistance: [{ level: 40.5, strong: true } as any],
    });
    try {
      const t = nearestStructuralTarget(38, 'long', candles, { noiseFloor: 0.5, maxReward: 20 });
      expect(t).not.toBeNull();
      expect(t!.level).toBe(40.5);
      expect(t!.kind).toBe('zone'); // при равенстве расстояний — приоритет зоне (канон ЯС)
    } finally {
      spy.mockRestore();
    }
  });
});

describe('P1-3: candle.gapUpFrom/gapDownFrom — гэп как разрыв диапазонов (канон ЯС «Окна»)', () => {
  it('open > prevClose, но low <= prevHigh → gapUpFrom === false (не гэп)', () => {
    const prev = cc(100, 102, 99, 101);
    const cur = cc(103, 104, 101.5, 103.5); // open выше close предыдущей, но диапазон перекрывается
    expect(cur.gapUpFrom(prev)).toBe(false);
  });

  it('low > prevHigh → gapUpFrom === true (настоящий разрыв диапазонов)', () => {
    const prev = cc(100, 102, 99, 101);
    const cur = cc(103, 104, 102.5, 103.5);
    expect(cur.gapUpFrom(prev)).toBe(true);
  });

  it('high < prevLow → gapDownFrom === true; high >= prevLow → false', () => {
    const prev = cc(100, 102, 99, 101);
    expect(cc(98, 98.5, 96, 97).gapDownFrom(prev)).toBe(true);
    expect(cc(99.5, 100, 97, 98).gapDownFrom(prev)).toBe(false);
  });
});
