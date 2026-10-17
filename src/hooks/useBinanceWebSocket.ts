// WebSocket хук для получения real-time цен с Binance
import { useEffect, useRef, useState } from 'react';
import { isValidSymbol } from '../utils/validation';

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
    // Фильтруем некорректные символы (защита от инъекции в URL потока Binance)
    const validSymbols = symbols.filter(isValidSymbol);
    if (validSymbols.length === 0) return;

    // Создаем WebSocket подключение к Binance
    const streamName = validSymbols.map(s => s.toLowerCase().trim()).join('/');
    const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}@ticker`;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
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
          if (disposed) return;
          console.log('WebSocket closed, reconnecting in 5s...');
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch (error) {
        console.error('Error creating WebSocket:', error);
        if (!disposed) reconnectTimer = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // предотвращаем переподключение после unmount
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbols.join(',')]);

  return prices;
}
