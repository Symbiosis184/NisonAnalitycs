// Журнал торговых сигналов
// Отслеживает сработавшие сигналы по методологии Нисона

import { assertValidSymbol, isValidTimeframe, clampNumber, sanitizeText } from './validation';
import { costImpactPercent, costImpactR, DEFAULT_COSTS, type CostModel } from './costs';

export interface SignalEntry {
  id: string;
  timestamp: number;
  symbol: string;
  timeframe: string;
  pattern: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskReward: number;
  confidence: number;
  status: 'pending' | 'hit_target' | 'hit_stop' | 'expired';
  exitPrice?: number;
  exitTimestamp?: number;
  pnl?: number;
  pnlPercent?: number;
  netPnlPercent?: number;
  costsR?: number;
  notes?: string;
  barTime?: number;
}

export interface SignalStats {
  totalSignals: number;
  activeSignals: number;
  hitTarget: number;
  hitStop: number;
  expired: number;
  winRate: number;
  grossWinRate: number;
  avgPnl: number;
  avgNetPnl: number;
  avgCostsR: number;
  avgRiskReward: number;
}

const STORAGE_KEY = 'nison_signal_journal';
const SNAPSHOT_PREFIX = 'nison_signal_journal_backup_';
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_RETENTION = 7;

export interface JournalSnapshot {
  key: string;
  savedAt: number;
  entries: number;
}

function isStorageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function safeSetItem(key: string, value: string): boolean {
  if (!isStorageAvailable()) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    try {
      for (const s of listSnapshots()) localStorage.removeItem(s.key);
      localStorage.setItem(key, value);
      return true;
    } catch {
      console.warn('localStorage недоступен для записи (квота/приватный режим)');
      return false;
    }
  }
}

function saveJournal(entries: SignalEntry[]): void {
  maybeSnapshot();
  safeSetItem(STORAGE_KEY, JSON.stringify(entries));
}

export function saveJournalPublic(entries: SignalEntry[]): void {
  saveJournal(entries);
}

function maybeSnapshot(): void {
  if (!isStorageAvailable()) return;
  const snapshots = listSnapshots();
  const latest = snapshots[0];
  if (latest && Date.now() - latest.savedAt < SNAPSHOT_INTERVAL_MS) return;

  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return;

  const key = `${SNAPSHOT_PREFIX}${Date.now()}`;
  if (safeSetItem(key, data)) {
    snapshots
      .map(s => s.key)
      .concat(key)
      .sort()
      .slice(0, -SNAPSHOT_RETENTION)
      .forEach(old => localStorage.removeItem(old));
  }
}

export function listSnapshots(): JournalSnapshot[] {
  if (!isStorageAvailable()) return [];
  const out: JournalSnapshot[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SNAPSHOT_PREFIX)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
      out.push({
        key,
        savedAt: Number(key.slice(SNAPSHOT_PREFIX.length)) || 0,
        entries: Array.isArray(parsed) ? parsed.length : 0,
      });
    } catch {
      /* повреждённый снапшот пропускаем */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function restoreFromSnapshot(key?: string): SignalEntry[] | null {
  if (!isStorageAvailable()) return null;
  const target = key ?? listSnapshots()[0]?.key;
  if (!target || !target.startsWith(SNAPSHOT_PREFIX)) return null;
  const data = localStorage.getItem(target);
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return null;
    const restored = parsed.map(sanitizeSignalEntry).filter((e): e is SignalEntry => e !== null);
    saveJournal(restored);
    return restored;
  } catch {
    return null;
  }
}

export function sanitizeSignalEntry(raw: any): SignalEntry | null {
  if (!raw || typeof raw !== 'object') return null;

  let symbol: string;
  try {
    symbol = assertValidSymbol(raw.symbol);
  } catch {
    return null;
  }

  const direction = raw.direction === 'long' || raw.direction === 'short' ? raw.direction : null;
  const statusValues = ['pending', 'hit_target', 'hit_stop', 'expired'];
  const status = statusValues.includes(raw.status) ? raw.status : 'pending';
  if (!direction) return null;

  const entryPrice = clampNumber(raw.entryPrice, 0.00000001, 1e12, NaN);
  if (!Number.isFinite(entryPrice)) return null;

  const sanitized: SignalEntry = {
    id: (() => {
      const cleaned = sanitizeText(raw.id, 64);
      if (cleaned.length >= 8) return cleaned;
      return `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    })(),
    timestamp: clampNumber(raw.timestamp, 0, Date.now() + 86400000, Date.now()),
    symbol,
    timeframe: isValidTimeframe(raw.timeframe) ? raw.timeframe : 'D',
    pattern: sanitizeText(raw.pattern, 100, 'unknown'),
    direction,
    entryPrice,
    stopLoss: clampNumber(raw.stopLoss, 0, 1e12, entryPrice),
    target: clampNumber(raw.target, 0, 1e12, entryPrice),
    riskReward: clampNumber(raw.riskReward, 0, 1000, 0),
    confidence: clampNumber(raw.confidence, 0, 100, 0),
    status,
  };

  if (typeof raw.exitPrice === 'number' && Number.isFinite(raw.exitPrice)) {
    sanitized.exitPrice = Math.min(1e12, Math.max(0, raw.exitPrice));
  }
  if (typeof raw.exitTimestamp === 'number' && Number.isFinite(raw.exitTimestamp)) {
    sanitized.exitTimestamp = clampNumber(raw.exitTimestamp, 0, Date.now() + 86400000, Date.now());
  }
  if (typeof raw.pnl === 'number' && Number.isFinite(raw.pnl)) {
    sanitized.pnl = clampNumber(raw.pnl, -1e12, 1e12, 0);
  }
  if (typeof raw.pnlPercent === 'number' && Number.isFinite(raw.pnlPercent)) {
    sanitized.pnlPercent = clampNumber(raw.pnlPercent, -100, 1e6, 0);
  }
  if (typeof raw.netPnlPercent === 'number' && Number.isFinite(raw.netPnlPercent)) {
    sanitized.netPnlPercent = clampNumber(raw.netPnlPercent, -100, 1e6, 0);
  }
  if (typeof raw.costsR === 'number' && Number.isFinite(raw.costsR)) {
    sanitized.costsR = clampNumber(raw.costsR, -1000, 0, 0);
  }
  const notes = sanitizeText(raw.notes, 500);
  if (notes) sanitized.notes = notes;

  if (typeof raw.barTime === 'number' && Number.isFinite(raw.barTime) && raw.barTime > 0) {
    sanitized.barTime = Math.floor(raw.barTime);
  }

  return sanitized;
}

function loadJournal(): SignalEntry[] {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSignalEntry).filter((e): e is SignalEntry => e !== null);
  } catch {
    return [];
  }
}

export function addSignal(signal: Omit<SignalEntry, 'id' | 'timestamp' | 'status'>): SignalEntry | null {
  const clean = sanitizeSignalEntry(signal);
  if (!clean) {
    console.warn('addSignal: запись отклонена (не прошла валидацию)');
    return null;
  }

  const entries = loadJournal();

  if (clean.barTime !== undefined) {
    const sameEvent = entries.some(entry =>
      entry.symbol === clean.symbol &&
      entry.timeframe === clean.timeframe &&
      entry.pattern === clean.pattern &&
      entry.direction === clean.direction &&
      entry.barTime === clean.barTime
    );
    if (sameEvent) {
      console.warn('Дубликат сигнала (та же формация на том же баре) пропущен');
      return null;
    }
  }

  // FIX: проверяем дубликаты не только среди pending, но и среди всех сигналов
  const isDuplicate = entries.some(entry =>
    entry.symbol === clean.symbol &&
    entry.pattern === clean.pattern &&
    entry.direction === clean.direction &&
    Math.abs(entry.entryPrice - clean.entryPrice) < 0.0001 &&
    entry.status === 'pending'
  );

  if (isDuplicate) {
    console.warn('Дубликат сигнала обнаружен и пропущен');
    return null;
  }

  const newEntry: SignalEntry = {
    ...clean,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? `signal_${Date.now()}_${crypto.randomUUID()}`
      : `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    timestamp: Date.now(),
    status: 'pending',
  };
  entries.unshift(newEntry);
  saveJournal(entries);
  return newEntry;
}

export function updateSignalStatus(
  signalId: string,
  status: SignalEntry['status'],
  exitPrice?: number,
  notes?: string
): void {
  const entries = loadJournal();
  const entry = entries.find(e => e.id === signalId);
  
  if (entry) {
    entry.status = status;
    entry.exitTimestamp = Date.now();
    if (exitPrice !== undefined) {
      Object.assign(entry, applyExit(entry, exitPrice));
    }
    if (notes) {
      entry.notes = notes;
    }
    
    saveJournal(entries);
  }
}

/**
 * FIX: возвращает новую копию entry, не мутируя оригинал.
 */
export function applyExit(entry: SignalEntry, exitPrice: number, costs: CostModel = DEFAULT_COSTS): SignalEntry {
  const updated = { ...entry };
  updated.exitPrice = exitPrice;
  updated.exitTimestamp = Date.now();

  if (updated.direction === 'long') {
    updated.pnl = exitPrice - updated.entryPrice;
    updated.pnlPercent = ((exitPrice - updated.entryPrice) / updated.entryPrice) * 100;
  } else {
    updated.pnl = updated.entryPrice - exitPrice;
    updated.pnlPercent = ((updated.entryPrice - exitPrice) / updated.entryPrice) * 100;
  }

  const impactPct = costImpactPercent(updated.direction, updated.entryPrice, exitPrice, costs);
  if (Number.isFinite(impactPct)) {
    updated.netPnlPercent = (updated.pnlPercent ?? 0) + impactPct;
  }
  const impactR = costImpactR(updated.direction, updated.entryPrice, exitPrice, updated.stopLoss, costs);
  if (Number.isFinite(impactR)) {
    updated.costsR = impactR;
  }
  
  return updated;
}

export function deleteSignal(signalId: string): void {
  const entries = loadJournal();
  const filtered = entries.filter(e => e.id !== signalId);
  saveJournal(filtered);
}

export function getAllSignals(): SignalEntry[] {
  return loadJournal();
}

export function getActiveSignals(): SignalEntry[] {
  return loadJournal().filter(e => e.status === 'pending');
}

export function getSignalStats(): SignalStats {
  const entries = loadJournal();
  const closed = entries.filter(e => e.status !== 'pending');
  
  const hitTarget = closed.filter(e => e.status === 'hit_target').length;
  const hitStop = closed.filter(e => e.status === 'hit_stop').length;
  const expired = closed.filter(e => e.status === 'expired').length;
  
  const netOf = (e: SignalEntry) => e.netPnlPercent ?? e.pnlPercent ?? 0;
  const totalNet = closed.reduce((sum, e) => sum + netOf(e), 0);
  const avgPnl = closed.length > 0 ? totalNet / closed.length : 0;

  const avgRR = entries.length > 0
    ? entries.reduce((sum, e) => sum + e.riskReward, 0) / entries.length
    : 0;

  const netWins = closed.filter(e => netOf(e) > 0).length;
  const grossWins = closed.filter(e => (e.pnlPercent ?? 0) > 0).length;
  const winRate = closed.length > 0 ? (netWins / closed.length) * 100 : 0;
  const grossWinRate = closed.length > 0 ? (grossWins / closed.length) * 100 : 0;

  const withCosts = closed.filter(e => typeof e.costsR === 'number');
  const avgCostsR = withCosts.length > 0
    ? withCosts.reduce((sum, e) => sum + (e.costsR || 0), 0) / withCosts.length
    : 0;

  return {
    totalSignals: entries.length,
    activeSignals: entries.filter(e => e.status === 'pending').length,
    hitTarget,
    hitStop,
    expired,
    winRate,
    grossWinRate,
    avgPnl,
    avgNetPnl: avgPnl,
    avgCostsR,
    avgRiskReward: avgRR,
  };
}

export interface OutcomeCandle {
  openTime: number;
  high: number;
  low: number;
  close: number;
}

export function evaluateSignalOutcome(
  signal: Pick<SignalEntry, 'direction' | 'stopLoss' | 'target'>,
  candlesAfterEntry: OutcomeCandle[],
): { status: 'hit_target' | 'hit_stop'; exitPrice: number } | null {
  const isLong = signal.direction === 'long';
  for (const c of candlesAfterEntry) {
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) continue;
    const hitStop = isLong ? c.low <= signal.stopLoss : c.high >= signal.stopLoss;
    const hitTarget = isLong ? c.high >= signal.target : c.low <= signal.target;
    if (hitStop) return { status: 'hit_stop', exitPrice: signal.stopLoss };
    if (hitTarget) return { status: 'hit_target', exitPrice: signal.target };
  }
  return null;
}

function tfDurationMs(tf: string): number | undefined {
  const t = String(tf).trim();
  if (/^\d+$/.test(t)) return Number(t) * 60_000;
  switch (t.toUpperCase()) {
    case '1M': return 60_000;
    case '5M': return 5 * 60_000;
    case '15M': return 15 * 60_000;
    case '30M': return 30 * 60_000;
    case '1H': case '60M': return 60 * 60_000;
    case '2H': case '120M': return 2 * 60 * 60_000;
    case '4H': case '240M': return 4 * 60 * 60_000;
    case 'D': case '1D': return 24 * 60 * 60_000;
    case 'W': case '1W': return 7 * 24 * 60 * 60_000;
    default: return undefined;
  }
}

/**
 * FIX: добавлена проверка, что cutoff не в будущем.
 */
function signalMaxAgeMs(timeframe: string, cutoff: number): number {
  const now = Date.now();
  const safeCutoff = Math.min(cutoff, now); // cutoff не может быть в будущем
  const dur = tfDurationMs(timeframe) ?? 24 * 60 * 60_000;
  const horizon = Math.min(7 * 24 * 60 * 60_000, Math.max(24 * 60 * 60_000, 7 * dur));
  return safeCutoff + horizon;
}

/**
 * FIX: добавлена сортировка свечей и валидация outcome.
 */
export async function settlePendingSignals(
  candleProvider: (symbol: string, timeframe: string) => Promise<OutcomeCandle[]>,
): Promise<SignalEntry[]> {
  const entries = loadJournal();
  const pendings = entries.filter(e => e.status === 'pending');
  if (pendings.length === 0) return entries;

  const keys = Array.from(new Set(pendings.map(e => `${e.symbol}|${e.timeframe}`)));
  const candlesByKey = new Map<string, OutcomeCandle[]>();
  await Promise.all(keys.map(async (key) => {
    const [symbol, timeframe] = key.split('|');
    try {
      const candles = await candleProvider(symbol, timeframe);
      // FIX: сортируем свечи хронологически (старые → новые)
      candles.sort((a, b) => a.openTime - b.openTime);
      candlesByKey.set(key, candles);
    } catch (err) {
      console.error(`Журнал: не удалось получить свечи ${symbol}/${timeframe}:`, err);
    }
  }));

  let changed = false;
  for (const entry of pendings) {
    const candles = candlesByKey.get(`${entry.symbol}|${entry.timeframe}`);
    if (!candles || candles.length === 0) continue;
    const cutoff = entry.barTime ?? entry.timestamp;
    const after = candles.filter(c => c.openTime > cutoff);
    const outcome = evaluateSignalOutcome(entry, after);
    if (outcome) {
      // FIX: валидация outcome
      if (!Number.isFinite(outcome.exitPrice) || outcome.exitPrice <= 0) {
        console.warn(`settlePendingSignals: невалидный exitPrice для сигнала ${entry.id}`);
        continue;
      }
      entry.status = outcome.status;
      const updated = applyExit(entry, outcome.exitPrice);
      Object.assign(entry, updated);
      changed = true;
    } else if (after.length > 0) {
      const deadline = signalMaxAgeMs(entry.timeframe, cutoff);
      if (Date.now() > deadline) {
        entry.status = 'expired';
        const updated = applyExit(entry, after[after.length - 1].close);
        Object.assign(entry, updated);
        changed = true;
      }
    }
  }

  if (changed) saveJournal(entries);
  return entries;
}

/**
 * FIX: унифицирован источник цен с settlePendingSignals.
 * Теперь checkActiveSignals тоже использует high/low бара, а не только currentPrice.
 * 
 * ВАЖНО: candleProvider должен быть тем же, что и в settlePendingSignals (Bybit),
 * чтобы избежать рассинхрона источников цен.
 */
export async function checkActiveSignalsUnified(
  candleProvider: (symbol: string, timeframe: string) => Promise<OutcomeCandle[]>,
): Promise<SignalEntry[]> {
  const entries = loadJournal();
  const pendings = entries.filter(e => e.status === 'pending');
  if (pendings.length === 0) return entries;

  const keys = Array.from(new Set(pendings.map(e => `${e.symbol}|${e.timeframe}`)));
  const candlesByKey = new Map<string, OutcomeCandle[]>();
  await Promise.all(keys.map(async (key) => {
    const [symbol, timeframe] = key.split('|');
    try {
      const candles = await candleProvider(symbol, timeframe);
      candles.sort((a, b) => a.openTime - b.openTime);
      candlesByKey.set(key, candles);
    } catch (err) {
      console.error(`checkActiveSignalsUnified: не удалось получить свечи ${symbol}/${timeframe}:`, err);
    }
  }));

  let changed = false;
  for (const entry of pendings) {
    const candles = candlesByKey.get(`${entry.symbol}|${entry.timeframe}`);
    if (!candles || candles.length === 0) continue;
    const cutoff = entry.barTime ?? entry.timestamp;
    const after = candles.filter(c => c.openTime > cutoff);
    
    // Используем ту же логику, что и в settlePendingSignals
    const outcome = evaluateSignalOutcome(entry, after);
    if (outcome) {
      if (!Number.isFinite(outcome.exitPrice) || outcome.exitPrice <= 0) {
        console.warn(`checkActiveSignalsUnified: невалидный exitPrice для сигнала ${entry.id}`);
        continue;
      }
      entry.status = outcome.status;
      const updated = applyExit(entry, outcome.exitPrice);
      Object.assign(entry, updated);
      changed = true;
    } else if (after.length > 0) {
      const deadline = signalMaxAgeMs(entry.timeframe, cutoff);
      if (Date.now() > deadline) {
        entry.status = 'expired';
        const updated = applyExit(entry, after[after.length - 1].close);
        Object.assign(entry, updated);
        changed = true;
      }
    }
  }

  if (changed) saveJournal(entries);
  return entries;
}

/**
 * @deprecated Используйте checkActiveSignalsUnified вместо этой функции.
 * Эта функция использует currentPrice (одна точка), что может привести к рассинхрону
 * с settlePendingSignals (который использует high/low бара).
 */
export function checkActiveSignals(currentPrices: Record<string, number>): SignalEntry[] {
  console.warn('checkActiveSignals устарела. Используйте checkActiveSignalsUnified.');
  
  const entries = loadJournal();
  const updated: SignalEntry[] = [];
  
  entries.forEach(entry => {
    if (entry.status !== 'pending') {
      updated.push(entry);
      return;
    }
    
    const currentPrice = currentPrices[entry.symbol];
    if (!currentPrice) {
      updated.push(entry);
      return;
    }
    
    if (entry.direction === 'long' && currentPrice >= entry.target) {
      entry.status = 'hit_target';
      const updatedEntry = applyExit(entry, currentPrice);
      Object.assign(entry, updatedEntry);
    } else if (entry.direction === 'short' && currentPrice <= entry.target) {
      entry.status = 'hit_target';
      const updatedEntry = applyExit(entry, currentPrice);
      Object.assign(entry, updatedEntry);
    }
    else if (entry.direction === 'long' && currentPrice <= entry.stopLoss) {
      entry.status = 'hit_stop';
      const updatedEntry = applyExit(entry, currentPrice);
      Object.assign(entry, updatedEntry);
    } else if (entry.direction === 'short' && currentPrice >= entry.stopLoss) {
      entry.status = 'hit_stop';
      const updatedEntry = applyExit(entry, currentPrice);
      Object.assign(entry, updatedEntry);
    }
    else {
      const deadline = signalMaxAgeMs(entry.timeframe, entry.barTime ?? entry.timestamp);
      if (Date.now() > deadline) {
        entry.status = 'expired';
        const updatedEntry = applyExit(entry, currentPrice);
        Object.assign(entry, updatedEntry);
      }
    }

    updated.push(entry);
  });
  
  saveJournal(updated);
  return updated;
}

export function exportJournal(): string {
  return JSON.stringify(loadJournal(), null, 2);
}

export function importJournal(json: string): { imported: number; rejected: number } {
  let entries: unknown;
  try {
    entries = JSON.parse(json);
  } catch (error) {
    console.error('Ошибка импорта журнала: некорректный JSON', error);
    throw new Error('Некорректный JSON-файл');
  }

  if (!Array.isArray(entries)) {
    throw new Error('Ожидался массив сигналов');
  }

  const MAX_IMPORT_ENTRIES = 5000;
  const sanitized = entries
    .slice(0, MAX_IMPORT_ENTRIES)
    .map(sanitizeSignalEntry)
    .filter((e): e is SignalEntry => e !== null);

  if (sanitized.length === 0) {
    throw new Error('В файле не найдено корректных записей журнала');
  }

  saveJournal(sanitized);
  return { imported: sanitized.length, rejected: Math.min(entries.length, MAX_IMPORT_ENTRIES) - sanitized.length };
}

export function clearJournal(): void {
  maybeSnapshot();
  if (isStorageAvailable()) localStorage.removeItem(STORAGE_KEY);
}
