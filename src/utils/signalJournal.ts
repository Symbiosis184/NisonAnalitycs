// Журнал торговых сигналов
// Отслеживает сработавшие сигналы по методологии Нисона

import { assertValidSymbol, isValidTimeframe, clampNumber, sanitizeText } from './validation';

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
  notes?: string;
}

export interface SignalStats {
  totalSignals: number;
  activeSignals: number;
  hitTarget: number;
  hitStop: number;
  expired: number;
  winRate: number;
  avgPnl: number;
  avgRiskReward: number;
}

const STORAGE_KEY = 'nison_signal_journal';

// Сохранение журнала в localStorage
function saveJournal(entries: SignalEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// Санитизация одной записи журнала: строгая проверка типов и границ.
// Возвращает безопасную копию или null, если запись некорректна.
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
    id: sanitizeText(raw.id, 64, `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`),
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
    sanitized.exitPrice = clampNumber(raw.exitPrice, 0, 1e12, undefined as any as number);
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
  const notes = sanitizeText(raw.notes, 500);
  if (notes) sanitized.notes = notes;

  return sanitized;
}

// Загрузка журнала из localStorage с валидацией каждой записи
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

// Добавление нового сигнала с проверкой на дубликаты
export function addSignal(signal: Omit<SignalEntry, 'id' | 'timestamp' | 'status'>): SignalEntry | null {
  const entries = loadJournal();
  
  // Проверка на дубликаты: тот же символ, паттерн, направление и цена входа
  const isDuplicate = entries.some(entry => 
    entry.symbol === signal.symbol &&
    entry.pattern === signal.pattern &&
    entry.direction === signal.direction &&
    Math.abs(entry.entryPrice - signal.entryPrice) < 0.0001 && // Учитываем погрешность float
    entry.status === 'pending' // Только активные сигналы
  );
  
  if (isDuplicate) {
    console.warn('Дубликат сигнала обнаружен и пропущен');
    return null;
  }
  
  const newEntry: SignalEntry = {
    ...signal,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? `signal_${Date.now()}_${crypto.randomUUID()}`
      : `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    timestamp: Date.now(),
    status: 'pending',
  };
  entries.unshift(newEntry); // Добавляем в начало
  saveJournal(entries);
  return newEntry;
}

// Обновление статуса сигнала
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
      entry.exitPrice = exitPrice;
      
      // Расчет P&L
      if (entry.direction === 'long') {
        entry.pnl = exitPrice - entry.entryPrice;
        entry.pnlPercent = ((exitPrice - entry.entryPrice) / entry.entryPrice) * 100;
      } else {
        entry.pnl = entry.entryPrice - exitPrice;
        entry.pnlPercent = ((entry.entryPrice - exitPrice) / entry.entryPrice) * 100;
      }
    }
    if (notes) {
      entry.notes = notes;
    }
    
    saveJournal(entries);
  }
}

// Удаление сигнала
export function deleteSignal(signalId: string): void {
  const entries = loadJournal();
  const filtered = entries.filter(e => e.id !== signalId);
  saveJournal(filtered);
}

// Получение всех сигналов
export function getAllSignals(): SignalEntry[] {
  return loadJournal();
}

// Получение активных сигналов
export function getActiveSignals(): SignalEntry[] {
  return loadJournal().filter(e => e.status === 'pending');
}

// Получение статистики
export function getSignalStats(): SignalStats {
  const entries = loadJournal();
  const closed = entries.filter(e => e.status !== 'pending');
  
  const hitTarget = closed.filter(e => e.status === 'hit_target').length;
  const hitStop = closed.filter(e => e.status === 'hit_stop').length;
  const expired = closed.filter(e => e.status === 'expired').length;
  
  const totalPnl = closed.reduce((sum, e) => sum + (e.pnlPercent || 0), 0);
  const avgPnl = closed.length > 0 ? totalPnl / closed.length : 0;
  
  const avgRR = entries.length > 0 
    ? entries.reduce((sum, e) => sum + e.riskReward, 0) / entries.length 
    : 0;
  
  const winRate = closed.length > 0 ? (hitTarget / closed.length) * 100 : 0;
  
  return {
    totalSignals: entries.length,
    activeSignals: entries.filter(e => e.status === 'pending').length,
    hitTarget,
    hitStop,
    expired,
    winRate,
    avgPnl,
    avgRiskReward: avgRR,
  };
}

// Проверка активных сигналов против текущих цен
export function checkActiveSignals(currentPrices: Record<string, number>): SignalEntry[] {
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
    
    // Проверка достижения цели
    if (entry.direction === 'long' && currentPrice >= entry.target) {
      entry.status = 'hit_target';
      entry.exitPrice = currentPrice;
      entry.exitTimestamp = Date.now();
      entry.pnl = currentPrice - entry.entryPrice;
      entry.pnlPercent = ((currentPrice - entry.entryPrice) / entry.entryPrice) * 100;
    } else if (entry.direction === 'short' && currentPrice <= entry.target) {
      entry.status = 'hit_target';
      entry.exitPrice = currentPrice;
      entry.exitTimestamp = Date.now();
      entry.pnl = entry.entryPrice - currentPrice;
      entry.pnlPercent = ((entry.entryPrice - currentPrice) / entry.entryPrice) * 100;
    }
    // Проверка достижения стопа
    else if (entry.direction === 'long' && currentPrice <= entry.stopLoss) {
      entry.status = 'hit_stop';
      entry.exitPrice = currentPrice;
      entry.exitTimestamp = Date.now();
      entry.pnl = currentPrice - entry.entryPrice;
      entry.pnlPercent = ((currentPrice - entry.entryPrice) / entry.entryPrice) * 100;
    } else if (entry.direction === 'short' && currentPrice >= entry.stopLoss) {
      entry.status = 'hit_stop';
      entry.exitPrice = currentPrice;
      entry.exitTimestamp = Date.now();
      entry.pnl = entry.entryPrice - currentPrice;
      entry.pnlPercent = ((entry.entryPrice - currentPrice) / entry.entryPrice) * 100;
    }
    // Проверка истечения времени (7 дней для дневных сигналов)
    else {
      const maxAge = entry.timeframe === 'D' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if (Date.now() - entry.timestamp > maxAge) {
        entry.status = 'expired';
        entry.exitPrice = currentPrice;
        entry.exitTimestamp = Date.now();
        if (entry.direction === 'long') {
          entry.pnl = currentPrice - entry.entryPrice;
          entry.pnlPercent = ((currentPrice - entry.entryPrice) / entry.entryPrice) * 100;
        } else {
          entry.pnl = entry.entryPrice - currentPrice;
          entry.pnlPercent = ((entry.entryPrice - currentPrice) / entry.entryPrice) * 100;
        }
      }
    }
    
    updated.push(entry);
  });
  
  saveJournal(updated);
  return updated;
}

// Экспорт журнала в JSON
export function exportJournal(): string {
  return JSON.stringify(loadJournal(), null, 2);
}

// Импорт журнала из JSON со строгой валидацией каждой записи.
// Некорректные/вредные элементы отбрасываются; при отсутствии валидных — ошибка.
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

  // Разумное ограничение на размер импорта (защита от DoS огромными файлами)
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

// Очистка журнала
export function clearJournal(): void {
  localStorage.removeItem(STORAGE_KEY);
}
