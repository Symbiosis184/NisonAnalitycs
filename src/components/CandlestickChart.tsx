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

        // ── Tooltip по наведению на маркеры-сигналы ─────────────────────────
        // lightweight-charts рисует маркеры на canvas без DOM-элементов, поэтому
        // «попадание» курсора по стрелке определяем сами. Прежние версии не
        // работали из-за трёх ошибок, учтённых здесь:
        //  1) координата X мыши считалась от контейнера, а timeToCoordinate()
        //     возвращает X области графика (без левого поля и ценовой оси) —
        //     теперь X приводится к системе графика через getBoundingClientRect
        //     канваса;
        //  2) время бара сравнивалось в разных форматах (мс из candles против
        //     секунд в маркерах) — теперь ключи берутся ТОЛЬКО из значений
        //     времени маркеров (секунды), идентичных данным серии;
        //  3) поиск ближайшего маркера не запускался, если crosshair-событие
        //     приходило без «валидного» времени — теперь попадание вычисляется
        //     по пиксельной близости при любом движении мыши над графиком.
        const ts = () => chart.timeScale();

        // Смещение области графика относительно контейнера. В v5 у контейнера
        // несколько stacked-canvas; берём последний (нижний слой), а если его
        // rect совпадает с контейнером (jsdom/SSR) — offsetLeft/offsetTop.
        const graphOffset = (): { ox: number; oy: number } => {
          let ox = 0, oy = 0;
          try {
            const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[];
            const c = canvases[canvases.length - 1];
            if (c) {
              const cr = c.getBoundingClientRect();
              const kr = container.getBoundingClientRect();
              ox = Math.round(cr.left - kr.left) || (c.offsetLeft || 0);
              oy = Math.round(cr.top - kr.top) || (c.offsetTop || 0);
            }
          } catch { /* jsdom/SSR: нулевые смещения */ }
          return { ox, oy };
        };

        // Ключ времени маркера — строковое представление тех же секунд, что
        // переданы в setData/markers (совпадает с param.time crosshair-событий).
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
          const pattern = mk.__pattern as Pattern;
          // Все формации, подтверждённые на этом баре (несколько названий —
          // через « | », чтобы «одна стрелка» не выглядела загадкой).
          const names = confirmedPatterns
            .filter(p => p.candleIndex === pattern.candleIndex)
            .map(p => `${p.name} · ${Math.round(Math.min(100, Math.max(0, p.confidence)))}%`);
          const label = names.length > 1 ? `Паттерны Нисона: ${names.join(' | ')}` : (names[0] ?? pattern.name);
          if (!label) { scheduleHide(); return; }
          // Плашка привязана к реальной позиции маркера по вертикали:
          // belowBar рисуется под low, aboveBar — над high свечи.
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

        // Поиск ближайшего маркера по пиксельной близости (надёжный путь:
        // работает всегда, даже если библиотека не передала время бара).
        const hitByPixel = (graphX: number, graphY: number): boolean => {
          let bestMk: (typeof markers)[number] | null = null;
          let bestDist = 18; // px радиус «попадания» (чуть шире самой стрелки)
          for (const mk of markers) {
            const px = ts().timeToCoordinate(mk.time as any);
            if (px === null) continue;
            const dist = Math.abs(px - graphX);
            if (dist < bestDist) { bestDist = dist; bestMk = mk; }
          }
          if (!bestMk) return false;
          const cx = ts().timeToCoordinate(bestMk.time as any) ?? graphX;
          placeTip(bestMk, cx, graphY);
          return true;
        };

        // Точный путь: сопоставление времени бара под курсором из параметров
        // crosshair (или coordinateToTime для «сырого» mousemove).
        const hitByTime = (t: any, x: number, y: number): boolean => {
          let key = markerKeyOf(t);
          if (key === null) {
            try { key = markerKeyOf((ts() as any).tsToSeconds?.(t)); } catch { /* ignore */ }
          }
          if (key === null) return false;
          const mk = markerByKey.get(key);
          if (!mk) return false;
          const cx = ts().timeToCoordinate(mk.time as any) ?? x;
          placeTip(mk, cx, y);
          return true;
        };

        const handleHover = (graphX: number, graphY: number, barTime?: any): void => {
          if (barTime !== undefined && hitByTime(barTime, graphX, graphY)) return;
          if (hitByPixel(graphX, graphY)) return;
          try {
            const t = (ts() as any).coordinateToTime?.(graphX);
            if (t !== undefined && t !== null && hitByTime(t, graphX, graphY)) return;
          } catch { /* API недоступен — уже есть pixel-hit */ }
          scheduleHide();
        };

        const onCrosshairMove = (param: any) => {
          if (!param || !param.point) { scheduleHide(); return; }
          handleHover(param.point.x, param.point.y, param.time);
        };
        chart.subscribeCrosshairMove(onCrosshairMove);

        // Резервная подписка mousemove: приводит координаты мыши к системе
        // графика и вызывает ту же логику попадания.
        const onMouseMoveFallback = (ev: MouseEvent) => {
          const rect = container.getBoundingClientRect();
          const { ox, oy } = graphOffset();
          handleHover(ev.clientX - rect.left - ox, ev.clientY - rect.top - oy);
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
