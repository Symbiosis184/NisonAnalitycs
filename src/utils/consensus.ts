// Consensus Score по канону Стива Нисона: консенсус — это СОГЛАСИЕ факторов
// (подтверждённых свечных сценариев, усиленных объёмом и уровнями S/R) вокруг
// одной идеи, а не сумма голосов. Противоречивые сигналы (long+short) — шум,
// они не должны поднимать оценку.
export interface ConsensusInput {
  direction: 'long' | 'short';
  quality: number; // 0..1 — качество сигнала (объём/уровень/форма)
}

export interface ConsensusResult {
  score: number;        // 0..5
  confidence: number;   // 0..95 %
  direction: 'buy' | 'sell' | 'neutral';
}

/** Взвешенный вес сигнала: базовый + буст за сильное подтверждение объёмом. */
const weight = (s: ConsensusInput): number => {
  const volBoost = s.quality >= 0.75 ? 1.25 : s.quality >= 0.6 ? 1.0 : 0.8;
  return (0.5 + s.quality) * volBoost;
};

export function aggregateConsensus(signals: ConsensusInput[]): ConsensusResult {
  let bullW = 0;
  let bearW = 0;
  for (const s of signals) {
    if (s.direction === 'long') bullW += weight(s); else bearW += weight(s);
  }
  const totalW = bullW + bearW;
  const ratio = totalW === 0 ? 0 : Math.abs(bullW - bearW) / totalW; // 0..1 согласие

  // Порог согласия: ниже 20% — направления нет (взаимное гашение сигналов).
  if (totalW === 0 || ratio < 0.2) {
    return { score: 0, confidence: 0, direction: 'neutral' };
  }

  const agreeCount = Math.max(
    signals.filter((s) => s.direction === 'long').length,
    signals.filter((s) => s.direction === 'short').length,
  );

  // Базовый балл за силу согласия (max 4) + небольшой бонус за «широту
  // консенсуса» (несколько независимых сигналов в одну сторону, max 1).
  const score = Math.min(5, ratio * 4 + Math.min(1, (agreeCount - 1) * 0.25));
  // Уверенность начинается с нуля: нет согласия → 0%, а не «40% ни за что».
  const confidence = Math.min(95, Math.round(ratio * 70 + Math.min(25, agreeCount * 5)));
  const direction: ConsensusResult['direction'] = bullW > bearW ? 'buy' : 'sell';

  return { score, confidence, direction };
}
