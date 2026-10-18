import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Target, Shield, Trash2, Download, Upload, History } from 'lucide-react';
import {
  getAllSignals,
  getSignalStats,
  deleteSignal,
  exportJournal,
  importJournal,
  checkActiveSignals,
  listSnapshots,
  restoreFromSnapshot,
  type SignalEntry,
  type SignalStats,
  type JournalSnapshot
} from '../utils/signalJournal';
import { formatPrice } from '../utils/format';
import { fetch24hTicker } from '../api/bybit';

export default function SignalJournal() {
  const [signals, setSignals] = useState<SignalEntry[]>([]);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'closed'>('all');

  useEffect(() => {
    loadSignals();
    
    // Автоматическая проверка статусов сигналов каждые 30 секунд
    const interval = setInterval(() => {
      checkSignalStatuses();
    }, 30000);
    
    // Первоначальная проверка при загрузке
    checkSignalStatuses();
    
    return () => clearInterval(interval);
  }, []);

  const [snapshots, setSnapshots] = useState<JournalSnapshot[]>([]);

  const loadSignals = () => {
    setSignals(getAllSignals());
    setStats(getSignalStats());
    setSnapshots(listSnapshots());
  };

  // Восстановление журнала из последнего авто-снапшота (защита от потери данных)
  const handleRestore = () => {
    if (snapshots.length === 0) {
      alert('Резервных снапшотов пока нет.');
      return;
    }
    const latest = snapshots[0];
    const when = new Date(latest.savedAt).toLocaleString('ru-RU');
    if (!confirm(`Восстановить журнал из снапшота от ${when} (${latest.entries} записей)?\nТекущее состояние также будет сохранено в снапшоты.`)) return;
    const restored = restoreFromSnapshot();
    if (restored) {
      loadSignals();
      alert(`Журнал восстановлен: ${restored.length} записей.`);
    } else {
      alert('Не удалось восстановить журнал из снапшота.');
    }
  };

  // Проверка статусов активных сигналов
  const checkSignalStatuses = async () => {
    const activeSignals = getAllSignals().filter(s => s.status === 'pending');
    if (activeSignals.length === 0) return;

    // Получаем уникальные символы
    const symbols = Array.from(new Set(activeSignals.map(s => s.symbol)));
    
    // Получаем текущие цены для всех символов
    const currentPrices: Record<string, number> = {};
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const ticker = await fetch24hTicker(symbol);
          // fetch24hTicker теперь возвращает lastPrice; защищаемся от NaN
          const price = typeof ticker?.lastPrice === 'number' ? ticker.lastPrice : parseFloat(ticker?.lastPrice);
          if (Number.isFinite(price)) {
            currentPrices[symbol] = price;
          }
        } catch (err) {
          console.error(`Ошибка получения цены для ${symbol}:`, err);
        }
      })
    );

    // Проверяем сигналы и обновляем статусы
    if (Object.keys(currentPrices).length > 0) {
      const updated = checkActiveSignals(currentPrices);
      if (updated.length > 0) {
        setSignals(getAllSignals());
        setStats(getSignalStats());
      }
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Удалить сигнал?')) {
      deleteSignal(id);
      // Принудительно обновляем состояние после удаления
      setSignals(getAllSignals());
      setStats(getSignalStats());
    }
  };

  const handleExport = () => {
    const data = exportJournal();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nison_signals_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        try {
          const { imported, rejected } = importJournal(content);
          if (rejected > 0) {
            alert(`Импортировано сигналов: ${imported}. Отклонено некорректных записей: ${rejected}.`);
          }
          loadSignals();
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Не удалось импортировать журнал');
        }
      };
      reader.readAsText(file);
      // Освобожжаем input, чтобы можно было повторить импорт того же файла
      event.target.value = '';
    }
  };

  const filteredSignals = signals.filter(s => {
    if (filter === 'active') return s.status === 'pending';
    if (filter === 'closed') return s.status !== 'pending';
    return true;
  });

  const getStatusBadge = (status: SignalEntry['status']) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 text-xs border border-yellow-500/20">⏳ Активен</span>;
      case 'hit_target':
        return <span className="px-2 py-1 rounded bg-green-500/10 text-green-400 text-xs border border-green-500/20">✓ Цель достигнута</span>;
      case 'hit_stop':
        return <span className="px-2 py-1 rounded bg-red-500/10 text-red-400 text-xs border border-red-500/20">✗ Стоп сработал</span>;
      case 'expired':
        return <span className="px-2 py-1 rounded bg-gray-500/10 text-gray-400 text-xs border border-gray-500/20">⏰ Истёк</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Статистика */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-4">
          <div className="p-3 sm:p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Всего сигналов</div>
            <div className="text-lg sm:text-2xl font-bold text-white">{stats.totalSignals}</div>
          </div>
          <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Активных</div>
            <div className="text-lg sm:text-2xl font-bold text-yellow-400">{stats.activeSignals}</div>
          </div>
          <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Цель достигнута</div>
            <div className="text-lg sm:text-2xl font-bold text-green-400">{stats.hitTarget}</div>
          </div>
          <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Стоп сработал</div>
            <div className="text-lg sm:text-2xl font-bold text-red-400">{stats.hitStop}</div>
          </div>
          <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Win Rate</div>
            <div className="text-lg sm:text-2xl font-bold text-white">{stats.winRate.toFixed(1)}%</div>
          </div>
          <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Средний P&L</div>
            <div className={`text-lg sm:text-2xl font-bold ${stats.avgPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {stats.avgPnl >= 0 ? '+' : ''}{stats.avgPnl.toFixed(2)}%
            </div>
          </div>
          <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Средний R:R</div>
            <div className="text-lg sm:text-2xl font-bold text-white">1:{stats.avgRiskReward.toFixed(2)}</div>
          </div>
          <div className="p-4 rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
            <div className="text-xs text-gray-500 mb-1">Истёкших</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-400">{stats.expired}</div>
          </div>
        </div>
      )}

      {/* Контролы */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'active'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Активные
          </button>
          <button
            onClick={() => setFilter('closed')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'closed'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Закрытые
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0">
          <button
            onClick={handleRestore}
            title={`Авто-снапшоты: ${snapshots.length} (хранится до 7 последних)`}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-500/20 hover:bg-gray-500/30 text-gray-300 transition-colors"
          >
            <History className="w-4 h-4" />
            Восстановить{snapshots.length > 0 ? ` (${snapshots.length})` : ''}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 transition-colors"
          >
            <Download className="w-4 h-4" />
            Экспорт
          </button>
          <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 transition-colors cursor-pointer">
            <Upload className="w-4 h-4" />
            Импорт
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Список сигналов */}
      <div className="space-y-3">
        {filteredSignals.length === 0 ? (
          <div className="text-center py-12">
            <Target className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">Нет сигналов</p>
          </div>
        ) : (
          filteredSignals.map((signal) => (
            <div
              key={signal.id}
              className={`p-3 sm:p-4 rounded-xl border ${
                signal.status === 'pending'
                  ? 'border-yellow-500/20 bg-yellow-500/5'
                  : signal.status === 'hit_target'
                  ? 'border-green-500/20 bg-green-500/5'
                  : signal.status === 'hit_stop'
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-gray-800/60 bg-[#131a2b]/50'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    {signal.direction === 'long' ? (
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                    <span className="text-base sm:text-lg font-bold text-white break-all">
                      {signal.symbol}
                    </span>
                    <span className={`text-sm font-medium ${
                      signal.direction === 'long' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {signal.direction === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {signal.timeframe}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">{signal.pattern}</p>
                </div>
                <div className="flex items-center justify-between sm:justify-start gap-2 shrink-0">
                  {getStatusBadge(signal.status)}
                  <button
                    onClick={() => handleDelete(signal.id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Вход</div>
                  <div className="font-mono text-white">${formatPrice(signal.entryPrice)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Стоп
                  </div>
                  <div className="font-mono text-red-400">${formatPrice(signal.stopLoss)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    Цель
                  </div>
                  <div className="font-mono text-green-400">${formatPrice(signal.target)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">R:R</div>
                  <div className="font-mono text-white">1:{signal.riskReward.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Уверенность</div>
                  <div className="font-mono text-white">{signal.confidence.toFixed(0)}%</div>
                </div>
              </div>

              {signal.status !== 'pending' && signal.exitPrice && (
                <div className="pt-3 border-t border-gray-800/50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Выход</div>
                      <div className="font-mono text-white">${formatPrice(signal.exitPrice)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">P&L</div>
                      <div className={`font-mono font-bold ${
                        (signal.pnlPercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {(signal.pnlPercent || 0) >= 0 ? '+' : ''}{signal.pnlPercent?.toFixed(2)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Дата закрытия</div>
                      <div className="text-white">
                        {new Date(signal.exitTimestamp!).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                    {signal.notes && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Заметки</div>
                        <div className="text-white text-xs">{signal.notes}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-gray-800/50 text-xs text-gray-500">
                Создан: {new Date(signal.timestamp).toLocaleString('ru-RU')}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
