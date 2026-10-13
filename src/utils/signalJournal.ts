// Журнал торговых сигналов
// Отслеживает сработавшие сигналы по методологии Нисона

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

// Загрузка журнала из localStorage
function loadJournal(): SignalEntry[] {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

// Добавление нового сигнала
export function addSignal(signal: Omit<SignalEntry, 'id' | 'timestamp' | 'status'>): SignalEntry {
  const entries = loadJournal();
  const newEntry: SignalEntry = {
    ...signal,
    id: `signal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

// Импорт журнала из JSON
export function importJournal(json: string): void {
  try {
    const entries = JSON.parse(json);
    if (Array.isArray(entries)) {
      saveJournal(entries);
    }
  } catch (error) {
    console.error('Ошибка импорта журнала:', error);
  }
}

// Очистка журнала
export function clearJournal(): void {
  localStorage.removeItem(STORAGE_KEY);
}
