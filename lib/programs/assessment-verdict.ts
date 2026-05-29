import type { AssessmentVerdict } from '@prisma/client';

export function computeVerdict(eligible: boolean, questionnairePassed: boolean | null): AssessmentVerdict {
  if (!eligible) return 'NOT_ELIGIBLE';
  if (questionnairePassed === false) return 'NEEDS_REVIEW';
  return 'ELIGIBLE';
}
