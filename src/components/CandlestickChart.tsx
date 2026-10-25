import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { CandleDTO, PatternDTO, ZoneDTO, SignalDTO } from '../api/types';

// Единые типы данных графика — из общего контракта src/api/types.ts
type Candle = CandleDTO;
type Zone = ZoneDTO;

interface Pattern {
  name: string;
  type: PatternDTO['type'];
  candleIndex: number;
  confidence: number;
  confirmed: boolean;
}

/** Живая (незакрытая) свеча из WebSocket-потока Bybit */
export interface LiveCandleProp {
  start: number; // openTime, мс
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  candles: Candle[];
  ema20?: number[];
  ema50?: number[];
  ema200?: number[];
  patterns?: Pattern[];
  signals?: SignalDTO[];
  support?: Zone[];
  resistance?: Zone[];
  height?: number;
  live?: LiveCandleProp | null;
}

export default function CandlestickChart({ 
  candles, 
  ema20, 
  ema50, 
  ema200,
  patterns = [],
  signals = [],
  support = [],
  resistance = [],
  height = 500,
  live = null,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  // Живая свеча обновляется через WebSocket каждые ~сотни миллисекунд —
  // пересоздавать весь график на каждый тик нельзя. Держим ссылки на серии
  // и обновляем только последний бар отдельным «тихим» эффектом.
  const seriesRef = useRef<{ candle: any; volume: any } | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    // Очищаем предыдущий график если есть
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
      // Touch (мобильные): пан — пальцем, зум — щипком; на десктопе привычный drag/колесо
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#34d399',
      downColor: '#fb7185',
      borderDownColor: '#fb7185',
      borderUpColor: '#34d399',
      wickDownColor: '#fb7185',
      wickUpColor: '#34d399',
    });

    const chartData = candles.map(candle => ({
      time: (candle.time / 1000) as any,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    // Живая (незакрытая) свеча из WebSocket: если её бар новее последнего
    // закрытого — добавляем его в данные графика; если это тот же незакрытый
    // бар (REST-кэш отдаёт текущий) — заменяем на актуальные значения.
    if (live && live.start > 0) {
      const lastClosed = candles[candles.length - 1];
      const liveBar = {
        time: (Math.floor(live.start / 1000)) as any,
        open: live.open,
        high: live.high,
        low: live.low,
        close: live.close,
      };
      if (lastClosed && Math.floor(lastClosed.time / 1000) === liveBar.time) {
        chartData[chartData.length - 1] = liveBar;
      } else if (!lastClosed || liveBar.time > Math.floor(lastClosed.time / 1000)) {
        chartData.push(liveBar);
      }
    }

    candlestickSeries.setData(chartData);

    // Добавляем объем
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    const volumeData = candles.map(candle => ({
      time: (candle.time / 1000) as any,
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
    }));

    if (live && live.start > 0) {
      const lastClosed = candles[candles.length - 1];
      const lt = Math.floor(live.start / 1000);
      const liveVol = {
        time: lt as any,
        value: live.volume,
        color: live.close >= live.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      };
      if (lastClosed && Math.floor(lastClosed.time / 1000) === lt) {
        volumeData[volumeData.length - 1] = liveVol;
      } else if (!lastClosed || lt > Math.floor(lastClosed.time / 1000)) {
        volumeData.push(liveVol);
      }
    }

    volumeSeries.setData(volumeData);

    // Публикуем серии для «тихого» live-обновления последнего бара без пересоздания графика
    seriesRef.current = { candle: candlestickSeries, volume: volumeSeries };

    // ── Уровни S/R: тонкие линии, без зашумлённых подписей на полотне ────
    // Сильные поддержки — зелёные сплошные 1px, сопротивления — красные;
    // слабые (если попадут в список) — полупрозрачные штриховые.
    // axisLabel показывает короткую метку прямо на ценовой оси — так подписи
    // не перекрывают свечи и не наезжают друг на друга.
    const addZoneLines = (zones: Zone[], kind: 'support' | 'resistance') => {
      zones.forEach((zone, idx) => {
        candlestickSeries.createPriceLine({
          price: zone.level,
          color: kind === 'support'
            ? (zone.strong ? 'rgba(34,197,94,0.8)' : 'rgba(34,197,94,0.4)')
            : (zone.strong ? 'rgba(239,68,68,0.8)' : 'rgba(239,68,68,0.4)'),
          lineWidth: 1,
          lineStyle: zone.strong ? 0 : 2, // сильные сплошные, остальные штрих-пунктир
          axisLabelVisible: true,
          title: `${kind === 'support' ? 'S' : 'R'}${idx + 1}`,
        });
      });
    };
    addZoneLines(support.filter(z => z.strong), 'support');
    addZoneLines(resistance.filter(z => z.strong), 'resistance');

    // ── Сигналы: линии входа/стопа/цели + маркер направления на баре сигнала ──
    // Рисуем только живые сигналы (pending/confirmed): invalidated/expired — мусор истории.
    const liveSignals = signals.filter(
      (s) => (s.lifecycle_status ?? (s.confirmed ? 'confirmed' : 'pending')) !== 'invalidated'
        && (s.lifecycle_status ?? '') !== 'expired',
    );
    // lightweight-charts не допускает двух маркеров с одинаковым time —
    // на одном баре может быть несколько сигналов: объединяем в один,
    // при конфликте long/short ставим круг.
    const markerByTime = new Map<number, { dir: 'long' | 'short' | 'mixed' }>();
    for (const sig of liveSignals.slice(-5)) {
      const isLong = sig.direction === 'long';
      candlestickSeries.createPriceLine({
        price: sig.entry_price,
        color: 'rgba(148,163,184,0.7)',
        lineWidth: 1,
        lineStyle: 1, // пунктир: вход
        axisLabelVisible: true,
        title: `${isLong ? '▲' : '▼'} ${sig.pattern} · вход`,
      });
      candlestickSeries.createPriceLine({
        price: sig.stop_loss,
        color: 'rgba(239,68,68,0.6)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'стоп',
      });
      candlestickSeries.createPriceLine({
        price: sig.target,
        color: 'rgba(34,197,94,0.6)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `цель 1:${sig.rr.toFixed(1)}`,
      });
      if (sig.bar_time) {
        const t = Math.floor(sig.bar_time / 1000);
        const prev = markerByTime.get(t);
        markerByTime.set(t, !prev ? { dir: sig.direction } : prev.dir === sig.direction ? prev : { dir: 'mixed' });
      }
    }
    const signalMarkers = [...markerByTime.entries()].map(([t, { dir }]) => ({
      time: t as any,
      position: (dir === 'short' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
      color: dir === 'long' ? '#34d399' : dir === 'short' ? '#fb7185' : '#94a3b8',
      shape: dir === 'long' ? 'arrowUp' as const : dir === 'short' ? 'arrowDown' as const : 'circle' as const,
      text: '',
      size: 1,
    })).sort((a, b) => (a.time as number) - (b.time as number));
    if (signalMarkers.length > 0) {
      createSeriesMarkers(candlestickSeries, signalMarkers);
    }

    // ── Паттерны: компактные маркеры БЕЗ текста, название — в tooltip ─────
    // Стрелки уменьшены (size 1), текст убран с canvas. При наведении мыши
    // (или касании на мобильных) рядом с маркером всплывает тёмная плашка
    // с названием паттерна и уверенностью.
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    if (patterns.length > 0) {
      // По Нисону паттерн считается валидным только ПОСЛЕ подтверждения
      // следующей свечой — на графике рисуем исключительно подтверждённые
      // маркеры (это защита от «ложных» стрелок: неподтверждённая формация
      // может быть отменена следующей свечой). При равной уверенности выше
      // ставится тот паттерн, который подкреплён объёмом или уровнем S/R.
      const confirmedPatterns = patterns
        .filter(p => p.confirmed && p.candleIndex >= 0 && p.candleIndex < candles.length)
        .sort(
          (a, b) =>
            b.confidence - a.confidence ||
            Number(Boolean((b as any).hasVolume)) - Number(Boolean((a as any).hasVolume)) ||
            Number(Boolean((b as any).atLevel)) - Number(Boolean((a as any).atLevel)),
        );

      if (confirmedPatterns.length > 0) {
        const container = chartContainerRef.current!;
        const tipEl = document.createElement('div');
        Object.assign(tipEl.style, {
          position: 'absolute', display: 'none', zIndex: '30', pointerEvents: 'none',
          padding: '4px 8px', borderRadius: '6px', fontSize: '11px', lineHeight: '1.3',
          background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(148,163,184,0.35)',
          color: '#e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
          transform: 'translate(-50%, -100%)', transition: 'opacity .1s',
        } as Partial<CSSStyleDeclaration>);
        container.style.position = 'relative';
        container.appendChild(tipEl);

        const scheduleHide = () => {
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => { tipEl.style.display = 'none'; }, 120);
        };

        // Ключевая фиксация: маркер ставится на ПЕРВОЙ свече формации.
        // lightweight-charts не допускает двух маркеров с одинаковым time —
        // раньше несколько паттернов, подтверждённых на одной и той же свече,
        // склеивались визуально в «тройную стрелку». Теперь каждый уникальный
        // бар получает ровно один маркер; если на баре подтвердилось несколько
        // формаций — их названия перечисляются в tooltip через « · ».
        const byTime = new Map<string, { pattern: Pattern; count: number }>();
        for (const p of confirmedPatterns) {
          // Ключ — время бара в СЕКУНДАХ (как у маркеров ниже), чтобы
          // lookup из tooltip (byTime.get(barTime)) совпадал корректно.
          const t = String(Math.floor(candles[p.candleIndex].time / 1000));
          const prev = byTime.get(t);
          if (prev) prev.count += 1;
          else byTime.set(t, { pattern: p, count: 1 });
        }

        const markers = [...byTime.values()].map(({ pattern, count }) => {
          const candle = candles[pattern.candleIndex];
          return {
            time: Math.floor(candle.time / 1000) as any,
            position: pattern.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
            color: pattern.type === 'bullish' ? '#34d399' : pattern.type === 'bearish' ? '#fb7185' : '#94a3b8',
            shape: pattern.type === 'bullish' ? 'arrowUp' as const : pattern.type === 'bearish' ? 'arrowDown' as const : 'circle' as const,
            text: '', // название только в tooltip — чистый график без наложений
            size: 1,
            __count: count,
          };
        });

        createSeriesMarkers(candlestickSeries, markers);

        // lightweight-charts рисует маркеры на canvas — ловим mousemove по
        // контейнеру и находим ближайший маркер по X-координате.
        const onMove = (ev: MouseEvent) => {
          const rect = container.getBoundingClientRect();
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          let bestIdx = -1;
          let bestDist = 14; // px радиус «попадания» по маркеру
          for (let i = 0; i < markers.length; i++) {
            const px = chart.timeScale().timeToCoordinate(markers[i].time as any);
            if (px === null) continue;
            const dist = Math.abs(px - x);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          }
          if (bestIdx >= 0) {
            const m = markers[bestIdx];
            // Название(я) паттерна(ов), подтверждённых на этом баре. Если формаций
            // несколько — перечисляем все, чтобы «одна стрелка» не выглядела загадкой.
            // Ключ маркера — время в СЕКУНДАХ (timeToCoordinate/сравнение),
            // а time свечей — в миллисекундах. Конвертируем обе стороны,
            // иначе совпадений нет и tooltip остаётся пустым.
            const barTime = String(m.time);
            const names = confirmedPatterns
              .filter(p => String(Math.floor(candles[p.candleIndex].time / 1000)) === barTime)
              .map(p => `${p.name} · ${Math.round(Math.min(100, Math.max(0, p.confidence)))}%`);
            const label = names.length > 1 ? `Паттерны Нисона: ${names.join(' | ')}` : names[0] ?? '';
            const cx = chart.timeScale().timeToCoordinate(m.time as any) ?? x;
            const anchorPattern = byTime.get(barTime)?.pattern ?? confirmedPatterns[0];
            const cy = candlestickSeries.priceToCoordinate(
              anchorPattern.type === 'bullish'
                ? candles[anchorPattern.candleIndex].low
                : candles[anchorPattern.candleIndex].high,
            ) ?? y;
            tipEl.innerHTML = `<b>${label}</b>`;
            tipEl.style.left = `${cx}px`;
            tipEl.style.top = anchorPattern.type === 'bullish' ? `${cy + 36}px` : `${Math.max(4, cy - 10)}px`;
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            tipEl.style.display = 'block';
          } else {
            scheduleHide();
          }
        };
        container.addEventListener('mousemove', onMove);
        (chartRef.current as any).__cleanupMarkerHover = () => container.removeEventListener('mousemove', onMove);
      }
    }

    chart.timeScale().fitContent();

    // ResizeObserver: корректная перестройка при повороте экрана и смене размера контейнера
    const container = chartContainerRef.current;
    const ro = new ResizeObserver(() => {
      if (container) {
        chart.applyOptions({ width: container.clientWidth });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (hideTimer) clearTimeout(hideTimer);
      const cleanup = (chartRef.current as any)?.__cleanupMarkerHover;
      if (typeof cleanup === 'function') cleanup();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, ema20, ema50, ema200, patterns, signals, support, resistance, height]);

  // ── Тихое live-обновление последнего бара (WebSocket) ─────────────────────
  // Не пересоздаём график: обновляем только OHLCV текущего незакрытого бара
  // через series.update(). Вызывается на каждый тик дельты цены (~200–1000 мс).
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !live || live.start <= 0) return;
    const t = Math.floor(live.start / 1000);
    try {
      s.candle.update({ time: t as any, open: live.open, high: live.high, low: live.low, close: live.close });
      s.volume.update({
        time: t as any,
        value: live.volume,
        color: live.close >= live.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      });
    } catch {
      // бар ещё не в данных серии — ignore (полный setData перестроится при реанализе)
    }
  }, [live]);

  return <div ref={chartContainerRef} className="w-full" style={{ touchAction: 'pan-y' }} />;
}
