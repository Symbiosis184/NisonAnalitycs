// Методы из книги Стива Нисона «За гранью японских свечей».
// Все построения используют только переданные закрытые значения и не содержат
// торговых обещаний: это преобразования ценового ряда, а не сигналы сами по себе.

export interface ClosePoint {
  time: number;
  close: number;
}

export interface DisparityPoint extends ClosePoint {
  movingAverage: number;
  /** ((close - SMA) / SMA) * 100; NaN до накопления полного окна SMA. */
  disparity: number;
}

export function disparityIndex(
  points: ClosePoint[],
  period: number = 13,
): DisparityPoint[] {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError('Период индекса разницы должен быть положительным целым числом');
  }
  let rollingSum = 0;
  return points.map((point, i) => {
    rollingSum += point.close;
    if (i >= period) rollingSum -= points[i - period].close;
    const movingAverage = i >= period - 1 ? rollingSum / period : NaN;
    const disparity = Number.isFinite(movingAverage) && movingAverage !== 0
      ? ((point.close - movingAverage) / movingAverage) * 100
      : NaN;
    return { ...point, movingAverage, disparity };
  });
}

export type ChartDirection = 'up' | 'down';

export interface ThreeLineBreakLine {
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  direction: ChartDirection;
  reversal: boolean;
}

/**
 * Three-line break по закрытиям. Касания недостаточны: продолжение требует
 * превышения экстремума последней линии, разворот — выхода за диапазон одной,
 * двух или трёх предыдущих линий в зависимости от уже построенной серии.
 */
export function threeLineBreak(points: ClosePoint[]): ThreeLineBreakLine[] {
  const clean = points.filter(p => Number.isFinite(p.close));
  if (clean.length === 0) return [];
  const base = clean[0];
  const lines: ThreeLineBreakLine[] = [];

  const pushLine = (
    point: ClosePoint,
    startPrice: number,
    direction: ChartDirection,
    reversal: boolean,
  ) => {
    lines.push({
      startTime: lines.length === 0 ? base.time : lines[lines.length - 1].endTime,
      endTime: point.time,
      startPrice,
      endPrice: point.close,
      direction,
      reversal,
    });
  };

  for (const point of clean.slice(1)) {
    const last = lines[lines.length - 1];
    if (!last) {
      if (point.close > base.close) pushLine(point, base.close, 'up', false);
      else if (point.close < base.close) pushLine(point, base.close, 'down', false);
      continue;
    }

    if (last.direction === 'up' && point.close > last.endPrice) {
      pushLine(point, last.endPrice, 'up', false);
      continue;
    }
    if (last.direction === 'down' && point.close < last.endPrice) {
      pushLine(point, last.endPrice, 'down', false);
      continue;
    }

    const relevant = lines.slice(-3);
    if (last.direction === 'up') {
      const reversalBelow = Math.min(
        ...relevant.flatMap(line => [line.startPrice, line.endPrice]),
      );
      if (point.close < reversalBelow) pushLine(point, last.endPrice, 'down', true);
    } else {
      const reversalAbove = Math.max(
        ...relevant.flatMap(line => [line.startPrice, line.endPrice]),
      );
      if (point.close > reversalAbove) pushLine(point, last.endPrice, 'up', true);
    }
  }
  return lines;
}

export interface RenkoBrick {
  startTime: number;
  endTime: number;
  open: number;
  close: number;
  direction: ChartDirection;
  reversal: boolean;
}

/** Renko с фиксированным кирпичом; одно закрытие может создать несколько кирпичей. */
export function renko(points: ClosePoint[], brickSize: number): RenkoBrick[] {
  if (!Number.isFinite(brickSize) || brickSize <= 0) {
    throw new RangeError('Размер кирпича Renko должен быть положительным числом');
  }
  const clean = points.filter(p => Number.isFinite(p.close));
  if (clean.length === 0) return [];
  const base = clean[0];
  const bricks: RenkoBrick[] = [];
  let anchorTime = base.time;
  let anchorPrice = base.close;
  let direction: ChartDirection | null = null;

  for (const point of clean.slice(1)) {
    const delta = point.close - anchorPrice;
    const continuation: boolean = direction === null
      ? Math.abs(delta) >= brickSize
      : direction === 'up'
        ? delta >= brickSize
        : delta <= -brickSize;
    const reversal = direction !== null && !continuation && (
      direction === 'up' ? delta <= -2 * brickSize : delta >= 2 * brickSize
    );
    if (!continuation && !reversal) continue;

    const nextDirection: ChartDirection = continuation
      ? direction ?? (delta > 0 ? 'up' : 'down')
      : direction === 'up' ? 'down' : 'up';
    const count = Math.floor(Math.abs(delta) / brickSize);
    if (count < 1) continue;

    const step = nextDirection === 'up' ? brickSize : -brickSize;
    for (let j = 0; j < count; j++) {
      const open = anchorPrice + step * j;
      bricks.push({
        // P2-3 (ЗГ, раздел Renko): кирпич относится к бару point.time — именно его
        // закрытие его построило. Нулевая длительность (startTime === endTime) не
        // допускается даже когда время бара совпадает с якорем стартового закрытия.
        startTime: Math.min(anchorTime, point.time),
        endTime: point.time,
        open,
        close: open + step,
        direction: nextDirection,
        reversal: j === 0 && reversal,
      });
    }
    anchorPrice += step * count;
    anchorTime = point.time;
    direction = nextDirection;
  }
  return bricks;
}

export interface KagiReversalSetting {
  type: 'fixed' | 'percent';
  value: number;
}

export interface KagiSegment {
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  direction: ChartDirection;
  reversal: boolean;
  /** Тонкая инь или толстая ян по превышению предыдущего плеча/талии. */
  style: 'yin' | 'yang';
}

/** Kagi по закрытиям с фиксированным или процентным порогом разворота. */
export function kagi(
  points: ClosePoint[],
  reversal: KagiReversalSetting,
): KagiSegment[] {
  if (!Number.isFinite(reversal.value) || reversal.value <= 0) {
    throw new RangeError('Порог разворота Kagi должен быть положительным числом');
  }
  const clean = points.filter(p => Number.isFinite(p.close));
  if (clean.length === 0) return [];
  const base = clean[0];
  const segments: KagiSegment[] = [];
  let anchorTime = base.time;
  let anchorPrice = base.close;
  let direction: ChartDirection | null = null;
  let style: 'yin' | 'yang' = 'yin';
  let previousShoulder: number | null = null;
  let previousWaist: number | null = null;

  const thresholdAt = (price: number) => reversal.type === 'percent'
    ? Math.abs(price) * reversal.value / 100
    : reversal.value;
  const updateStyle = (price: number) => {
    if (previousShoulder !== null && price > previousShoulder) style = 'yang';
    if (previousWaist !== null && price < previousWaist) style = 'yin';
  };

  for (const point of clean.slice(1)) {
    if (direction === null) {
      if (Math.abs(point.close - anchorPrice) < thresholdAt(anchorPrice)) continue;
      direction = point.close > anchorPrice ? 'up' : 'down';
      updateStyle(point.close);
      segments.push({
        startTime: anchorTime, endTime: point.time,
        startPrice: anchorPrice, endPrice: point.close,
        direction, reversal: false, style,
      });
      anchorTime = point.time;
      anchorPrice = point.close;
      continue;
    }

    const currentDirection: ChartDirection = direction;
    const extendsLine: boolean = currentDirection === 'up'
      ? point.close > anchorPrice
      : point.close < anchorPrice;
    const reverse: boolean = currentDirection === 'up'
      ? anchorPrice - point.close >= thresholdAt(anchorPrice)
      : point.close - anchorPrice >= thresholdAt(anchorPrice);
    if (!extendsLine && !reverse) continue;

    const nextDirection: ChartDirection = extendsLine
      ? currentDirection
      : currentDirection === 'up' ? 'down' : 'up';
    if (!extendsLine) {
      if (currentDirection === 'up') previousShoulder = anchorPrice;
      else previousWaist = anchorPrice;
    }
    updateStyle(point.close);
    direction = nextDirection;
    segments.push({
      startTime: anchorTime, endTime: point.time,
      startPrice: anchorPrice, endPrice: point.close,
      direction, reversal: !extendsLine, style,
    });
    anchorTime = point.time;
    anchorPrice = point.close;
  }
  return segments;
}
