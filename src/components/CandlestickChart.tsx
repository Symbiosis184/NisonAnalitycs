import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Pattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  candleIndex: number;
  confidence: number;
  confirmed: boolean;
}

interface Zone {
  level: number;
  votes: number;
  strong: boolean;
  reasons: string[];
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

    // Добавляем только СИЛЬНЫЕ уровни поддержки (зелёные)
    const strongSupport = support.filter(zone => zone.strong);
    strongSupport.forEach((zone, idx) => {
      const line = candlestickSeries.createPriceLine({
        price: zone.level,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: 0, // solid
        axisLabelVisible: true,
        title: `П${idx + 1} (${zone.votes}гол)`,
      });
    });

    // Добавляем только СИЛЬНЫЕ уровни сопротивления (красные)
    const strongResistance = resistance.filter(zone => zone.strong);
    strongResistance.forEach((zone, idx) => {
      const line = candlestickSeries.createPriceLine({
        price: zone.level,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 0, // solid
        axisLabelVisible: true,
        title: `С${idx + 1} (${zone.votes}гол)`,
      });
    });

    // Добавляем маркеры ВСЕХ подтверждённых паттернов
    if (patterns.length > 0) {
      // Фильтруем только подтверждённые паттерны
      const confirmedPatterns = patterns
        .filter(p => p.confirmed && p.candleIndex >= 0 && p.candleIndex < candles.length)
        .sort((a, b) => b.confidence - a.confidence);
      
      if (confirmedPatterns.length > 0) {
        const markers = confirmedPatterns.map(pattern => {
          const candle = candles[pattern.candleIndex];
          return {
            time: (candle.time / 1000) as any,
            position: pattern.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
            color: pattern.type === 'bullish' ? '#22c55e' : pattern.type === 'bearish' ? '#ef4444' : '#94a3b8',
            shape: pattern.type === 'bullish' ? 'arrowUp' as const : pattern.type === 'bearish' ? 'arrowDown' as const : 'circle' as const,
            text: `✓ ${pattern.name}`,
            size: 2,
          };
        });

        createSeriesMarkers(candlestickSeries, markers);
      }
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, ema20, ema50, ema200, patterns, support, resistance, height]);

  return <div ref={chartContainerRef} className="w-full" />;
}
