// Регрессионные тесты на исправленные баги аналитики (аудит: RSI / Три метода)
import { describe, it } from 'vitest';
import { expect } from 'chai';
import { rsi } from '../../utils/indicators';
import { PatternDetector, VolumeAnalyzer } from '../../utils/pattern_engine';
import { Candle } from '../../utils/candle';

const mk = (o: number, h: number, l: number, c: number, v = 100) =>
  new Candle({ time: 0, open: o, high: h, low: l, close: c, volume: v });

describe('RSI — регрессия исправленных багов', () => {
  it('чистый рост даёт канонические 100 (раньше ~99 из-за rs=100 как заглушки)', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(closes, 14)[rsi(closes, 14).length - 1]).to.equal(100);
  });

  it('флэт-рынок (avgGain = avgLoss = 0) даёт 50, а не ложные ~99', () => {
    const closes = new Array(30).fill(100);
    expect(rsi(closes, 14)[rsi(closes, 14).length - 1]).to.equal(50);
  });

  it('короткий ряд (<= period) возвращает массив NaN нужной длины без исключений', () => {
    const out = rsi([1, 2, 3], 14);
    expect(out).to.have.length(3);
    expect(out.every(Number.isNaN)).to.equal(true);
  });

  it('значения RSI всегда в диапазоне [0, 100]', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    for (const v of rsi(closes, 14)) {
      if (!Number.isNaN(v)) expect(v).to.be.within(0, 100);
    }
  });
});

describe('Три метода Нисона — направление дрейфа паузы', () => {
  // 20 баров с объёмом 100 для скользящего среднего + паттерн из 5 баров
  const warmup = () => Array.from({ length: 20 }, () => mk(90, 91, 89, 90));

  it('восходящие три метода: пауза с дрейфом ВНИЗ детектируется', () => {
    const pattern = [
      mk(90, 96.2, 89.8, 96, 300),
      mk(95.8, 96, 94.2, 94.4),   // малое медвежье тело
      mk(94.4, 94.6, 93, 93.2),
      mk(93.2, 93.4, 91.8, 92),   // s3.close < s1.close*0.98
      mk(92, 98.6, 91.8, 98, 400),
    ];
    const res = (PatternDetector as any).isRisingThree([...warmup(), ...pattern]);
    expect(res.found).to.equal(true);
    expect(res.name).to.equal('ВОСХОДЯЩИЕ ТРИ МЕТОДА');
  });

  it('восходящие три метода: пауза с восходящим дрейфом ОТБРАСЫВАЕТСЯ', () => {
    const pattern = [
      mk(90, 96.2, 89.8, 96, 300),
      mk(92, 93.8, 91.8, 93.6),
      mk(93.6, 95.4, 93.4, 95.2),
      mk(95.2, 96.1, 95, 95.9),   // s3.close > s1.close — рост паузы
      mk(95.9, 98.6, 95.7, 98, 400),
    ];
    expect((PatternDetector as any).isRisingThree([...warmup(), ...pattern]).found).to.equal(false);
  });

  it('нисходящие три метода: пауза с дрейфом ВВЕРХ детектируется (зеркально)', () => {
    const pattern = [
      mk(110.2, 110.4, 103.8, 104, 300),
      mk(104.2, 105.8, 104, 105.6),  // малое бычье тело
      mk(105.6, 107.2, 105.4, 107),
      mk(107, 108.4, 106.8, 108.2),  // s3.close > s1.close*1.02
      mk(108.2, 108.4, 101.6, 102, 400),
    ];
    const res = (PatternDetector as any).isFallingThree([...warmup(), ...pattern]);
    expect(res.found).to.equal(true);
    expect(res.name).to.equal('НИСХОДЯЩИЕ ТРИ МЕТОДА');
  });

  it('VolumeAnalyzer.isHighVolume требует >=20 предыдущих баров (документированное поведение)', () => {
    const many = Array.from({ length: 25 }, () => mk(90, 91, 89, 90, 100));
    expect(VolumeAnalyzer.isHighVolume(mk(90, 91, 89, 90, 400), many, 1.3)).to.equal(true);
    expect(VolumeAnalyzer.isHighVolume(mk(90, 91, 89, 90, 400), many.slice(0, 3), 1.3)).to.equal(false);
  });
});
