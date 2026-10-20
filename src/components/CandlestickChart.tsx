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
  // Состояние маркеров createSeriesMarkers — живёт МЕЖДУ перестройками
  // графика; hover-обработчик читает из него актуальный список стрелок.
  const markerStateRef = useRef<any>(null);
  // Удаление слушателя/плашки tooltip при cleanup эффекта.
  const cleanupHoverRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    // При каждой перестройке графика старое состояние маркеров привязано к
    // уже удалённой серии — сбрасываем, чтобы следующий цикл создал новый
    // setMarkers на живой серии (иначе стрелки пропадали бы навсегда).
    markerStateRef.current = null;
    if (cleanupHoverRef.current) {
      cleanupHoverRef.current();
      cleanupHoverRef.current = null;
    }

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
    const hideTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const tipElRef = { current: null as HTMLDivElement | null };

    // ── Всплывающая подсказка паттернов: СОЗДАЁТСЯ ВСЕГДА, независимо от того,
    // есть ли маркеры в момент монтирования. Раньше плашка и слушатель mousemove
    // создавались только внутри блока «есть паттерны» — при первом рендере без
    // паттернов hover-обработчик не навешивался НИКОГДА, и даже когда стрелки
    // появлялись позже, наведение на них не давало ровным счётом ничего.
    {
      const container = chartContainerRef.current!;
      const tip = document.createElement('div');
      Object.assign(tip.style, {
        position: 'absolute', display: 'none', zIndex: '30', pointerEvents: 'none',
        padding: '4px 8px', borderRadius: '6px', fontSize: '11px', lineHeight: '1.3',
        background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(148,163,184,0.35)',
        color: '#e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        transform: 'translate(-50%, -100%)', transition: 'opacity .1s',
      } as Partial<CSSStyleDeclaration>);
      container.style.position = 'relative';
      container.appendChild(tip);
      tipElRef.current = tip;

      const scheduleHide = () => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => { tip.style.display = 'none'; }, 120);
      };

      const showAt = (clientX: number, clientY: number) => {
        // Актуальный список маркеров берём из state-хранилища createSeriesMarkers:
        // он обновляется отдельным эффектом при каждом изменении паттернов,
        // поэтому hover всегда видит те же стрелки, что нарисованы на canvas.
        const ms = markerStateRef.current;
        const list = ms ? ms.markers() : [];
        if (!list || list.length === 0) { scheduleHide(); return; }
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        let bestIdx = -1;
        // Радиус попадания 24 px: маркер size:1 — это ~10 px стрелка; при
        // плотных барах курсор часто промахивался на пиксель-два мимо узкого
        // окна, и tooltip не показывался.
        let bestDist = 24;
        for (let i = 0; i < list.length; i++) {
          const px = chart.timeScale().timeToCoordinate(list[i].time as any);
          if (px === null) continue;
          const dist = Math.abs(px - x);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
        if (bestIdx >= 0) {
          const m: any = list[bestIdx];
          const entry = m && typeof m.__tip === 'string' ? m.__tip : '';
          if (!entry) { scheduleHide(); return; }
          const cx = chart.timeScale().timeToCoordinate(m.time as any) ?? x;
          // Y-якорь: bullish — под баром (стрелка belowBar), bearish — над баром.
          const cy = candlestickSeries.priceToCoordinate(m.position === 'belowBar' ? (m.__low ?? 0) : (m.__high ?? 0)) ?? y;
          tip.textContent = entry;
          tip.style.left = `${cx}px`;
          tip.style.top = m.position === 'belowBar' ? `${cy + 36}px` : `${Math.max(4, cy - 10)}px`;
          if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
          tip.style.display = 'block';
        } else {
          scheduleHide();
        }
      };

      const onMove = (ev: MouseEvent) => showAt(ev.clientX, ev.clientY);
      container.addEventListener('mousemove', onMove);
      // Touch (мобильные): раньше слушался только mousemove — на телефоне
      // tooltip не появлялся никогда.
      const onTouch = (ev: TouchEvent) => {
        const t0 = ev.touches[0];
        if (t0) showAt(t0.clientX, t0.clientY);
      };
      container.addEventListener('touchstart', onTouch, { passive: true });

      cleanupHoverRef.current = () => {
        container.removeEventListener('mousemove', onMove);
        container.removeEventListener('touchstart', onTouch);
        if (tip.parentNode) tip.parentNode.removeChild(tip);
        tipElRef.current = null;
      };
    }

    if (patterns.length > 0) {
      // По Нисону паттерн считается валидным только ПОСЛЕ подтверждения
      // следующей свечой — на графике рисуем исключительно подтверждённые
      // маркеры (это защита от «ложных» стрелок: неподтверждённая формация
      // может быть отменена следующей свечой). При равной уверенности выше
      // ставится тот паттерн, который подкреплён объёмом или уровнем S/R.
      // FIX (tooltip не показывался): раньше маркеры ставились ТОЛЬКО на
      // подтверждённые паттерны. Пока формация в статусе 'pending' (следующая
      // свеча ещё не закрылась в её направлении — у Нисона это почти всегда
      // последний бар), стрелка на график НЕ попадала. Пользователь видел
      // стрелку, рисованную другим слоем/старой сборкой, наводил курсор —
      // а в нашем списке маркеров её не было, и tooltip не появлялся.
      // Теперь рисуем все валидные паттерны; pending рисуются полупрозрачным
      // цветом, подтверждённые — сплошным.
      const confirmedPatterns = patterns
        .filter(p => p.candleIndex >= 0 && p.candleIndex < candles.length)
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
        // Ключ карты — ТОЛЬКО что округлённое время бара. Ровно это же значение
        // кладём в time маркера и ровно по нему ищем при наведении. Раньше
        // ключи строились из candle.time, а поиск шёл по m.time — при любом
        // расхождении (например, дробное время или пересборка массива) плашка
        // не появлялась вообще.
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
          // Pending-формации (ждут подтверждения следующей свечой) рисуем
          // полупрозрачным цветом, чтобы не путать с подтверждёнными.
          const baseColor = pattern.type === 'bullish' ? '#22c55e' : pattern.type === 'bearish' ? '#ef4444' : '#94a3b8';
          const color = pattern.confirmed ? baseColor : baseColor + '80'; // +alpha для pending
          // Уверенность: нормализуем долю 0–1 (контракт PatternDTO) к
          // проценту. Детектор всегда отдаёт 50–92, поэтому условие
          // «<= 1» больше не может съесть реальный низкий процент.
          const raw = pattern.confidence;
          const conf = raw > 0 && raw <= 1 ? raw * 100 : raw;
          const pct = Math.round(Math.min(100, Math.max(0, conf)));
          const pendingNote = pattern.confirmed ? '' : ' · ожидает подтверждения';
          const suffix = count > 1 ? ` · ещё ${count - 1}` : '';
          // Текст плашки заранее шьём прямо в маркер (__tip): hover-обработчик
          // живёт вне этого блока и берёт актуальные маркеры из состояния
          // createSeriesMarkers — без замыкания на конкретный рендер.
          const tipText = `${pattern.name} · ${pct}%${pendingNote}${suffix}`;
          return {
            time: markerTime as any,
            position: pattern.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
            color,
            shape: pattern.type === 'bullish' ? 'arrowUp' as const : pattern.type === 'bearish' ? 'arrowDown' as const : 'circle' as const,
            text: '', // название только в tooltip — чистый график без наложений
            size: 1,
            __tip: tipText,
            __low: candle.low,
            __high: candle.high,
          };
        });

        // Ключевое исправление №2: маркеры обновляются ЧЕРЕЗ существующее
        // состояние createSeriesMarkers, а не пересоздаются каждый раз.
        // Раньше здесь вызывался createSeriesMarkers(...) повторно на той же
        // серии — в lightweight-charts v5 это вешало второй обработчик
        // destroyOnSeriesDisconnect, который при перестройке графика убивал
        // ПЕРВОЕ хранилище маркеров: набор маркеров продолжал отрисовываться
        // на canvas (стрелки видно), но hover-логика смотрела в мёртвое/пустое
        // состояние — tooltip не появлялся никогда.
        const ms = markerStateRef.current;
        if (ms) ms.setMarkers(markers);
        else markerStateRef.current = createSeriesMarkers(candlestickSeries, markers);
      }
    }

    chart.timeScale().fitContent();

    // ResizeObserver: корректная перестройка при повороте экрана и смене размера контейнера
    const roContainer = chartContainerRef.current;
    const ro = new ResizeObserver(() => {
      if (roContainer) {
        chart.applyOptions({ width: roContainer.clientWidth });
      }
    });
    ro.observe(roContainer);

    return () => {
      ro.disconnect();
      if (cleanupHoverRef.current) {
        cleanupHoverRef.current();
        cleanupHoverRef.current = null;
      }
      markerStateRef.current = null;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, ema20, ema50, ema200, patterns, support, resistance, height]);

  return <div ref={chartContainerRef} className="w-full" style={{ touchAction: 'pan-y' }} />;
}
