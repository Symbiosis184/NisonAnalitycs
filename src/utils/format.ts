export function formatPrice(price: number): string {
  // Защита от нечисловых/неконечных значений (NaN, undefined, Infinity):
  // toLocaleString(NaN) возвращает строку "NaN", а React при рендере
  // нетипизированных объектов бросает Minified React error #310.
  if (typeof price !== 'number' || !Number.isFinite(price)) return '—';
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

/**
 * Форматирование момента подтверждения формации (мс) для вкладки
 * «Подтверждённые паттерны»: на дневном/недельном ТФ достаточно даты,
 * на внутридневных — дата + время (закрытие подтверждающей свечи).
 */
export function formatConfirmedTime(ms: number | null | undefined, timeframe?: string): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const tf = String(timeframe ?? '').trim().toUpperCase();
  const intraday = !(tf === 'D' || tf === '1D' || tf === 'W' || tf === '1W');
  const d = new Date(ms);
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  if (!intraday) return date;
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
