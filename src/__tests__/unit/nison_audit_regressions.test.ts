import { describe, expect, it } from 'vitest';
import { c } from '../helpers/candles';
import { PatternDetector } from '../../utils/pattern_engine';
import { scanPatternCandidates } from '../../utils/pattern_scanner';
import { detectPatterns } from '../../utils/patterns';
import { requiresNextCandleConfirmation } from '../../utils/pattern_ids';
import { resolveSignalLifecycle } from '../../utils/signal_lifecycle';

const STOCKS = { market: 'stocks' as const };

function rally(count = 6, start = 80, step = 2) {
  return Array.from({ length: count }, (_, i) => {
    const open = start + i * step;
    return c(open, open + step + 0.3, open - 0.3, open + step);
  });
}

function decline(count = 6, start = 120, step = 2) {
  return Array.from({ length: count }, (_, i) => {
    const open = start - i * step;
    return c(open, open + 0.3, open - step - 0.3, open - step);
  });
}

const risingThree = [
  c(100, 111, 99, 110),
  c(109.8, 110.2, 108.8, 109.4),
  c(109.4, 109.8, 108.2, 109),
  c(109, 109.5, 108, 108.6),
  c(109, 112.5, 108.5, 112),
];

const tasuki = [
  ...rally(),
  c(100, 105, 99, 104.5),
  c(106, 112.5, 105.5, 112),
  c(111.5, 112, 104.8, 105.2),
];

const gappingPlay = [
  ...rally(),
  c(92, 100.3, 91.8, 100), c(100, 108.3, 99.8, 108),
  c(108, 110, 107.8, 108.2), c(108.2, 109.8, 108, 108.4),
  c(108.3, 109.7, 108.1, 108.5), c(108.4, 109.9, 108.2, 108.6),
  c(108.5, 110, 108.3, 108.7),
  c(114, 119, 113.5, 118.5),
];

const threeRiversBase = [
  c(105, 106, 104, 105), c(103, 104, 101, 102), c(101, 102, 100, 101),
  c(101, 103, 101, 102), c(103, 105, 102, 104), c(103, 104, 100.5, 101),
  c(101, 102, 100.1, 101), c(101, 103, 100.6, 102), c(103, 106, 101, 104),
  c(103, 104, 100.4, 101), c(101, 102, 100.2, 101), c(101, 103, 101, 102),
  c(103, 105, 102, 104),
];

const threeMountainsBase = [
  c(104, 106, 103, 105), c(106, 108, 104, 107), c(108, 110, 106, 108),
  c(106, 108, 104, 105), c(104, 107, 103, 104), c(106, 108.5, 104, 107),
  c(108, 110.1, 106, 108), c(105, 108, 103, 104), c(103, 107, 102, 103),
  c(106, 108.5, 103, 107), c(108, 110.2, 105, 108), c(104, 108, 103, 104),
  c(103, 107, 102, 103),
];

describe('Регрессии книжных границ и ложных моделей', () => {
  it('захват за пояс — одна свеча, а не двухсвечная формация', () => {
    const candles = [...decline(), c(100, 110, 100, 109.5)];
    const belt = scanPatternCandidates(candles).find((p) => p.name.startsWith('ЛИНИЯ ПОЯСА (БЫЧЬЯ)'));
    expect(belt).toBeDefined();
    expect(belt!.formationSize).toBe(1);
    expect(belt!.patternStartIdx).toBe(belt!.patternEndIdx);
  });

  it('завеса и просвет не допускают открытие на неправильной стороне close', () => {
    const firstWhite = c(100, 111, 99.5, 110);
    expect(PatternDetector.isDarkCloudCover(
      firstWhite, c(109, 111, 101, 102), rally(),
    ).found).toBe(false);
    expect(PatternDetector.isDarkCloudCover(
      firstWhite, c(110.5, 112, 101, 102), rally(),
    ).found).toBe(true);

    const firstBlack = c(110, 110.5, 99, 100);
    expect(PatternDetector.isPiercingPattern(
      firstBlack, c(101, 109, 100.5, 108), decline(),
    ).found).toBe(false);
    expect(PatternDetector.isPiercingPattern(
      firstBlack, c(99.5, 109, 99, 108), decline(),
    ).found).toBe(true);
  });

  it('три метода требуют предшествующего тренда', () => {
    expect(PatternDetector.isRisingThree(risingThree).found).toBe(false);
    expect(PatternDetector.isRisingThree([...rally(), ...risingThree]).found).toBe(true);
  });

  it('тасуки требуют открытие внутри второго тела и незакрытое окно', () => {
    expect(PatternDetector.isTasuki(tasuki, STOCKS).found).toBe(true);
    const wrongOpen = [...tasuki];
    wrongOpen[wrongOpen.length - 1] = c(112.6, 113, 104.8, 105.2);
    expect(PatternDetector.isTasuki(wrongOpen, STOCKS).found).toBe(false);
    const closedWindow = [...tasuki];
    closedWindow[closedWindow.length - 1] = c(111.5, 112, 104.5, 104.9);
    expect(PatternDetector.isTasuki(closedWindow, STOCKS).found).toBe(false);
  });

  it('gapping play требует фактический разрыв диапазонов и возвращает свою длину', () => {
    const valid = PatternDetector.isGappingPlay(gappingPlay, STOCKS);
    expect(valid.found).toBe(true);
    expect(valid.formationSize).toBe(6);
    const touching = [...gappingPlay];
    touching[touching.length - 1] = c(111, 115, 110, 114.5);
    expect(PatternDetector.isGappingPlay(touching, STOCKS).found).toBe(false);
  });

  it('три реки подтверждаются только выше промежуточных пиков', () => {
    const below = [...threeRiversBase, c(104, 106, 103.5, 105.5)];
    expect(PatternDetector.isThreeRivers(below).found).toBe(false);
    const above = [...threeRiversBase, c(105, 107, 104, 106.5)];
    const found = PatternDetector.isThreeRivers(above);
    expect(found.found).toBe(true);
    expect(found.formationSize).toBe(12);
  });

  it('три горы требуют отдельную медвежью свечу после последней горы', () => {
    const weak = [...threeMountainsBase, c(104, 105, 102.5, 103)];
    expect(PatternDetector.isThreeMountains(weak).found).toBe(false);
    const confirmed = [...threeMountainsBase, c(103, 104, 100, 100.5)];
    const found = PatternDetector.isThreeMountains(confirmed);
    expect(found.found).toBe(true);
    expect(found.formationSize).toBe(12);
  });

  it('башни поддерживают переменную консолидацию и фактические границы', () => {
    const top = [
      ...rally(),
      c(92, 102.5, 91.5, 102),
      c(101.8, 102.3, 101.2, 101.6),
      c(101.6, 102.1, 101, 101.8),
      c(101.8, 102.2, 101.1, 101.6),
      c(101, 101.5, 89.5, 90),
    ];
    const foundTop = PatternDetector.isTowerTop(top);
    expect(foundTop.found).toBe(true);
    // Две длинные белые из финала рывка также входят в левую башню.
    expect(foundTop.formationSize).toBe(7);

    const bottom = [
      ...decline(),
      c(108, 108.5, 97.5, 98),
      c(98.2, 99, 97.8, 98.4),
      c(98.4, 99.2, 98, 98.2),
      c(98.2, 99, 97.9, 98.4),
      c(99, 110.5, 98.5, 110),
    ];
    const foundBottom = PatternDetector.isTowerBottom(bottom);
    expect(foundBottom.found).toBe(true);
    expect(foundBottom.formationSize).toBe(7);
  });
});

describe('Модельно-специфичные подтверждения Нисона', () => {
  it('две вороны и оба варианта смежных белых свечей ждут следующую сессию', () => {
    expect(requiresNextCandleConfirmation('ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ')).toBe(true);
    expect(requiresNextCandleConfirmation('ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ')).toBe(true);
    expect(requiresNextCandleConfirmation('ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)')).toBe(true);
  });

  it('четвёртая сессия ворон подтверждается без возврата к максимумам', () => {
    const bounds = { patternLow: 99, patternHigh: 112 };
    const base = [c(100, 101, 99, 100), c(111, 112, 110, 110.5), c(111, 111.5, 109, 109.5)];
    const confirmed = resolveSignalLifecycle(
      [...base, c(109.5, 111.9, 108, 109)], 2, 'short', 109.5, bounds, 4, 3,
      'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ',
    );
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmationIndex).toBe(3);

    const returned = resolveSignalLifecycle(
      [...base, c(109.5, 112, 108, 109)], 2, 'short', 109.5, bounds, 4, 3,
      'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ',
    );
    expect(returned.status).toBe('invalidated');
  });

  it('сканер/UI сохраняют ворон pending и подтверждают их на четвёртом баре', () => {
    const crows = [
      ...rally(),
      c(92, 101, 91.5, 100),
      c(101, 102, 99.8, 100.2),
      c(101.5, 102.2, 99.5, 100.1),
    ];
    const pending = detectPatterns(crows, 'D', STOCKS)
      .find((p) => p.name.startsWith('ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ'));
    expect(pending?.status).toBe('pending');
    const confirmed = detectPatterns(
      [...crows, c(100.2, 102.1, 99.7, 100.3)], 'D', STOCKS,
    ).find((p) => p.name.startsWith('ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ'));
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.confirmationIndex).toBe(crows.length);
  });

  it('смежные белые свечи подтверждаются закрытием выше их максимумов', () => {
    const sideBySide = [
      ...rally(),
      c(100, 105, 99.5, 104.5),
      c(106, 112, 105.5, 111.5),
      c(106, 112.2, 105.6, 111.7),
    ];
    const pending = detectPatterns(sideBySide, 'D', STOCKS)
      .find((p) => p.name.startsWith('ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ'));
    expect(pending?.status).toBe('pending');
    const confirmed = detectPatterns(
      [...sideBySide, c(111.8, 113, 111, 112.8)], 'D', STOCKS,
    ).find((p) => p.name.startsWith('ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ'));
    expect(confirmed?.status).toBe('confirmed');
  });
});


describe('Ценовое подтверждение стрелок разворота', () => {
  const engulfing = [
    ...decline(),
    c(108, 108.3, 105.7, 106),
    c(105.5, 110, 105, 109.5),
  ];

  it('завершённое бычье поглощение не даёт стрелку, пока падение продолжается', () => {
    const result = detectPatterns(
      [...engulfing, c(109, 109.8, 106, 107)],
      'D',
      STOCKS,
    ).find((p) => p.name.startsWith('БЫЧЬЕ ПОГЛОЩЕНИЕ'));

    // Книжная формация распознана и завершена, но последующего закрытия выше
    // patternHigh нет: в списке модель остаётся, на графике стрелки нет.
    expect(result?.confirmed).toBe(true);
    expect(result?.priceConfirmed).toBe(false);
  });

  it('стрелка разрешена после закрытия выше границы бычьей формации', () => {
    const result = detectPatterns(
      [...engulfing, c(109.5, 111, 109, 110.5)],
      'D',
      STOCKS,
    ).find((p) => p.name.startsWith('БЫЧЬЕ ПОГЛОЩЕНИЕ'));

    expect(result?.confirmed).toBe(true);
    expect(result?.priceConfirmed).toBe(true);
  });
});

describe('Контекстные стрелки дожи', () => {
  it('дожи после роста даёт красную стрелку после закрытия ниже минимума', () => {
    const result = detectPatterns([
      ...rally(),
      c(93, 94, 92.4, 93),
      c(92.8, 93.8, 91.5, 92),
    ], 'D', STOCKS).find((p) => p.name === 'ДОДЖИ');

    expect(result?.type).toBe('нейтральный');
    expect(result?.confirmed).toBe(true);
    expect(result?.priceConfirmed).toBe(true);
    expect(result?.priceDirection).toBe('bearish');
  });

  it('одиночный дожи после снижения не даёт бычью стрелку одним пробоем максимума', () => {
    const history = decline();
    expect(PatternDetector.getDojiContextDirection(history)).toBeNull();

    // Глава 8: в основании дожи требует более сильного подтверждения от других
    // технических индикаторов. Закрытия выше максимума самого дожи недостаточно.
    const result = detectPatterns([
      ...history,
      c(107, 107.3, 106.4, 107),
      c(107.1, 108.2, 106.6, 108),
    ], 'D', STOCKS).find((p) => p.name === 'ДОДЖИ');

    expect(result).toBeUndefined();
  });

  it('дожи в боковике не получает направленную стрелку даже после пробоя', () => {
    const sideways = Array.from({ length: 8 }, () => c(99.95, 100.3, 99.7, 100.05));
    const result = detectPatterns([
      ...sideways,
      c(100, 100.6, 99.6, 100),
      c(100.1, 100.4, 99.4, 99.8),
    ], 'D', STOCKS).find((p) => p.name === 'ДОДЖИ');

    expect(result).toBeUndefined();
  });

  it('дожи на вершине без выхода закрытия за диапазон остаётся без стрелки', () => {
    const result = detectPatterns([
      ...rally(),
      c(93, 94, 92.4, 93),
      c(93.1, 93.7, 92.6, 93.2),
    ], 'D', STOCKS).find((p) => p.name === 'ДОДЖИ');

    expect(result).toBeUndefined();
  });
});
