// ЗАДАЧА 1: длинное тело — ОДНА зона, а не две точки.
// Книга: ЗГ гл. 2, рис. 2.11: «Откат цен должен встретить поддержку либо на уровне
// середины длинного белого тела, либо в основании всей белой свечи, включая и нижнюю
// тень». Глоссарий ЗГ: поддержка «от середины до основания белой свечи (включая и
// минимум нижней тени)». Книжный критерий длинного тела: тело >= 3x тела предыдущей.
import { describe, it, expect, beforeEach } from 'vitest';
import { Candle } from '../../utils/candle';
import { ZoneVoter } from '../../utils/zone_voter';

const mk = (time: number, open: number, high: number, low: number, close: number, volume = 100) =>
  new Candle({ time, open, high, low, close, volume });

// История: 25 нейтральных баров (body=0.1), затем длинная белая свеча body=3
// (= 3x тела предыдущей — книжный критерий), затем откаты к зоне и защита зоны.
// Длинная белая: open=100, close=103 → mid=101.5; low=99.5 (нижняя тень включена).
// Книжная зона поддержки: [99.5 … 101.5] → level=100.5, halfWidth=1.
const longBodyHistory = [
  ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 99.95, 100.3, 99.7, 100.05)),
  mk(26, 100, 103.4, 99.5, 103),                       // длинная белая: body=3 >= 3*prevBody
  mk(27, 103, 103.2, 101.8, 102.2),                    // откат внутри полосы
  mk(28, 102.2, 102.4, 100.6, 101.2),                  // откат к середине зоны
  mk(29, 101.2, 101.4, 99.8, 100.8),                   // тест у основания (low 99.8 > 99.5)
  mk(30, 100.8, 101.6, 100.4, 101.4),                  // отскок вверх — зона жива
  mk(31, 101.4, 101.8, 101.0, 101.5),                  // стабилизация над зоной
  mk(32, 101.5, 102.0, 101.2, 101.8),
  mk(33, 101.8, 102.2, 101.5, 102.0),
  mk(34, 102.0, 102.4, 101.7, 102.2),
  mk(35, 102.2, 102.6, 101.9, 102.4),
];

describe('Задача 1: длинное тело — одна зона [основание свечи (с тенью) … середина]', () => {
  beforeEach(() => ZoneVoter.clearCache());

  it('фикстура body=3x(prev): ровно одна long-body зона с книжной геометрией', () => {
    const lastClose = longBodyHistory[longBodyHistory.length - 1].close;
    const zones = ZoneVoter.collect(lastClose, longBodyHistory, 'swing');
    const lb = zones.support.filter((z) => z.sources.includes('long-body'));
    // Было: две точки (mid и c.low). Стало: одна полоса.
    expect(lb.length).toBe(1);
    const z = lb[0];
    // level = середина полосы [c.low … mid] = (99.5 + 101.5)/2 = 100.5
    expect(z.level).toBeCloseTo(100.5, 6);
    // halfWidth = (mid - c.low)/2 = 1 (книжная геометрия, см. задачу 5)
    expect(z.halfWidth).toBeCloseTo(1, 6);
    expect(z.reasons.some((r) => /ЗГ гл\. 2/.test(r))).toBe(true);
    // Метка исправлена: «основание свечи (включая нижнюю тень)», а не «тела».
    expect(z.reasons.some((r) => /основания свечи, включая нижнюю тень/.test(r))).toBe(true);
    expect(z.reasons.some((r) => /основание длинного белого тела/.test(r))).toBe(false);
  });

  it('откат в середину между бывшими точками mid и low — больше не «дыра»', () => {
    const lastClose = longBodyHistory[longBodyHistory.length - 1].close;
    // Цена ровно между прежними точками mid=101.5 и low=100.5-точкой: 101.0 ∈ [99.5..101.5]
    expect(ZoneVoter.isNearSupport(101.0, longBodyHistory, 0.015, 'swing')).toBe(true);
    expect(ZoneVoter.isNearSupport(lastClose, longBodyHistory, 0.015, 'swing')).toBe(true);
  });

  it('чёрная длинная свеча: зона [середина … вершина свечи, включая верхнюю тень]', () => {
    const hist = [
      ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 100.05, 100.3, 99.7, 99.95)),
      mk(26, 103, 103.5, 99.6, 100),                    // длинная чёрная: body=3, high=103.5
      mk(27, 100, 101.2, 99.8, 101),                    // возврат к зоне сопротивления
      mk(28, 101, 101.6, 100.6, 100.9),                 // тест нижней границы полосы 101.5
      mk(29, 100.9, 101.3, 100.4, 100.7),               // отбой вниз — зона жива
      mk(30, 100.7, 101.1, 100.4, 100.6),               // цена ниже полосы: R-роль сохраняется
      mk(31, 100.6, 101.0, 100.3, 100.5),
      mk(32, 100.5, 100.9, 100.2, 100.4),
      mk(33, 100.4, 100.8, 100.1, 100.3),
      mk(34, 100.3, 100.7, 100.0, 100.2),
      mk(35, 100.2, 100.6, 99.9, 100.1),
    ];
    const lastClose = hist[hist.length - 1].close;
    const zones = ZoneVoter.collect(lastClose, hist, 'swing');
    const lb = zones.resistance.filter((z) => z.sources.includes('long-body'));
    expect(lb.length).toBe(1);
    // mid=(103+100)/2=101.5; зона [101.5 … 103.5] → level=102.5, halfWidth=1
    expect(lb[0].level).toBeCloseTo(102.5, 6);
    expect(lb[0].halfWidth).toBeCloseTo(1, 6);
    expect(lb[0].reasons.some((r) => /вершины свечи, включая верхнюю тень/.test(r))).toBe(true);
  });

  it('тело < 3x предыдущего — книжная зона не формируется', () => {
    // Тело меньше утроенного тела предыдущей свечи: предыдущая свеча тоже крупная.
    const hist2 = [
      ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 99.95, 100.3, 99.7, 100.05)),
      mk(26, 100, 102.3, 99.6, 102),                    // prev body=2
      mk(27, 102, 103.9, 101.6, 103.5),                 // body=1.5 < 3*2=6 → не книжная
      mk(28, 103.5, 104, 103, 103.6),
    ];
    const zones = ZoneVoter.collect(103.6, hist2, 'swing');
    expect([...zones.support, ...zones.resistance].some((z) => z.sources.includes('long-body'))).toBe(false);
  });

  it('крайний случай prevBody=0 (инженерная защита, не из книг): зону не формируем', () => {
    const hist = [
      ...Array.from({ length: 25 }, (_, i) => mk(i + 1, 100, 100.3, 99.7, 100)), // doji-подобные: body=0
      mk(26, 100, 103.4, 99.5, 103),                     // длинная белая, но предыдущее тело = 0
      mk(27, 103, 103.2, 102, 102.5),
      ...Array.from({ length: 10 }, (_, i) => mk(28 + i, 102.5, 102.8, 102.2, 102.6)),
    ];
    const zones = ZoneVoter.collect(hist[hist.length - 1].close, hist, 'swing');
    expect([...zones.support, ...zones.resistance].some((z) => z.sources.includes('long-body'))).toBe(false);
  });
});
