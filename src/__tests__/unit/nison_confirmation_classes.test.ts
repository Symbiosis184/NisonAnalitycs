// Строгое соответствие книгам Нисона: классификация моделей по требованию
// подтверждения следующей закрытой свечой (гл. 3–6).
//  • односвечные (молот, повешенный, падающая звезда, доджи, поясные головы) —
//    «signal to a signal», вход только после следующей ЗАКРЫТОЙ свечи;
//  • харами/татами/тычущие/контратака/твизеры — подтверждение обязательно;
//  • завершённые формации (звёзды, поглощения, тёмное облако, три солдата/
//    ворона, покинутое дитя) — последняя свеча модели И ЕСТЬ подтверждение.
import { describe, it, expect } from 'vitest';
import { requiresNextCandleConfirmation, CONFIRMATION_REQUIRED_IDS } from '../../utils/pattern_ids';
import { Candle } from '../../utils/candle';
import { SignalGenerator } from '../../utils/signal_generator';

const cc = (o: number, h: number, l: number, cl: number, volume = 100) =>
  new Candle({ time: 0, open: o, high: h, low: l, close: cl, volume });

describe('Классы подтверждения по Нисону (гл. 3–6)', () => {
  it('односвечные модели требуют подтверждения следующей свечой', () => {
    for (const name of ['МОЛОТ', 'ПОВЕШЕННЫЙ', 'ПАДАЮЩАЯ ЗВЕЗДА', 'ДОДЖИ', 'ЛИНИЯ ПОЯСА (БЫЧЬЯ)']) {
      expect(requiresNextCandleConfirmation(name)).toBe(true);
    }
  });

  it('харами, татами, тычущие, контратака, пинцеты требуют подтверждения', () => {
    for (const name of ['БЫЧИЙ ХАРАМИ', 'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ', 'УДЕРЖАНИЕ НА ТАТАМИ', 'ТОЛЧОК',
      'КОНТРАТАКА (БЫЧЬЯ)', 'ПИНЦЕТ (НИЗ)', 'РАЗДЕЛЕНИЕ (БЫЧЬЕ)']) {
      expect(requiresNextCandleConfirmation(name)).toBe(true);
    }
  });

  it('завершённые формации НЕ ждут отдельную следующую свечу (подтверждение внутри модели)', () => {
    for (const name of ['УТРЕННЯЯ ЗВЕЗДА', 'ВЕЧЕРНЯЯ ЗВЕЗДА', 'БЫЧЬЕ ПОГЛОЩЕНИЕ', 'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ',
      'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ', 'ПРОСВЕТ В ОБЛАКАХ', 'ТРИ БЕЛЫХ СОЛДАТА', 'ТРИ ЧЁРНЫХ ВОРОНА',
      'ПОКИНУТЫЙ МЛАДЕНЕЦ (НИЗ)']) {
      expect(CONFIRMATION_REQUIRED_IDS.length).toBeGreaterThan(0); // sanity
      expect(requiresNextCandleConfirmation(name)).toBe(false);
    }
  });

  it('SignalGenerator: утренняя звезда подтверждена сразу по закрытии модели (без следующей свечи)', () => {
    const gen = new SignalGenerator();
    // History с отскоками (rally-ноги): по канону Нисона цель сигнала —
    // ближайший значимый структурный уровень (максимум предшествующего
    // движения). Монотонное падение без отскоков уровней не даёт — сигнал
    // тогда правомерно не генерируется («нет явного уровня — ждём»).
    const candles: Candle[] = [];
    const pushLeg = (from: number, to: number, steps: number) => {
      for (let k = 0; k < steps; k++) {
        const open = from + ((to - from) * k) / steps;
        const close = from + ((to - from) * (k + 1)) / steps;
        candles.push(cc(open, Math.max(open, close) + 0.4, Math.min(open, close) - 0.4, close));
      }
    };
    pushLeg(200, 180, 8); pushLeg(180, 190, 6); // swing high ~190.4
    pushLeg(190, 170, 8); pushLeg(170, 178, 6); // swing high ~178.4
    pushLeg(178, 155, 8); pushLeg(155, 163, 6); // swing high ~163.4 — будущая цель лонга
    pushLeg(163, 145, 10);                       // нисходящее движение к модели
    // Свеча 1 модели: сильный медвежий
    candles.push(cc(145, 145.5, 141, 141.5));
    // Свеча 2: малое тело (звезда), гэп вниз
    candles.push(cc(141, 141.4, 139.8, 140.4));
    // Свеча 3: бычий возврат выше середины тела свечи 1 → модель ЗАВЕРШЕНА
    candles.push(cc(140.6, 144.5, 140.4, 144.2));
    // Формирующаяся (незакрытая) свеча — не должна учитываться как подтверждение
    const forming = cc(141.2, 141.5, 140.8, 141.3);
    (forming as unknown as { isForming: boolean }).isForming = true;
    candles.push(forming);

    const signals = gen.findSignals(candles, 'D');
    const star = signals.find(s => s.pattern.includes('ЗВЕЗДА') && s.direction === 'long');
    expect(star).toBeDefined();
    expect(star!.status).toBe('confirmed');
    expect(star!.confirmed).toBe(true);
  });

  it('SignalGenerator: молот остаётся pending без следующей закрытой свечи', () => {
    const gen = new SignalGenerator();
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const close = 200 - i * 1.5;
      candles.push(cc(close + 0.5, close + 0.9, close - 0.9, close));
    }
    // Молот: малое тело в верхней части, длинная нижняя тень
    candles.push(cc(141.5, 142.2, 137, 141.8));
    const forming = cc(141.8, 142, 141.3, 141.6);
    (forming as unknown as { isForming: boolean }).isForming = true;
    candles.push(forming); // формирующаяся — не подтверждение

    const signals = gen.findSignals(candles, 'D');
    const hammer = signals.find(s => s.pattern.includes('МОЛОТ'));
    if (hammer) {
      expect(hammer.status).toBe('pending');
      expect(hammer.confirmed).toBe(false);
    }
  });
});
