// Вынос из Analysis.tsx (реконструкция): адаптивная высота графика.
// На узких экранах меньше, чтобы график влезал без дабл-скролла.

import { useEffect, useState } from 'react';

/** Брейкпоинты высоты: <480 → 320, <768 → 400, иначе 500 */
export function chartHeightForWidth(width: number): number {
  return width < 480 ? 320 : width < 768 ? 400 : 500;
}

export function useResponsiveChartHeight(): number {
  const [chartHeight, setChartHeight] = useState(() =>
    typeof window !== 'undefined' ? chartHeightForWidth(window.innerWidth) : 500);
  useEffect(() => {
    const onResize = () => setChartHeight(chartHeightForWidth(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return chartHeight;
}
