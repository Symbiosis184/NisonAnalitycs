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
          const t = String(candles[p.candleIndex].time);
          const prev = byTime.get(t);
          if (prev) prev.count += 1;
          else byTime.set(t, { pattern: p, count: 1 });
        }

        const markers = [...byTime.values()].map(({ pattern, count }) => {
          const candle = candles[pattern.candleIndex];
          return {
            time: (candle.time / 1000) as any,
            position: pattern.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
            color: pattern.type === 'bullish' ? '#22c55e' : pattern.type === 'bearish' ? '#ef4444' : '#94a3b8',
            shape: pattern.type === 'bullish' ? 'arrowUp' as const : pattern.type === 'bearish' ? 'arrowDown' as const : 'circle' as const,
            text: '', // название только в tooltip — чистый график без наложений
            size: 1,
            __count: count,
            __pattern: pattern,
          };
        });

        const markerPlugin = createSeriesMarkers(candlestickSeries, markers);

        // ── Tooltip по наведению: subscribeCrosshairMove ────────────────────
        // lightweight-charts рисует маркеры на canvas, поэтому подписку на
        // hover делаем через штатное событие crosshair move: оно приходит с
        // временем бара под курсором и координатами курсора В СИСТЕМЕ КООРДИНАТ
        // ГРАФИКА. Раньше использовался «сырой» mousemove контейнера: координата
        // мыши считалась от левого верхнего угла контейнера, а timeToCoordinate()
        // возвращает X относительно начала области графика — из-за расхождения
        // осей ближайший маркер не попадал в радиус «попадания», и tooltip при
        // наведении мыши не появлялся.
        // ── Ключи времени: ТОЧНО так же, как в данных серии ────────────────
        // timeToCoordinate() / coordinateToTime() работают со временем в том
        // виде, в котором оно передано в setData/markers (число секунд).
        // Ранее tooltip сравнивал координаты и ключи по-разному, из-за чего
        // маркер никогда не считался «под курсором».
        const markerKeyOf = (t: any): string | null => {
          if (typeof t === 'number' && Number.isFinite(t)) return String(t);
          if (typeof t === 'string') return t;
          if (t && typeof t === 'object' && 'businessDay' in t) {
            return `${t.year}-${t.month}-${t.businessDay}`;
          }
          return null;
        };
        const markerByKey = new Map<string, (typeof markers)[number]>();
        for (const mk of markers) {
          const k = markerKeyOf(mk.time);
          if (k !== null) markerByKey.set(k, mk);
        }

        const placeTip = (mk: (typeof markers)[number], cx: number, cyHint: number) => {
          // Название(я) паттерна(ов), подтверждённых на этом баре. Если формаций
          // несколько — перечисляем все, чтобы «одна стрелка» не выглядела загадкой.
          const pattern = mk.__pattern as Pattern;
          const names = confirmedPatterns
            .filter(p => p.candleIndex === pattern.candleIndex)
            .map(p => `${p.name} · ${Math.round(Math.min(100, Math.max(0, p.confidence)))}%`);
          const label = names.length > 1 ? `Паттерны Нисона: ${names.join(' | ')}` : (names[0] ?? `${pattern.name}`);
          if (!label) { scheduleHide(); return; }
          // Вертикаль привязываем к реальной позиции маркера: priceToCoordinate
          // по low/high свечи (для belowBar/aboveBar) — плашка всплывает у стрелки.
          const candle = candles[pattern.candleIndex];
          const priceY = candlestickSeries.priceToCoordinate(
            pattern.type === 'bullish' ? candle.low : candle.high,
          );
          const cy = priceY ?? cyHint;
          tipEl.innerHTML = `<b>${label}</b>`;
          tipEl.style.left = `${cx}px`;
          tipEl.style.top = pattern.type === 'bullish' ? `${cy + 24}px` : `${Math.max(4, cy - 26)}px`;
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          tipEl.style.display = 'block';
        };

        // Основной путь: точное время бара под курсором из crosshair-параметров.
        const resolveByTime = (param: any): boolean => {
          if (!param) return false;
          let key = markerKeyOf(param.time);
          if (key === null) {
            // запасной вариант: приводим формат времени через API таймскейла
            try {
              const ts = chart.timeScale();
              const conv = (ts as any).tsToSeconds?.(param.time);
              key = markerKeyOf(conv);
            } catch { /* ignore */ }
          }
          if (key === null) return false;
          const mk = markerByKey.get(key);
          if (!mk) return false;
          const cx = chart.timeScale().timeToCoordinate(mk.time as any) ?? param.point?.x ?? 0;
          placeTip(mk, cx, param.point?.y ?? 0);
          return true;
        };

        // Запасной путь: X-координата курсора → время ближайшего бара (v4/v5
        // возвращают то же представление времени, что и в данных серии).
        const resolveByCoord = (x: number, y: number): boolean => {
          const ts = chart.timeScale() as any;
          const t = ts.coordinateToTime?.(x);
          const key = markerKeyOf(t);
          if (key === null) return false;
          const mk = markerByKey.get(key);
          if (!mk) return false;
          placeTip(mk, x, y);
          return true;
        };

        const handleHover = (x: number, y: number, param?: any) => {
          if (resolveByTime(param)) return;
          if (resolveByCoord(x, y)) return;
          scheduleHide();
        };

        const onCrosshairMove = (param: any) => {
          if (!param || !param.point) { scheduleHide(); return; }
          handleHover(param.point.x, param.point.y, param);
        };
        chart.subscribeCrosshairMove(onCrosshairMove);

        // Резервная подписка на mousemove контейнера: приводит координаты мыши
        // к системе графика через getBoundingClientRect канваса (offsetLeft в
        // v5 ненадёжен — там может не быть канваса, смещённого на область осей).
        const onMouseMoveFallback = (ev: MouseEvent) => {
          const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
          const base = canvas ?? container;
          const rect = base.getBoundingClientRect();
          handleHover(ev.clientX - rect.left, ev.clientY - rect.top);
        };
        container.addEventListener('mousemove', onMouseMoveFallback);
        (chartRef.current as any).__cleanupMarkerHover = () => {
          chart.unsubscribeCrosshairMove(onCrosshairMove);
          container.removeEventListener('mousemove', onMouseMoveFallback);
          try { (markerPlugin as any).detach?.(); } catch { /* ignore */ }
          try { tipEl.remove(); } catch { /* ignore */ }
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
