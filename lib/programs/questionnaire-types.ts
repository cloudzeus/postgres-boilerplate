// Shared types for the self-assessment questionnaire + scoring/eligibility engines.
// Kept dependency-free so both server (Prisma rows) and client (live calc) can import.

export type ScoringModel = 'WEIGHTED' | 'POINTS_SUM';
export type AnswerType = 'BOOLEAN' | 'SINGLE_CHOICE' | 'NUMERIC' | 'SCALE';

// Mapping keys that allow auto-filling an answer from a company's stored data.
export type CompanyField = 'legalForm' | 'operationalYears' | 'employeeCount' | 'region' | 'kad';

export interface QuestionOptionDraft {
  label: string;
  points: number;
}

export interface QuestionDraft {
  code: string | null;
  text: string;
  criterionRef: string | null;
  helpText: string | null;
  answerType: AnswerType;
  weight: number | null;       // WEIGHTED model
  maxPoints: number | null;    // POINTS_SUM / per-question ceiling
  companyField: CompanyField | null;
  options: QuestionOptionDraft[];
}

export interface QuestionnaireDraft {
  scoringModel: ScoringModel;
  threshold: number | null;
  maxScore: number | null;
  sourceNote: string | null;
  questions: QuestionDraft[];
}

// ---- Scoring engine shapes (id-based, used at runtime against DB rows) ----

export interface ScoringOption { id: string; points: number }

export interface ScoringQuestion {
  id: string;
  answerType: AnswerType;
  weight: number | null;
  maxPoints: number | null;
  options: ScoringOption[];
}

export interface ScoringAnswer {
  questionId: string;
  valueBool?: boolean | null;
  valueNumber?: number | null;
  selectedOptionId?: string | null;
}

export interface ScoreResult {
  score: number;
  maxScore: number;
  passed: boolean;
}
