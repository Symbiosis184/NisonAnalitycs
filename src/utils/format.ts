export function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return price.toLocaleString('ru-RU', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
  return vol.toFixed(0);
}

export function formatPercent(value: number, decimals: number = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}
