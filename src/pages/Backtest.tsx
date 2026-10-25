// Страница «Бэктест» — эмпирическая проверка ребра паттернов Нисона (бэклог П.3)
// Данные: публичный REST Bybit (без ключей). Издержки: тейкер 0.1% + слиппедж 5 б.п./сторону.
import { useEffect, useMemo, useState } from 'react';
import { fetchKlines, type Kline } from '../api/bybit';
import { Candle } from '../utils/candle';
import { signalGenerator, type Signal } from '../utils/signal_generator';
import { runBacktest, type BacktestResult, type FormationBounds } from '../utils/backtest';
import { cycleCostFraction, type CostModel } from '../utils/costs';
import { wilsonWinRate, expectancyCI, hasEdge } from '../utils/stats';
import { runWalkForward } from '../utils/walkforward';
import { detectRegime, type RegimeInfo } from '../utils/regime';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
// Значения проходят whitelist валидацию (validation.ALLOWED_TIMEFRAMES)
const TIMEFRAMES: Array<[string, string]> = [
  ['30m', '30м'], ['1H', '1ч'], ['4H', '4ч'], ['1D', '1Д'], ['1W', '1Нд'],
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
    signalGenerator.resetRun(); // новый прогон — чистый кэш «свежих событий»
    for (let i = 60; i < candles.length; i++) {
      const sigs = signalGenerator.findSignals(candles.slice(0, i + 1), 'D');
      for (const s of sigs) {
        // FIX бэктест-аудита №3 (по книгам Нисона): торгуем ТОЛЬКО подтверждённые
        // сигналы — «ожидание → подтверждение». Раньше вход шёл по close первого
        // появления формации (статус pending, т.е. за бар ДО подтверждения), что
        // систематически ломало статистику (WR ~35%, отрицательная expectancy).
        if (!s.confirmed || s.status !== 'confirmed') continue;
        // FIX: событие привязываем к ЗАКРЫВАЮЩЕМУ бару формации (meta.patternEndIdx),
        // а не к текущему бару прогона i. При confirmDelay>1 пары (i, endIdx) не
        // существовало — детектор runBacktest никогда не находил сигнал (потерянные
        // паттерны). Вход: close бара подтверждения (= candles[endIdx+1]).
        const entryBar = Math.min(s.meta.patternEndIdx + 1, i);
        // Сигнальный режим: несём в бэктест УПРАВЛЕНИЕ ЖИВОЙ СТРАТЕГИИ —
        // структурную цель Нисона (s.target) и порог входа adjustedRR >= 2
        // (тот же фильтр, что в findSignals). Теперь проверяется вся текущая
        // стратегия (вход + стоп + цель), а не только точка входа с механикой 2R.
        events.push({
          i: entryBar,
          pattern: s.pattern,
          direction: s.direction,
          bounds: {
            patternLow: s.meta.patternLow,
            patternHigh: s.meta.patternHigh,
            target: { targetPrice: s.target, minRR: 2 },
          },
        });
      }
    }
    // Дедупликация событий: одна формация = одна сделка. При confirmDelay>1 один
    // и тот же паттерн подтверждается повторно с разных баров i — без дедупа
    // выборка раздувалась серией входов в одну структуру (артефакты «Три горы»).
    const uniqueEvents = new Map<string, typeof events[number]>();
    for (const e of events) {
      const key = `${e.pattern}|${e.direction}|${e.i}`;
      if (!uniqueEvents.has(key)) uniqueEvents.set(key, e);
    }
    const deduped = [...uniqueEvents.values()];

    // Один прогон на уникальную пару (паттерн, направление)
    const keys = new Set(deduped.map((e) => `${e.pattern}|${e.direction}`));
    const out: Array<{ key: string; res: BacktestResult; wf: ReturnType<typeof runWalkForward>; regime: RegimeInfo }> = [];
    for (const k of keys) {
      const [pattern, dirRaw] = k.split('|');
      const direction = dirRaw as 'long' | 'short';
      const detect = (hist: Candle[], idx: number): FormationBounds | null => {
        const hit = deduped.find((e) => e.i === idx && e.pattern === pattern && e.direction === direction && hist.length === idx + 1);
        return hit ? hit.bounds : null;
      };
      const evCount = deduped.filter((e) => e.pattern === pattern && e.direction === direction).length;
      if (evCount < 3) continue; // слишком мало наблюдений — не показываем
      const config = { detect, direction, costs, signalManagement: true };
      const res = runBacktest(candles, config);
      // v1.1beta: walk-forward (train 300 / test 100) и режим рынка на момент каждой сделки
      const wf = runWalkForward(candles, config, { trainBars: 300, testBars: 100, warmup: 60 });
      out.push({ key: `${pattern} (${direction === 'long' ? 'лонг' : 'шорт'})`, res, wf, regime: detectRegime(candles) });
    }
    return out.sort((a, b) => b.res.stats.avgNetR - a.res.stats.avgNetR);
  }, [candles, costs]);

  const overall: PatternStat[] = results.map(({ key, res }) => ({
    pattern: key, trades: res.stats.totalTrades, winRate: res.stats.winRate,
    avgNetR: res.stats.avgNetR, totalNetR: res.stats.totalNetR,
  }));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-bold text-slate-100">🧪 Бэктест паттернов Нисона</h1>
        <span
          className="px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide bg-amber-500/10 text-amber-400 border border-amber-500/30"
          title="Бэктест в бета-версии: методика и выборка дорабатываются, результаты — ориентировочные"
        >
          beta
        </span>
      </div>
      <p className="text-sm text-slate-400 max-w-3xl">
        Эмпирическая проверка «ребра»: каждый сигнал детектора открывается по close свечи сигнала,
        стоп = граница формации, тейк = 2R, максимум удержания 60 свечей. Результат каждой сделки
        уменьшен на издержки цикла ({fmt((cycleCostFraction(costs)) * 100)}%). Вход без lookahead: управление позицией со следующей свечи.
      </p>

      {/* Панель управления */}
      <div className="flex flex-wrap sm:flex-nowrap items-end gap-3 bg-slate-900/60 border border-slate-800 rounded-lg p-3 overflow-x-auto">
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

          {/* v1.1beta: режим рынка */}
          {candles.length >= 80 && (() => {
            const rg = detectRegime(candles);
            const labels: Record<string, string> = {
              'trend-up': '📈 Тренд вверх', 'trend-down': '📉 Тренд вниз',
              'range': '↔️ Боковик', 'volatile-breakout': '⚡ Волатильный пробой',
            };
            return (
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span className="text-slate-400">Режим рынка:</span>
                <span className={`font-semibold ${rg.regime === 'range' || rg.regime === 'volatile-breakout' ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {labels[rg.regime]}
                </span>
                <span className="text-slate-500">сила тренда {fmt(rg.trendStrength * 100, 0)}%</span>
                <span className="text-slate-500">волатильность ×{fmt(rg.volatilityRatio)}</span>
                <span className="text-slate-500" title="Множитель доверия к сигналам в текущем режиме">коэфф. сигналов ×{fmt(rg.multiplier)}</span>
              </div>
            );
          })()}

          {/* Таблица результатов (на мобильных — горизонтальный скролл) */}
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[720px] text-sm border border-slate-800 rounded overflow-hidden">
            <thead className="bg-slate-900 text-slate-400 text-left">
              <tr>
                <th className="p-2">Паттерн</th><th className="p-2">Сделок</th>
                <th className="p-2 cursor-help" title={'Доля прибыльных сделок после вычета издержек цикла (0.30% на сделку).\n' + '[95% CI] — интервал Уилсона: диапазон, в котором с вероятностью 95% лежит истинный win rate.\n' + 'Пример: 48% [35–61] означает, что реальный WR может быть как 35%, так и 61% — при малом числе сделок не делайте выводов по одному лишь проценту.'}>WR (net) [95% CI]</th>
                <th className="p-2 cursor-help" title={'Средний результат одной сделки в единицах риска R (стоп = граница формации, тейк = 2R), уже за вычетом издержек.\n' + 'Например, +0.15 R = в среднем каждая сделка приносит 15% от величины вашего стопа.\n' + '[CI] — 95%-й доверительный интервал среднего; p — вероятность получить такое среднее, если реального преимущества нет (edge = 0).\n' + 'Ключевой критерий Нисона: expectancy должна быть устойчиво положительной.'}>Exp. R [CI] · p</th>
                <th className="p-2 cursor-help" title={'Walk-forward проверка на будущих данных: стратегия обучается на окне 300 свечей и тестируется на следующих 100, окно сдвигается.\n' + 'OOS expectancy — средний результат только на данных вне обучения.\n' + 'Если OOS близок к историческому результату — преимущество настоящее; если резко хуже — статистика переобучена (бейдж ⚠︎overfit?).'}>WF OOS</th>
                <th className="p-2 cursor-help" title={'Вердикт по преимуществу (edge): EDGE — если 95%-й ДИ expectancy полностью выше нуля и p < 0.05, т.е. положительный результат статистически достоверен.\n' + 'n/d — недостаточно данных или преимущество не подтверждено (результат мог получиться случайно).'}>Edge</th>
                <th className="p-2 cursor-help" title={'Суммарный накопленный результат всех сделок паттерна в единицах R (нетто, после издержек).\n' + '+12 R означает: при стопе 1% депозита каждая такая сделка в сумме дала бы ≈ +12% к капиталу без учёта компаундинга.'}>Σ net R</th>
                <th className="p-2 cursor-help" title={'Profit Factor = сумма прибыли / сумма убытков.\n' + '>1.5 — здоровое преимущество; 1.0–1.5 — на грани шума; <1.0 — стратегия убыточна.'}>PF</th>
                <th className="p-2 cursor-help" title={'Максимальная просадка кривой капитала в единицах R: насколько глубоко equity падала от локального пика.\n' + 'Например, −8 R — худший период «съел» восемь размеров стопа. Помогает оценить, выдержит ли психика и депозит серию убытков этого паттерна.'}>Max DD (R)</th>
              </tr>
            </thead>
            <tbody>
              {results.map(({ key, res, wf }) => {
                const wins = Math.round((res.stats.winRate / 100) * res.stats.totalTrades);
                const wr = wilsonWinRate(wins, res.stats.totalTrades);
                const exp = expectancyCI(res.trades.map((t) => t.netR));
                const edge = hasEdge(exp);
                const oos = wf.oosExpectancy;
                return (
                <tr key={key} className="border-t border-slate-800 hover:bg-slate-900/50">
                  <td className="p-2 text-slate-200">{key}</td>
                  <td className="p-2">{res.stats.totalTrades}</td>
                  <td className="p-2 font-mono">{fmt(wr.p * 100, 1)}% <span className="text-slate-500">[{fmt(wr.ciLow * 100, 0)}–{fmt(wr.ciHigh * 100, 0)}]</span></td>
                  <td className={`p-2 font-mono ${exp.meanR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {exp.meanR >= 0 ? '+' : ''}{fmt(exp.meanR)} <span className="text-slate-500">[{fmt(exp.ciLow)}…{fmt(exp.ciHigh)}]</span>
                    <span className="text-slate-500"> · p={fmt(exp.pValue, 3)}</span>
                  </td>
                  <td className={`p-2 font-mono ${oos === null ? 'text-slate-600' : oos >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      title={wf.overfitSuspected ? 'OOS заметно хуже IS — возможен overfitting' : 'Out-of-sample expectancy'}>
                    {oos === null ? 'нет данных' : `${oos >= 0 ? '+' : ''}${fmt(oos)} R`}
                    {wf.overfitSuspected && <span className="ml-1 text-amber-400" title="OOS хуже IS более чем на 25%">⚠︎overfit?</span>}
                  </td>
                  <td className="p-2">{edge
                    ? <span className="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 text-xs font-semibold">EDGE</span>
                    : <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-xs">n/d</span>}</td>
                  <td className={`p-2 font-mono ${res.stats.totalNetR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{res.stats.totalNetR >= 0 ? '+' : ''}{fmt(res.stats.totalNetR)} R</td>
                  <td className="p-2">{fmt(res.stats.profitFactor)}</td>
                  <td className="p-2 text-amber-400">{fmt(res.stats.maxDrawdownR)}</td>
                </tr>
                );
              })}
              {results.length === 0 && (
                <tr><td colSpan={9} className="p-3 text-slate-500">Недостаточно наблюдений (минимум 3 сигнала на паттерн) для статистики.</td></tr>
              )}
            </tbody>
          </table>
          </div>

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
