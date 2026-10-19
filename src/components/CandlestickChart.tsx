import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { CandleDTO, PatternDTO, ZoneDTO } from '../api/types';

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

interface Props {
  candles: Candle[];
  ema20?: number[];
  ema50?: number[];
  ema200?: number[];
  patterns?: Pattern[];
  support?: Zone[];
  resistance?: Zone[];
  height?: number;
}

export default function CandlestickChart({ 
  candles, 
  ema20, 
  ema50, 
  ema200,
  patterns = [],
  support = [],
  resistance = [],
  height = 500 
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

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
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    const chartData = candles.map(candle => ({
      time: (candle.time / 1000) as any,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

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

    volumeSeries.setData(volumeData);

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

    // ── Паттерны: компактные маркеры БЕЗ текста, название — в tooltip ─────
    // Стрелки уменьшены (size 1), текст убран с canvas. При наведении мыши
    // (или касании на мобильных) рядом с маркером всплывает тёмная плашка
    // с названием паттерна и уверенностью.
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let tipEl: HTMLDivElement | null = null;

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

        // Ключевая фиксация: маркер ставится на ПЕРВОЙ свече формации.
        // lightweight-charts не допускает двух маркеров с одинаковым time —
        // раньше несколько паттернов, подтверждённых на одной и той же свече,
        // склеивались визуально в «тройную стрелку». Теперь каждый уникальный
        // бар получает ровно один маркер; если на баре подтвердилось несколько
        // формаций — их названия перечисляются в tooltip через « · ».
        // Ключ карты — время бара В СЕКУНДАХ (как у самих маркеров): раньше
        // tooltip сверял String(m.time) («1700000000») со String(candle.time)
        // в миллисекундах («1700000000000») — совпадений не было никогда,
        // поэтому плашка выходила пустой («undefined%» / `<b></b>`).
        const byTime = new Map<string, { pattern: Pattern; count: number }>();
        for (const p of confirmedPatterns) {
          const t = String(Math.round(candles[p.candleIndex].time / 1000));
          const prev = byTime.get(t);
          if (prev) prev.count += 1;
          else byTime.set(t, { pattern: p, count: 1 });
        }

        const markers = [...byTime.values()].map(({ pattern, count }) => {
          const candle = candles[pattern.candleIndex];
          // ВАЖНО: время маркера округляем до целых секунд — ровно так же,
          // как и ключ в byTime. Без округления key «1700000000» никогда не
          // совпадал бы с String(m.time) = «1700000000.5», tooltip искал бы
          // запись по неверному ключу и плашка над стрелкой не появлялась.
          const markerTime = Math.round(candle.time / 1000);
          return {
            time: markerTime as any,
            position: pattern.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
            color: pattern.type === 'bullish' ? '#22c55e' : pattern.type === 'bearish' ? '#ef4444' : '#94a3b8',
            shape: pattern.type === 'bullish' ? 'arrowUp' as const : pattern.type === 'bearish' ? 'arrowDown' as const : 'circle' as const,
            text: '', // название только в tooltip — чистый график без наложений
            size: 1,
            __count: count,
          };
        });

        createSeriesMarkers(candlestickSeries, markers);

        // lightweight-charts рисует маркеры на canvas — ловим mousemove по
        // контейнеру и находим ближайший маркер по X-координате.
        tipEl = document.createElement('div');
        Object.assign(tipEl.style, {
          position: 'absolute', display: 'none', zIndex: '30', pointerEvents: 'none',
          padding: '4px 8px', borderRadius: '6px', fontSize: '11px', lineHeight: '1.3',
          background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(148,163,184,0.35)',
          color: '#e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
          transform: 'translate(-50%, -100%)', transition: 'opacity .1s',
        } as Partial<CSSStyleDeclaration>);
        container.style.position = 'relative';
        container.appendChild(tipEl);
        const tip = tipEl;

        const scheduleHide = () => {
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => { tip.style.display = 'none'; }, 120);
        };

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
            const barTime = String(m.time);
            const entry = byTime.get(barTime);
            if (!entry) { scheduleHide(); return; }
            // Уверенность нормализуем к проценту: detector отдаёт 0-100,
            // но общий контракт PatternDTO допускает долю 0-1 — иначе в
            // tooltip появлялось «1%» вместо «75%».
            const conf = entry.pattern.confidence <= 1
              ? entry.pattern.confidence * 100
              : entry.pattern.confidence;
            const suffix = entry.count > 1 ? ` · ещё ${entry.count - 1}` : '';
            const label = `${entry.pattern.name} · ${Math.round(Math.min(100, Math.max(0, conf)))}%${suffix}`;
            const cx = chart.timeScale().timeToCoordinate(m.time as any) ?? x;
            const anchorPattern = entry.pattern;
            const cy = candlestickSeries.priceToCoordinate(
              anchorPattern.type === 'bullish'
                ? candles[anchorPattern.candleIndex].low
                : candles[anchorPattern.candleIndex].high,
            ) ?? y;
            // Текст пишем через textContent: никаких HTML-инъекций из названий
            tip.textContent = label;
            tip.style.left = `${cx}px`;
            tip.style.top = anchorPattern.type === 'bullish' ? `${cy + 36}px` : `${Math.max(4, cy - 10)}px`;
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            tip.style.display = 'block';
          } else {
            scheduleHide();
          }
        };
        container.addEventListener('mousemove', onMove);
        (chartRef.current as any).__cleanupMarkerHover = () => {
          container.removeEventListener('mousemove', onMove);
          if (tip.parentNode) tip.parentNode.removeChild(tip);
        };
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
  }, [candles, ema20, ema50, ema200, patterns, support, resistance, height]);

  return <div ref={chartContainerRef} className="w-full" style={{ touchAction: 'pan-y' }} />;
}
