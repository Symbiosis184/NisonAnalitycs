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

    // Добавляем маркеры паттернов - только самый важный (топ-1 по confidence)
    if (patterns.length > 0) {
      // Сортируем по confidence и берем только топ-1
      const sortedPatterns = [...patterns]
        .filter(p => p.candleIndex >= 0 && p.candleIndex < candles.length)
        .sort((a, b) => b.confidence - a.confidence);
      
      const topPattern = sortedPatterns[0];
      
      if (topPattern) {
        const candle = candles[topPattern.candleIndex];
        const marker = {
          time: (candle.time / 1000) as any,
          position: topPattern.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
          color: topPattern.type === 'bullish' ? '#22c55e' : topPattern.type === 'bearish' ? '#ef4444' : '#94a3b8',
          shape: topPattern.type === 'bullish' ? 'arrowUp' as const : topPattern.type === 'bearish' ? 'arrowDown' as const : 'circle' as const,
          text: topPattern.confirmed ? `✓ ${topPattern.name}` : topPattern.name,
          size: topPattern.confirmed ? 2 : 1.5,
        };

        createSeriesMarkers(candlestickSeries, [marker]);
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
