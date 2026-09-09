# Extraction Templates — Plan 2b: Standalone templates, auto-slug, field detection, JSON output

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a template independent of any supplier (name + auto slug + optional department/supplier link), let the designer create fields by drawing a region (the model names the field and the slug), propose fields from hand-circled marks on the sample, output a JSON `{ template, version, extractedAt, values }` per run, and seed templates from a customer PDF.

**Architecture:** Spec `docs/superpowers/specs/2026-09-09-extraction-templates-design.md` §14 (read §14 in full before any task). Isomorphic pure helpers in `lib/templates/{schema,guess,output,detect-parse}.ts` (vitest), server-only `lib/templates/{detect,sample}.ts`, three new route handlers under `app/api/admin/ocr/templates/[id]/`, designer UI in `components/templates/*`, a Prisma migration, and a dev script `scripts/templates/seed-from-pdf.ts`.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (PostgreSQL, hand-written SQL migrations, `npx prisma migrate deploy`), zod 4, vitest 4, sharp, `@xyflow/react`, DG design system (Tailwind preset), react-icons/fi, sonner, `pdf-lib` (new devDependency, seed script only).

**Conventions (from CLAUDE.md and previous plans):**
- Type-check: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"` → no output = clean.
- Tests: `npx vitest run lib/templates` (all of `lib/**/*.test.ts` run with `npm test`).
- Greek UI text, no dynamic Tailwind class names (inline hex for data colours), `cursor-pointer` on clickable non-buttons.
- Never commit `.env`. The DB in `.env` is the customer's live DB — migrations are applied with `npx prisma migrate deploy` only, exactly as plan 1 did.
- Commit after every task with a conventional message.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/migrations/20260909200000_template_standalone/migration.sql` | slug/department columns, drop docType, vatNumber nullable, MANUAL default |
| `prisma/schema.prisma` | `ExtractionTemplate` model changes |
| `lib/templates/schema.ts` | + `uniqueKey`, `templateSlug` |
| `lib/templates/guess.ts` | `guessValueType`, `isGlAccount` (pure) |
| `lib/templates/output.ts` | `toOutputJson` (pure) |
| `lib/templates/detect-parse.ts` | `extractJson`, `parseDetectField`, `parseMarks`, `toBbox` (pure) |
| `lib/templates/detect.ts` | `detectFieldFromCrop`, `detectMarksOnPage` (server, vision) |
| `lib/templates/vision.ts` | export `callVision` |
| `lib/templates/sample.ts` | `storeSample` (server) — shared by the sample route and the seed script |
| `lib/templates/serialize.ts` | DTO: `slug`, `department`, `runsCount`; no `docType` |
| `lib/templates/labels.ts` | MODE_HELP text for MANUAL |
| `app/api/admin/ocr/templates/route.ts` | create with slug; list with slug/department |
| `app/api/admin/ocr/templates/[id]/route.ts` | PATCH slug/department/vatNumber; readiness rules |
| `app/api/admin/ocr/templates/[id]/sample/route.ts` | delegates to `storeSample` |
| `app/api/admin/ocr/templates/[id]/detect-field/route.ts` | region → proposed field |
| `app/api/admin/ocr/templates/[id]/detect-marks/route.ts` | page → proposed fields from circles/notes |
| `app/api/admin/ocr/templates/[id]/test/route.ts` | read all fields → JSON output |
| `components/templates/api.ts` | client helpers + error texts |
| `components/templates/supplier-search.tsx` | reusable SoftOne supplier combobox (extracted from the dialog) |
| `components/templates/details-step.tsx` | replaces `supplier-step.tsx` |
| `components/templates/template-designer.tsx` | steps, readiness |
| `components/templates/regions-step.tsx` | field-from-region, detect marks, test JSON |
| `components/templates/test-json-dialog.tsx` | JSON result dialog |
| `app/admin/ocr/templates/new-template-dialog.tsx` | name + slug + department |
| `app/admin/ocr/templates/{page,templates-table}.tsx` | list columns |
| `components/admin/sidebar.tsx` | label «Πρότυπα εξαγωγής» |
| `docs/wiki/ocr/templates.mdx`, `docs/manual/CHANGELOG.md` | docs |
| `scripts/templates/seed-from-pdf.ts` | split customer PDF, create templates, propose fields |

---

### Task 1: Pure helpers `uniqueKey`, `templateSlug`

**Files:**
- Modify: `lib/templates/schema.ts`
- Test: `lib/templates/__tests__/schema.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `lib/templates/__tests__/schema.test.ts`:

```ts
import { uniqueKey, templateSlug } from '../schema';

describe('uniqueKey', () => {
  it('returns the base when free', () => { expect(uniqueKey('total', ['date'])).toBe('total'); });
  it('suffixes _2, _3… when taken', () => {
    expect(uniqueKey('total', ['total'])).toBe('total_2');
    expect(uniqueKey('total', ['total', 'total_2'])).toBe('total_3');
  });
  it('accepts any iterable', () => { expect(uniqueKey('a', new Set(['a']))).toBe('a_2'); });
});

describe('templateSlug', () => {
  it('slugs Greek names like a field key', () => { expect(templateSlug('ΗΡΩΝ — Εκκαθαριστικός')).toBe('iron_ekkatharistikos'); });
  it('never returns empty', () => { expect(templateSlug('!!!')).toMatch(/^field_/); });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/templates/__tests__/schema.test.ts` → FAIL (`uniqueKey` is not exported). If the Greek expectation in the first `templateSlug` test differs from what `slugifyFieldKey` actually produces, run `node -e` against `lib/ocr/field-rules.ts` to read the real output and put THAT string in the test (the point is stability, not a specific transliteration).

- [ ] **Step 3: Implement** — append to `lib/templates/schema.ts`:

```ts
/** `base` if not taken, else `base_2`, `base_3`, … (exact, case-sensitive match). */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Template slug — the key of the JSON output. Same charset/rules as a field key. */
export function templateSlug(name: string): string {
  return slugKey(name);
}
```

- [ ] **Step 4: Run** the test file → PASS.
- [ ] **Step 5: Commit** — `git add lib/templates && git commit -m "feat(templates): uniqueKey and templateSlug helpers"`

---

### Task 2: Migration + Prisma model + DTO + sample storage key

**Files:**
- Create: `prisma/migrations/20260909200000_template_standalone/migration.sql`
- Modify: `prisma/schema.prisma` (model `ExtractionTemplate`), `lib/templates/serialize.ts`, `app/api/admin/ocr/templates/[id]/sample/route.ts`

- [ ] **Step 1: Migration SQL** — create the file with exactly:

```sql
-- Templates become standalone (spec §14): slug is the identity, the supplier link is optional, docType goes away.
ALTER TABLE "ExtractionTemplate" ADD COLUMN "slug" TEXT;
-- Backfill: Latin-only slug + id fragment (Greek names of the few test rows collapse to "_<id>"; they get renamed in the UI).
UPDATE "ExtractionTemplate"
SET "slug" = trim(both '_' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '_', 'g'))) || '_' || left("id", 6);
ALTER TABLE "ExtractionTemplate" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "ExtractionTemplate_slug_key" ON "ExtractionTemplate"("slug");

DROP INDEX IF EXISTS "ExtractionTemplate_vatNumber_docType_name_key";
DROP INDEX IF EXISTS "ExtractionTemplate_vatNumber_docType_status_idx";
ALTER TABLE "ExtractionTemplate" DROP COLUMN "docType";
ALTER TABLE "ExtractionTemplate" ALTER COLUMN "vatNumber" DROP NOT NULL;
ALTER TABLE "ExtractionTemplate" ADD COLUMN "department" TEXT;
ALTER TABLE "ExtractionTemplate" ALTER COLUMN "mode" SET DEFAULT 'MANUAL';
CREATE INDEX "ExtractionTemplate_vatNumber_status_idx" ON "ExtractionTemplate"("vatNumber", "status");
```

- [ ] **Step 2: Prisma model** — in `prisma/schema.prisma` replace the head of `model ExtractionTemplate` so it reads:

```prisma
model ExtractionTemplate {
  id               String          @id @default(cuid())
  name             String
  slug             String          @unique         // auto από name — κλειδί του JSON εξόδου
  department       String?                         // τμήμα / κατηγορία (ελεύθερο κείμενο)
  vatNumber        String?                         // ΑΦΜ προμηθευτή — προαιρετική συσχέτιση
  traderTrdr       Int?                            // → SoftoneTrader.trdr (προαιρετικό)
  supplierName     String?                         // denormalized για λίστες
  mode             TemplateMode    @default(MANUAL)
  status           TemplateStatus  @default(DRAFT)
```
Remove the `docType` line, and at the bottom of the model replace the `@@unique([vatNumber, docType, name])` / `@@index([vatNumber, docType, status])` lines with `@@index([vatNumber, status])`. Keep everything else.

- [ ] **Step 3: Apply** — `npx prisma migrate deploy` (expected: `1 migration applied`) then `npx prisma generate`.

- [ ] **Step 4: DTO** — in `lib/templates/serialize.ts`:
  - change `TEMPLATE_INCLUDE` to `{ fields: true, mappings: true, conditions: true, _count: { select: { runs: true } } } as const`;
  - change the `toTemplateDto` parameter type to `ExtractionTemplate & { fields: TemplateField[]; mappings: TemplateMapping[]; conditions: TemplateCondition[]; _count?: { runs: number } }`;
  - in the returned object replace `vatNumber: t.vatNumber, traderTrdr: t.traderTrdr, supplierName: t.supplierName, docType: t.docType,` with `slug: t.slug, department: t.department, vatNumber: t.vatNumber, traderTrdr: t.traderTrdr, supplierName: t.supplierName, runsCount: t._count?.runs ?? 0,`.

- [ ] **Step 5: Sample key** — in `app/api/admin/ocr/templates/[id]/sample/route.ts` change the key to `` const key = `templates/${id}/sample-${nanoid(8)}.${ext}`; `` (no ΑΦΜ in the path).

- [ ] **Step 6: Type-check** — `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`. Expected errors ONLY in files that still reference `docType`/non-null `vatNumber`: `app/api/admin/ocr/templates/route.ts`, `[id]/route.ts`, `app/admin/ocr/templates/*.tsx`, `components/templates/supplier-step.tsx`, `components/templates/template-designer.tsx`, `components/templates/api.ts` and possibly `lib/templates/flow.ts`. List them in your report — Tasks 3 and 7 fix them. Do NOT fix UI files here.

- [ ] **Step 7: Commit** — `git add prisma lib/templates/serialize.ts app/api/admin/ocr/templates/[id]/sample && git commit -m "feat(templates): standalone template model — slug, department, optional supplier, no docType"`

---

### Task 3: Create / list / PATCH routes + client API types

**Files:**
- Modify: `app/api/admin/ocr/templates/route.ts`, `app/api/admin/ocr/templates/[id]/route.ts`, `components/templates/api.ts`, `lib/templates/labels.ts`

- [ ] **Step 1: List + create** — rewrite `app/api/admin/ocr/templates/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { templateSlug, uniqueKey } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const SLUG_RE = /^[a-z0-9_]{1,60}$/;

/** Row shape for the list page and GET. */
export function toListRow(t: { id: string; name: string; slug: string; department: string | null; vatNumber: string | null; supplierName: string | null; mode: 'AUTO' | 'SEMI_AUTO' | 'MANUAL'; status: 'DRAFT' | 'ACTIVE'; version: number; timesUsed: number; sampleStorageKey: string | null; updatedAt: Date; _count: { fields: number; runs: number } }) {
  return {
    id: t.id, name: t.name, slug: t.slug, department: t.department, vatNumber: t.vatNumber, supplierName: t.supplierName,
    mode: t.mode, status: t.status, version: t.version, fieldsCount: t._count.fields, runsCount: t._count.runs,
    timesUsed: t.timesUsed, hasSample: !!t.sampleStorageKey, updatedAt: t.updatedAt.toISOString(),
  };
}
export const LIST_QUERY = { orderBy: [{ name: 'asc' as const }], include: { _count: { select: { fields: true, runs: true } } } };

// GET — λίστα προτύπων
export async function GET() {
  await requirePermission('ocr.read');
  const rows = await prisma.extractionTemplate.findMany(LIST_QUERY);
  return NextResponse.json({ templates: rows.map(toListRow) });
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(SLUG_RE, 'Slug: μόνο a-z, 0-9, _').optional(),
  department: z.string().trim().max(80).nullable().optional(),
  vatNumber: z.string().trim().regex(/^\d{9}$/, 'ΑΦΜ 9 ψηφίων').nullable().optional(),
  traderTrdr: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
});

/** First free slug for `base` (base, base_2, …) — one query, no loop of round-trips. */
export async function freeSlug(base: string): Promise<string> {
  const rows = await prisma.extractionTemplate.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } });
  return uniqueKey(base, rows.map((r) => r.slug));
}

// POST — νέο πρότυπο (DRAFT). Μόνο το όνομα είναι υποχρεωτικό (spec §14.1).
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  let slug: string;
  if (b.slug) {
    if (await prisma.extractionTemplate.findUnique({ where: { slug: b.slug }, select: { id: true } })) {
      return NextResponse.json({ error: 'duplicate_slug', message: 'Υπάρχει ήδη πρότυπο με αυτό το slug' }, { status: 409 });
    }
    slug = b.slug;
  } else slug = await freeSlug(templateSlug(b.name));

  try {
    const t = await prisma.extractionTemplate.create({
      data: { name: b.name, slug, department: b.department ?? null, vatNumber: b.vatNumber ?? null, traderTrdr: b.traderTrdr ?? null, supplierName: b.supplierName ?? null, createdById: u.id },
    });
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.create', resource: 'extractionTemplate', resourceId: t.id, metadata: { name: t.name, slug: t.slug } });
    return NextResponse.json({ ok: true, id: t.id, slug: t.slug }, { status: 201 });
  } catch (err) {
    // Two concurrent creates can race freeSlug(); the unique index is the arbiter.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'duplicate_slug', message: 'Υπάρχει ήδη πρότυπο με αυτό το slug' }, { status: 409 });
    }
    throw err;
  }
}
```
NOTE: Next.js route files may only export HTTP verbs plus config. Move `SLUG_RE`, `toListRow`, `LIST_QUERY`, `freeSlug` into a new server module `lib/templates/list.ts` (with `import 'server-only'`) and import them from there in both this route and `app/admin/ocr/templates/page.tsx` (Task 7). Keep `SLUG_RE` also importable by the client: put `SLUG_RE` in `lib/templates/schema.ts` (isomorphic) instead of `list.ts`.

- [ ] **Step 2: PATCH** — in `app/api/admin/ocr/templates/[id]/route.ts`:
  - `PatchBody`: add `slug: z.string().trim().regex(SLUG_RE).optional()`, `department: z.string().trim().max(80).nullable().optional()`, change `vatNumber` to `z.string().trim().regex(/^\d{9}$/).nullable().optional()` (new field).
  - After loading `t`, add:
    ```ts
    if (b.slug !== undefined && b.slug !== t.slug && (t._count?.runs ?? 0) > 0) {
      return NextResponse.json({ error: 'slug_locked', message: 'Το slug κλειδώνει μόλις το πρότυπο αποκτήσει εκτελέσεις' }, { status: 409 });
    }
    ```
    (`TEMPLATE_INCLUDE` now carries `_count.runs` from Task 2.)
  - Replace the readiness block with:
    ```ts
    // ACTIVE needs a sample and a field with a region; a mapping only when the mode posts to SoftOne (spec §14.1-4).
    const status = b.status ?? t.status;
    if (status === 'ACTIVE') {
      const hasRegion = t.fields.some((f) => f.region != null);
      const needsMapping = mode !== 'MANUAL' && t.mappings.length === 0;
      if (!hasRegion || !t.sampleStorageKey || needsMapping) {
        return NextResponse.json({ error: 'not_ready', message: 'Για ενεργοποίηση χρειάζονται δείγμα και ένα πεδίο με περιοχή — και mapping για ημιαυτόματη/αυτόματη λειτουργία' }, { status: 422 });
      }
    }
    ```
    (this also blocks switching an ACTIVE template to SEMI_AUTO/AUTO without a mapping).
  - In the update `data`, add `...(b.slug !== undefined && { slug: b.slug })`, `...(b.department !== undefined && { department: b.department })`, `...(b.vatNumber !== undefined && { vatNumber: b.vatNumber })`.
  - P2002 handler: return `{ error: 'duplicate_slug', message: 'Υπάρχει ήδη πρότυπο με αυτό το slug' }` (409).

- [ ] **Step 3: Client API** — in `components/templates/api.ts`:
  - `create` body type → `{ name: string; slug?: string; department?: string | null; vatNumber?: string | null; traderTrdr?: number | null; supplierName?: string | null }`, result `{ ok: true; id: string; slug: string }`.
  - `patch` body type → `Partial<{ name: string; slug: string; department: string | null; vatNumber: string | null; traderTrdr: number | null; supplierName: string | null; mode: TemplateDto['mode']; status: TemplateDto['status']; notifyEmails: string | null }>`.
  - `ERROR_TEXT`: replace `duplicate` with `duplicate_slug: 'Υπάρχει ήδη πρότυπο με αυτό το slug.'`, add `slug_locked: 'Το slug κλειδώνει μόλις το πρότυπο αποκτήσει εκτελέσεις.'`, `no_fields: 'Δεν υπάρχουν πεδία με περιοχή.'`, `bad_page: 'Μη έγκυρη σελίδα.'`, and update `not_ready` to the new message text.
- [ ] **Step 4: Labels** — in `lib/templates/labels.ts` set `MODE_HELP.MANUAL = 'Μόνο εξαγωγή πεδίων σε JSON. Χωρίς mapping/ανάρτηση — τα υπόλοιπα γίνονται χειροκίνητα.'`.
- [ ] **Step 5: Type-check** as in Task 2 Step 6; remaining errors must be only in UI files (Task 7). `npx vitest run lib/templates` → all green.
- [ ] **Step 6: Commit** — `git add -A lib/templates app/api/admin/ocr/templates components/templates/api.ts && git commit -m "feat(templates): create/patch with slug, department, optional supplier; MANUAL needs no mapping"`

---

### Task 4: `guessValueType`, `isGlAccount`, `toOutputJson`

**Files:**
- Create: `lib/templates/guess.ts`, `lib/templates/output.ts`
- Test: `lib/templates/__tests__/guess.test.ts`, `lib/templates/__tests__/output.test.ts`

- [ ] **Step 1: Failing tests**

`lib/templates/__tests__/guess.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { guessValueType, isGlAccount } from '../guess';

describe('guessValueType', () => {
  it.each([
    ['30/06/2026', 'DATE'], ['16.6.2026', 'DATE'], ['2026-06-30', 'DATE'], ['2026.06.30', 'DATE'], ['22/06/2026 10:59', 'DATE'],
    ['3.584,00 EUR', 'CURRENCY'], ['78.298,47€', 'CURRENCY'], ['1.015,69', 'CURRENCY'], ['229,40', 'CURRENCY'], ['4,122.85', 'CURRENCY'],
    ['24.000', 'NUMBER'], ['309', 'NUMBER'], ['24 %', 'NUMBER'], ['437.775,64 kWh', 'NUMBER'], ['300 M3', 'NUMBER'],
    ['ΤΠΥ0000017', 'TEXT'], ['094170559', 'TEXT'], ['', 'TEXT'], ['Επί πιστώσει', 'TEXT'], ['60.64.00.000.010', 'TEXT'],
  ])('%s → %s', (raw, expected) => { expect(guessValueType(raw)).toBe(expected); });
});

describe('isGlAccount', () => {
  it.each(['60.64.00.000.010', '62.03.90.000.023', '25.09.00.000.006', '61.90.01.016.023'])('accepts %s', (s) => { expect(isGlAccount(s)).toBe(true); });
  it.each(['3.584,00', '2026.06.30', '24.000', 'ΤΠΥ0000017', '60.64'])('rejects %s', (s) => { expect(isGlAccount(s)).toBe(false); });
  it('ignores spaces written between groups', () => { expect(isGlAccount('60.64.00. 000.010')).toBe(true); });
});
```
Note `094170559` (a 9-digit ΑΦΜ with a leading zero) must stay TEXT; `309` is NUMBER (the user retypes when it is really a document number).

`lib/templates/__tests__/output.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toOutputJson } from '../output';
import type { FieldValue } from '../schema';

const fv = (value: FieldValue['value']): FieldValue => ({ raw: String(value), value, confidence: 1, source: 'text', page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

describe('toOutputJson', () => {
  it('keys coerced values by field key, with slug/version/timestamp', () => {
    const at = new Date('2026-09-09T18:00:00.000Z');
    const out = toOutputJson({ slug: 'kapaline', version: 3 }, { arithmos: fv('309'), poso: fv(229.4), lines: fv([{ eidos: 'x', poso: 185 }]) }, at);
    expect(out).toEqual({ template: 'kapaline', version: 3, extractedAt: '2026-09-09T18:00:00.000Z', values: { arithmos: '309', poso: 229.4, lines: [{ eidos: 'x', poso: 185 }] } });
  });
  it('keeps null for fields that were not read', () => {
    expect(toOutputJson({ slug: 's', version: 1 }, { a: { ...fv(null), source: 'none' } }).values).toEqual({ a: null });
  });
});
```

- [ ] **Step 2: Run** both files → FAIL (modules missing).
- [ ] **Step 3: Implement**

`lib/templates/guess.ts`:
```ts
// lib/templates/guess.ts — ISOMORPHIC. Heuristics for a value the model just read.
import type { TemplateValueType } from './schema';

const DATE_RE = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/;
// Greek "1.234,56" / "229,40" and English "4,122.85" — two decimals are the tell.
const CURRENCY_RE = /^[-+]?(\d{1,3}([.,]\d{3})*|\d+)[.,]\d{2}$/;
const CURRENCY_MARK_RE = /€|\beur\b|\bευρώ\b/i;
const NUMBER_RE = /^[-+]?(\d{1,3}(\.\d{3})*|\d+)([.,]\d+)?$/;
const UNIT_RE = /\s*(%|kwh|m3|m³|kg|lt|l|τεμ\.?|pcs?\.?|κιλά)$/i;
/** Ελληνικό λογιστικό άρθρο: 60.64.00.000.010 (≥3 groups). */
export const GL_ACCOUNT_RE = /^\d{2}(\.\d{2,3}){2,}$/;

export function isGlAccount(raw: string): boolean {
  return GL_ACCOUNT_RE.test(String(raw ?? '').replace(/\s+/g, ''));
}

export function guessValueType(raw: string): TemplateValueType {
  const s = String(raw ?? '').trim();
  if (!s) return 'TEXT';
  if (isGlAccount(s)) return 'TEXT';
  if (DATE_RE.test(s)) return 'DATE';
  const core = s.replace(CURRENCY_MARK_RE, '').trim();
  if (CURRENCY_MARK_RE.test(s) && /\d/.test(core)) return 'CURRENCY';
  if (CURRENCY_RE.test(core)) return 'CURRENCY';
  const num = core.replace(UNIT_RE, '').trim();
  if (NUMBER_RE.test(num) && !/^0\d/.test(num)) return 'NUMBER';
  return 'TEXT';
}
```

`lib/templates/output.ts`:
```ts
// lib/templates/output.ts — ISOMORPHIC. The one JSON shape every extraction produces (spec §14.1-5).
import type { FieldValue } from './schema';

export type OutputJson = { template: string; version: number; extractedAt: string; values: Record<string, FieldValue['value']> };

export function toOutputJson(t: { slug: string; version: number }, values: Record<string, FieldValue>, at: Date = new Date()): OutputJson {
  const out: OutputJson['values'] = {};
  for (const [key, v] of Object.entries(values)) out[key] = v.value;
  return { template: t.slug, version: t.version, extractedAt: at.toISOString(), values: out };
}
```

- [ ] **Step 4: Run** tests → PASS. If a `guessValueType` case fails, fix the regex, not the expectation (each expectation is a real value from the customer PDF).
- [ ] **Step 5: Commit** — `git add lib/templates && git commit -m "feat(templates): value-type guessing, GL account detection, JSON output shape"`

---

### Task 5: Detection parsers (pure) + vision-backed detectors

**Files:**
- Create: `lib/templates/detect-parse.ts`, `lib/templates/detect.ts`
- Modify: `lib/templates/vision.ts` (export `callVision`; generic wording)
- Test: `lib/templates/__tests__/detect-parse.test.ts`

- [ ] **Step 1: Failing tests** — `lib/templates/__tests__/detect-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractJson, parseDetectField, parseMarks, toBbox } from '../detect-parse';

describe('extractJson', () => {
  it('strips fences and prose around the object', () => {
    expect(extractJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('returns null on garbage', () => { expect(extractJson('no json here')).toBeNull(); });
});

describe('parseDetectField', () => {
  it('builds a SINGLE field with a deduped key and a guessed type when the model omits one', () => {
    const f = parseDetectField('{"label":"Αριθμός","value":"309","kind":"SINGLE"}', { taken: ['arithmos'], fallbackLabel: 'Πεδίο 3' });
    expect(f).toMatchObject({ label: 'Αριθμός', key: 'arithmos_2', kind: 'SINGLE', valueType: 'NUMBER', value: '309', columns: null });
  });
  it('trusts a valid model valueType', () => {
    expect(parseDetectField('{"label":"Αρ.","value":"309","valueType":"text"}', { taken: [], fallbackLabel: 'x' }).valueType).toBe('TEXT');
  });
  it('falls back to the given label when the model has none', () => {
    expect(parseDetectField('{"value":"x"}', { taken: [], fallbackLabel: 'Πεδίο 1' }).label).toBe('Πεδίο 1');
  });
  it('builds TABLE columns with unique keys', () => {
    const f = parseDetectField('{"label":"Γραμμές","kind":"TABLE","columns":[{"label":"Είδος"},{"label":"Είδος"},{"label":"Αξία","valueType":"CURRENCY"}]}', { taken: [], fallbackLabel: 'x' });
    expect(f.kind).toBe('TABLE');
    expect(f.columns?.map((c) => c.key)).toEqual(['eidos', 'eidos_2', 'axia']);
    expect(f.columns?.[2].valueType).toBe('CURRENCY');
  });
  it('a TABLE without columns degrades to SINGLE', () => {
    expect(parseDetectField('{"label":"x","kind":"TABLE","columns":[]}', { taken: [], fallbackLabel: 'x' }).kind).toBe('SINGLE');
  });
});

describe('toBbox', () => {
  it('converts Gemini box_2d [ymin,xmin,ymax,xmax] on a 0-1000 grid', () => {
    expect(toBbox({ box_2d: [100, 200, 300, 600] })).toEqual([0.2, 0.1, 0.4, 0.2]);
  });
  it('accepts an already-normalized bbox', () => { expect(toBbox({ bbox: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]); });
  it('rejects empty or inverted boxes', () => { expect(toBbox({ box_2d: [300, 200, 100, 600] })).toBeNull(); expect(toBbox({})).toBeNull(); });
});

describe('parseMarks', () => {
  const content = JSON.stringify({ marks: [
    { label: 'Αριθμός', value: '309', box_2d: [150, 600, 190, 700] },
    { label: '', value: '60.64.00.000.010', box_2d: [800, 100, 830, 400] },
    { label: 'Ημερομηνία', value: '30/06/2026', bbox: [0.7, 0.15, 0.2, 0.03] },
    { label: 'bad', value: 'x' },
  ] });
  it('keeps only marks with a usable box, dedupes keys against existing fields, names GL accounts', () => {
    const m = parseMarks(content, { taken: ['arithmos'] });
    expect(m.map((x) => x.key)).toEqual(['arithmos_2', 'gl_account_handwritten', 'imerominia']);
    expect(m[1].label).toBe('Λογιστικό άρθρο (χειρόγραφο)');
    expect(m[1].valueType).toBe('TEXT');
    expect(m[2].valueType).toBe('DATE');
    expect(m[2].bbox).toEqual([0.7, 0.15, 0.2, 0.03]);
  });
  it('caps the count', () => { expect(parseMarks(content, { taken: [], max: 1 })).toHaveLength(1); });
  it('returns [] for non-JSON', () => { expect(parseMarks('nope', { taken: [] })).toEqual([]); });
});
```
If `slugKey('Αριθμός')` / `slugKey('Είδος')` / `slugKey('Αξία')` / `slugKey('Ημερομηνία')` transliterate differently from `arithmos` / `eidos` / `axia` / `imerominia`, check with `node -e` and use the real strings.

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement `lib/templates/detect-parse.ts`**

```ts
// lib/templates/detect-parse.ts — ISOMORPHIC. Turns the vision model's JSON into field proposals (spec §14.1-6/7).
import { guessValueType, isGlAccount } from './guess';
import { isValidBbox, slugKey, uniqueKey, type Bbox, type ColumnDef, type TemplateFieldKind, type TemplateValueType } from './schema';

const VALUE_TYPES = new Set(['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'LIST']);
export const GL_LABEL = 'Λογιστικό άρθρο (χειρόγραφο)';
export const GL_KEY = 'gl_account_handwritten';

export type DetectedField = { label: string; key: string; kind: TemplateFieldKind; valueType: TemplateValueType; value: string; columns: ColumnDef[] | null };
export type DetectedMark = { label: string; key: string; valueType: TemplateValueType; value: string; bbox: Bbox };

/** First {...} object in a model reply, tolerating ```json fences and prose. */
export function extractJson(content: string): unknown | null {
  const stripped = String(content ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{'); const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)); } catch { return null; }
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function resolveType(model: unknown, value: string): TemplateValueType {
  const m = str(model).toUpperCase();
  return VALUE_TYPES.has(m) ? (m as TemplateValueType) : guessValueType(value);
}

export function parseDetectField(content: string, opts: { taken: Iterable<string>; fallbackLabel: string }): DetectedField {
  const obj = (extractJson(content) ?? {}) as Record<string, unknown>;
  const value = str(obj.value);
  const label = str(obj.label).replace(/[:：]\s*$/, '') || opts.fallbackLabel;
  const rawCols = Array.isArray(obj.columns) ? obj.columns : [];
  const kind: TemplateFieldKind = str(obj.kind).toUpperCase() === 'TABLE' && rawCols.length > 0 ? 'TABLE' : 'SINGLE';
  let columns: ColumnDef[] | null = null;
  if (kind === 'TABLE') {
    const used: string[] = [];
    columns = rawCols.map((c, i) => {
      const col = (typeof c === 'string' ? { label: c } : (c ?? {})) as Record<string, unknown>;
      const l = str(col.label) || `Στήλη ${i + 1}`;
      const k = uniqueKey(slugKey(l), used); used.push(k);
      return { key: k, label: l, valueType: resolveType(col.valueType, str(col.sample)) };
    });
  }
  return { label, key: uniqueKey(slugKey(label), opts.taken), kind, valueType: kind === 'TABLE' ? 'TEXT' : resolveType(obj.valueType, value), value, columns };
}

/** `box_2d` = [ymin, xmin, ymax, xmax] on a 0–1000 grid (Gemini), or `bbox` = [x, y, w, h] normalized 0–1. */
export function toBbox(m: Record<string, unknown>): Bbox | null {
  const b2 = m.box_2d;
  if (Array.isArray(b2) && b2.length === 4 && b2.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    const c = (n: number) => Math.min(1, Math.max(0, n / 1000));
    const [ymin, xmin, ymax, xmax] = b2 as number[];
    const x = c(xmin), y = c(ymin);
    const box: Bbox = [round3(x), round3(y), round3(c(xmax) - x), round3(c(ymax) - y)];
    return isValidBbox(box) ? box : null;
  }
  const bb = m.bbox;
  if (isValidBbox(bb)) return bb.map(round3) as Bbox;
  return null;
}

export function parseMarks(content: string, opts: { taken: Iterable<string>; max?: number }): DetectedMark[] {
  const obj = extractJson(content) as { marks?: unknown } | null;
  const arr = Array.isArray(obj?.marks) ? (obj!.marks as unknown[]) : [];
  const taken = new Set(opts.taken);
  const out: DetectedMark[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const bbox = toBbox(m);
    if (!bbox) continue;
    const value = str(m.value);
    const gl = isGlAccount(value);
    const label = (gl ? str(m.label) || GL_LABEL : str(m.label).replace(/[:：]\s*$/, '')) || `Πεδίο ${out.length + 1}`;
    const key = uniqueKey(gl ? GL_KEY : slugKey(label), taken);
    taken.add(key);
    out.push({ label, key, valueType: gl ? 'TEXT' : resolveType(m.valueType, value), value, bbox });
    if (out.length >= (opts.max ?? 20)) break;
  }
  return out;
}
```

- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Vision** — in `lib/templates/vision.ts`: change `async function callVision(` to `export async function callVision(`; in `readCropValue` change "a cropped area of a Greek invoice/receipt" to "a cropped area of a scanned business document (Greek or English)"; in `readCropTable` change "of a Greek document" to "of a scanned business document".

- [ ] **Step 6: Implement `lib/templates/detect.ts`**

```ts
// lib/templates/detect.ts — SERVER. "Name this region" and "find what the accountant circled" (spec §14.1-6/7).
import 'server-only';
import sharp from 'sharp';
import { callVision, prepareCrop, type UsageRef } from './vision';
import { parseDetectField, parseMarks, type DetectedField, type DetectedMark } from './detect-parse';
import type { Bbox } from './schema';

const FIELD_PROMPT = [
  'You are labelling one region of a scanned business document (Greek or English) for a data-extraction template.',
  'Return ONLY JSON: {"label":"<short field name in the document\'s language, e.g. Αριθμός παραστατικού>","value":"<the raw value printed or handwritten in the region>","kind":"SINGLE"|"TABLE","valueType":"TEXT"|"NUMBER"|"CURRENCY"|"DATE"|"LIST","columns":[{"label":"...","valueType":"..."}]}.',
  'If the region shows a caption next to a value: label = the caption without its colon, value = the value. If it shows only a value: invent a short descriptive label.',
  'If it shows a table header or table rows: kind = "TABLE" and list every column; otherwise columns = [].',
  'No markdown, no explanation.',
].join('\n');

export async function detectFieldFromCrop(pageBuf: Buffer, bbox: Bbox, opts: { taken: Iterable<string>; fallbackLabel: string; ref?: UsageRef }): Promise<{ field: DetectedField; model: string; tokensUsed: number | null }> {
  const crop = await prepareCrop(pageBuf, bbox);
  const r = await callVision(crop, FIELD_PROMPT, 'template.detectField', opts.ref);
  return { field: parseDetectField(r.content, { taken: opts.taken, fallbackLabel: opts.fallbackLabel }), model: r.model, tokensUsed: r.tokensUsed };
}

const MARKS_PROMPT = [
  'This is a full page of a scanned business document. An accountant has marked by hand what must be extracted: hand-drawn circles or ellipses around printed values, and handwritten notes (accounting codes such as 60.64.00.000.010, amounts, words).',
  'Return ONLY JSON: {"marks":[{"label":"<the printed caption of the circled value, or a short name>","value":"<the text inside the mark, exactly as printed or written>","valueType":"TEXT"|"NUMBER"|"CURRENCY"|"DATE","box_2d":[ymin,xmin,ymax,xmax]}]}.',
  'box_2d is on a 0-1000 grid over the whole image (y grows downwards) and must contain the entire circle or note. One entry per circle and per handwritten note. Ignore stamps such as ΚΑΤΕΧΩΡΗΘΗ, signatures and ticks. At most 20 entries. No markdown.',
].join('\n');

const ALL_PROMPT = [
  'This is a full page of a scanned business document (Greek or English). List every labelled value a data-extraction template could want: document number, dates, codes, amounts, quantities with units, identifiers, registration plates, account numbers, handwritten notes. Skip long free text, addresses, legal footers and marketing.',
  'Return ONLY JSON: {"marks":[{"label":"<the printed caption, without its colon>","value":"<the value exactly as printed or written>","valueType":"TEXT"|"NUMBER"|"CURRENCY"|"DATE","box_2d":[ymin,xmin,ymax,xmax]}]}.',
  'box_2d is on a 0-1000 grid over the whole image (y grows downwards) and must contain the value (and its caption when adjacent). At most 20 entries, most important first. No markdown.',
].join('\n');

export type DetectMode = 'marks' | 'all';

/** Whole-page detection. `marks` = only what the accountant circled/wrote; `all` = every labelled value (clean samples). The bitmap is downscaled (boxes are normalized, so scale is irrelevant) and kept in colour — pen marks matter. */
export async function detectMarksOnPage(pageBuf: Buffer, opts: { taken: Iterable<string>; mode?: DetectMode; ref?: UsageRef }): Promise<{ marks: DetectedMark[]; model: string; tokensUsed: number | null }> {
  const img = await sharp(pageBuf).resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const r = await callVision(img, opts.mode === 'all' ? ALL_PROMPT : MARKS_PROMPT, opts.mode === 'all' ? 'template.detectAll' : 'template.detectMarks', opts.ref);
  return { marks: parseMarks(r.content, { taken: opts.taken }), model: r.model, tokensUsed: r.tokensUsed };
}
```

- [ ] **Step 7: Type-check** (UI errors from Task 2 may remain; nothing new) and `npx vitest run lib/templates` green.
- [ ] **Step 8: Commit** — `git add lib/templates && git commit -m "feat(templates): field detection from a region and from hand-marked pages"`

---

### Task 6: Endpoints `detect-field`, `detect-marks`, `test`

**Files:**
- Create: `app/api/admin/ocr/templates/[id]/detect-field/route.ts`, `.../detect-marks/route.ts`, `.../test/route.ts`
- Modify: `components/templates/api.ts`

- [ ] **Step 1: `detect-field/route.ts`**

```ts
// POST { region } → proposed field for that region of the sample (spec §14.3).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { renderPage } from '@/lib/ocr/rasterize';
import { detectFieldFromCrop } from '@/lib/templates/detect';
import { RegionSchema } from '@/lib/templates/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ region: RegionSchema });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { region } = parsed.data;

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  if (region.page >= (t.samplePageCount ?? 1)) return NextResponse.json({ error: 'bad_page' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  try {
    const pageBuf = await renderPage(buf, t.sampleMimeType ?? 'application/pdf', region.page);
    const r = await detectFieldFromCrop(pageBuf, region.bbox, { taken: t.fields.map((f) => f.key), fallbackLabel: `Πεδίο ${t.fields.length + 1}`, ref: { refType: 'ExtractionTemplate', refId: id } });
    return NextResponse.json({ ...r.field, model: r.model, tokensUsed: r.tokensUsed ?? 0, durationMs: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ error: 'read_failed', message: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: `detect-marks/route.ts`** — same skeleton; `Body = z.object({ page: z.number().int().min(0), mode: z.enum(['marks', 'all']).default('all') })`; validate `page < (t.samplePageCount ?? 1)` else 422 `bad_page`; `const pageBuf = await renderPage(buf, mime, page, 2)`; `detectMarksOnPage(pageBuf, { taken, mode, ref })`; respond `{ marks, model, tokensUsed: tokensUsed ?? 0, durationMs }`.

- [ ] **Step 3: `test/route.ts`** — reads every saved field with a region:

```ts
// POST {} → JSON output of the template applied to its own sample (spec §14.1-5).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { extractTemplateFields } from '@/lib/templates/extract';
import { toOutputJson } from '@/lib/templates/output';
import { toFieldDef } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: true } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  const fields = [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef).filter((f) => f.region);
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields', message: 'Δεν υπάρχουν αποθηκευμένα πεδία με περιοχή' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  const r = await extractTemplateFields(buf, t.sampleMimeType ?? 'application/pdf', fields, { ref: { refType: 'ExtractionTemplate', refId: id } });
  const json = toOutputJson({ slug: t.slug, version: t.version }, r.values);
  return NextResponse.json({ ...json, fields: r.values, model: r.model, tokensUsed: r.tokensUsed, durationMs: Date.now() - started, errors: r.errors });
}
```

- [ ] **Step 4: Client** — in `components/templates/api.ts` add:

```ts
export type DetectFieldResult = { label: string; key: string; kind: 'SINGLE' | 'TABLE'; valueType: FieldDef['valueType']; value: string; columns: FieldDef['columns']; model: string; tokensUsed: number; durationMs: number };
export type DetectedMark = { label: string; key: string; valueType: FieldDef['valueType']; value: string; bbox: [number, number, number, number] };
export type DetectMarksResult = { marks: DetectedMark[]; model: string; tokensUsed: number; durationMs: number };
export type TestTemplateResult = { template: string; version: number; extractedAt: string; values: Record<string, unknown>; fields: Record<string, FieldValue>; model: string | null; tokensUsed: number; durationMs: number; errors: { fieldKey: string; message: string }[] };
```
(import `FieldValue` from `@/lib/templates/schema`) and in `templatesApi`:
```ts
  detectField: (id: string, region: Region) => fetch(`${base(id)}/detect-field`, json({ region })).then((r) => handle<DetectFieldResult>(r)),
  detectMarks: (id: string, page: number, mode: 'marks' | 'all' = 'all') => fetch(`${base(id)}/detect-marks`, json({ page, mode })).then((r) => handle<DetectMarksResult>(r)),
  test: (id: string) => fetch(`${base(id)}/test`, json({})).then((r) => handle<TestTemplateResult>(r)),
```

- [ ] **Step 5: Smoke** — with the dev server running (`.claude/launch.json` → `dev`), pick an existing template id with a sample from the DB (`npx prisma studio` is NOT available; use `npx tsx --conditions=react-server -e` or a one-off script with `import 'dotenv/config'` and `prisma.extractionTemplate.findFirst({ where: { sampleStorageKey: { not: null } } })`). Then in the browser (logged-in session) call `fetch('/api/admin/ocr/templates/<id>/test', { method: 'POST', body: '{}' , headers: { 'Content-Type': 'application/json' } }).then(r => r.json())` from devtools and confirm `template`, `values` come back. If no template has a sample yet, skip and say so in your report.
- [ ] **Step 6: Type-check** (only pre-existing UI errors allowed) + commit — `git add app/api/admin/ocr/templates components/templates/api.ts && git commit -m "feat(templates): detect-field, detect-marks and test endpoints"`

---

### Task 7: Designer UI — new-template dialog, «Στοιχεία» step, stepper, list page, sidebar

**Files:**
- Create: `components/templates/supplier-search.tsx`, `components/templates/details-step.tsx`, `lib/templates/list.ts` (if not created in Task 3)
- Delete: `components/templates/supplier-step.tsx`
- Modify: `app/admin/ocr/templates/new-template-dialog.tsx`, `app/admin/ocr/templates/page.tsx`, `app/admin/ocr/templates/templates-table.tsx`, `components/templates/template-designer.tsx`, `components/admin/sidebar.tsx`, `lib/templates/flow.ts` (only if it references `docType`/`vatNumber`)

- [ ] **Step 1: `supplier-search.tsx`** — extract the debounced search from the dialog into a reusable combobox:

```tsx
'use client';
import * as React from 'react';
import { FiSearch, FiX } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { templatesApi } from './api';

export type SupplierPick = { id: number; name: string; vat: string };
type Result = { id: number; code: string; name: string; sub: string };

/** SoftOne supplier lookup (≥2 chars, debounced). `value` null = no supplier linked. */
export function SupplierSearch({ value, onChange, disabled, id = 'sup' }: { value: SupplierPick | null; onChange: (v: SupplierPick | null) => void; disabled?: boolean; id?: string }) {
  const [q, setQ] = React.useState(value?.name ?? '');
  const [results, setResults] = React.useState<Result[]>([]);
  React.useEffect(() => { setQ(value?.name ?? ''); }, [value?.name]);
  React.useEffect(() => {
    if (value || q.trim().length < 2) { setResults([]); return; }
    let ignore = false;
    const h = setTimeout(() => {
      templatesApi.searchSuppliers(q.trim()).then((r) => { if (!ignore) setResults(r.results); }).catch(() => { if (!ignore) setResults([]); });
    }, 250);
    return () => { ignore = true; clearTimeout(h); };
  }, [q, value]);
  const pick = (s: Result) => { onChange({ id: s.id, name: s.name, vat: /\b(\d{9})\b/.exec(s.sub)?.[1] ?? '' }); setResults([]); };
  return (
    <div className="relative">
      <Label htmlFor={id}>Προμηθευτής SoftOne (προαιρετικό)</Label>
      <div className="relative mt-1">
        <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} value={q} disabled={disabled} onChange={(e) => { setQ(e.target.value); if (value) onChange(null); }} placeholder="Αναζήτηση επωνυμίας / ΑΦΜ…" className="pl-8 pr-8" autoComplete="off" />
        {value && !disabled && <button type="button" aria-label="Καθαρισμός προμηθευτή" onClick={() => { onChange(null); setQ(''); }} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)]"><FiX className="size-3.5" /></button>}
      </div>
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-white shadow-fluent-8">
          {results.map((s) => (
            <li key={s.id}><button type="button" onClick={() => pick(s)} className="flex w-full cursor-pointer flex-col px-3 py-2 text-left hover:bg-[var(--cx-hover)]">
              <span className="text-[13px] font-medium">{s.name}</span><span className="text-[11px] text-muted-foreground">{s.sub}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: New-template dialog** — rewrite `new-template-dialog.tsx`: state `name`, `slug`, `slugTouched`, `department`, `busy`. `onChange` of name: `setName(v); if (!slugTouched) setSlug(templateSlug(v))`. Slug input (mono, `onChange` → `setSlug(slugKey(v)); setSlugTouched(true)`), helper text «Κλειδί του JSON εξόδου. Παράγεται από το όνομα, μπορείς να το αλλάξεις.» Department input placeholder «π.χ. Λογιστήριο, Συνεργείο». Submit: `templatesApi.create({ name: name.trim(), slug: slug || undefined, department: department.trim() || null })` → `router.push(`/admin/ocr/templates/${r.id}`)`. Title «Νέο πρότυπο», description «Δώσε ένα όνομα. Προμηθευτή ή τμήμα συνδέεις αργότερα, αν χρειάζεται.» Reset state on close. No supplier UI here.

- [ ] **Step 3: `details-step.tsx`** (replaces `supplier-step.tsx`; delete the old file):

```tsx
'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { slugKey } from '@/lib/templates/schema';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';
import { useServerDraft } from './use-server-draft';
import { SupplierSearch, type SupplierPick } from './supplier-search';

export function DetailsStep() {
  const { dto, setDto, canManage, setDirty } = useDesigner();
  const [name, setName] = useServerDraft(dto.name);
  const [slug, setSlug] = useServerDraft(dto.slug);
  const [department, setDepartment] = useServerDraft(dto.department ?? '');
  const [vat, setVat] = useServerDraft(dto.vatNumber ?? '');
  const [supplier, setSupplier] = useServerDraft<SupplierPick | null>(dto.traderTrdr ? { id: dto.traderTrdr, name: dto.supplierName ?? '', vat: dto.vatNumber ?? '' } : null);
  const [busy, setBusy] = React.useState(false);
  const slugLocked = dto.runsCount > 0;
  const dirty = name.trim() !== dto.name || slug !== dto.slug || department.trim() !== (dto.department ?? '') || vat !== (dto.vatNumber ?? '') || (supplier?.id ?? null) !== dto.traderTrdr;
  React.useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);

  const pickSupplier = (s: SupplierPick | null) => { setSupplier(s); if (s?.vat) setVat(s.vat); };
  const save = async () => {
    if (vat && !/^\d{9}$/.test(vat)) { toast.error('Το ΑΦΜ έχει 9 ψηφία'); return; }
    setBusy(true);
    try {
      setDto(await templatesApi.patch(dto.id, {
        name: name.trim(), ...(slugLocked ? {} : { slug }), department: department.trim() || null,
        vatNumber: vat || null, traderTrdr: supplier?.id ?? null, supplierName: supplier?.name ?? null,
      }));
      toast.success('Αποθηκεύτηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div><h2 className="text-[16px] font-semibold">Στοιχεία προτύπου</h2><p className="text-[12px] text-muted-foreground">Το πρότυπο είναι ανεξάρτητο. Η σύνδεση με προμηθευτή ή τμήμα είναι προαιρετική.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="tn">Όνομα</Label><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="mt-1" /></div>
        <div><Label htmlFor="ts">Slug</Label><Input id="ts" value={slug} onChange={(e) => setSlug(slugKey(e.target.value) || slug)} disabled={!canManage || slugLocked} className="mt-1 font-mono" />
          <p className="mt-1 text-[10px] text-muted-foreground">{slugLocked ? 'Κλειδωμένο — το πρότυπο έχει εκτελέσεις.' : 'Κλειδί του JSON εξόδου.'}</p></div>
        <div><Label htmlFor="td">Τμήμα / κατηγορία</Label><Input id="td" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!canManage} className="mt-1" placeholder="π.χ. Λογιστήριο, Συνεργείο" /></div>
        <div className="sm:col-span-2"><SupplierSearch value={supplier} onChange={pickSupplier} disabled={!canManage} /></div>
        <div><Label htmlFor="tv">ΑΦΜ εκδότη (προαιρετικό)</Label><Input id="tv" value={vat} onChange={(e) => setVat(e.target.value.replace(/\D/g, '').slice(0, 9))} disabled={!canManage} className="mt-1 font-mono" inputMode="numeric" />
          <p className="mt-1 text-[10px] text-muted-foreground">Με ΑΦΜ, το πρότυπο εφαρμόζεται αυτόματα στα έγγραφα του εκδότη.</p></div>
      </div>
      {canManage && <Button onClick={save} disabled={!dirty || busy || !name.trim()}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>}
    </div>
  );
}
```
`useServerDraft` is generic over `T`; passing an object (`SupplierPick | null`) is fine (it compares JSON).

- [ ] **Step 4: Designer shell** — in `template-designer.tsx`: import `DetailsStep` instead of `SupplierStep`; `STEPS[0] = { key: 'details', label: 'Στοιχεία', icon: FiFileText }` (react-icons/fi), `STEPS[3].label = 'Mapping (προαιρετικό)'`; `stepDone`: `case 0: return !!dto.name;` and `case 3: return dto.mode === 'MANUAL' || dto.mappings.length > 0;`; component array `[DetailsStep, SampleStep, RegionsStep, MappingStep, ConditionsStep]`. Initial step: `initial.sample ? (initial.fields.length ? 2 : 1) : 1` (a fresh template lands on «Δείγμα»). In the side info box add a row `Slug` (`<span className="font-mono">{dto.slug}</span>`) above «Κατάσταση».

- [ ] **Step 5: List page** — `page.tsx`: use `LIST_QUERY`/`toListRow` from `lib/templates/list.ts`; `PageHeader` title «Πρότυπα εξαγωγής», description `` `Έντυπα με περιοχές και πεδία· έξοδος JSON ανά έγγραφο (${data.length} πρότυπα).` ``. `templates-table.tsx`: `TemplateRow` gets `slug: string; department: string | null; vatNumber: string | null;` and loses `docType`; columns in this order: Πρότυπο (name link + `slug` mono under it, size 260), Τμήμα (`department || '—'`, 140), Προμηθευτής (`supplierName || (vatNumber ? '' : '—')` + vatNumber mono under it, 220), Λειτουργία, Κατάσταση, Πεδία, Χρήσεις, Ενημ., actions. Hidden accessor columns `slug`, `vatNumber`, `department` are NOT needed as separate columns if they are rendered inside cells — but the global filter only sees accessor columns, so keep hidden accessor columns for `slug` and `vatNumber` (as done today for `vatNumber`) and make `department` its own visible column. `searchPlaceholder="Αναζήτηση (πρότυπο, slug, τμήμα, προμηθευτής…)"`, `initialColumnVisibility={{ slug: false, vatNumber: false }}`, `persistKey="admin.templates.table.v2"`.

- [ ] **Step 6: Sidebar** — `components/admin/sidebar.tsx`: label of `/admin/ocr/templates` → «Πρότυπα εξαγωγής».
- [ ] **Step 7: Flow** — `grep -n "docType\|supplierName\|vatNumber" lib/templates/flow.ts components/templates/*.tsx`. Where the root/template node shows the supplier, show `t.name` on line 1 and `t.supplierName ?? t.department ?? t.slug` on line 2; drop any docType text. Update `lib/templates/__tests__/flow.test.ts` fixtures accordingly (they build a `FlowTemplateSource`).
- [ ] **Step 8: Verify** — type-check clean (`grep -v "^.next/"` prints nothing), `npm test` green. Dev server: create a template from the dialog (name «Δοκιμή ΗΡΩΝ» → slug shown live), land on «Δείγμα», go to «Στοιχεία», link a supplier, clear it, set a department, save; list shows the new columns.
- [ ] **Step 9: Commit** — `git add -A app/admin/ocr/templates components/templates components/admin/sidebar.tsx lib/templates && git commit -m "feat(templates): standalone designer — name/slug/department dialog, details step with optional supplier, list columns"`

---

### Task 8: Regions step — «Πεδίο από περιοχή», «Ανίχνευση σημειώσεων», «Δοκιμή προτύπου»

**Files:**
- Create: `components/templates/test-json-dialog.tsx`
- Modify: `components/templates/regions-step.tsx`

- [ ] **Step 1: `test-json-dialog.tsx`**

```tsx
'use client';
import * as React from 'react';
import { FiCopy, FiDownload } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TestTemplateResult } from './api';

export function TestJsonDialog({ open, onOpenChange, result, slug }: { open: boolean; onOpenChange: (o: boolean) => void; result: TestTemplateResult | null; slug: string }) {
  const json = React.useMemo(() => (result ? JSON.stringify({ template: result.template, version: result.version, extractedAt: result.extractedAt, values: result.values }, null, 2) : ''), [result]);
  const copy = async () => { try { await navigator.clipboard.writeText(json); toast.success('Αντιγράφηκε'); } catch { toast.error('Δεν ήταν δυνατή η αντιγραφή'); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${slug}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Δοκιμή προτύπου — JSON</DialogTitle>
          <DialogDescription>{result ? `${Object.keys(result.values).length} πεδία · ${result.model ?? '—'} · ${result.tokensUsed} tokens · ${result.durationMs} ms` : 'Ανάγνωση…'}</DialogDescription></DialogHeader>
        {result && (
          <>
            <ul className="flex flex-wrap gap-1.5">
              {Object.entries(result.fields).map(([k, v]) => (
                <li key={k} className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: v.color, color: v.color }}>
                  <span className="font-mono">{k}</span><span className="truncate text-foreground">{v.value == null ? '∅' : typeof v.value === 'object' ? `${(v.value as unknown[]).length} γραμμές` : String(v.value)}</span>
                </li>))}
            </ul>
            {result.errors.length > 0 && <p className="text-[11px] text-dg-red-600">{result.errors.map((e) => `${e.fieldKey}: ${e.message}`).join(' · ')}</p>}
            <pre className="max-h-[50vh] overflow-auto rounded-md border border-border bg-neutral-4 p-3 font-mono text-[11px] leading-relaxed">{json}</pre>
            <div className="flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={copy}><FiCopy className="mr-1 size-3.5" /> Αντιγραφή</Button><Button size="sm" onClick={download}><FiDownload className="mr-1 size-3.5" /> Λήψη .json</Button></div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Regions step changes** (`regions-step.tsx`), keeping everything that exists:
  1. `const NEW_MARK = '__new__';` — `marking` may now be a field key or `NEW_MARK`.
  2. Replace the inline dedupe loop in `update()` with `uniqueKey(f.key, fields.filter((x) => x.key !== key).map((x) => x.key))` (import from schema).
  3. New state: `const [detecting, setDetecting] = React.useState(false);`, `const [proposed, setProposed] = React.useState<Set<string>>(new Set());`, `const [testResult, setTestResult] = React.useState<TestTemplateResult | null>(null);`, `const [testOpen, setTestOpen] = React.useState(false);`, `const [testing, setTesting] = React.useState(false);`.
  4. `addDetected(d: { label; key; kind; valueType; value; columns; region; model?; tokensUsed?; durationMs? }, mark = false)`:
     ```ts
     const key = uniqueKey(d.key, fields.map((f) => f.key));
     const f: FieldDef = { key, label: d.label, kind: d.kind, valueType: d.valueType, color: nextColor(fields.map((x) => x.color)), region: d.region, columns: d.columns, aiHint: null, required: false, order: fields.length };
     setFields((fs) => [...fs, f]);
     setTests((t) => ({ ...t, [key]: { raw: d.value, value: d.value, source: 'vision', model: d.model ?? null, tokensUsed: d.tokensUsed ?? 0, color: f.color, durationMs: d.durationMs ?? 0 } }));
     if (mark) setProposed((p) => new Set(p).add(key));
     return key;
     ```
     Because `fields` is read inside a loop when several marks arrive at once, build the batch with a local array: in `detectMarks` compute keys/colours against a running `draft` copy and call `setFields` once.
  5. `onRegion`: if `marking === NEW_MARK`: `setMarking(null); if (atColorCap) { toast.error(COLOR_CAP_MSG); return; } setDetecting(true); try { const r = await templatesApi.detectField(dto.id, region); const key = addDetected({ ...r, region }); setFocusKey(key); toast.success(`Αναγνωρίστηκε «${r.label}»`); } catch (e) { toast.error(errorMessage(e)); } finally { setDetecting(false); }`. Otherwise the existing behaviour.
  6. `detectMarks(mode: 'marks' | 'all')`: `setDetecting(true)`; `const r = await templatesApi.detectMarks(dto.id, page, mode)`; if `r.marks.length === 0` → `toast.info(mode === 'marks' ? 'Δεν βρέθηκαν σημειώσεις στη σελίδα' : 'Δεν βρέθηκαν πεδία στη σελίδα')`; else add up to the free colour slots as proposals (`region: { page, bbox: m.bbox }`, `kind: 'SINGLE'`, `columns: null`), toast `${n} προτάσεις — έλεγξε, διόρθωσε και αποθήκευσε` (warning toast if some were skipped for the colour cap). State `const [scanMode, setScanMode] = React.useState<'marks' | 'all'>('all')` — the default is «Όλα τα πεδία»: the scan finds and marks everything, then the user corrects, deletes or adds (user decision 2026-09-09).
  7. `runTest()`: `setTesting(true); setTestOpen(true); setTestResult(null); try { setTestResult(await templatesApi.test(dto.id)); } catch (e) { setTestOpen(false); toast.error(errorMessage(e)); } finally { setTesting(false); }`.
  8. `save()` success → `setProposed(new Set())`.
  9. `remove(key)` → also drop from `proposed`.
  10. Toolbar (right column header, `canManage` only): keep «Πεδίο» and «Αποθήκευση»; add `<Button size="sm" variant="secondary" onClick={() => { setFocusKey(null); setMarking(NEW_MARK); }} disabled={atColorCap || detecting} title="Σύρε πλαίσιο — το μοντέλο ονομάζει το πεδίο"><FiTarget className="mr-1 size-3.5" /> Από περιοχή</Button>`, a scan group `<div className="inline-flex items-stretch overflow-hidden rounded-sm border border-input"><select aria-label="Τρόπος σάρωσης" value={scanMode} onChange={(e) => setScanMode(e.target.value as 'marks' | 'all')} className="h-8 border-r border-input bg-background px-1.5 text-[11px]"><option value="all">Όλα τα πεδία</option><option value="marks">Μόνο σημειωμένα</option></select><button type="button" onClick={() => detectMarks(scanMode)} disabled={detecting || atColorCap} className="inline-flex h-8 cursor-pointer items-center gap-1 px-2 text-[12px] hover:bg-[var(--cx-hover)] disabled:opacity-50"><FiEye className={cn('size-3.5', detecting && 'animate-pulse')} /> Αυτόματη σάρωση</button></div>`, and above the canvas header a `<Button size="sm" variant="secondary" onClick={runTest} disabled={testing || !dto.fields.some((f) => f.region)} title="Διαβάζει όλα τα αποθηκευμένα πεδία από το δείγμα"><FiPlay className="mr-1 size-3.5" /> Δοκιμή προτύπου</Button>`. Wrap the toolbar in `flex flex-wrap gap-1`.
  11. Marking badge text: when `marking === NEW_MARK` → «Σύρε πλαίσιο — θα αναγνωριστεί το πεδίο · Esc για ακύρωση».
  12. In the field list row, after the label, when `proposed.has(f.key)` render `<span className="rounded-full bg-[#FDF3E3] px-1.5 text-[10px] font-medium text-[#B45309]">πρόταση</span>`.
  13. Render `<TestJsonDialog open={testOpen} onOpenChange={setTestOpen} result={testResult} slug={dto.slug} />` at the end of the root element.
  Icons: `FiTarget`, `FiEye`, `FiPlay` from `react-icons/fi`.

- [ ] **Step 3: Verify in the browser** — open a template with a sample: (a) «Από περιοχή», draw around «Αριθμός … 309»-style caption+value → a new field appears named by the model, key slugged, value chip filled, region coloured; (b) «Σημειώσεις» on a hand-marked page → proposals with «πρόταση» chips and coloured regions; delete one, save, chips disappear; (c) «Δοκιμή προτύπου» → dialog with JSON, copy, download. Type-check clean, `npm test` green.
- [ ] **Step 4: Commit** — `git add components/templates && git commit -m "feat(templates): field from region, proposals from hand marks, JSON test dialog"`

---

### Task 9: Wiki + changelog

**Files:**
- Modify: `docs/wiki/ocr/templates.mdx`, `docs/manual/CHANGELOG.md`

- [ ] **Step 1: Wiki** — rewrite `docs/wiki/ocr/templates.mdx` (keep the frontmatter keys; `title: "Πρότυπα εξαγωγής"`, `updatedAt: 2026-09-09`, `helpAnchors: [templates]`, `description: "Ανεξάρτητα πρότυπα εντύπων: περιοχές και πεδία με χρώμα, αυτόματη ονομασία πεδίων από το μοντέλο, προτάσεις από κυκλωμένες σημειώσεις, έξοδος JSON, προαιρετική σύνδεση με προμηθευτή ή τμήμα."`). Body:

```mdx
## Τι είναι

Ένα πρότυπο περιγράφει ένα **έντυπο** — τιμολόγιο προμηθευτή, λογαριασμό ΔΕΚΟ, φόρμα service, εκκαθάριση εξόδων — και λέει **πού** βρίσκεται κάθε πληροφορία και **πώς** την ονομάζουμε. Κάθε εκτέλεση παράγει ένα **JSON** με τις τιμές, με κλειδί το **slug** του προτύπου.

Το πρότυπο είναι ανεξάρτητο: πρώτα το φτιάχνεις, μετά —αν θέλεις— το συνδέεις με προμηθευτή SoftOne ή τμήμα.

<Steps>
  <li><strong>Νέο πρότυπο</strong> — μόνο όνομα. Το slug παράγεται αυτόματα (μπορείς να το αλλάξεις μέχρι την πρώτη εκτέλεση). Προαιρετικά τμήμα/κατηγορία.</li>
  <li><strong>Δείγμα</strong> — ένα PDF ή φωτογραφία του εντύπου. Καλά δουλεύει και ένα δείγμα όπου ο λογιστής έχει <em>κυκλώσει</em> τι θέλει.</li>
  <li><strong>Περιοχές & πεδία</strong> — τρεις τρόποι: «Πεδίο» (δίνεις ετικέτα, μαρκάρεις περιοχή), «Από περιοχή» (μαρκάρεις πρώτα — το μοντέλο διαβάζει ετικέτα και τιμή και ονομάζει το πεδίο), «Σημειώσεις» (βρίσκει ό,τι είναι κυκλωμένο ή χειρόγραφο στη σελίδα και προτείνει πεδία). Κάθε πεδίο έχει δικό του χρώμα. Με «Δοκιμή προτύπου» βλέπεις το JSON.</li>
  <li><strong>Στοιχεία</strong> — προαιρετική σύνδεση με προμηθευτή SoftOne (ΑΦΜ) ή τμήμα. Με ΑΦΜ, το πρότυπο εφαρμόζεται αυτόματα στα έγγραφα του εκδότη.</li>
  <li><strong>Mapping (προαιρετικό)</strong> και <strong>Conditions & λειτουργία</strong> — μόνο αν το πρότυπο πρέπει να αναρτά παραστατικό στο SoftOne. Η χειροκίνητη λειτουργία (προεπιλογή) παράγει μόνο JSON.</li>
</Steps>

<Callout type="info">
  Οι προτάσεις από «Σημειώσεις» και «Από περιοχή» είναι <em>προτάσεις</em>: έλεγξε ετικέτα, τύπο τιμής και περιοχή πριν αποθηκεύσεις. Το χειρόγραφο λογιστικό άρθρο (π.χ. 60.64.00.000.010) προτείνεται ως πεδίο «Λογιστικό άρθρο (χειρόγραφο)».
</Callout>

<Callout type="warning">
  Η αυτόματη λειτουργία (AUTO) αναρτά στο SoftOne χωρίς έλεγχο. Απαιτεί δικαίωμα <RoleBadge role="ADMIN" /> με ανάρτηση, mapping, και συνιστάται μόνο για δοκιμασμένα πρότυπα.
</Callout>

<Callout type="danger">
  Αν διαγράψεις ή μετονομάσεις πεδίο, οι αντιστοιχίσεις και οι ρήτρες που το αναφέρουν αφαιρούνται αυτόματα. Το slug του προτύπου κλειδώνει μόλις υπάρξουν εκτελέσεις.
</Callout>
```
Run `npm run wiki:index`.

- [ ] **Step 2: Changelog** — add an entry dated 2026-09-09 under the templates section: standalone templates (name + auto slug, optional supplier/department, no document type), field naming from a drawn region, proposals from hand-circled marks, JSON output + test dialog, MANUAL default needs no mapping.
- [ ] **Step 3: Commit** — `git add docs && git commit -m "docs(templates): wiki and changelog for standalone templates"`

---

### Task 10: `storeSample` + seed script from a customer PDF

**Files:**
- Create: `lib/templates/sample.ts`, `scripts/templates/seed-from-pdf.ts`
- Modify: `app/api/admin/ocr/templates/[id]/sample/route.ts`, `package.json` (devDependency `pdf-lib`, script `templates:seed`)

- [ ] **Step 1: `lib/templates/sample.ts`** — move the body of the sample route into a server module:

```ts
// lib/templates/sample.ts — SERVER. Store a template's sample file (route + seed script share this).
import 'server-only';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
import { bunnyUploadPrivate, bunnyDelete } from '@/lib/bunny';
import { countPdfPages, isPdfBuffer, sniffImageType } from '@/lib/ocr/rasterize';

export const SAMPLE_MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

export class SampleError extends Error { constructor(public code: 'not_found' | 'too_large' | 'unsupported_type') { super(code); } }

export async function storeSample(templateId: string, buffer: Buffer): Promise<{ mimeType: string; pageCount: number; version: number }> {
  const t = await prisma.extractionTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw new SampleError('not_found');
  if (buffer.length > SAMPLE_MAX_BYTES) throw new SampleError('too_large');
  const sniffed = isPdfBuffer(buffer) ? 'application/pdf' : sniffImageType(buffer);
  if (sniffed === null || !ALLOWED.has(sniffed)) throw new SampleError('unsupported_type');
  const mimeType = sniffed;
  const pageCount = mimeType === 'application/pdf' ? await countPdfPages(buffer).catch(() => 1) : 1;
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const key = `templates/${templateId}/sample-${nanoid(8)}.${ext}`;
  await bunnyUploadPrivate({ key, body: buffer, contentType: mimeType });
  const old = t.sampleStorageKey;
  const updated = await prisma.extractionTemplate.update({ where: { id: templateId }, data: { sampleStorageKey: key, sampleMimeType: mimeType, samplePageCount: pageCount, version: { increment: 1 } } });
  await prisma.extractionTemplate.update({ where: { id: templateId }, data: { sampleThumbUrl: `/api/admin/ocr/templates/${templateId}/page-image?page=0&scale=2&v=${updated.version}` } });
  if (old && old !== key) await bunnyDelete([old]).catch(() => null);
  return { mimeType, pageCount, version: updated.version };
}
```
Keep the existing comments about sniffing and cache-busting (move them along). The route becomes: permission → form → `file` check → `storeSample(id, Buffer.from(await file.arrayBuffer()))` inside try/catch mapping `SampleError.code` to 404 / 413 (`too_large`, message «Μέγιστο 25 MB») / 415, then `logAudit` and `{ ok: true, mimeType, pageCount }`.

- [ ] **Step 2: Install** — `npm i -D pdf-lib` and add `"templates:seed": "npx tsx --conditions=react-server scripts/templates/seed-from-pdf.ts"` to `package.json` scripts. (`--conditions=react-server` resolves the `server-only` package to its no-op build, so `lib/*` modules that import it load under tsx. Verify with `npx tsx --conditions=react-server -e "import('server-only').then(()=>console.log('ok'))"`; if that prints an error, fall back to `--import ./scripts/templates/server-only-shim.mjs` that registers a loader mapping `server-only` to `lib/__mocks__/server-only.ts` — say which one worked in your report.)

- [ ] **Step 3: `scripts/templates/seed-from-pdf.ts`**

```ts
// scripts/templates/seed-from-pdf.ts — DEV. Split a scanned PDF into per-form documents and create one
// template per manifest entry, proposing fields from the accountant's hand marks (spec §14.6).
// Usage: npm run templates:seed -- <file.pdf> <manifest.json> [--dry]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { prisma } from '../../lib/db';
import { renderPage } from '../../lib/ocr/rasterize';
import { storeSample } from '../../lib/templates/sample';
import { detectMarksOnPage } from '../../lib/templates/detect';
import { COLOR_PALETTE, templateSlug, uniqueKey } from '../../lib/templates/schema';
import { bunnyUploadPrivate } from '../../lib/bunny';

type Entry = { name: string; pages: number[]; rotate?: 90 | 180 | 270; department?: string; vatNumber?: string; supplierName?: string; extraPages?: number[][]; mode?: 'marks' | 'all' };

async function slice(src: PDFDocument, pages: number[], rotate?: Entry['rotate']): Promise<Buffer> {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  for (const p of copied) { if (rotate) p.setRotation(degrees((p.getRotation().angle + rotate) % 360)); out.addPage(p); }
  return Buffer.from(await out.save());
}

async function main() {
  const [pdfPath, manifestPath, flag] = process.argv.slice(2);
  if (!pdfPath || !manifestPath) { console.error('usage: seed-from-pdf <file.pdf> <manifest.json> [--dry]'); process.exit(1); }
  const dry = flag === '--dry';
  const src = await PDFDocument.load(fs.readFileSync(pdfPath));
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Entry[];
  const outDir = path.join(path.dirname(manifestPath), 'split'); fs.mkdirSync(outDir, { recursive: true });
  const existing = new Set((await prisma.extractionTemplate.findMany({ select: { slug: true } })).map((t) => t.slug));

  for (const e of entries) {
    const slug = uniqueKey(templateSlug(e.name), existing); existing.add(slug);
    const pdf = await slice(src, e.pages, e.rotate);
    fs.writeFileSync(path.join(outDir, `${slug}.pdf`), pdf);
    console.log(`\n== ${e.name} → ${slug} (pages ${e.pages.join(',')}${e.rotate ? `, rot ${e.rotate}` : ''})`);
    if (dry) continue;

    const t = await prisma.extractionTemplate.create({ data: { name: e.name, slug, department: e.department ?? null, vatNumber: e.vatNumber ?? null, supplierName: e.supplierName ?? null } });
    const sample = await storeSample(t.id, pdf);
    const taken = new Set<string>(); let colorIdx = 0; let order = 0;
    for (let page = 0; page < sample.pageCount; page++) {
      const pageBuf = await renderPage(pdf, 'application/pdf', page, 2);
      const r = await detectMarksOnPage(pageBuf, { taken, mode: e.mode ?? 'marks', ref: { refType: 'ExtractionTemplate', refId: t.id } });
      for (const m of r.marks) {
        if (colorIdx >= COLOR_PALETTE.length) { console.log(`   (skip, colour cap) ${m.label}`); continue; }
        taken.add(m.key);
        await prisma.templateField.create({ data: { templateId: t.id, key: m.key, label: m.label, kind: 'SINGLE', valueType: m.valueType, color: COLOR_PALETTE[colorIdx++], region: { page, bbox: m.bbox }, order: order++ } });
        console.log(`   + ${m.key.padEnd(28)} ${m.valueType.padEnd(8)} p${page + 1} ${JSON.stringify(m.bbox)}  «${m.value}»`);
      }
      console.log(`   page ${page + 1}: ${r.marks.length} marks (${r.model}, ${r.tokensUsed ?? 0} tokens)`);
    }
    for (const [i, pages] of (e.extraPages ?? []).entries()) {
      const extra = await slice(src, pages, e.rotate);
      const key = `templates/${t.id}/samples/extra-${i + 1}.pdf`;
      await bunnyUploadPrivate({ key, body: extra, contentType: 'application/pdf' });
      console.log(`   extra sample ${i + 1} → ${key}`);
    }
  }
  console.log('\ndone');
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); prisma.$disconnect().finally(() => process.exit(1)); });
```
`renderPage` for a PDF buffer works on the sliced document (page index within the slice). `region` is a Prisma `Json` column — pass the object directly.

- [ ] **Step 4: Dry run** — create `.local/seed/manifest.json` (the folder is gitignored) with a two-entry manifest pointing at pages of any local PDF and run `npm run templates:seed -- <pdf> .local/seed/manifest.json --dry`; expect `split/<slug>.pdf` files and no DB writes. Then type-check clean, `npm test` green.
- [ ] **Step 5: Commit** — `git add lib/templates/sample.ts app/api/admin/ocr/templates/[id]/sample scripts/templates package.json package-lock.json && git commit -m "feat(templates): shared storeSample and seed-from-pdf script"`

---

## Self-review (done while writing)

- **Spec coverage §14:** 14.8 auto-scan modes (T5 `DetectMode`, T6 body `mode`, T8 select) · 1 slug (T1–T3, T7) · 2 optional association + department (T2, T3, T7) · 3 docType removed (T2, T7) · 4 MANUAL default, mapping optional (T2 SQL default, T3 readiness, T7 stepper) · 5 JSON shape + test dialog (T4, T6, T8) · 6 field from region (T5, T6, T8) · 7 marks detection incl. GL account (T4, T5, T6, T8) · 14.2 migration (T2) · 14.3 endpoints (T3, T6) · 14.4 lib (T1, T4, T5) · 14.5 UI (T7, T8, T9) · 14.6 seed (T10). 14.7 is a note for plan 3/4 — no task.
- **Type consistency:** `uniqueKey(base, taken)` (T1) used in T3 `freeSlug`, T5 parsers, T8, T10. `templateSlug` (T1) in T3, T7 dialog, T10. `DetectedField/DetectedMark` (T5) mirrored by the client types in T6. `TemplateDto.slug/department/runsCount` (T2) used in T7/T8. `storeSample` (T10) returns `{ mimeType, pageCount, version }`.
- **Placeholders:** none.
