// Consensus Score — эвристика проекта по мотивам правила множества технических
// приёмов: оценивается согласие сценариев, а не простое количество сигналов.
// Веса и пороги не взяты из книг; confidence не является вероятностью прибыли.
export interface ConsensusInput {
  direction: 'long' | 'short';
  quality: number; // 0..1 — качество сигнала (объём/уровень/форма)
  /** Повторы одной модели в окне — один фактор, а не новый независимый голос. */
  pattern?: string;
}

export interface ConsensusResult {
  score: number;        // 0..5
  confidence: number;   // эвристический балл согласия 0..95, не вероятность
  direction: 'buy' | 'sell' | 'neutral';
}

/** Приведение качества к безопасному диапазону [0, 1] (защита от NaN/misfire). */
const safeQuality = (q: number): number => (Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : 0);

/** Непрерывный вес направления: качество усиливает сигнал без скачков по порогам. */
const weight = (s: ConsensusInput): number => 0.5 + safeQuality(s.quality);

export function aggregateConsensus(signals: ConsensusInput[]): ConsensusResult {
  // Пропускаем сигналы с нечисловым качеством/направлением — иначе один
  // бракованный элемент превращает весь score/confidence в NaN.
  const valid = signals.filter(
    (s) => Number.isFinite(s.quality) && (s.direction === 'long' || s.direction === 'short'),
  );

  // Один тип модели в одну сторону — один независимый фактор. Повторы не должны
  // накапливать «широту»; оставляем наиболее качественное подтверждение фактора.
  const independent = new Map<string, ConsensusInput>();
  valid.forEach((signal, index) => {
    const pattern = signal.pattern?.trim().toUpperCase();
    const key = pattern ? `${signal.direction}:${pattern}` : `${signal.direction}:anonymous:${index}`;
    const previous = independent.get(key);
    if (!previous || safeQuality(signal.quality) > safeQuality(previous.quality)) {
      independent.set(key, signal);
    }
  });
  const factors = [...independent.values()];

  let bullW = 0;
  let bearW = 0;
  for (const s of factors) {
    if (s.direction === 'long') bullW += weight(s); else bearW += weight(s);
  }
  const totalW = bullW + bearW;
  const ratio = totalW === 0 ? 0 : Math.abs(bullW - bearW) / totalW;

  // Порог согласия: ниже 20% — направления нет (взаимное гашение сигналов).
  if (totalW === 0 || ratio < 0.2) {
    return { score: 0, confidence: 0, direction: 'neutral' };
  }

  const direction: ConsensusResult['direction'] = bullW > bearW ? 'buy' : 'sell';
  const dominantDirection = direction === 'buy' ? 'long' : 'short';
  const agreeing = factors.filter((s) => s.direction === dominantDirection);
  const agreeCount = agreeing.length;
  const meanQuality = agreeing.reduce((sum, s) => sum + safeQuality(s.quality), 0) / agreeCount;

  // Консенсус требует нескольких независимых подтверждений. Один сигнал даёт
  // лишь треть возможной широты, два — две трети, три и больше — полную широту.
  const breadth = Math.min(1, agreeCount / 3);
  const qualityFactor = 0.5 + meanQuality / 2;

  // Score учитывает направленное согласие, независимую широту и качество.
  // Поэтому одиночный сигнал не может получить 4/5, а слабые и сильные наборы
  // одинакового направления больше не выглядят одинаково.
  const score = 5 * ratio * breadth * qualityFactor;
  // B2 (вариант B, PR #40): confidence — «Широта согласия» (балл 0..95, в UI
  // отображается без «%»). Качество учитывается в score (× qualityFactor),
  // а не здесь: набор из трёх слабых и набор из трёх сильных подтверждений
  // одинаково широки по направлению. Метрика НЕ является вероятностью прибыли.
  const confidence = Math.min(95, Math.round(ratio * breadth * 100));

  return { score, confidence, direction };
}
