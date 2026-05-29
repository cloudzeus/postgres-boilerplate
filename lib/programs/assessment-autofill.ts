// lib/programs/assessment-autofill.ts
import type { AnswerType, CompanyField } from './questionnaire-types';

export interface QuestionDraftWithId {
  id: string;
  answerType: AnswerType;
  companyField: CompanyField | null;
  options: { id: string; label: string }[];
}
export interface AutofillCompany {
  legalForm: string | null;
  employeeCount: number | null;
  foundingDate: Date | null;
  regionName: string | null;
}
export interface DraftAnswer {
  questionId: string;
  valueBool?: boolean | null;
  valueNumber?: number | null;
  valueText?: string | null;
  selectedOptionId?: string | null;
  source: 'AUTO' | 'MANUAL';
}

function norm(s: string): string { return s.replace(/[.\s]/g, '').toUpperCase(); }

function companyValue(field: CompanyField, c: AutofillCompany, asOf: Date): number | string | null {
  switch (field) {
    case 'employeeCount': return c.employeeCount;
    case 'operationalYears':
      return c.foundingDate ? (asOf.getTime() - c.foundingDate.getTime()) / (365.25 * 24 * 3600 * 1000) : null;
    case 'legalForm': return c.legalForm;
    case 'region': return c.regionName;
    case 'kad': return null; // ΚΑΔ auto-fill handled in eligibility, not as a scored answer
    default: return null;
  }
}

export function autofillAnswers(
  company: AutofillCompany,
  questions: QuestionDraftWithId[],
  asOf: Date,
): DraftAnswer[] {
  const out: DraftAnswer[] = [];
  for (const q of questions) {
    if (!q.companyField) continue;
    const val = companyValue(q.companyField, company, asOf);
    if (val == null) continue;
    if (q.answerType === 'NUMERIC' && typeof val === 'number') {
      out.push({ questionId: q.id, valueNumber: val, source: 'AUTO' });
    } else if (q.answerType === 'SINGLE_CHOICE' || q.answerType === 'SCALE') {
      const match = q.options.find((o) => norm(o.label) === norm(String(val)));
      if (match) out.push({ questionId: q.id, selectedOptionId: match.id, source: 'AUTO' });
    }
  }
  return out;
}
