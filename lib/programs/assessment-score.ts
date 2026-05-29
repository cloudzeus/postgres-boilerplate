// lib/programs/assessment-score.ts
// Pure scoring engine. No I/O, no Date — safe to run on client (live preview) and server.
import type {
  ScoringModel, ScoringQuestion, ScoringAnswer, ScoreResult,
} from './questionnaire-types';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Points awarded for one answer, derived from the question's type. */
export function awardPoints(q: ScoringQuestion, a: ScoringAnswer | undefined): number {
  const max = q.maxPoints ?? 0;
  if (!a) return 0;
  switch (q.answerType) {
    case 'SINGLE_CHOICE':
    case 'SCALE': {
      const opt = q.options.find((o) => o.id === a.selectedOptionId);
      return opt ? opt.points : 0;
    }
    case 'BOOLEAN':
      return a.valueBool ? max : 0;
    case 'NUMERIC':
      return clamp(a.valueNumber ?? 0, 0, max || Number.POSITIVE_INFINITY);
    default:
      return 0;
  }
}

export function computeScore(
  model: ScoringModel,
  threshold: number | null,
  maxScore: number | null,
  questions: ScoringQuestion[],
  answers: ScoringAnswer[],
): ScoreResult {
  const byQ = new Map(answers.map((a) => [a.questionId, a]));
  if (model === 'POINTS_SUM') {
    const score = questions.reduce((sum, q) => sum + awardPoints(q, byQ.get(q.id)), 0);
    const max = maxScore ?? questions.reduce((s, q) => s + (q.maxPoints ?? 0), 0);
    return { score, maxScore: max, passed: threshold == null ? true : score >= threshold };
  }
  // WEIGHTED
  let weightedSum = 0;
  let totalWeight = 0;
  for (const q of questions) {
    const w = q.weight ?? 0;
    if (w <= 0) continue;
    const ceil = q.maxPoints ?? 0;
    const fraction = ceil > 0 ? clamp(awardPoints(q, byQ.get(q.id)) / ceil, 0, 1) : 0;
    weightedSum += fraction * w;
    totalWeight += w;
  }
  const max = maxScore ?? 100;
  const score = totalWeight > 0 ? (weightedSum / totalWeight) * max : 0;
  return { score, maxScore: max, passed: threshold == null ? true : score >= threshold };
}
