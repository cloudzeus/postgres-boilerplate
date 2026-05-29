# Program Self-Assessment Questionnaire & Company Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Όταn το DeepSeek εντοπίζει κριτήριο αυτοαξιολόγησης με κατώφλι, παράγει αυτόματα ένα editable ερωτηματολόγιο στο πρόγραμμα· ο admin αξιολογεί εταιρίες (έλεγχος βασικών κριτηρίων + ερωτηματολόγιο) με σκορ & PASS/FAIL, αποθηκευμένα ανά εταιρία.

**Architecture:** Relational, editable ορισμός ερωτηματολογίου στο `Program` (Προσέγγιση C). Pure-function engines (scoring/eligibility/autofill) με TDD μέσω vitest. Δεύτερη αποκλειστική κλήση DeepSeek για τη γέννηση. Company-centric evaluation flow με entry point στο actions-dropdown εταιρίας. Αποτελέσματα σε `CompanyAssessment` (πολλές εταιρίες ανά πρόγραμμα).

**Tech Stack:** Next.js (App Router), Prisma + MySQL, vitest, DeepSeek (deepseek-chat/reasoner), shadcn/ui, react-icons/fi, sonner.

**Spec:** [docs/superpowers/specs/2026-05-29-program-self-assessment-design.md](../specs/2026-05-29-program-self-assessment-design.md)

---

## File Structure

**Create:**
- `lib/programs/questionnaire-types.ts` — shared TS types (no deps, imported by engines + UI)
- `lib/programs/assessment-score.ts` — pure scoring engine (WEIGHTED / POINTS_SUM)
- `lib/programs/__tests__/assessment-score.test.ts`
- `lib/programs/eligibility.ts` — pure βασικά-κριτήρια engine
- `lib/programs/__tests__/eligibility.test.ts`
- `lib/programs/assessment-autofill.ts` — pure auto-fill engine (company → answers)
- `lib/programs/__tests__/assessment-autofill.test.ts`
- `lib/programs/questionnaire.ts` — `generateQuestionnaire()` (DeepSeek call) + `persistQuestionnaire()`
- `lib/programs/questionnaire-prompt.ts` — focused system prompt για τη γέννηση
- `app/api/admin/programs/[id]/questionnaire/generate/route.ts`
- `app/api/admin/programs/[id]/questionnaire/route.ts` (PATCH)
- `app/api/admin/programs/[id]/assessments/route.ts` (GET list — program side)
- `app/api/admin/companies/[id]/assessments/route.ts` (GET list + POST create)
- `app/api/admin/companies/[id]/assessments/[assessmentId]/route.ts` (PATCH save + recompute)
- `app/admin/programs/[id]/questionnaire-tab.tsx` — editable tab component
- `components/companies/assessment-dialog.tsx` — company evaluation dialog

**Modify:**
- `prisma/schema.prisma` — new models + enums + back-relations on `Program`, `Company`
- `lib/programs/templates.ts` — add `selfAssessment` to output schema
- `lib/programs/extract.ts` — surface `selfAssessment` (no logic change, it passes through `data`)
- `app/api/admin/programs/[id]/route.ts` — include questionnaire in GET
- `app/api/admin/programs/route.ts` & `app/api/admin/programs/[id]/reextract/route.ts` — best-effort auto-generate trigger
- `app/admin/programs/[id]/page.tsx` — include questionnaire in query
- `app/admin/programs/[id]/editor.tsx` — wire new tab
- `app/admin/companies/companies-view.tsx` — new dropdown action + dialog wiring

---

## Phase 1 — Data model & pure engines

### Task 1: Prisma schema — questionnaire & assessment models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums + models**

Append at the end of `prisma/schema.prisma`:

```prisma
// ============================================================
// Self-assessment questionnaire (per Program) & company evaluation
// ============================================================

enum QuestionnaireScoringModel { WEIGHTED  POINTS_SUM }
enum QuestionnaireStatus       { DRAFT  READY }
enum QuestionAnswerType        { BOOLEAN  SINGLE_CHOICE  NUMERIC  SCALE }
enum AssessmentStatus          { DRAFT  COMPLETED }
enum AssessmentVerdict         { ELIGIBLE  NOT_ELIGIBLE  NEEDS_REVIEW }
enum AnswerSource              { AUTO  MANUAL }

model ProgramQuestionnaire {
  id             String   @id @default(cuid())
  programId      String   @unique
  program        Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  title          String?
  description    String?  @db.Text
  scoringModel   QuestionnaireScoringModel @default(WEIGHTED)
  threshold      Decimal? @db.Decimal(8, 2)
  maxScore       Decimal? @db.Decimal(8, 2)
  sourceNote     String?
  status         QuestionnaireStatus @default(DRAFT)
  generatedModel String?
  generatedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  questions      ProgramQuestion[]
  assessments    CompanyAssessment[]
}

model ProgramQuestion {
  id              String   @id @default(cuid())
  questionnaireId String
  questionnaire   ProgramQuestionnaire @relation(fields: [questionnaireId], references: [id], onDelete: Cascade)
  code            String?
  text            String   @db.Text
  criterionRef    String?
  helpText        String?  @db.Text
  answerType      QuestionAnswerType @default(SINGLE_CHOICE)
  weight          Decimal? @db.Decimal(8, 2)
  maxPoints       Decimal? @db.Decimal(8, 2)
  companyField    String?
  order           Int      @default(0)
  options         ProgramQuestionOption[]
  answers         AssessmentAnswer[]
  @@index([questionnaireId])
}

model ProgramQuestionOption {
  id          String  @id @default(cuid())
  questionId  String
  question    ProgramQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)
  label       String
  points      Decimal @default(0) @db.Decimal(8, 2)
  order       Int     @default(0)
  @@index([questionId])
}

model CompanyAssessment {
  id                  String   @id @default(cuid())
  companyId           String
  company             Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  programId           String
  program             Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  questionnaireId     String?
  questionnaire       ProgramQuestionnaire? @relation(fields: [questionnaireId], references: [id], onDelete: SetNull)
  eligible            Boolean?
  eligibilityResult   Json?
  questionnaireScore  Decimal? @db.Decimal(8, 2)
  questionnaireMax    Decimal? @db.Decimal(8, 2)
  questionnairePassed Boolean?
  overallVerdict      AssessmentVerdict @default(NEEDS_REVIEW)
  status              AssessmentStatus  @default(DRAFT)
  notes               String?  @db.Text
  createdById         String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  answers             AssessmentAnswer[]
  @@index([companyId])
  @@index([programId])
  @@index([programId, eligible])
}

model AssessmentAnswer {
  id               String  @id @default(cuid())
  assessmentId     String
  assessment       CompanyAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)
  questionId       String
  question         ProgramQuestion   @relation(fields: [questionId], references: [id], onDelete: Cascade)
  valueBool        Boolean?
  valueNumber      Decimal? @db.Decimal(14, 4)
  valueText        String?  @db.Text
  selectedOptionId String?
  pointsAwarded    Decimal? @db.Decimal(8, 2)
  source           AnswerSource @default(MANUAL)
  @@index([assessmentId])
  @@index([questionId])
}
```

- [ ] **Step 2: Add back-relations on existing models**

In `model Program { ... }` (after the existing relations block, e.g. after `files ProgramFile[]`):

```prisma
  questionnaire   ProgramQuestionnaire?
  assessments     CompanyAssessment[]
```

In `model Company { ... }` (with the other relations):

```prisma
  assessments     CompanyAssessment[]
```

- [ ] **Step 3: Create migration**

Run: `npx prisma migrate dev --name program_self_assessment`
Expected: migration created + applied, `prisma generate` runs, no errors. If MySQL not reachable, run `npx prisma generate` alone and note migration must be applied later.

- [ ] **Step 4: Verify client typegen**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". Confirms model names compile.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(programs): schema for self-assessment questionnaire & company assessments"
```

---

### Task 2: Shared questionnaire types

**Files:**
- Create: `lib/programs/questionnaire-types.ts`

- [ ] **Step 1: Write the types file**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep questionnaire-types || echo "OK no errors in file"`
Expected: `OK no errors in file`

- [ ] **Step 3: Commit**

```bash
git add lib/programs/questionnaire-types.ts
git commit -m "feat(programs): shared self-assessment types"
```

---

### Task 3: Scoring engine (TDD)

**Files:**
- Create: `lib/programs/assessment-score.ts`
- Test: `lib/programs/__tests__/assessment-score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { awardPoints, computeScore } from '../assessment-score';
import type { ScoringQuestion, ScoringAnswer } from '../questionnaire-types';

const single: ScoringQuestion = {
  id: 'q1', answerType: 'SINGLE_CHOICE', weight: 2, maxPoints: 10,
  options: [{ id: 'o1', points: 0 }, { id: 'o2', points: 10 }],
};
const bool: ScoringQuestion = { id: 'q2', answerType: 'BOOLEAN', weight: 1, maxPoints: 10, options: [] };
const num: ScoringQuestion = { id: 'q3', answerType: 'NUMERIC', weight: 1, maxPoints: 5, options: [] };

describe('awardPoints', () => {
  it('returns the selected option points for SINGLE_CHOICE', () => {
    expect(awardPoints(single, { questionId: 'q1', selectedOptionId: 'o2' })).toBe(10);
    expect(awardPoints(single, { questionId: 'q1', selectedOptionId: 'o1' })).toBe(0);
  });
  it('returns maxPoints for a true BOOLEAN, 0 for false/undefined', () => {
    expect(awardPoints(bool, { questionId: 'q2', valueBool: true })).toBe(10);
    expect(awardPoints(bool, { questionId: 'q2', valueBool: false })).toBe(0);
    expect(awardPoints(bool, undefined)).toBe(0);
  });
  it('clamps NUMERIC value to [0, maxPoints]', () => {
    expect(awardPoints(num, { questionId: 'q3', valueNumber: 3 })).toBe(3);
    expect(awardPoints(num, { questionId: 'q3', valueNumber: 99 })).toBe(5);
    expect(awardPoints(num, { questionId: 'q3', valueNumber: -2 })).toBe(0);
  });
});

describe('computeScore', () => {
  const qs = [single, bool];
  it('POINTS_SUM sums awarded points and compares to threshold', () => {
    const answers: ScoringAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'o2' }, // 10
      { questionId: 'q2', valueBool: false },       // 0
    ];
    const r = computeScore('POINTS_SUM', 15, 20, qs, answers);
    expect(r.score).toBe(10);
    expect(r.passed).toBe(false);
  });
  it('WEIGHTED normalises per-question fraction by weight and scales to maxScore', () => {
    // q1: 10/10=1 * w2 ; q2: false 0/10=0 * w1 => weightedSum=2, totalWeight=3 => 2/3*100=66.67
    const answers: ScoringAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'o2' },
      { questionId: 'q2', valueBool: false },
    ];
    const r = computeScore('WEIGHTED', 75, 100, qs, answers);
    expect(Math.round(r.score)).toBe(67);
    expect(r.passed).toBe(false);
  });
  it('WEIGHTED passes when threshold met', () => {
    const answers: ScoringAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'o2' },
      { questionId: 'q2', valueBool: true },
    ];
    const r = computeScore('WEIGHTED', 75, 100, qs, answers); // (1*2+1*1)/3*100=100
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
  });
  it('handles zero total weight without dividing by zero', () => {
    const r = computeScore('WEIGHTED', 50, 100, [{ id: 'q', answerType: 'BOOLEAN', weight: 0, maxPoints: 10, options: [] }], []);
    expect(r.score).toBe(0);
    expect(r.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- assessment-score`
Expected: FAIL — "Cannot find module '../assessment-score'".

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- assessment-score`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/programs/assessment-score.ts lib/programs/__tests__/assessment-score.test.ts
git commit -m "feat(programs): scoring engine (WEIGHTED + POINTS_SUM) with tests"
```

---

### Task 4: Eligibility engine (TDD)

**Files:**
- Create: `lib/programs/eligibility.ts`
- Test: `lib/programs/__tests__/eligibility.test.ts`

Note: ΚΑΔ matching uses hierarchical dotted-prefix logic (program "62.01" matches company "62.01.11"). Region matching is by normalized NAME — the API caller resolves the company's Καλλικράτης `regionCode` to a region name before calling.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '../eligibility';

const asOf = new Date('2026-05-29T00:00:00Z');

const baseProgram = {
  kadRule: 'ONLY_LISTED' as const,
  kads: [{ code: '62.01', excluded: false }, { code: '63.11', excluded: true }],
  eligibleLegalForms: ['ΙΚΕ', 'ΑΕ'],
  minEmployeesFte: 2,
  minOperationalYears: 3,
  regions: ['Αττική', 'Κρήτη'],
};

const baseCompany = {
  activities: [{ code: '62.01.11' }],
  legalForm: 'Ι.Κ.Ε.',
  employeeCount: 5,
  foundingDate: new Date('2020-01-01T00:00:00Z'),
  regionName: 'Αττική',
};

describe('evaluateEligibility', () => {
  it('passes a fully compliant company', () => {
    const r = evaluateEligibility(baseCompany, baseProgram, asOf);
    expect(r.eligible).toBe(true);
    expect(r.criteria.find((c) => c.key === 'kad')?.pass).toBe(true);
  });
  it('ONLY_LISTED fails when no activity matches a listed ΚΑΔ', () => {
    const r = evaluateEligibility({ ...baseCompany, activities: [{ code: '10.10.00' }] }, baseProgram, asOf);
    expect(r.criteria.find((c) => c.key === 'kad')?.pass).toBe(false);
    expect(r.eligible).toBe(false);
  });
  it('ALL_EXCEPT_LISTED fails only when an activity is explicitly excluded', () => {
    const prog = { ...baseProgram, kadRule: 'ALL_EXCEPT_LISTED' as const };
    expect(evaluateEligibility({ ...baseCompany, activities: [{ code: '63.11.10' }] }, prog, asOf).criteria.find((c) => c.key === 'kad')?.pass).toBe(false);
    expect(evaluateEligibility({ ...baseCompany, activities: [{ code: '99.99.99' }] }, prog, asOf).criteria.find((c) => c.key === 'kad')?.pass).toBe(true);
  });
  it('normalises legal form (dots/case) when matching', () => {
    expect(evaluateEligibility(baseCompany, baseProgram, asOf).criteria.find((c) => c.key === 'legalForm')?.pass).toBe(true);
    expect(evaluateEligibility({ ...baseCompany, legalForm: 'ΟΕ' }, baseProgram, asOf).criteria.find((c) => c.key === 'legalForm')?.pass).toBe(false);
  });
  it('fails operational years below the minimum', () => {
    const r = evaluateEligibility({ ...baseCompany, foundingDate: new Date('2025-01-01T00:00:00Z') }, baseProgram, asOf);
    expect(r.criteria.find((c) => c.key === 'operationalYears')?.pass).toBe(false);
  });
  it('marks a criterion N/A (pass) when the program has no requirement', () => {
    const prog = { ...baseProgram, eligibleLegalForms: [] as string[] };
    const c = evaluateEligibility(baseCompany, prog, asOf).criteria.find((x) => x.key === 'legalForm');
    expect(c?.pass).toBe(true);
    expect(c?.note).toMatch(/δεν απαιτείται/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- eligibility`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/programs/eligibility.ts
// Pure βασικά-κριτήρια engine. asOf is injected for deterministic tests.

export type KadRule = 'ALL_EXCEPT_LISTED' | 'ONLY_LISTED' | 'MIXED' | 'UNSPECIFIED';

export interface CompanyEligInput {
  activities: { code: string }[];
  legalForm: string | null;
  employeeCount: number | null;
  foundingDate: Date | null;
  regionName: string | null;
}
export interface ProgramEligInput {
  kadRule: KadRule;
  kads: { code: string; excluded: boolean }[];
  eligibleLegalForms: string[];
  minEmployeesFte: number | null;
  minOperationalYears: number | null;
  regions: string[];
}
export interface EligibilityCriterion {
  key: 'kad' | 'legalForm' | 'employeeCount' | 'operationalYears' | 'region';
  label: string;
  required: string | null;
  actual: string | null;
  pass: boolean;
  note?: string;
}
export interface EligibilityResult { criteria: EligibilityCriterion[]; eligible: boolean }

const NA = 'δεν απαιτείται';

function norm(s: string): string {
  return s.replace(/[.\s]/g, '').toUpperCase();
}
/** hierarchical dotted prefix: program "62.01" matches company "62.01.11" (and equal codes). */
function kadMatches(programCode: string, companyCode: string): boolean {
  const p = programCode.replace(/\s/g, '');
  const c = companyCode.replace(/\s/g, '');
  return c === p || c.startsWith(p + '.') || p.startsWith(c + '.');
}

function evalKad(company: CompanyEligInput, program: ProgramEligInput): EligibilityCriterion {
  const codes = company.activities.map((a) => a.code).filter(Boolean);
  const listed = program.kads.filter((k) => !k.excluded).map((k) => k.code);
  const excluded = program.kads.filter((k) => k.excluded).map((k) => k.code);
  const actual = codes.join(', ') || null;
  const base = { key: 'kad' as const, label: 'ΚΑΔ', actual };

  if (program.kadRule === 'UNSPECIFIED' || (listed.length === 0 && excluded.length === 0)) {
    return { ...base, required: null, pass: true, note: 'δεν διευκρινίζεται' };
  }
  const hitExcluded = codes.some((c) => excluded.some((e) => kadMatches(e, c)));
  const hitListed = codes.some((c) => listed.some((l) => kadMatches(l, c)));

  if (program.kadRule === 'ALL_EXCEPT_LISTED') {
    return { ...base, required: `εκτός: ${excluded.join(', ') || '—'}`, pass: !hitExcluded };
  }
  if (program.kadRule === 'ONLY_LISTED') {
    return { ...base, required: `εντός: ${listed.join(', ') || '—'}`, pass: hitListed };
  }
  // MIXED
  return { ...base, required: 'εντός λίστας & όχι εξαιρούμενος', pass: hitListed && !hitExcluded };
}

export function evaluateEligibility(
  company: CompanyEligInput,
  program: ProgramEligInput,
  asOf: Date,
): EligibilityResult {
  const criteria: EligibilityCriterion[] = [];
  criteria.push(evalKad(company, program));

  // Legal form
  if (program.eligibleLegalForms.length === 0) {
    criteria.push({ key: 'legalForm', label: 'Νομική μορφή', required: null, actual: company.legalForm, pass: true, note: NA });
  } else {
    const allowed = program.eligibleLegalForms.map(norm);
    const pass = !!company.legalForm && allowed.includes(norm(company.legalForm));
    criteria.push({ key: 'legalForm', label: 'Νομική μορφή', required: program.eligibleLegalForms.join(', '), actual: company.legalForm, pass });
  }

  // Employees (approx ΕΜΕ)
  if (program.minEmployeesFte == null) {
    criteria.push({ key: 'employeeCount', label: 'Προσωπικό (ΕΜΕ)', required: null, actual: company.employeeCount?.toString() ?? null, pass: true, note: NA });
  } else {
    const have = company.employeeCount ?? 0;
    criteria.push({ key: 'employeeCount', label: 'Προσωπικό (ΕΜΕ)', required: `≥ ${program.minEmployeesFte}`, actual: `${have} (κατά προσέγγιση)`, pass: have >= program.minEmployeesFte });
  }

  // Operational years
  if (program.minOperationalYears == null) {
    criteria.push({ key: 'operationalYears', label: 'Έτη λειτουργίας', required: null, actual: null, pass: true, note: NA });
  } else if (!company.foundingDate) {
    criteria.push({ key: 'operationalYears', label: 'Έτη λειτουργίας', required: `≥ ${program.minOperationalYears}`, actual: 'άγνωστη ίδρυση', pass: false });
  } else {
    const years = (asOf.getTime() - company.foundingDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    criteria.push({ key: 'operationalYears', label: 'Έτη λειτουργίας', required: `≥ ${program.minOperationalYears}`, actual: years.toFixed(1), pass: years >= program.minOperationalYears });
  }

  // Region
  if (program.regions.length === 0) {
    criteria.push({ key: 'region', label: 'Περιφέρεια', required: null, actual: company.regionName, pass: true, note: NA });
  } else {
    const allowed = program.regions.map(norm);
    const pass = !!company.regionName && allowed.includes(norm(company.regionName));
    criteria.push({ key: 'region', label: 'Περιφέρεια', required: program.regions.join(', '), actual: company.regionName, pass });
  }

  return { criteria, eligible: criteria.every((c) => c.pass) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- eligibility`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/programs/eligibility.ts lib/programs/__tests__/eligibility.test.ts
git commit -m "feat(programs): βασικά-κριτήρια eligibility engine with tests"
```

---

### Task 5: Auto-fill engine (TDD)

**Files:**
- Create: `lib/programs/assessment-autofill.ts`
- Test: `lib/programs/__tests__/assessment-autofill.test.ts`

Auto-fill is conservative: fills NUMERIC (`operationalYears`, `employeeCount`) and SINGLE_CHOICE/SCALE (label match against the company value). Everything else stays MANUAL.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { autofillAnswers } from '../assessment-autofill';
import type { QuestionDraftWithId } from '../assessment-autofill';

const asOf = new Date('2026-05-29T00:00:00Z');
const company = {
  legalForm: 'Ι.Κ.Ε.',
  employeeCount: 5,
  foundingDate: new Date('2020-01-01T00:00:00Z'),
  regionName: 'Αττική',
};

const questions: QuestionDraftWithId[] = [
  { id: 'q1', answerType: 'NUMERIC', companyField: 'employeeCount', options: [] },
  { id: 'q2', answerType: 'NUMERIC', companyField: 'operationalYears', options: [] },
  { id: 'q3', answerType: 'SINGLE_CHOICE', companyField: 'legalForm', options: [{ id: 'o1', label: 'ΑΕ' }, { id: 'o2', label: 'ΙΚΕ' }] },
  { id: 'q4', answerType: 'BOOLEAN', companyField: null, options: [] },
];

describe('autofillAnswers', () => {
  it('fills employeeCount as a numeric AUTO answer', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q1');
    expect(a?.valueNumber).toBe(5);
    expect(a?.source).toBe('AUTO');
  });
  it('derives operationalYears from foundingDate', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q2');
    expect(Math.round(a!.valueNumber!)).toBe(6);
    expect(a?.source).toBe('AUTO');
  });
  it('matches a SINGLE_CHOICE option by normalised label', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q3');
    expect(a?.selectedOptionId).toBe('o2');
    expect(a?.source).toBe('AUTO');
  });
  it('does not produce an answer for unmapped (manual) questions', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q4');
    expect(a).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- assessment-autofill`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- assessment-autofill`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/programs/assessment-autofill.ts lib/programs/__tests__/assessment-autofill.test.ts
git commit -m "feat(programs): assessment auto-fill engine with tests"
```

---

## Phase 2 — Questionnaire generation (program side)

### Task 6: Detection field in extraction prompt

**Files:**
- Modify: `lib/programs/templates.ts`

- [ ] **Step 1: Add `selfAssessment` to the output JSON shape**

In the `# Output JSON shape` block of `PROGRAM_SYSTEM_PROMPT`, immediately before the closing `"criteria": ["string"]` line, add:

```jsonc
  "selfAssessment": {
    "required": true,
    "threshold": 75,
    "maxScore": 100,
    "scoringModel": "WEIGHTED",
    "sourceNote": "Παράρτημα III"
  },
```

- [ ] **Step 2: Add an instruction paragraph**

Before `# Final rules`, add a new section:

```
# Αυτοαξιολόγηση (selfAssessment)

Αν το έγγραφο απαιτεί ΕΛΑΧΙΣΤΗ ΒΑΘΜΟΛΟΓΙΑ σε αυτοαξιολόγηση/βαθμολόγηση κριτηρίων (π.χ. "βαθμολογία ≥75", "Παράρτημα αξιολόγησης", "συντελεστές βαρύτητας", "μοριοδότηση"), συμπλήρωσε το "selfAssessment":
- "required": true, και βάλε "threshold" (το κατώφλι), "maxScore" (μέγιστο, συνήθως 100), "scoringModel" ("WEIGHTED" αν υπάρχουν συντελεστές βαρύτητας, αλλιώς "POINTS_SUM"), "sourceNote" (πού βρίσκεται, π.χ. "Παράρτημα III").
ΑΛΛΙΩΣ "selfAssessment": { "required": false, "threshold": null, "maxScore": null, "scoringModel": null, "sourceNote": null }.
ΜΗΝ παράγεις τις ίδιες τις ερωτήσεις εδώ — μόνο τη σηματοδότηση.
```

- [ ] **Step 3: Verify it builds**

Run: `npx tsc --noEmit 2>&1 | grep templates.ts || echo "OK"`
Expected: `OK` (string-only change).

- [ ] **Step 4: Commit**

```bash
git add lib/programs/templates.ts
git commit -m "feat(programs): detect self-assessment threshold in extraction prompt"
```

---

### Task 7: Questionnaire generation lib + persistence

**Files:**
- Create: `lib/programs/questionnaire-prompt.ts`
- Create: `lib/programs/questionnaire.ts`

- [ ] **Step 1: Write the focused generation prompt**

```ts
// lib/programs/questionnaire-prompt.ts
export const QUESTIONNAIRE_SYSTEM_PROMPT = `Είσαι σύμβουλος ΕΣΠΑ. Σου δίνεται το πλήρες κείμενο μιας προσκλήσεως (με τα παραρτήματά της) που απαιτεί ΑΥΤΟΑΞΙΟΛΟΓΗΣΗ με κατώφλι βαθμολογίας.

ΣΤΟΧΟΣ: Παρήγαγε ένα ΕΡΩΤΗΜΑΤΟΛΟΓΙΟ αυτοαξιολόγησης που αναπαράγει ΠΙΣΤΑ τον πίνακα μοριοδότησης (συνήθως "Παράρτημα III" ή "Πίνακας Κριτηρίων Αξιολόγησης").

ΠΗΓΗ (hybrid):
1. ΠΡΩΤΑ ψάξε τον πραγματικό πίνακα κριτηρίων/μοριοδότησης στα παραρτήματα — κράτα τα ίδια κριτήρια, βάρη (συντελεστές βαρύτητας) και κλίμακες.
2. ΑΝ ΔΕΝ υπάρχει αναλυτικός πίνακας, παρήγαγε 5-10 ερωτήσεις από τα γενικά κριτήρια επιλεξιμότητας.

ΑΝΤΙΚΕΙΜΕΝΙΚΑ vs ΥΠΟΚΕΙΜΕΝΙΚΑ:
- Αν μια ερώτηση μπορεί να απαντηθεί από στοιχεία της επιχείρησης, βάλε "companyField": ένα από "legalForm" | "operationalYears" | "employeeCount" | "region" | "kad".
- Αλλιώς "companyField": null (θα συμπληρωθεί χειροκίνητα).

SCORING:
- "WEIGHTED" όταν υπάρχουν συντελεστές βαρύτητας ανά κριτήριο — βάλε "weight" σε κάθε ερώτηση και "maxPoints" (μέγιστος βαθμός ανά ερώτηση, π.χ. 100 ή 10).
- "POINTS_SUM" όταν κάθε επιλογή δίνει σταθερά μόρια — βάλε "maxPoints" ανά ερώτηση, χωρίς weight.

answerType:
- "SINGLE_CHOICE" (επιλογές με μόρια) — το πιο συνηθισμένο.
- "SCALE" (κλίμακα, π.χ. 0/25/50/75/100) — options με αύξοντα points.
- "BOOLEAN" (ναι=maxPoints, όχι=0).
- "NUMERIC" (αριθμητική τιμή· τα μόρια = η τιμή, clamped στο maxPoints).

Επιστρέφεις ΜΟΝΟ valid JSON:
{
  "scoringModel": "WEIGHTED"|"POINTS_SUM",
  "threshold": number,
  "maxScore": number,
  "sourceNote": "string",
  "questions": [
    {
      "code": "Q1",
      "text": "string",
      "criterionRef": "string|null",
      "helpText": "string|null",
      "answerType": "BOOLEAN"|"SINGLE_CHOICE"|"NUMERIC"|"SCALE",
      "weight": number|null,
      "maxPoints": number|null,
      "companyField": "legalForm"|"operationalYears"|"employeeCount"|"region"|"kad"|null,
      "options": [ { "label": "string", "points": number } ]
    }
  ]
}
Χωρίς markdown fences, χωρίς σχόλια.`;
```

- [ ] **Step 2: Write the generation + persistence module**

```ts
// lib/programs/questionnaire.ts
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { bunnyDownload } from '@/lib/bunny';
import { QUESTIONNAIRE_SYSTEM_PROMPT } from './questionnaire-prompt';
import { asNum, asStr } from './coerce';
import type { QuestionnaireDraft, ScoringModel, AnswerType, CompanyField } from './questionnaire-types';

const MODEL = 'deepseek-reasoner';
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TEXT_CHARS = 360_000;

const ANSWER_TYPES: AnswerType[] = ['BOOLEAN', 'SINGLE_CHOICE', 'NUMERIC', 'SCALE'];
const COMPANY_FIELDS: CompanyField[] = ['legalForm', 'operationalYears', 'employeeCount', 'region', 'kad'];

async function parseJsonLoose(s: string): Promise<any> {
  const cleaned = (s || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  const candidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  const { jsonrepair } = await import('jsonrepair');
  return JSON.parse(jsonrepair(candidate));
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? '')];
  return pages.map((t, i) => `--- ΣΕΛΙΔΑ ${i + 1} ---\n${t}`).join('\n\n').replace(/[ \t]+/g, ' ').trim();
}

function coerceDraft(raw: any): QuestionnaireDraft {
  const scoringModel: ScoringModel = raw?.scoringModel === 'POINTS_SUM' ? 'POINTS_SUM' : 'WEIGHTED';
  const questions = Array.isArray(raw?.questions) ? raw.questions : [];
  return {
    scoringModel,
    threshold: asNum(raw?.threshold),
    maxScore: asNum(raw?.maxScore),
    sourceNote: asStr(raw?.sourceNote),
    questions: questions
      .filter((q: any) => asStr(q?.text))
      .map((q: any) => ({
        code: asStr(q?.code),
        text: asStr(q?.text)!,
        criterionRef: asStr(q?.criterionRef),
        helpText: asStr(q?.helpText),
        answerType: ANSWER_TYPES.includes(q?.answerType) ? q.answerType : 'SINGLE_CHOICE',
        weight: asNum(q?.weight),
        maxPoints: asNum(q?.maxPoints),
        companyField: COMPANY_FIELDS.includes(q?.companyField) ? q.companyField : null,
        options: Array.isArray(q?.options)
          ? q.options.filter((o: any) => asStr(o?.label)).map((o: any) => ({ label: asStr(o.label)!, points: asNum(o?.points) ?? 0 }))
          : [],
      })),
  };
}

/** Generate a questionnaire draft for a program via a focused DeepSeek call. */
export async function generateQuestionnaire(programId: string): Promise<{ draft: QuestionnaireDraft; model: string }> {
  const apiKey = (await getSetting<string>('ai.deepseekApiKey')) ?? process.env.DEEPSEEK_API_KEY ?? '';
  const apiUrl = (await getSetting<string>('ai.deepseekUrl')) ?? 'https://api.deepseek.com/v1/chat/completions';
  if (!apiKey) throw new Error('DeepSeek API key not configured.');

  const program = await prisma.program.findUnique({ where: { id: programId }, include: { files: true, criteria: { orderBy: { order: 'asc' } } } });
  if (!program) throw new Error('Program not found');

  // Build full text from attached files (fallback to storageKey).
  const fileRows = program.files.length ? program.files : (program.storageKey ? [{ storageKey: program.storageKey, mimeType: program.mimeType ?? 'application/pdf', fileName: program.sourceFileName ?? 'main.pdf' } as any] : []);
  let text = '';
  for (const f of fileRows) {
    try { text += `\n\n=== ${f.fileName} ===\n\n` + await extractPdfText(await bunnyDownload(f.storageKey)); } catch { /* skip */ }
  }
  text = text.slice(0, MAX_TEXT_CHARS);
  if (text.length < 200) {
    // Fallback: use already-extracted criteria as the source material.
    text = 'ΚΡΙΤΗΡΙΑ ΠΡΟΓΡΑΜΜΑΤΟΣ:\n' + program.criteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL, temperature: 0.1, max_tokens: 8192,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: QUESTIONNAIRE_SYSTEM_PROMPT },
          { role: 'user', content: `Φτιάξε το ερωτηματολόγιο αυτοαξιολόγησης. Κείμενο:\n\n${text}` },
        ],
      }),
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const u = data?.usage ?? {};
  void logAiUsage({ scope: 'OCR_TEXT', provider: providerFromUrl(apiUrl), model: MODEL, operation: 'program.questionnaire', inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 });

  const draft = coerceDraft(await parseJsonLoose(data?.choices?.[0]?.message?.content));
  return { draft, model: MODEL };
}

/** Replace the program's questionnaire definition (questions + options) from a draft. */
export async function persistQuestionnaire(programId: string, draft: QuestionnaireDraft, model: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.programQuestionnaire.findUnique({ where: { programId } });
    if (existing) await tx.programQuestion.deleteMany({ where: { questionnaireId: existing.id } });
    const q = await tx.programQuestionnaire.upsert({
      where: { programId },
      create: {
        programId, scoringModel: draft.scoringModel, threshold: draft.threshold ?? undefined,
        maxScore: draft.maxScore ?? undefined, sourceNote: draft.sourceNote ?? undefined,
        status: 'READY', generatedModel: model ?? undefined, generatedAt: new Date(),
      },
      update: {
        scoringModel: draft.scoringModel, threshold: draft.threshold ?? null, maxScore: draft.maxScore ?? null,
        sourceNote: draft.sourceNote ?? null, status: 'READY', generatedModel: model ?? undefined, generatedAt: new Date(),
      },
    });
    for (let i = 0; i < draft.questions.length; i++) {
      const d = draft.questions[i];
      await tx.programQuestion.create({
        data: {
          questionnaireId: q.id, code: d.code ?? undefined, text: d.text, criterionRef: d.criterionRef ?? undefined,
          helpText: d.helpText ?? undefined, answerType: d.answerType, weight: d.weight ?? undefined,
          maxPoints: d.maxPoints ?? undefined, companyField: d.companyField ?? undefined, order: i,
          options: { create: d.options.map((o, j) => ({ label: o.label, points: o.points, order: j })) },
        },
      });
    }
  }, { timeout: 60_000, maxWait: 10_000 });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "questionnaire(\.|-prompt)" || echo "OK"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add lib/programs/questionnaire.ts lib/programs/questionnaire-prompt.ts
git commit -m "feat(programs): DeepSeek questionnaire generation + persistence"
```

---

### Task 8: Questionnaire API routes (generate + PATCH) + GET include

**Files:**
- Create: `app/api/admin/programs/[id]/questionnaire/generate/route.ts`
- Create: `app/api/admin/programs/[id]/questionnaire/route.ts`
- Modify: `app/api/admin/programs/[id]/route.ts` (GET include)
- Modify: `app/admin/programs/[id]/page.tsx` (query include)

- [ ] **Step 1: Generate route**

```ts
// app/api/admin/programs/[id]/questionnaire/generate/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { generateQuestionnaire, persistQuestionnaire } from '@/lib/programs/questionnaire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  try {
    const { draft, model } = await generateQuestionnaire(id);
    await persistQuestionnaire(id, draft, model);
    const fresh = await prisma.programQuestionnaire.findUnique({ where: { programId: id }, include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } });
    return NextResponse.json(fresh);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'generation failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: PATCH route (full-replace edited definition)**

```ts
// app/api/admin/programs/[id]/questionnaire/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { asNum, asStr } from '@/lib/programs/coerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({
  scoringModel: z.enum(['WEIGHTED', 'POINTS_SUM']),
  threshold: z.union([z.number(), z.string(), z.null()]).optional(),
  maxScore: z.union([z.number(), z.string(), z.null()]).optional(),
  sourceNote: z.string().nullable().optional(),
  questions: z.array(z.object({
    code: z.string().nullable().optional(),
    text: z.string().min(1),
    criterionRef: z.string().nullable().optional(),
    helpText: z.string().nullable().optional(),
    answerType: z.enum(['BOOLEAN', 'SINGLE_CHOICE', 'NUMERIC', 'SCALE']),
    weight: z.union([z.number(), z.string(), z.null()]).optional(),
    maxPoints: z.union([z.number(), z.string(), z.null()]).optional(),
    companyField: z.enum(['legalForm', 'operationalYears', 'employeeCount', 'region', 'kad']).nullable().optional(),
    options: z.array(z.object({ label: z.string().min(1), points: z.union([z.number(), z.string()]).optional() })).optional(),
  })),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  const body = Schema.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    const existing = await tx.programQuestionnaire.findUnique({ where: { programId: id } });
    if (existing) await tx.programQuestion.deleteMany({ where: { questionnaireId: existing.id } });
    const q = await tx.programQuestionnaire.upsert({
      where: { programId: id },
      create: { programId: id, scoringModel: body.scoringModel, threshold: asNum(body.threshold), maxScore: asNum(body.maxScore), sourceNote: asStr(body.sourceNote), status: 'READY' },
      update: { scoringModel: body.scoringModel, threshold: asNum(body.threshold), maxScore: asNum(body.maxScore), sourceNote: asStr(body.sourceNote), status: 'READY' },
    });
    for (let i = 0; i < body.questions.length; i++) {
      const d = body.questions[i];
      await tx.programQuestion.create({
        data: {
          questionnaireId: q.id, code: asStr(d.code), text: d.text, criterionRef: asStr(d.criterionRef),
          helpText: asStr(d.helpText), answerType: d.answerType, weight: asNum(d.weight), maxPoints: asNum(d.maxPoints),
          companyField: d.companyField ?? undefined, order: i,
          options: { create: (d.options ?? []).map((o, j) => ({ label: o.label, points: asNum(o.points) ?? 0, order: j })) },
        },
      });
    }
  }, { timeout: 60_000, maxWait: 10_000 });

  const fresh = await prisma.programQuestionnaire.findUnique({ where: { programId: id }, include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } });
  return NextResponse.json(fresh);
}
```

- [ ] **Step 3: Include questionnaire in program GET**

In `app/api/admin/programs/[id]/route.ts`, in the `GET` handler's `include` block, add:

```ts
      questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } },
```

- [ ] **Step 4: Include questionnaire in the page query**

In `app/admin/programs/[id]/page.tsx`, add the same `questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } }` to the program `include`.

- [ ] **Step 5: Manual smoke test**

Run: `npm run build 2>&1 | tail -5`
Expected: build succeeds (routes compile). If DB unavailable, build still typechecks routes.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/programs/[id]/questionnaire app/api/admin/programs/[id]/route.ts app/admin/programs/[id]/page.tsx
git commit -m "feat(programs): questionnaire generate + edit API routes; include in GET"
```

---

### Task 9: Auto-generate trigger (best-effort)

**Files:**
- Modify: `app/api/admin/programs/[id]/reextract/route.ts`
- Modify: `app/api/admin/programs/route.ts`

- [ ] **Step 1: Add a shared helper call after extraction in reextract route**

In `app/api/admin/programs/[id]/reextract/route.ts`, after the child rows are written and before the final response, add:

```ts
  // Best-effort: auto-generate the self-assessment questionnaire if the program needs one.
  if (data?.selfAssessment?.required === true) {
    try {
      const { generateQuestionnaire, persistQuestionnaire } = await import('@/lib/programs/questionnaire');
      const gen = await generateQuestionnaire(id);
      await persistQuestionnaire(id, gen.draft, gen.model);
    } catch (err) {
      console.error('[questionnaire auto-gen] failed (non-fatal):', err);
    }
  }
```

- [ ] **Step 2: Same in the create route**

In `app/api/admin/programs/route.ts`, locate where extraction `data` is processed and the program `id` exists after creation. After child rows are persisted, add the same block (use the created program's `id`).

- [ ] **Step 3: Manual verification note**

Run: `npm run build 2>&1 | tail -3`
Expected: build succeeds. Functional test happens in Task 16 (needs DeepSeek key + DB).

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/programs/[id]/reextract/route.ts app/api/admin/programs/route.ts
git commit -m "feat(programs): auto-generate questionnaire after extraction (best-effort)"
```

---

## Phase 3 — Company evaluation API

### Task 10: Verdict helper + create-assessment route

**Files:**
- Create: `app/api/admin/companies/[id]/assessments/route.ts`
- Create: `lib/programs/assessment-verdict.ts`

- [ ] **Step 1: Verdict helper (TDD)**

Create `lib/programs/__tests__/assessment-verdict.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../assessment-verdict';

describe('computeVerdict', () => {
  it('NOT_ELIGIBLE when basic criteria fail', () => {
    expect(computeVerdict(false, null)).toBe('NOT_ELIGIBLE');
  });
  it('ELIGIBLE when eligible and (no questionnaire OR passed)', () => {
    expect(computeVerdict(true, null)).toBe('ELIGIBLE');
    expect(computeVerdict(true, true)).toBe('ELIGIBLE');
  });
  it('NEEDS_REVIEW when eligible but questionnaire not passed', () => {
    expect(computeVerdict(true, false)).toBe('NEEDS_REVIEW');
  });
});
```

Create `lib/programs/assessment-verdict.ts`:

```ts
import type { AssessmentVerdict } from '@prisma/client';

export function computeVerdict(eligible: boolean, questionnairePassed: boolean | null): AssessmentVerdict {
  if (!eligible) return 'NOT_ELIGIBLE';
  if (questionnairePassed === false) return 'NEEDS_REVIEW';
  return 'ELIGIBLE';
}
```

Run: `npm test -- assessment-verdict`
Expected: PASS.

- [ ] **Step 2: Create-assessment route**

```ts
// app/api/admin/companies/[id]/assessments/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { evaluateEligibility, type KadRule } from '@/lib/programs/eligibility';
import { autofillAnswers, type QuestionDraftWithId } from '@/lib/programs/assessment-autofill';
import { computeVerdict } from '@/lib/programs/assessment-verdict';
import { asNum } from '@/lib/programs/coerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const list = await prisma.companyAssessment.findMany({
    where: { companyId: id },
    orderBy: { createdAt: 'desc' },
    include: { program: { select: { title: true } } },
  });
  return NextResponse.json(list);
}

const CreateSchema = z.object({ programId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id: companyId } = await params;
  const { programId } = CreateSchema.parse(await req.json());

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { activities: { select: { code: true } } },
  });
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 });

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      kads: { select: { code: true, excluded: true } },
      legalForms: { select: { name: true } },
      regions: { select: { name: true } },
      questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } },
    },
  });
  if (!program) return NextResponse.json({ error: 'program not found' }, { status: 404 });

  // Resolve the company's region NAME from its Καλλικράτης regionCode (level-3 region).
  let regionName: string | null = null;
  if (company.regionCode) {
    const reg = await prisma.region.findUnique({ where: { code: company.regionCode }, select: { nameEL: true, level: true, parentCode: true } });
    regionName = reg?.nameEL ?? null;
    // climb to level-3 region name if the code points to a unit/municipality
    let cur = reg;
    while (cur && cur.level > 3 && cur.parentCode) {
      cur = await prisma.region.findUnique({ where: { code: cur.parentCode }, select: { nameEL: true, level: true, parentCode: true } });
      if (cur && cur.level === 3) regionName = cur.nameEL;
    }
  }

  const elig = evaluateEligibility(
    {
      activities: company.activities,
      legalForm: company.legalForm,
      employeeCount: company.employeeCount,
      foundingDate: company.foundingDate,
      regionName,
    },
    {
      kadRule: program.kadRule as KadRule,
      kads: program.kads,
      eligibleLegalForms: program.legalForms.map((l) => l.name),
      minEmployeesFte: asNum(program.minEmployeesFte),
      minOperationalYears: asNum(program.minOperationalYears),
      regions: program.regions.map((r) => r.name),
    },
    new Date(),
  );

  const assessment = await prisma.companyAssessment.create({
    data: {
      companyId, programId, questionnaireId: program.questionnaire?.id ?? null,
      eligible: elig.eligible, eligibilityResult: elig as any,
      overallVerdict: computeVerdict(elig.eligible, program.questionnaire ? false : null),
      status: 'DRAFT',
    },
  });

  // Pre-fill objective answers if a questionnaire exists.
  if (program.questionnaire) {
    const qs: QuestionDraftWithId[] = program.questionnaire.questions.map((q) => ({
      id: q.id, answerType: q.answerType, companyField: (q.companyField as any) ?? null,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    }));
    const filled = autofillAnswers(
      { legalForm: company.legalForm, employeeCount: company.employeeCount, foundingDate: company.foundingDate, regionName },
      qs, new Date(),
    );
    if (filled.length) {
      await prisma.assessmentAnswer.createMany({
        data: filled.map((a) => ({
          assessmentId: assessment.id, questionId: a.questionId,
          valueBool: a.valueBool ?? null, valueNumber: a.valueNumber ?? null,
          selectedOptionId: a.selectedOptionId ?? null, source: 'AUTO' as const,
        })),
      });
    }
  }

  const fresh = await prisma.companyAssessment.findUnique({
    where: { id: assessment.id },
    include: { answers: true, questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } } },
  });
  return NextResponse.json(fresh);
}
```

- [ ] **Step 3: Build check**

Run: `npm run build 2>&1 | tail -5`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/companies/[id]/assessments/route.ts lib/programs/assessment-verdict.ts lib/programs/__tests__/assessment-verdict.test.ts
git commit -m "feat(companies): create assessment (eligibility + auto-fill) + list route"
```

---

### Task 11: Save answers + recompute route

**Files:**
- Create: `app/api/admin/companies/[id]/assessments/[assessmentId]/route.ts`

- [ ] **Step 1: PATCH route**

```ts
// app/api/admin/companies/[id]/assessments/[assessmentId]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { awardPoints, computeScore } from '@/lib/programs/assessment-score';
import { computeVerdict } from '@/lib/programs/assessment-verdict';
import { asNum } from '@/lib/programs/coerce';
import type { ScoringQuestion, ScoringAnswer, ScoringModel } from '@/lib/programs/questionnaire-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({
  notes: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'COMPLETED']).optional(),
  answers: z.array(z.object({
    questionId: z.string().min(1),
    valueBool: z.boolean().nullable().optional(),
    valueNumber: z.union([z.number(), z.string(), z.null()]).optional(),
    valueText: z.string().nullable().optional(),
    selectedOptionId: z.string().nullable().optional(),
    source: z.enum(['AUTO', 'MANUAL']).optional(),
  })).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; assessmentId: string }> }) {
  await requirePermission('programs.update');
  const { assessmentId } = await params;
  const body = Schema.parse(await req.json());

  const assessment = await prisma.companyAssessment.findUnique({
    where: { id: assessmentId },
    include: { questionnaire: { include: { questions: { include: { options: true } } } } },
  });
  if (!assessment) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    if (body.answers) {
      await tx.assessmentAnswer.deleteMany({ where: { assessmentId } });
      for (const a of body.answers) {
        await tx.assessmentAnswer.create({
          data: {
            assessmentId, questionId: a.questionId,
            valueBool: a.valueBool ?? null, valueNumber: asNum(a.valueNumber),
            valueText: a.valueText ?? null, selectedOptionId: a.selectedOptionId ?? null,
            source: a.source ?? 'MANUAL',
          },
        });
      }
    }

    let score: number | null = null, maxScore: number | null = null, passed: boolean | null = null;
    const q = assessment.questionnaire;
    if (q) {
      const questions: ScoringQuestion[] = q.questions.map((qq) => ({
        id: qq.id, answerType: qq.answerType, weight: asNum(qq.weight), maxPoints: asNum(qq.maxPoints),
        options: qq.options.map((o) => ({ id: o.id, points: Number(o.points) })),
      }));
      const answers: ScoringAnswer[] = (body.answers ?? []).map((a) => ({
        questionId: a.questionId, valueBool: a.valueBool ?? null, valueNumber: asNum(a.valueNumber), selectedOptionId: a.selectedOptionId ?? null,
      }));
      const r = computeScore(q.scoringModel as ScoringModel, asNum(q.threshold), asNum(q.maxScore), questions, answers);
      score = r.score; maxScore = r.maxScore; passed = r.passed;
      // persist per-answer pointsAwarded
      for (const a of answers) {
        const sq = questions.find((x) => x.id === a.questionId);
        if (sq) await tx.assessmentAnswer.updateMany({ where: { assessmentId, questionId: a.questionId }, data: { pointsAwarded: awardPoints(sq, a) } });
      }
    }

    await tx.companyAssessment.update({
      where: { id: assessmentId },
      data: {
        notes: body.notes ?? undefined,
        status: body.status ?? undefined,
        questionnaireScore: score, questionnaireMax: maxScore, questionnairePassed: passed,
        overallVerdict: computeVerdict(assessment.eligible ?? false, passed),
      },
    });
  }, { timeout: 60_000, maxWait: 10_000 });

  const fresh = await prisma.companyAssessment.findUnique({ where: { id: assessmentId }, include: { answers: true } });
  return NextResponse.json(fresh);
}
```

- [ ] **Step 2: Build check**

Run: `npm run build 2>&1 | tail -5`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/companies/[id]/assessments/[assessmentId]/route.ts
git commit -m "feat(companies): save assessment answers + recompute score/verdict"
```

---

### Task 12: Program-side assessments list route

**Files:**
- Create: `app/api/admin/programs/[id]/assessments/route.ts`

- [ ] **Step 1: GET route**

```ts
// app/api/admin/programs/[id]/assessments/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const list = await prisma.companyAssessment.findMany({
    where: { programId: id },
    orderBy: { createdAt: 'desc' },
    include: { company: { select: { id: true, name: true } } },
  });
  return NextResponse.json(list);
}
```

- [ ] **Step 2: Build check**

Run: `npm run build 2>&1 | tail -3`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/programs/[id]/assessments/route.ts
git commit -m "feat(programs): list assessed companies for a program"
```

---

## Phase 4 — UI

### Task 13: Program editor — «Αυτοαξιολόγηση» tab

**Files:**
- Create: `app/admin/programs/[id]/questionnaire-tab.tsx`
- Modify: `app/admin/programs/[id]/editor.tsx`

- [ ] **Step 1: Write the tab component**

```tsx
// app/admin/programs/[id]/questionnaire-tab.tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave } from 'react-icons/fi';
import { Badge } from '@/components/ui/badge';
import type { AnswerType, ScoringModel, CompanyField } from '@/lib/programs/questionnaire-types';

interface Opt { label: string; points: number }
interface Q {
  code: string | null; text: string; criterionRef: string | null; helpText: string | null;
  answerType: AnswerType; weight: number | null; maxPoints: number | null;
  companyField: CompanyField | null; options: Opt[];
}
export interface QuestionnaireData {
  scoringModel: ScoringModel; threshold: number | null; maxScore: number | null;
  sourceNote: string | null; questions: Q[];
}

const ANSWER_TYPES: AnswerType[] = ['SINGLE_CHOICE', 'SCALE', 'BOOLEAN', 'NUMERIC'];
const COMPANY_FIELDS: (CompanyField | '')[] = ['', 'legalForm', 'operationalYears', 'employeeCount', 'region', 'kad'];

export function QuestionnaireTab({ programId, initial }: { programId: string; initial: QuestionnaireData | null }) {
  const router = useRouter();
  const [q, setQ] = React.useState<QuestionnaireData>(initial ?? { scoringModel: 'WEIGHTED', threshold: 75, maxScore: 100, sourceNote: null, questions: [] });
  const [busy, setBusy] = React.useState(false);

  async function generate() {
    if (!confirm('Η δημιουργία με AI θα ΑΝΤΙΚΑΤΑΣΤΗΣΕΙ το τρέχον ερωτηματολόγιο. Συνέχεια;')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}/questionnaire/generate`, { method: 'POST' });
      if (!res.ok) { toast.error('Η δημιουργία απέτυχε'); return; }
      toast.success('Δημιουργήθηκε'); router.refresh();
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}/questionnaire`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q),
      });
      if (!res.ok) { toast.error('Αποτυχία αποθήκευσης'); return; }
      toast.success('Αποθηκεύτηκε'); router.refresh();
    } finally { setBusy(false); }
  }

  function patch(i: number, p: Partial<Q>) { setQ((s) => ({ ...s, questions: s.questions.map((x, j) => j === i ? { ...x, ...p } : x) })); }
  function addQ() { setQ((s) => ({ ...s, questions: [...s.questions, { code: null, text: '', criterionRef: null, helpText: null, answerType: 'SINGLE_CHOICE', weight: 1, maxPoints: 100, companyField: null, options: [] }] })); }
  function removeQ(i: number) { setQ((s) => ({ ...s, questions: s.questions.filter((_, j) => j !== i) })); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">Μοντέλο
          <select className="ml-2 rounded border p-1" value={q.scoringModel} onChange={(e) => setQ({ ...q, scoringModel: e.target.value as ScoringModel })}>
            <option value="WEIGHTED">WEIGHTED</option><option value="POINTS_SUM">POINTS_SUM</option>
          </select>
        </label>
        <label className="text-xs">Κατώφλι
          <input type="number" className="ml-2 w-20 rounded border p-1" value={q.threshold ?? ''} onChange={(e) => setQ({ ...q, threshold: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label className="text-xs">Max
          <input type="number" className="ml-2 w-20 rounded border p-1" value={q.maxScore ?? ''} onChange={(e) => setQ({ ...q, maxScore: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <button type="button" disabled={busy} onClick={generate} className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">🪄 Δημιουργία/Αναδημιουργία με AI</button>
      </div>

      {q.questions.map((item, i) => (
        <div key={i} className="rounded border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{item.code ?? `Q${i + 1}`}</Badge>
            <input className="flex-1 rounded border p-1 text-sm" placeholder="Ερώτηση" value={item.text} onChange={(e) => patch(i, { text: e.target.value })} />
            <button type="button" onClick={() => removeQ(i)} className="text-red-600"><FiTrash2 /></button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <select className="rounded border p-1" value={item.answerType} onChange={(e) => patch(i, { answerType: e.target.value as AnswerType })}>
              {ANSWER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" className="w-20 rounded border p-1" placeholder="weight" value={item.weight ?? ''} onChange={(e) => patch(i, { weight: e.target.value === '' ? null : Number(e.target.value) })} />
            <input type="number" className="w-24 rounded border p-1" placeholder="maxPoints" value={item.maxPoints ?? ''} onChange={(e) => patch(i, { maxPoints: e.target.value === '' ? null : Number(e.target.value) })} />
            <select className="rounded border p-1" value={item.companyField ?? ''} onChange={(e) => patch(i, { companyField: (e.target.value || null) as CompanyField | null })}>
              {COMPANY_FIELDS.map((f) => <option key={f} value={f}>{f === '' ? 'χειροκίνητο' : f}</option>)}
            </select>
          </div>
          {(item.answerType === 'SINGLE_CHOICE' || item.answerType === 'SCALE') && (
            <div className="space-y-1 pl-4">
              {item.options.map((o, oi) => (
                <div key={oi} className="flex gap-2">
                  <input className="flex-1 rounded border p-1 text-xs" placeholder="Επιλογή" value={o.label} onChange={(e) => patch(i, { options: item.options.map((x, j) => j === oi ? { ...x, label: e.target.value } : x) })} />
                  <input type="number" className="w-20 rounded border p-1 text-xs" placeholder="μόρια" value={o.points} onChange={(e) => patch(i, { options: item.options.map((x, j) => j === oi ? { ...x, points: Number(e.target.value) } : x) })} />
                  <button type="button" onClick={() => patch(i, { options: item.options.filter((_, j) => j !== oi) })} className="text-red-600"><FiTrash2 /></button>
                </div>
              ))}
              <button type="button" onClick={() => patch(i, { options: [...item.options, { label: '', points: 0 }] })} className="text-xs text-violet-600"><FiPlus className="inline" /> επιλογή</button>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <button type="button" onClick={addQ} className="rounded border px-3 py-1.5 text-sm"><FiPlus className="inline" /> Ερώτηση</button>
        <button type="button" disabled={busy} onClick={save} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"><FiSave className="inline" /> Αποθήκευση</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab into the editor**

In `app/admin/programs/[id]/editor.tsx`:

1. Add import at the top: `import { QuestionnaireTab, type QuestionnaireData } from './questionnaire-tab';`
2. Add a trigger inside `<TabsList>` after the `criteria` trigger (after line ~276):

```tsx
              <TabsTrigger value="questionnaire">Αυτοαξιολόγηση{program.questionnaire ? <Badge variant="outline">{program.questionnaire.questions.length}</Badge> : null}</TabsTrigger>
```

3. Add a `<TabsContent>` after the `criteria` content (after line ~416):

```tsx
          <TabsContent value="questionnaire" className="w-full p-4">
            <QuestionnaireTab
              programId={p.id}
              initial={program.questionnaire ? {
                scoringModel: program.questionnaire.scoringModel,
                threshold: program.questionnaire.threshold == null ? null : Number(program.questionnaire.threshold),
                maxScore: program.questionnaire.maxScore == null ? null : Number(program.questionnaire.maxScore),
                sourceNote: program.questionnaire.sourceNote ?? null,
                questions: program.questionnaire.questions.map((q: any) => ({
                  code: q.code ?? null, text: q.text, criterionRef: q.criterionRef ?? null, helpText: q.helpText ?? null,
                  answerType: q.answerType, weight: q.weight == null ? null : Number(q.weight),
                  maxPoints: q.maxPoints == null ? null : Number(q.maxPoints), companyField: q.companyField ?? null,
                  options: (q.options ?? []).map((o: any) => ({ label: o.label, points: Number(o.points) })),
                })),
              } : null}
            />
          </TabsContent>
```

Note: `program` prop type in editor.tsx must allow an optional `questionnaire`. Add `questionnaire?: any;` to the `ProgramData` interface (around line 44).

- [ ] **Step 3: Add `helpAnchor` to the program PageHeader**

In `app/admin/programs/[id]/editor.tsx` (or page.tsx, wherever `<PageHeader` for this route renders), add prop `helpAnchor="self-assessment"`.

- [ ] **Step 4: Build check**

Run: `npm run build 2>&1 | tail -8`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/admin/programs/[id]/questionnaire-tab.tsx app/admin/programs/[id]/editor.tsx
git commit -m "feat(programs): editable self-assessment questionnaire tab"
```

---

### Task 14: Company actions — «Αξιολόγηση» dialog

**Files:**
- Create: `components/companies/assessment-dialog.tsx`
- Modify: `app/admin/companies/companies-view.tsx`

- [ ] **Step 1: Write the dialog component**

```tsx
// components/companies/assessment-dialog.tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { awardPoints, computeScore } from '@/lib/programs/assessment-score';
import type { ScoringQuestion, ScoringAnswer, ScoringModel } from '@/lib/programs/questionnaire-types';

interface ProgramOption { id: string; title: string }

export function AssessmentDialog({ companyId, companyName, open, onClose }: { companyId: string | null; companyName: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [programs, setPrograms] = React.useState<ProgramOption[]>([]);
  const [programId, setProgramId] = React.useState('');
  const [assessment, setAssessment] = React.useState<any>(null);
  const [answers, setAnswers] = React.useState<Record<string, ScoringAnswer>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) { setProgramId(''); setAssessment(null); setAnswers({}); return; }
    fetch('/api/admin/programs?status=PUBLISHED').then((r) => r.json()).then((d) => {
      const list = Array.isArray(d) ? d : (d.items ?? d.programs ?? []);
      setPrograms(list.map((p: any) => ({ id: p.id, title: p.title })));
    }).catch(() => {});
  }, [open]);

  async function start() {
    if (!companyId || !programId) { toast.error('Επίλεξε πρόγραμμα'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/assessments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ programId }),
      });
      if (!res.ok) { toast.error('Αποτυχία'); return; }
      const a = await res.json();
      setAssessment(a);
      const init: Record<string, ScoringAnswer> = {};
      for (const ans of a.answers ?? []) init[ans.questionId] = { questionId: ans.questionId, valueBool: ans.valueBool, valueNumber: ans.valueNumber == null ? null : Number(ans.valueNumber), selectedOptionId: ans.selectedOptionId };
      setAnswers(init);
    } finally { setBusy(false); }
  }

  const questions: ScoringQuestion[] = (assessment?.questionnaire?.questions ?? []).map((q: any) => ({
    id: q.id, answerType: q.answerType, weight: q.weight == null ? null : Number(q.weight),
    maxPoints: q.maxPoints == null ? null : Number(q.maxPoints), options: (q.options ?? []).map((o: any) => ({ id: o.id, points: Number(o.points) })),
  }));
  const qn = assessment?.questionnaire;
  const live = qn ? computeScore(qn.scoringModel as ScoringModel, qn.threshold == null ? null : Number(qn.threshold), qn.maxScore == null ? null : Number(qn.maxScore), questions, Object.values(answers)) : null;

  async function save() {
    if (!companyId || !assessment) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/assessments/${assessment.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED', answers: Object.values(answers) }),
      });
      if (!res.ok) { toast.error('Αποτυχία αποθήκευσης'); return; }
      toast.success('Αποθηκεύτηκε'); onClose(); router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Αξιολόγηση — {companyName}</DialogTitle></DialogHeader>

        {!assessment && (
          <div className="space-y-3">
            <select className="w-full rounded border p-2" value={programId} onChange={(e) => setProgramId(e.target.value)}>
              <option value="">— Επίλεξε πρόγραμμα —</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <button type="button" disabled={busy} onClick={start} className="rounded bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50">Έλεγχος κριτηρίων</button>
          </div>
        )}

        {assessment && (
          <div className="space-y-4">
            <div>
              <h4 className="mb-1 text-sm font-semibold">Βασικά κριτήρια {assessment.eligible ? <Badge className="bg-emerald-600">ΟΚ</Badge> : <Badge variant="destructive">FAIL</Badge>}</h4>
              <table className="w-full text-xs">
                <tbody>
                  {(assessment.eligibilityResult?.criteria ?? []).map((c: any) => (
                    <tr key={c.key} className="border-b">
                      <td className="py-1 font-medium">{c.label}</td>
                      <td className="py-1 text-muted-foreground">{c.actual ?? '—'}</td>
                      <td className="py-1">{c.required ?? c.note ?? ''}</td>
                      <td className="py-1 text-right">{c.pass ? '✅' : '❌'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {qn && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Ερωτηματολόγιο</h4>
                {qn.questions.map((q: any) => {
                  const a = answers[q.id] ?? { questionId: q.id };
                  const auto = (assessment.answers ?? []).find((x: any) => x.questionId === q.id && x.source === 'AUTO');
                  return (
                    <div key={q.id} className="rounded border p-2">
                      <div className="mb-1 text-sm">{q.text} {auto && <Badge variant="outline" className="ml-1">από στοιχεία εταιρίας</Badge>}</div>
                      {(q.answerType === 'SINGLE_CHOICE' || q.answerType === 'SCALE') && (
                        <select className="w-full rounded border p-1 text-sm" value={a.selectedOptionId ?? ''} onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: { questionId: q.id, selectedOptionId: e.target.value || null } }))}>
                          <option value="">—</option>
                          {q.options.map((o: any) => <option key={o.id} value={o.id}>{o.label} ({Number(o.points)})</option>)}
                        </select>
                      )}
                      {q.answerType === 'BOOLEAN' && (
                        <label className="text-sm"><input type="checkbox" checked={!!a.valueBool} onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: { questionId: q.id, valueBool: e.target.checked } }))} /> Ναι</label>
                      )}
                      {q.answerType === 'NUMERIC' && (
                        <input type="number" className="w-32 rounded border p-1 text-sm" value={a.valueNumber ?? ''} onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: { questionId: q.id, valueNumber: e.target.value === '' ? null : Number(e.target.value) } }))} />
                      )}
                    </div>
                  );
                })}
                {live && (
                  <div className={`rounded p-2 text-sm font-semibold ${live.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    Σκορ: {live.score.toFixed(1)} / {live.maxScore} — {live.passed ? 'PASS ✅' : 'FAIL ❌'} (κατώφλι {qn.threshold ?? '—'})
                  </div>
                )}
              </div>
            )}

            <button type="button" disabled={busy} onClick={save} className="rounded bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">Αποθήκευση στην εταιρία</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire into companies-view.tsx**

1. Add import near the other imports: `import { AssessmentDialog } from '@/components/companies/assessment-dialog';`
2. Add state near `const [contactFor, setContactFor] = ...` (line ~191): `const [assessing, setAssessing] = React.useState<CompanyRow | null>(null);`
3. Add a dropdown item after the «Προσθήκη επαφής» item (after line ~329):

```tsx
              <DropdownMenuItem onClick={() => setAssessing(c)}>
                <FiClipboard /> Αξιολόγηση
              </DropdownMenuItem>
```

(import `FiClipboard` from `react-icons/fi` in the existing fi import line.)

4. Render the dialog near the `<ContactDialog ... />` (line ~422):

```tsx
      <AssessmentDialog
        open={!!assessing}
        companyId={assessing?.id ?? null}
        companyName={assessing?.name ?? ''}
        onClose={() => setAssessing(null)}
      />
```

- [ ] **Step 3: Build check**

Run: `npm run build 2>&1 | tail -8`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/companies/assessment-dialog.tsx app/admin/companies/companies-view.tsx
git commit -m "feat(companies): Αξιολόγηση action — eligibility + questionnaire dialog"
```

---

## Phase 5 — Wiki & acceptance

### Task 15: Wiki entry (mandatory per CLAUDE.md)

**Files:**
- Create: `docs/wiki/programs/self-assessment.mdx` (via scaffold)

- [ ] **Step 1: Scaffold the wiki page**

Run:
```bash
npm run wiki:new -- programs/self-assessment --roles "SUPER_ADMIN,ADMIN,EMPLOYEE" --title "Αυτοαξιολόγηση & Αξιολόγηση Εταιριών"
```
Expected: creates `docs/wiki/programs/self-assessment.mdx`. If `programs` module missing from `lib/wiki/modules-meta.ts`, add an entry (label "Προγράμματα", icon/gradient) first.

- [ ] **Step 2: Write content**

Replace the scaffolded body with Greek content:
- Frontmatter: `description`, `roles`, `helpAnchors: [self-assessment]`, `screenshots: [{ file: questionnaire.png, route: /admin/programs/<id>, caption: "Tab Αυτοαξιολόγηση" }]`.
- `<Steps>`: (1) Άνοιγμα προγράμματος → tab «Αυτοαξιολόγηση» → «Δημιουργία με AI» → επεξεργασία ερωτήσεων/βαρών → Αποθήκευση. (2) Από εταιρία → dropdown «Αξιολόγηση» → επιλογή προγράμματος → έλεγχος βασικών κριτηρίων → συμπλήρωση ερωτηματολογίου → Αποθήκευση.
- `<Callout type="warning">`: το «Δημιουργία με AI» αντικαθιστά το υπάρχον ερωτηματολόγιο.
- `<Callout type="info">`: το προσωπικό (ΕΜΕ) ελέγχεται κατά προσέγγιση από το `employeeCount`.

- [ ] **Step 3: Rebuild search index**

Run: `npm run wiki:index`
Expected: updates `public/wiki/index.json`.

- [ ] **Step 4: Commit**

```bash
git add docs/wiki/programs/self-assessment.mdx public/wiki/index.json lib/wiki/modules-meta.ts
git commit -m "docs(wiki): self-assessment & company evaluation page"
```

---

### Task 16: End-to-end acceptance (manual)

**Files:** none (verification)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all `assessment-score`, `eligibility`, `assessment-autofill`, `assessment-verdict` tests PASS (plus existing region tests).

- [ ] **Step 2: Generate questionnaire for the test program**

Start dev server (`npm run dev`), open `/admin/programs/cmpo0byg200009id4dhuh43iw`, tab «Αυτοαξιολόγηση» → «Δημιουργία με AI».
Expected: questions appear with weights/options. Edit one question + Save → persists after refresh.

- [ ] **Step 3: Evaluate a company**

Open `/admin/companies`, on a company with ΚΑΔ + νομική μορφή + ημ. ίδρυσης → dropdown «Αξιολόγηση» → pick the program → «Έλεγχος κριτηρίων».
Expected: βασικά κριτήρια table with ✅/❌; objective questions pre-filled with «από στοιχεία εταιρίας» badge.

- [ ] **Step 4: Complete + verify score**

Fill remaining questions → live σκορ updates → PASS/FAIL vs κατώφλι correct → «Αποθήκευση στην εταιρία».
Expected: toast success; GET `/api/admin/programs/<id>/assessments` lists the company.

- [ ] **Step 5: Final commit (if any tweaks)**

```bash
git add -A
git commit -m "test(programs): self-assessment acceptance verified"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** §3.1 → Task 6; §3.2 → Tasks 7-8; §3.3 → Task 4; §3.4 → Task 5; §3.5 → Task 3; §4 → Task 1; §5 → Tasks 8,10,11,12; §6.1 → Task 13; §6.2 → Task 14; §7 → Task 9; §8 → Task 15; §9 → Task 16. ✓
- **Type consistency:** `ScoringQuestion`/`ScoringAnswer`/`computeScore`/`awardPoints`/`evaluateEligibility`/`autofillAnswers`/`computeVerdict` names identical across tasks. `QuestionDraftWithId` defined in Task 5, reused in Task 10. ✓
- **Known approximations (documented):** ΕΜΕ via `employeeCount`; region matched by name after Καλλικράτης code resolution; NUMERIC scoring = clamped value.
- **Assumptions to verify at execution:** `GET /api/admin/programs?status=PUBLISHED` response shape (dialog handles array/`items`/`programs`); existence of `Company.employeeCount` (confirmed in schema); `<PageHeader>` location for `helpAnchor`.
