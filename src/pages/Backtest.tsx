// Страница «Бэктест» — эмпирическая проверка ребра паттернов Нисона (бэклог П.3)
// Данные: публичный REST Bybit (без ключей). Издержки: тейкер 0.1% + слиппедж 5 б.п./сторону.
import { useEffect, useMemo, useState } from 'react';
import { fetchKlines, type Kline } from '../api/bybit';
import { Candle } from '../utils/candle';
import { signalGenerator } from '../utils/signal_generator';
import { runBacktest, type BacktestResult, type FormationBounds } from '../utils/backtest';
import { cycleCostFraction, type CostModel } from '../utils/costs';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
// Значения проходят whitelist валидацию (validation.ALLOWED_TIMEFRAMES)
const TIMEFRAMES: Array<[string, string]> = [
  ['15m', '15м'], ['1H', '1ч'], ['4H', '4ч'], ['1D', '1Д'], ['1W', '1Нд'],
];

function toCandles(ks: Kline[]): Candle[] {
  return ks.map((k) => new Candle({ time: k.openTime / 1000, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }));
}

interface PatternStat {
  pattern: string;
  trades: number;
  winRate: number;   // по net R
  avgNetR: number;   // expectancy, R/сделка
  totalNetR: number;
}

function fmt(n: number, d = 2): string {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

export default function BacktestPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1D');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slippageBps, setSlippageBps] = useState(5);
  const [feePct, setFeePct] = useState(0.1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchKlines(symbol, timeframe, 1000)
      .then((ks) => { if (!cancelled) setCandles(toCandles(ks)); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить данные Bybit'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  const costs: CostModel = useMemo(
    () => ({ feeRate: feePct / 100, slippageRate: slippageBps / 10000 }),
    [feePct, slippageBps],
  );

  const results = useMemo(() => {
    if (candles.length < 80) return [];
    // Собираем все срабатывания генератора по истории one-at-a-time.
    // Ключ tf задаёт пороги подтверждения (timeout/дистанция уровней) — фиксируем 'D'.
    const events: Array<{ i: number; pattern: string; direction: 'long' | 'short'; bounds: FormationBounds }> = [];
    for (let i = 60; i < candles.length; i++) {
      const sigs = signalGenerator.findSignals(candles.slice(0, i + 1), 'D');
      for (const s of sigs) {
        if (s.meta.patternEndIdx !== i) continue; // только свежие сигналы этой свечи
        events.push({ i, pattern: s.pattern, direction: s.direction, bounds: { patternLow: s.meta.patternLow, patternHigh: s.meta.patternHigh } });
      }
    }
    // Один прогон на уникальную пару (паттерн, направление)
    const keys = new Set(events.map((e) => `${e.pattern}|${e.direction}`));
    const out: Array<{ key: string; res: BacktestResult }> = [];
    for (const k of keys) {
      const [pattern, dirRaw] = k.split('|');
      const direction = dirRaw as 'long' | 'short';
      const detect = (hist: Candle[], idx: number): FormationBounds | null => {
        const hit = events.find((e) => e.i === idx && e.pattern === pattern && hist.length === idx + 1);
        return hit ? hit.bounds : null;
      };
      const evCount = events.filter((e) => e.pattern === pattern && e.direction === direction).length;
      if (evCount < 3) continue; // слишком мало наблюдений — не показываем
      out.push({ key: `${pattern} (${direction === 'long' ? 'лонг' : 'шорт'})`, res: runBacktest(candles, { detect, direction, costs }) });
    }
    return out.sort((a, b) => b.res.stats.avgNetR - a.res.stats.avgNetR);
  }, [candles, costs]);

  const overall: PatternStat[] = results.map(({ key, res }) => ({
    pattern: key, trades: res.stats.totalTrades, winRate: res.stats.winRate,
    avgNetR: res.stats.avgNetR, totalNetR: res.stats.totalNetR,
  }));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold text-slate-100">🧪 Бэктест паттернов Нисона</h1>
      <p className="text-sm text-slate-400 max-w-3xl">
        Эмпирическая проверка «ребра»: каждый сигнал детектора открывается по close свечи сигнала,
        стоп = граница формации, тейк = 2R, максимум удержания 60 свечей. Результат каждой сделки
        уменьшен на издержки цикла ({fmt((cycleCostFraction(costs)) * 100)}%). Вход без lookahead: управление позицией со следующей свечи.
      </p>

      {/* Панель управления */}
      <div className="flex flex-wrap items-end gap-3 bg-slate-900/60 border border-slate-800 rounded-lg p-3">
        <label className="text-xs text-slate-400">Инструмент
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
            className="block mt-1 bg-slate-800 text-slate-100 text-sm rounded px-2 py-1 border border-slate-700">
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">Таймфрейм
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}
            className="block mt-1 bg-slate-800 text-slate-100 text-sm rounded px-2 py-1 border border-slate-700">
            {TIMEFRAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">Комиссия, %/сторона
          <input type="number" step="0.01" min="0" value={feePct} onChange={(e) => setFeePct(Math.max(0, Number(e.target.value)))}
            className="block mt-1 w-24 bg-slate-800 text-slate-100 text-sm rounded px-2 py-1 border border-slate-700" />
        </label>
        <label className="text-xs text-slate-400">Проскальзывание, б.п.
          <input type="number" step="1" min="0" value={slippageBps} onChange={(e) => setSlippageBps(Math.max(0, Number(e.target.value)))}
            className="block mt-1 w-24 bg-slate-800 text-slate-100 text-sm rounded px-2 py-1 border border-slate-700" />
        </label>
        <span className="text-xs text-slate-500">{candles.length ? `Свечей в истории: ${candles.length}` : ''}</span>
      </div>

      {loading && <div className="text-slate-300 animate-pulse">Загрузка свечей с Bybit…</div>}
      {error && <div className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded p-3">{error}. Проверьте соединение и повторите выбор.</div>}

      {!loading && !error && candles.length >= 80 && (
        <>
          {/* Сводка */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Проверено стратегий" value={String(results.length)} />
            <Stat label="Всего сделок" value={String(results.reduce((s, r) => s + r.res.stats.totalTrades, 0))} />
            <Stat label="Лучшая expectancy" value={overall.length ? `${fmt(Math.max(...overall.map(o => o.avgNetR)))} R` : '—'} good={overall.some(o => o.avgNetR > 0)} />
            <Stat label="Худшая expectancy" value={overall.length ? `${fmt(Math.min(...overall.map(o => o.avgNetR)))} R` : '—'} good={false} />
          </div>

          {/* Таблица результатов */}
          <table className="w-full text-sm border border-slate-800 rounded overflow-hidden">
            <thead className="bg-slate-900 text-slate-400 text-left">
              <tr>
                <th className="p-2">Паттерн</th><th className="p-2">Сделок</th><th className="p-2">Win rate (net)</th>
                <th className="p-2">Expectancy</th><th className="p-2">Σ net R</th><th className="p-2">PF</th><th className="p-2">Max DD (R)</th>
              </tr>
            </thead>
            <tbody>
              {results.map(({ key, res }) => (
                <tr key={key} className="border-t border-slate-800 hover:bg-slate-900/50">
                  <td className="p-2 text-slate-200">{key}</td>
                  <td className="p-2">{res.stats.totalTrades}</td>
                  <td className="p-2">{fmt(res.stats.winRate, 1)}%</td>
                  <td className={`p-2 font-mono ${res.stats.avgNetR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{res.stats.avgNetR >= 0 ? '+' : ''}{fmt(res.stats.avgNetR)} R</td>
                  <td className={`p-2 font-mono ${res.stats.totalNetR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{res.stats.totalNetR >= 0 ? '+' : ''}{fmt(res.stats.totalNetR)} R</td>
                  <td className="p-2">{fmt(res.stats.profitFactor)}</td>
                  <td className="p-2 text-amber-400">{fmt(res.stats.maxDrawdownR)}</td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr><td colSpan={7} className="p-3 text-slate-500">Недостаточно наблюдений (минимум 3 сигнала на паттерн) для статистики.</td></tr>
              )}
            </tbody>
          </table>

          {/* Кривые эквити */}
          <div className="grid md:grid-cols-2 gap-3">
            {results.slice(0, 4).map(({ key, res }) => <EquityMini key={key} title={key} curve={res.equityCurve} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${good === undefined ? 'text-slate-100' : good ? 'text-emerald-400' : 'text-red-400'}`}>{value}</div>
    </div>
  );
}

function EquityMini({ title, curve }: { title: string; curve: number[] }) {
  const w = 320, h = 90, pad = 4;
  const min = Math.min(0, ...curve), max = Math.max(0, ...curve);
  const span = max - min || 1;
  const pts = curve.map((v, i) => `${pad + (i / Math.max(1, curve.length - 1)) * (w - 2 * pad)},${h - pad - ((v - min) / span) * (h - 2 * pad)}`).join(' ');
  const zeroY = h - pad - ((0 - min) / span) * (h - 2 * pad);
  const last = curve[curve.length - 1] ?? 0;
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <div className="text-xs text-slate-400 mb-1">{title} · накопленный net R: <span className={last >= 0 ? 'text-emerald-400' : 'text-red-400'}>{last >= 0 ? '+' : ''}{fmt(last)}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="#475569" strokeDasharray="3 3" strokeWidth="1" />
        <polyline points={pts} fill="none" stroke={last >= 0 ? '#34d399' : '#f87171'} strokeWidth="2" />
      </svg>
    </div>
  );
}
