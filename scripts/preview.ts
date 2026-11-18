/**
 * Предпросмотр ядра NisonAnalytics (п.1–3 бэклога) на детерминированных демо-данных.
 * Запуск: npm run preview
 * Выход — ASCII-график свечей + таблица метрик бэктеста + план риска по последнему сигналу.
 */
import { makeDemoCandles } from '../src/analysis/demo_data';
import { scanPatterns } from '../src/analysis/patterns';
import { atr } from '../src/analysis/indicators';
import { runBacktest, DEFAULT_BACKTEST_PARAMS } from '../src/analysis/backtest';
import { computeRiskPlan } from '../src/analysis/position_sizing';
import { roundTripCostPct } from '../src/analysis/costs';
import { DEFAULT_TRADE_SETTINGS } from '../src/analysis/types';

const candles = makeDemoCandles(240);
const last = candles[candles.length - 1];

// ── 1. ASCII-график закрытий ────────────────────────────────────────────────
function sparkline(values: number[], width = 78, height = 14): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ' '),
  );
  for (let x = 0; x < width; x++) {
    const v = values[Math.floor((x / (width - 1)) * (values.length - 1))];
    const y = Math.round(((max - v) / (max - min || 1)) * (height - 1));
    grid[y][x] = '•';
  }
  let prevY = -1;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (grid[y][x] === '•') {
        if (prevY >= 0) {
          const [a, b] = prevY < y ? [prevY, y] : [y, prevY];
          for (let k = a + 1; k < b; k++) if (grid[k][x] === ' ') grid[k][x] = '|';
        }
        prevY = y;
        break;
      }
    }
  }
  return grid.map((row) => row.join('')).join('\n');
}

console.log('┌──────────────────────── NisonAnalytics — предпросмотр ────────────────────────┐');
console.log(`│ BTCUSDT 1H (демо, seed=7)  ${candles.length} свечей  close=${last.close.toFixed(2)}`);
console.log('│');
console.log(sparkline(candles.map((c) => c.close)).replace(/^/gm, '│ '));
console.log('│');

// ── 2. Паттерны Нисона ──────────────────────────────────────────────────────
const patterns = scanPatterns(candles);
const byName = new Map<string, number>();
for (const p of patterns) byName.set(p.name, (byName.get(p.name) ?? 0) + 1);
console.log(`│ Свечные паттерны найдено: ${patterns.length}`);
for (const [name, n] of [...byName].sort((a, b) => b[1] - a[1])) {
  console.log(`│   • ${name.padEnd(24)} ×${n}`);
}

// ── 3. Бэктест (п.3) с издержками (п.2) ─────────────────────────────────────
const bt = runBacktest(candles, DEFAULT_BACKTEST_PARAMS);
const m = bt.metrics;
console.log('│');
console.log('│ ══ Бэктест паттернов Нисона (стоп 1.5×ATR, TP 2R, комиссии+проскальзывание) ══');
console.log(
  `│ Сделок: ${m.trades}  |  Win Rate (net): ${(m.winRate * 100).toFixed(1)}%  |  Profit Factor: ${fmt(m.profitFactor)}`,
);
console.log(
  `│ Expectancy: ${fmt(m.avgNetR)} R/сделка  |  Итог: ${fmt(m.totalNetR)} R  |  Max Drawdown: ${fmt(m.maxDrawdownR)} R`,
);
console.log('│ Разрез по паттернам (net R):');
for (const [name, s] of Object.entries(m.byPattern).sort((a, b) => b[1].avgNetR - a[1].avgNetR)) {
  console.log(
    `│   ${name.padEnd(24)} сделок:${String(s.trades).padStart(3)}  WR:${(s.winRate * 100).toFixed(0).padStart(3)}%  avgR:${fmt(s.avgNetR)}`,
  );
}

// ── 4. Position sizing (п.1) по последнему сигналу ──────────────────────────
const atrSeries = atr(candles, 14);
const sig = patterns[patterns.length - 1];
if (sig) {
  const c = candles[sig.index];
  const plan = computeRiskPlan({
    entryPrice: c.close,
    side: sig.side,
    atr: atrSeries[sig.index],
    settings: DEFAULT_TRADE_SETTINGS,
  });
  console.log('│');
  console.log(`│ ══ План риска: ${sig.name} (${sig.side}) @ ${c.close.toFixed(2)} ══`);
  console.log(`│   Капитал ${plan.capital} $, риск ${plan.riskPct}% = ${plan.riskAmount.toFixed(2)} $`);
  console.log(`│   ATR=${plan.atr.toFixed(2)} стоп=${plan.stopPrice.toFixed(2)} кол-во=${plan.positionQty.toFixed(4)} (= ${plan.positionValue.toFixed(0)} $)`);
  console.log(`│   Издержки полного цикла: ${plan.costs.toFixed(2)} $ (${(roundTripCostPct(DEFAULT_TRADE_SETTINGS) * 100).toFixed(2)}%)`);
  console.log(`│   Чистый убыток по стопу: ${plan.netStopLoss.toFixed(2)} $ ≈ ${((plan.netStopLoss / plan.capital) * 100).toFixed(2)}% капитала`);
}
console.log('└───────────────────────────────────────────────────────────────────────────────┘');

function fmt(x: number): string {
  return (x >= 0 ? '+' : '') + x.toFixed(2);
}
