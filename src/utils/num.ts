// Защита рендера от битых данных (Minified React error #310): если бэкенд,
// прокси или кэш вернули null/undefined/строку вместо числа, num() даёт 0 —
// .toFixed()/.toLocaleString() больше не падают и не рисуют мусор.
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
