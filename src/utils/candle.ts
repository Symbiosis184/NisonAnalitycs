export class Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;

  constructor(data: { time: number; open: number; high: number; low: number; close: number; volume: number }) {
    this.time = data.time;
    this.open = data.open;
    this.high = data.high;
    this.low = data.low;
    this.close = data.close;
    this.volume = data.volume;
  }

  get body(): number {
    return Math.abs(this.close - this.open);
  }

  get bodyTop(): number {
    return Math.max(this.open, this.close);
  }

  get bodyBottom(): number {
    return Math.min(this.open, this.close);
  }

  get bodyMid(): number {
    return (this.open + this.close) / 2;
  }

  get totalRange(): number {
    return this.high - this.low;
  }

  get upperWick(): number {
    return this.high - this.bodyTop;
  }

  get lowerWick(): number {
    return this.bodyBottom - this.low;
  }

  get isBullish(): boolean {
    return this.close > this.open;
  }

  get isBearish(): boolean {
    return this.close < this.open;
  }

  // P3-1: проектное решение — свеча с нулевым диапазоном (O=H=L=C) НЕ считается
  // дожи: это признак неликвидности/отсутствия торгов, а не каноническая модель
  // нерешительности Нисона (ЯС, гл. «Доджи»). totalRange === 0 → false.
  get isDoji(): boolean {
    if (this.totalRange <= 0) return false;
    return this.body < this.totalRange * 0.1;
  }

  get isLongCandle(): boolean {
    return this.body > this.totalRange * 0.6;
  }

  get isShortCandle(): boolean {
    return this.body < this.totalRange * 0.3;
  }

  // P3-2: проектное ужесточение — строгие неравенства отсекают поглощение с
  // равенством границ тел (в книге Нисона такое тоже поглощение). Поведение
  // намеренно не меняем; зафиксировано как ограничение реализации.
  isEngulfing(other: Candle): boolean {
    return this.bodyTop > other.bodyTop && this.bodyBottom < other.bodyBottom;
  }

  isInside(other: Candle): boolean {
    return this.high < other.high && this.low > other.low;
  }

  // P1-3: канон ЯС, глава «Окна» (гэп = разрыв ДИАПАЗОНОВ свечей, а не open-vs-close;
  // см. корректную реализацию в gaps.ts). Прежняя семантика `open < other.close`
  // противоречила канону; использований в коде/тестах не было.
  gapDownFrom(other: Candle): boolean {
    return this.high < other.low;
  }

  gapUpFrom(other: Candle): boolean {
    return this.low > other.high;
  }
}
