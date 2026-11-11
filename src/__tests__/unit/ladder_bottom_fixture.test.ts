// P2-1e: фикстура «Лестничное дно» по канону С. Нисон, гл. 6.
// Канон: три чёрные свечи с последовательно снижающимися закрытиями («ступени
// вниз»), четвёртая свеча НЕ закрывается ниже третьей (падение остановлено),
// пятая — длинная белая свеча, закрывающаяся выше максимумов обеих последних
// свечей формации. Формация состоит ровно из 5 свечей.
import { describe, expect, it } from 'vitest';
import { Candle } from '../../utils/candle';
import { c, flat } from '../helpers/candles';
import { PatternDetector } from '../../utils/pattern_engine';
import { scanPatternCandidates } from '../../utils/pattern_scanner';

/** Эталонная каноническая фикстура (5 свечей). */
const canonicalLadderBottom = [
  c(100, 100.5, 97.5, 98),   // ступень 1: чёрная
  c(98, 98.5, 95.5, 96),     // ступень 2: закрытие ниже предыдущего
  c(96, 96.5, 93.5, 94),     // ступень 3: закрытие ниже предыдущего
  c(94, 95.5, 93.5, 94.5),   // остановка: не закрывается ниже третьей
  c(94.5, 99.5, 94, 99),     // разворот: длинная белая над максимумами c4 и c5.open
];

describe('P2-1e: фикстура «Лестничное дно» (канон, гл. 6 ЯС)', () => {
  it('детектирует каноническую пятиcвечную фикстуру', () => {
    const res = PatternDetector.isLadderBottom(canonicalLadderBottom);
    expect(res.found).toBe(true);
    expect(res.name).toBe('ЛЕСТНИЧНОЕ ДНО');
    expect(res.formationSize).toBe(5);
  });

  it('детектирует фикстуру в составе длинной истории (сканер) и возвращает корректные границы', () => {
    let seq = 10_000;
    const remap = (arr: Candle[]) => arr.map(x => new Candle({
      time: ++seq, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume,
    }));
    const candles = [...remap(flat(20, 110)), ...remap(canonicalLadderBottom)];
    const found = scanPatternCandidates(candles).filter(p => p.name === 'ЛЕСТНИЧНОЕ ДНО');
    expect(found.length).toBeGreaterThan(0);
    const hit = found[found.length - 1];
    expect(hit.patternEndIdx).toBe(candles.length - 1);
    expect(hit.formationSize).toBe(5);
  });

  it('не детектирует, если четвёртая свеча продолжает серию вниз (закрытие ниже третьего дна)', () => {
    const broken = [...canonicalLadderBottom.slice(0, 3), c(94, 94.5, 91.5, 92), c(92, 97, 91.5, 96.5)];
    expect(PatternDetector.isLadderBottom(broken).found).toBe(false);
  });

  it('не детектирует без длинной белой завершающей свечи', () => {
    const noReversal = [...canonicalLadderBottom.slice(0, 4), c(94.5, 95.2, 94.2, 95)];
    expect(PatternDetector.isLadderBottom(noReversal).found).toBe(false);
  });

  it('не детектирует при отсутствии серии из трёх снижающихся чёрных закрытий', () => {
    const noStairs = [
      c(100, 100.5, 97.5, 98),
      c(98, 99, 97, 98.5),    // закрытие ВЫШЕ предыдущего — лестницы нет
      c(98.5, 99, 96, 96.5),
      c(96.5, 97.5, 96, 97),
      c(97, 101, 96.5, 100.5),
    ];
    expect(PatternDetector.isLadderBottom(noStairs).found).toBe(false);
  });

  it('требует минимум 5 свечей', () => {
    expect(PatternDetector.isLadderBottom(canonicalLadderBottom.slice(0, 4)).found).toBe(false);
  });
});
