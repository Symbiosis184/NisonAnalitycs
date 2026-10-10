import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';

interface Candle {
  time: number;
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
  height?: number;
}

export default function CandlestickChart({ candles, ema20, ema50, ema200, height = 500 }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

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

    // Добавляем EMA линии
    if (ema20 && ema20.length > 0) {
      const ema20Series = chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        priceLineVisible: false,
      });
      const ema20Data = ema20.map((value, index) => ({
        time: (candles[index].time / 1000) as any,
        value,
      }));
      ema20Series.setData(ema20Data);
    }

    if (ema50 && ema50.length > 0) {
      const ema50Series = chart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 1,
        priceLineVisible: false,
      });
      const ema50Data = ema50.map((value, index) => ({
        time: (candles[index].time / 1000) as any,
        value,
      }));
      ema50Series.setData(ema50Data);
    }

    if (ema200 && ema200.length > 0) {
      const ema200Series = chart.addSeries(LineSeries, {
        color: '#a855f7',
        lineWidth: 1,
        priceLineVisible: false,
      });
      const ema200Data = ema200.map((value, index) => ({
        time: (candles[index].time / 1000) as any,
        value,
      }));
      ema200Series.setData(ema200Data);
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
      chart.remove();
    };
  }, [candles, ema20, ema50, ema200, height]);

  return <div ref={chartContainerRef} className="w-full" />;
}
