import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeSignalEntry,
  addSignal,
  getAllSignals,
  deleteSignal,
  getActiveSignals,
  updateSignalStatus,
  checkActiveSignals,
  exportJournal,
  importJournal,
  clearJournal,
} from '../../utils/signalJournal';

const validRaw = () => ({
  id: 'x1',
  timestamp: Date.now(),
  symbol: 'BTCUSDT',
  timeframe: 'D',
  pattern: 'БЫЧЬЕ ПОГЛОЩЕНИЕ',
  direction: 'long',
  entryPrice: 50000,
  stopLoss: 49000,
  target: 53000,
  riskReward: 3,
  confidence: 80,
  status: 'pending',
});

describe('sanitizeSignalEntry — защита от вредного импорта', () => {
  it('пропускает валидную запись', () => {
    const s = sanitizeSignalEntry(validRaw());
    expect(s).not.toBeNull();
    expect(s!.symbol).toBe('BTCUSDT');
    expect(s!.entryPrice).toBe(50000);
  });

  it('отклоняет запись с инъекцией в symbol', () => {
    expect(sanitizeSignalEntry({ ...validRaw(), symbol: 'BTC&interval=D' })).toBeNull();
    expect(sanitizeSignalEntry({ ...validRaw(), symbol: '<script>' })).toBeNull();
    expect(sanitizeSignalEntry({ ...validRaw(), symbol: 123 })).toBeNull();
  });

  it('отклоняет не-объект и запись без direction', () => {
    expect(sanitizeSignalEntry(null)).toBeNull();
    expect(sanitizeSignalEntry('string')).toBeNull();
    expect(sanitizeSignalEntry({ ...validRaw(), direction: 'sideways' })).toBeNull();
  });

  it('отклоняет запись с неконечной ценой входа (NaN/Infinity → null)', () => {
    const s = sanitizeSignalEntry({
      ...validRaw(),
      entryPrice: Infinity,
      confidence: 9999,
      riskReward: -5,
    });
    expect(s).toBeNull(); // entryPrice clamp-fallback = NaN → запись отброшена
  });

  it('клампит конечные значения цен/процентов в безопасные границы', () => {
    const s = sanitizeSignalEntry({
      ...validRaw(),
      confidence: 9999,     // > 100 → 100
      riskReward: -5,       // < 0 → 0
      stopLoss: 1e20,       // > 1e12 → 1e12
      pnlPercent: -1e9,     // < -100 → -100
    });
    expect(s).not.toBeNull();
    expect(s!.confidence).toBe(100);
    expect(s!.riskReward).toBe(0);
    expect(s!.stopLoss).toBeLessThanOrEqual(1e12);
    if (s!.pnlPercent !== undefined) expect(s!.pnlPercent).toBeGreaterThanOrEqual(-100);
  });

  it('санитизирует notes/pattern от управляющих символов', () => {
    const s = sanitizeSignalEntry({
      ...validRaw(),
      pattern: 'A'.repeat(500),
      notes: 'привет\u0000\u001Fмир',
    });
    expect(s!.pattern.length).toBeLessThanOrEqual(100);
    expect(s!.notes).toBe('приветмир');
  });

  it('неизвестный timeframe заменяется на D', () => {
    const s = sanitizeSignalEntry({ ...validRaw(), timeframe: '7x' });
    expect(s!.timeframe).toBe('D');
  });
});

describe('Журнал (localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const newSig = (over: Partial<any> = {}) => ({
    symbol: 'BTCUSDT',
    timeframe: 'D',
    pattern: 'МОЛОТ',
    direction: 'long' as const,
    entryPrice: 50000,
    stopLoss: 49000,
    target: 53000,
    riskReward: 3,
    confidence: 75,
    ...over,
  });

  it('addSignal добавляет запись с id/timestamp/status', () => {
    const e = addSignal(newSig())!;
    expect(e.id).toBeTruthy();
    expect(e.status).toBe('pending');
    expect(getAllSignals()).toHaveLength(1);
  });

  it('addSignal отклоняет дубликат активного сигнала', () => {
    addSignal(newSig());
    expect(addSignal(newSig())).toBeNull();
    expect(getAllSignals()).toHaveLength(1);
  });

  it('addSignal не допускает вредный symbol в журнале (возвращает null либо бросает)', () => {
    for (const bad of ['BAD SYMBOL!', 'BTC&x=1', '<script>']) {
      let result: unknown = 'threw';
      try {
        result = addSignal(newSig({ symbol: bad } as any) as any);
      } catch {
        result = 'threw';
      }
      expect(result === null || result === 'threw').toBe(true);
    }
    expect(getAllSignals().every((s) => /^[A-Z0-9]+$/.test(s.symbol))).toBe(true);
  });

  it('deleteSignal удаляет по id', () => {
    const e = addSignal(newSig())!;
    deleteSignal(e.id);
    expect(getAllSignals()).toHaveLength(0);
  });

  it('updateSignalStatus рассчитывает PnL для long', () => {
    const e = addSignal(newSig())!;
    updateSignalStatus(e.id, 'hit_target', 53000);
    const updated = getAllSignals()[0];
    expect(updated.status).toBe('hit_target');
    expect(updated.pnl).toBeCloseTo(3000);
    expect(updated.pnlPercent).toBeCloseTo(6);
  });

  it('checkActiveSignals закрывает по target/stop и игнорирует NaN-цены', () => {
    const a = addSignal(newSig({ symbol: 'BTCUSDT' }))!;
    const b = addSignal(newSig({ symbol: 'ETHUSDT', pattern: 'ПОГЛОЩЕНИЕ', entryPrice: 3000, stopLoss: 2900, target: 3200 }))!;

    // BTC достиг цели, ETH упал до стопа; SOL — цена NaN (защита от бага lastPrice)
    const changed = checkActiveSignals({ BTCUSDT: 53500, ETHUSDT: 2850, SOLUSDT: NaN } as any);
    const byId = Object.fromEntries(changed.map((e) => [e.id, e]));
    expect(byId[a.id].status).toBe('hit_target');
    expect(byId[b.id].status).toBe('hit_stop');
    expect(byId[b.id].pnl).toBeLessThan(0);
  });

  it('export/import round-trip', () => {
    addSignal(newSig());
    const json = exportJournal();
    clearJournal();
    expect(getAllSignals()).toHaveLength(0);
    const res = importJournal(json);
    expect(res.imported).toBe(1);
    expect(res.rejected).toBe(0);
    expect(getAllSignals()).toHaveLength(1);
  });

  it('importJournal отбрасывает вредные элементы и считает rejected', () => {
    const payload = JSON.stringify([
      validRaw(),
      { ...validRaw(), id: 'x2', symbol: 'EVIL&param=1' },
      { ...validRaw(), id: 'x3', entryPrice: 'abc' },
      'not-an-object',
      null,
    ]);
    const res = importJournal(payload);
    expect(res.imported).toBe(1);
    expect(res.rejected).toBe(4);
    expect(getAllSignals()[0].symbol).toBe('BTCUSDT');
  });

  it('importJournal бросает на некорректный JSON / не-массив / пустой после санитизации', () => {
    expect(() => importJournal('{invalid')).toThrow();
    expect(() => importJournal('{"a":1}')).toThrow();
    expect(() => importJournal(JSON.stringify([{ junk: true }]))).toThrow();
  });

  it('loadJournal устойчив к мусору в localStorage', () => {
    localStorage.setItem('nison_signal_journal', '###not json###');
    expect(getAllSignals()).toEqual([]);
    localStorage.setItem('nison_signal_journal', JSON.stringify({ nope: 1 }));
    expect(getAllSignals()).toEqual([]);
  });

  it('getActiveSignals возвращает только pending', () => {
    const e = addSignal(newSig())!;
    addSignal(newSig({ symbol: 'ETHUSDT', pattern: 'ЗВЕЗДА', entryPrice: 3000 }));
    updateSignalStatus(e.id, 'expired');
    expect(getActiveSignals()).toHaveLength(1);
  });
});
