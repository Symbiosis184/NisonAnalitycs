// WebSocket хук для получения real-time цен с Binance
import { useEffect, useRef, useState } from 'react';

interface TickerData {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
}

export function useBinanceWebSocket(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, TickerData>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (symbols.length === 0) return;

    // Создаем WebSocket подключение к Binance
    const streamName = symbols.map(s => s.toLowerCase()).join('/');
    const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}@ticker`;

    const connect = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('WebSocket connected to Binance');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Обновляем цену для символа
            if (data.s && data.c) {
              setPrices(prev => ({
                ...prev,
                [data.s]: {
                  symbol: data.s,
                  price: parseFloat(data.c),
                  priceChange: parseFloat(data.p),
                  priceChangePercent: parseFloat(data.P),
                }
              }));
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
          console.log('WebSocket closed, reconnecting in 5s...');
          setTimeout(connect, 5000);
        };
      } catch (error) {
        console.error('Error creating WebSocket:', error);
        setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbols.join(',')]);

  return prices;
}
