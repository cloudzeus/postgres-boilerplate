# OCR Correction + Supplier Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a region-marking correction UI and per-supplier few-shot templates to the `/admin/ocr` pipeline, plus deterministic validations, so OCR accuracy improves on rescans and repeat suppliers.

**Architecture:** Four phases. (1) Pure deterministic validation + a quality score that fixes the broken "retry-keep" logic. (2) A `SupplierTemplate` model + few-shot prompt + a template-aware second pass that fires only when the first pass is incomplete. (3) An interactive correction component (canvas + marquee; digital-PDF text-layer mapping with no AI, image/scanned crop+vision) and a `read-region` API. (4) A templates management page + mandatory wiki entry. Backend phases are TDD; UI uses the project's `lib/design-system` (Fluent 2 + DG brand).

**Tech Stack:** Next.js 16 (App Router), Prisma + MySQL, vitest, pdfjs-dist (browser + node), sharp, Gemini (vision) + DeepSeek (text), `lib/design-system` components.

**Reference spec:** [docs/superpowers/specs/2026-05-30-ocr-correction-supplier-templates-design.md](../specs/2026-05-30-ocr-correction-supplier-templates-design.md)

**Conventions in this repo:**
- Tests: `*.test.ts` inside a `__tests__/` folder next to source. Run with `npx vitest run <path>`.
- Migrations: `prisma migrate dev` is unreliable here — use `prisma db push` for schema, then `prisma migrate diff` to author SQL + `prisma migrate resolve` (see memory `prisma-migrate-workflow`). Each task notes this.
- API routes: `export const runtime = 'nodejs'`, `requirePermission('ocr.*')`, zod-validated bodies.
- Greek user-facing strings.

---

## File Structure

**Phase 1 — validation (no UI):**
- Create: `lib/ocr/validate.ts` — pure: `isValidAfm`, `checkTotals`, `fixSwappedParties`, `qualityScore`.
- Create: `lib/ocr/__tests__/validate.test.ts`.
- Create: `lib/ocr/own-afm.ts` — `resolveOwnAfm()` (SoftOne company info, day-cached; settings fallback).
- Modify: `lib/ocr/extract.ts` — replace `countMissingRequired` in retry-keep with `qualityScore`; run `fixSwappedParties` post-parse.

**Phase 2 — templates backend:**
- Modify: `prisma/schema.prisma` — add `SupplierTemplate`.
- Create: `lib/ocr/templates-store.ts` — `findSupplierTemplate`, `upsertSupplierTemplate`, `mergeFromTemplatePass`.
- Create: `lib/ocr/__tests__/templates-store.test.ts`.
- Modify: `lib/ocr/templates.ts` — `buildSystemPrompt(docType, lang, example?, fieldHints?)`.
- Modify: `lib/ocr/extract.ts` — template-aware second pass.
- Create: `app/api/admin/ocr/[id]/save-template/route.ts`.

**Phase 3 — correction UI:**
- Create: `lib/ocr/region-text.ts` — pure `textInBox(items, box)` (digital-PDF marquee→text).
- Create: `lib/ocr/__tests__/region-text.test.ts`.
- Create: `app/api/admin/ocr/[id]/read-region/route.ts` — crop + small vision call.
- Create: `app/admin/ocr/[id]/field-correction.tsx` — interactive client component.
- Create: `app/admin/ocr/[id]/use-marquee.ts` — marquee hook (pointer math, normalized coords).
- Modify: `app/api/admin/ocr/[id]/route.ts` — extend `PATCH` to persist `extractedData` + items.
- Modify: `app/admin/ocr/[id]/result-view.tsx` — mount `FieldCorrection`.

**Phase 4 — management + docs:**
- Create: `app/admin/ocr/templates/page.tsx` + `app/api/admin/ocr/templates/route.ts` (GET/DELETE).
- Create: `docs/wiki/ocr/correction.mdx` (via `wiki:new`).
- Modify: `lib/wiki/modules-meta.ts` — ensure `ocr` module.

---

## PHASE 1 — Deterministic validation + retry-keep fix

### Task 1: ΑΦΜ check-digit validation

**Files:**
- Create: `lib/ocr/validate.ts`
- Test: `lib/ocr/__tests__/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ocr/__tests__/validate.test.ts
import { describe, it, expect } from 'vitest';
import { isValidAfm } from '../validate';

describe('isValidAfm', () => {
  it('accepts a valid 9-digit ΑΦΜ', () => {
    expect(isValidAfm('094014201')).toBe(true);   // ΟΤΕ Α.Ε. — real valid ΑΦΜ
  });
  it('rejects a number that fails the mod-11 check digit', () => {
    expect(isValidAfm('094014202')).toBe(false);
  });
  it('rejects wrong length / non-digits / all zeros', () => {
    expect(isValidAfm('12345678')).toBe(false);
    expect(isValidAfm('12345678a')).toBe(false);
    expect(isValidAfm('000000000')).toBe(false);
  });
  it('strips spaces and non-digit noise before checking', () => {
    expect(isValidAfm('094 014 201')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ocr/__tests__/validate.test.ts`
Expected: FAIL — "Failed to resolve import '../validate'".

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ocr/validate.ts
/**
 * Greek ΑΦΜ check-digit validation (mod-11 over the first 8 digits, weighted
 * by descending powers of two). Non-digit characters are stripped first.
 */
export function isValidAfm(input: string | null | undefined): boolean {
  const afm = String(input ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm)) return false;
  if (afm === '000000000') return false;
  const d = afm.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += d[i] * 2 ** (8 - i);
  const check = (sum % 11) % 10;
  return check === d[8];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ocr/__tests__/validate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/validate.ts lib/ocr/__tests__/validate.test.ts
git commit -m "feat(ocr): ΑΦΜ mod-11 check-digit validation"
```

---

### Task 2: Totals check + party-swap fix + quality score

**Files:**
- Modify: `lib/ocr/validate.ts`
- Test: `lib/ocr/__tests__/validate.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

```ts
// append to lib/ocr/__tests__/validate.test.ts
import { checkTotals, fixSwappedParties, qualityScore } from '../validate';

describe('checkTotals', () => {
  it('passes when subtotal + vat == total within tolerance', () => {
    expect(checkTotals({ subtotal: 100, vatAmount: 24, totalAmount: 124 }).ok).toBe(true);
    expect(checkTotals({ subtotal: 100, vatAmount: 24, totalAmount: 124.01 }).ok).toBe(true);
  });
  it('fails when the arithmetic is off beyond tolerance', () => {
    const r = checkTotals({ subtotal: 100, vatAmount: 24, totalAmount: 130 });
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
  it('is neutral (ok) when any total is missing', () => {
    expect(checkTotals({ subtotal: 100, vatAmount: null, totalAmount: 124 }).ok).toBe(true);
  });
});

describe('fixSwappedParties', () => {
  const ownAfm = '094014201';
  it('swaps issuer/recipient when the issuer ΑΦΜ is our own ΑΦΜ', () => {
    const out = fixSwappedParties(
      { companyName: 'US', vatNumber: ownAfm, customerName: 'THEM', customerVatNumber: '123456789' },
      ownAfm,
    );
    expect(out.vatNumber).toBe('123456789');
    expect(out.customerVatNumber).toBe(ownAfm);
    expect(out.companyName).toBe('THEM');
    expect(out.customerName).toBe('US');
  });
  it('leaves data unchanged when the issuer is not us', () => {
    const data = { vatNumber: '123456789', customerVatNumber: ownAfm };
    expect(fixSwappedParties(data, ownAfm)).toEqual(data);
  });
  it('no-ops when ownAfm is null', () => {
    const data = { vatNumber: '094014201' };
    expect(fixSwappedParties(data, null)).toEqual(data);
  });
});

describe('qualityScore', () => {
  it('ranks a fully-correct invoice better (lower) than one with a wrong ΑΦΜ', () => {
    const good = { companyName:'A', vatNumber:'094014201', customerName:'B', customerVatNumber:'090000045',
      invoiceNumber:'1', date:'2026-01-01', subtotal:100, vatAmount:24, totalAmount:124 };
    const badAfm = { ...good, vatNumber:'094014202' };               // present but invalid
    const badMath = { ...good, totalAmount: 999 };                   // present but wrong total
    expect(qualityScore(good, 'invoice')).toBeLessThan(qualityScore(badAfm, 'invoice'));
    expect(qualityScore(good, 'invoice')).toBeLessThan(qualityScore(badMath, 'invoice'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ocr/__tests__/validate.test.ts`
Expected: FAIL — `checkTotals`/`fixSwappedParties`/`qualityScore` not exported.

- [ ] **Step 3: Implement (append to `lib/ocr/validate.ts`)**

```ts
// append to lib/ocr/validate.ts
import { countMissingRequired, type DocType } from '@/lib/ocr/templates';

const TOTALS_TOLERANCE = 0.02;

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Invoice arithmetic sanity: subtotal + vat ≈ total. Neutral if any part missing. */
export function checkTotals(data: any): { ok: boolean; issues: string[] } {
  const sub = num(data?.subtotal), vat = num(data?.vatAmount), tot = num(data?.totalAmount);
  if (sub == null || vat == null || tot == null) return { ok: true, issues: [] };
  const ok = Math.abs(sub + vat - tot) <= TOTALS_TOLERANCE;
  return ok ? { ok, issues: [] } : { ok, issues: [`subtotal(${sub}) + vat(${vat}) ≠ total(${tot})`] };
}

/**
 * If the extracted ISSUER ΑΦΜ equals OUR OWN ΑΦΜ, the model swapped issuer and
 * recipient (common on documents where we are the buyer). Swap them back.
 */
export function fixSwappedParties<T extends Record<string, any>>(data: T, ownAfm: string | null): T {
  if (!ownAfm || !data) return data;
  const issuer = String(data.vatNumber ?? '').replace(/\D+/g, '');
  if (issuer !== ownAfm) return data;
  return {
    ...data,
    companyName: data.customerName ?? null,        vatNumber: data.customerVatNumber ?? null,
    companyAddress: data.customerAddress ?? null,  companyDoy: data.customerDoy ?? null,
    companyProfession: data.customerProfession ?? null,
    customerName: data.companyName ?? null,        customerVatNumber: data.vatNumber ?? null,
    customerAddress: data.companyAddress ?? null,  customerDoy: data.companyDoy ?? null,
    customerProfession: data.companyProfession ?? null,
  };
}

/**
 * Combined quality signal: missing required fields + failed deterministic checks.
 * LOWER is better. Replaces bare missing-count in the retry-keep decision so a
 * present-but-wrong field can lose to a better pass.
 */
export function qualityScore(data: any, docType: DocType): number {
  let score = countMissingRequired(data, docType);
  if (docType === 'invoice') {
    if (data?.vatNumber && !isValidAfm(data.vatNumber)) score += 1;
    if (data?.customerVatNumber && !isValidAfm(data.customerVatNumber)) score += 1;
    if (!checkTotals(data).ok) score += 1;
  }
  if (docType === 'receipt' && data?.vatNumber && !isValidAfm(data.vatNumber)) score += 1;
  return score;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ocr/__tests__/validate.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/validate.ts lib/ocr/__tests__/validate.test.ts
git commit -m "feat(ocr): totals check, party-swap fix, composite quality score"
```

---

### Task 3: Own-ΑΦΜ resolver

**Files:**
- Create: `lib/ocr/own-afm.ts`

> No unit test — this calls a live service and is exercised via integration. Keep it tiny and defensive.

- [ ] **Step 1: Implement**

```ts
// lib/ocr/own-afm.ts
import { getSetting } from '@/lib/settings';

let cache: { value: string | null; day: string } | null = null;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Our own company ΑΦΜ, used only to detect issuer/recipient swaps.
 * Source priority: SoftOne system params (configured COMPANY) → `company.ownVat`
 * setting → env. Cached for the calendar day. Never throws.
 */
export async function resolveOwnAfm(): Promise<string | null> {
  if (cache && cache.day === today()) return cache.value;
  let value: string | null = null;
  try {
    // SoftOne path: company info exposes the firm ΑΦΜ. Wrapped so a failure
    // silently falls through to settings.
    const { s1 } = await import('@/lib/softone');
    const res = await s1('getSystemParams').catch(() => null);
    const afm = res?.afm ?? res?.AFM ?? res?.companyinfo?.afm ?? null;
    if (afm) value = String(afm).replace(/\D+/g, '') || null;
  } catch { /* softone unavailable — fall through */ }
  if (!value) {
    const setting = await getSetting<string>('company.ownVat').catch(() => null);
    value = setting ? String(setting).replace(/\D+/g, '') || null : null;
  }
  if (!value && process.env.COMPANY_OWN_VAT) value = process.env.COMPANY_OWN_VAT.replace(/\D+/g, '') || null;
  cache = { value, day: today() };
  return value;
}
```

> NOTE: if `lib/softone.ts` does not exist in this repo, delete the SoftOne block
> and rely on the `company.ownVat` setting + env fallback. Verify before writing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep own-afm || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add lib/ocr/own-afm.ts
git commit -m "feat(ocr): day-cached own-ΑΦΜ resolver for party disambiguation"
```

---

### Task 4: Wire validation into the extraction pipeline

**Files:**
- Modify: `lib/ocr/extract.ts`

- [ ] **Step 1: Import the new helpers**

At the top of `lib/ocr/extract.ts`, add:

```ts
import { qualityScore, fixSwappedParties } from '@/lib/ocr/validate';
import { resolveOwnAfm } from '@/lib/ocr/own-afm';
```

- [ ] **Step 2: Apply party-fix after each parse in the image path**

In `extractDocument`, in the `if (isImage)` block, immediately after `let data = parseJsonLoose(out.content);` add:

```ts
    const ownAfm = await resolveOwnAfm();
    data = fixSwappedParties(data, ownAfm);
```

- [ ] **Step 3: Replace retry-keep comparisons with `qualityScore`**

There are three sites that currently compare `countMissingRequired`. Change the **keep** decision (not the trigger) to compare `qualityScore`:

- Image path (~L435):
```ts
        if (qualityScore(retryData, input.docType) < qualityScore(data, input.docType)) {
```
- Gemini-native path in `runScannedPdf` (~L532):
```ts
        if (qualityScore(retryData, docType) < qualityScore(data, docType)) {
```
- Rasterized path in `runScannedPdf` (~L573):
```ts
      if (qualityScore(retryMerged, docType) < qualityScore(merged, docType)) {
```

> Leave the **trigger** (`countMissingRequired(...) >= RETRY_MISSING_THRESHOLD`)
> unchanged for now — a present-but-wrong field still won't *trigger* a retry, but
> when a retry runs (because something else is missing) its better result is now kept.
> Triggering on quality is added in Task 8.

- [ ] **Step 4: Apply party-fix in the Gemini-native + rasterized paths too**

In `runScannedPdf`, after each `parseJsonLoose` that produces the primary `data`/`merged`, apply `fixSwappedParties`. For the native path add after `let data = parseJsonLoose(out.content);`:

```ts
    const ownAfm = await resolveOwnAfm();
    data = fixSwappedParties(data, ownAfm);
```

For the rasterized path, after `let merged = mergePages(parsed, docType);`:

```ts
  const ownAfm = await resolveOwnAfm();
  merged = fixSwappedParties(merged, docType === 'invoice' ? ownAfm : null) as any;
```

- [ ] **Step 5: Typecheck + existing tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "ocr/(extract|validate|own-afm)" || echo "clean"`
Then: `npx vitest run lib/ocr`
Expected: `clean`; ocr tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ocr/extract.ts
git commit -m "feat(ocr): use quality score for retry-keep + fix swapped parties"
```

---

## PHASE 2 — Supplier templates (few-shot)

### Task 5: `SupplierTemplate` model + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model** (after `OcrInvoiceItem`)

```prisma
model SupplierTemplate {
  id           String      @id @default(cuid())
  vatNumber    String
  docType      OcrDocType
  supplierName String?
  example      Json
  fieldHints   Json?
  sampleDocId  String?
  thumbUrl     String?
  timesUsed    Int      @default(0)
  createdById  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([vatNumber, docType])
  @@index([vatNumber])
}
```

- [ ] **Step 2: Push schema + generate client** (per repo migrate workflow)

Run:
```bash
npx prisma db push && npx prisma generate
```
Expected: "Your database is now in sync"; client regenerated.

- [ ] **Step 3: Author the migration SQL for repeatability**

Run:
```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_supplier_template
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/st.sql; cat /tmp/st.sql
```
> If the diff is empty because `db push` already applied it, generate the SQL with
> `--from-empty` against the model instead, or copy the `CREATE TABLE SupplierTemplate`
> from your DB. Place the SQL in the new migration's `migration.sql` and run
> `npx prisma migrate resolve --applied <dir-name>`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(ocr): SupplierTemplate model + migration"
```

---

### Task 6: Few-shot system prompt

**Files:**
- Modify: `lib/ocr/templates.ts`
- Test: `lib/ocr/__tests__/templates.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// lib/ocr/__tests__/templates.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../templates';

describe('buildSystemPrompt few-shot', () => {
  it('omits the reference block when no example is given', () => {
    const p = buildSystemPrompt('invoice', 'el');
    expect(p).not.toMatch(/Αναφορά|Reference example/i);
  });
  it('includes the example JSON and a "do not copy" instruction when given', () => {
    const example = { vatNumber: '094014201', companyName: 'ΟΤΕ' };
    const p = buildSystemPrompt('invoice', 'el', example, { vatNumber: { note: 'πάνω δεξιά' } });
    expect(p).toContain('094014201');
    expect(p).toMatch(/do NOT copy|μην αντιγρ/i);
    expect(p).toContain('πάνω δεξιά');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ocr/__tests__/templates.test.ts`
Expected: FAIL — `buildSystemPrompt` takes 2 args / ignores example.

- [ ] **Step 3: Implement — extend `buildSystemPrompt`**

Replace the existing `buildSystemPrompt` in `lib/ocr/templates.ts` with:

```ts
export function buildSystemPrompt(
  docType: DocType,
  lang: SupportedLang,
  example?: unknown,
  fieldHints?: unknown,
): string {
  const tpl = TEMPLATE_SCHEMAS[docType];
  const ln = SUPPORTED_LANGUAGES[lang];
  const lines = [
    'You are a highly resilient JSON document extraction node.',
    tpl.systemInstructions,
    ln.instruction,
    '',
    'You MUST respond EXCLUSIVELY with a raw valid JSON object matching this blueprint.',
    'Do not wrap output in markdown code fences (no ```json).',
    'Do not include conversational text, prefixes, or trailing notes.',
    '',
    'Blueprint:',
    tpl.jsonStructure,
  ];
  if (example != null) {
    lines.push(
      '',
      'Reference example — a previously VERIFIED document from this SAME issuer had',
      'the structure below. Use it ONLY to locate and disambiguate fields (e.g. which',
      'block is the issuer vs the recipient, where the ΑΦΜ sits). Do NOT copy values —',
      'μην αντιγράφεις τιμές — read the ACTUAL document in front of you:',
      JSON.stringify(example),
    );
    if (fieldHints != null) {
      lines.push('Field location hints (page/position notes):', JSON.stringify(fieldHints));
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ocr/__tests__/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/templates.ts lib/ocr/__tests__/templates.test.ts
git commit -m "feat(ocr): few-shot reference block in system prompt"
```

---

### Task 7: Template store + merge logic

**Files:**
- Create: `lib/ocr/templates-store.ts`
- Test: `lib/ocr/__tests__/templates-store.test.ts`

- [ ] **Step 1: Write the failing test (pure merge function)**

```ts
// lib/ocr/__tests__/templates-store.test.ts
import { describe, it, expect } from 'vitest';
import { mergeFromTemplatePass } from '../templates-store';

describe('mergeFromTemplatePass', () => {
  it('fills only fields that were missing or invalid in pass1', () => {
    const pass1 = { companyName: 'A', vatNumber: '', customerName: 'B',
      customerVatNumber: '090000045', invoiceNumber: '7', date: '2026-01-01',
      subtotal: 100, vatAmount: 24, totalAmount: 124 };
    const pass2 = { companyName: 'SHOULD-NOT-WIN', vatNumber: '094014201',
      customerVatNumber: '090000045', subtotal: 100, vatAmount: 24, totalAmount: 124 };
    const out = mergeFromTemplatePass(pass1, pass2, 'invoice');
    expect(out.vatNumber).toBe('094014201');   // was empty → filled from pass2
    expect(out.companyName).toBe('A');          // pass1 had it → kept
  });
  it('replaces a present-but-invalid ΑΦΜ from pass1 with a valid one from pass2', () => {
    const pass1 = { vatNumber: '094014202', subtotal: 1, vatAmount: 0, totalAmount: 1 };
    const pass2 = { vatNumber: '094014201' };
    expect(mergeFromTemplatePass(pass1, pass2, 'invoice').vatNumber).toBe('094014201');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ocr/__tests__/templates-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/ocr/templates-store.ts
import { prisma } from '@/lib/db';
import { REQUIRED_FIELDS, type DocType } from '@/lib/ocr/templates';
import { isValidAfm } from '@/lib/ocr/validate';

const AFM_FIELDS = new Set(['vatNumber', 'customerVatNumber']);

function isWeak(field: string, v: unknown): boolean {
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return true;
  if (AFM_FIELDS.has(field) && !isValidAfm(String(v))) return true;
  return false;
}

/** Take from pass2 only the required fields that were missing/invalid in pass1. */
export function mergeFromTemplatePass<T extends Record<string, any>>(
  pass1: T, pass2: Record<string, any>, docType: DocType,
): T {
  const out: Record<string, any> = { ...pass1 };
  for (const key of REQUIRED_FIELDS[docType]) {
    if (isWeak(key, out[key]) && !isWeak(key, pass2?.[key])) out[key] = pass2[key];
  }
  if (docType === 'invoice' && (!Array.isArray(out.items) || out.items.length === 0)
      && Array.isArray(pass2?.items) && pass2.items.length) {
    out.items = pass2.items;
  }
  return out as T;
}

const docTypeToEnum: Record<DocType, 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT'> = {
  invoice: 'INVOICE', receipt: 'RECEIPT', general_text: 'GENERAL_TEXT',
};

export async function findSupplierTemplate(vatNumber: string, docType: DocType) {
  const afm = String(vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm) || docType === 'general_text') return null;
  return prisma.supplierTemplate.findUnique({
    where: { vatNumber_docType: { vatNumber: afm, docType: docTypeToEnum[docType] } },
  });
}

export async function upsertSupplierTemplate(args: {
  vatNumber: string; docType: DocType; supplierName?: string | null;
  example: unknown; fieldHints?: unknown; sampleDocId?: string | null;
  thumbUrl?: string | null; createdById?: string | null;
}) {
  const afm = String(args.vatNumber ?? '').replace(/\D+/g, '');
  const enumType = docTypeToEnum[args.docType];
  return prisma.supplierTemplate.upsert({
    where: { vatNumber_docType: { vatNumber: afm, docType: enumType } },
    create: {
      vatNumber: afm, docType: enumType, supplierName: args.supplierName ?? null,
      example: args.example as any, fieldHints: (args.fieldHints ?? null) as any,
      sampleDocId: args.sampleDocId ?? null, thumbUrl: args.thumbUrl ?? null,
      createdById: args.createdById ?? null,
    },
    update: {
      supplierName: args.supplierName ?? null, example: args.example as any,
      fieldHints: (args.fieldHints ?? null) as any, sampleDocId: args.sampleDocId ?? null,
      thumbUrl: args.thumbUrl ?? null,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ocr/__tests__/templates-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/templates-store.ts lib/ocr/__tests__/templates-store.test.ts
git commit -m "feat(ocr): supplier template store + selective merge"
```

---

### Task 8: Template-aware second pass in the pipeline

**Files:**
- Modify: `lib/ocr/extract.ts`

- [ ] **Step 1: Import the store**

Add near the other imports:

```ts
import { findSupplierTemplate, mergeFromTemplatePass } from '@/lib/ocr/templates-store';
import { buildSystemPrompt as buildPrompt } from '@/lib/ocr/templates';
```

(`buildSystemPrompt` is already imported; alias avoids touching the existing call sites.)

- [ ] **Step 2: Add a refined-pass helper at the end of `extract.ts`**

```ts
/**
 * After a normal pass, if required fields are still missing AND we have a
 * verified template for this issuer ΑΦΜ, run ONE more pass with a few-shot prompt
 * and merge in only the fields pass 1 missed. Returns the (possibly) improved result.
 * Costs an extra model call only for known suppliers with incomplete first passes.
 */
async function applySupplierTemplate(
  cfg: DeepSeekCfg, input: ExtractInput, base: ExtractResult, started: number,
): Promise<ExtractResult> {
  if (countMissingRequired(base.data, input.docType) === 0) return base;
  const issuerAfm = String(base.data?.vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(issuerAfm)) return base;
  const tpl = await findSupplierTemplate(issuerAfm, input.docType);
  if (!tpl) return base;

  const system = buildPrompt(input.docType, input.language, tpl.example, tpl.fieldHints);
  let pass2: any = null;
  try {
    if (input.mimeType === 'application/pdf'
        && cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
      const out = await callGeminiPdfNative(cfg, system, input.buffer, UPGRADED_VISION_MODEL);
      pass2 = parseJsonLoose(out.content);
    } else if (input.mimeType.startsWith('image/')) {
      const enhanced = await enhanceForOcr(input.buffer);
      const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'),
        enhanced.mimeType, UPGRADED_VISION_MODEL);
      pass2 = parseJsonLoose(out.content);
    } else if (base.rawText) {
      const out = await callTextLLM(cfg, system,
        `Here is the digital text payload extracted from the document:\n\n${base.rawText}`);
      pass2 = parseJsonLoose(out.content);
    }
  } catch { return base; }
  if (!pass2) return base;

  const merged = mergeFromTemplatePass(base.data, pass2, input.docType);
  await prisma.supplierTemplate.update({
    where: { id: tpl.id }, data: { timesUsed: { increment: 1 } },
  }).catch(() => {});
  return { ...base, data: merged, model: `${base.model} + template`, durationMs: Date.now() - started, retried: true };
}
```

Add at the top: `import { prisma } from '@/lib/db';`

- [ ] **Step 3: Call it from `extractDocument` before each `return`**

Wrap the image-path and pdf-path results. Simplest: compute the result into a variable and pass through `applySupplierTemplate` at the single exit. For the image branch, change `return { data, ... }` to:

```ts
    const base: ExtractResult = { data, rawText: null, model, tokensUsed: tokens,
      durationMs: Date.now() - started, passes, retried };
    return await applySupplierTemplate(cfg, input, base, started);
```

For the `auto`/`digital`/`scanned` pdf branches, wrap their return values likewise, e.g.:

```ts
      return await applySupplierTemplate(cfg, input, digital, started);
```
and for scanned:
```ts
    return await applySupplierTemplate(cfg, input, await runScannedPdf(cfg, system, input.buffer, input.docType, started), started);
```

> Apply consistently at every `extractDocument` return that yields a final result
> (not inside `runScannedPdf`/`runDigitalPdf` helpers — wrap their callers).

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit 2>&1 | grep "ocr/extract" || echo "clean"`
Then: `npx vitest run lib/ocr`
Expected: `clean`; PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/extract.ts
git commit -m "feat(ocr): template-aware second pass for known suppliers"
```

---

### Task 9: Save-template API

**Files:**
- Create: `app/api/admin/ocr/[id]/save-template/route.ts`

- [ ] **Step 1: Implement the route**

```ts
// app/api/admin/ocr/[id]/save-template/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { upsertSupplierTemplate } from '@/lib/ocr/templates-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  fieldHints: z.record(z.any()).optional(),   // { field: { page, bbox, note } }
});

const docEnumToType = { INVOICE: 'invoice', RECEIPT: 'receipt', GENERAL_TEXT: 'general_text' } as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;
  const { fieldHints } = Body.parse(await req.json().catch(() => ({})));

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.docType === 'GENERAL_TEXT') {
    return NextResponse.json({ error: 'Τα πρότυπα υποστηρίζονται μόνο για τιμολόγια/αποδείξεις.' }, { status: 422 });
  }
  const data = (doc.extractedData ?? {}) as any;
  const afm = String(data?.vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm)) {
    return NextResponse.json({ error: 'Δεν υπάρχει έγκυρο ΑΦΜ εκδότη για να αποθηκευτεί πρότυπο.' }, { status: 422 });
  }

  const tpl = await upsertSupplierTemplate({
    vatNumber: afm,
    docType: docEnumToType[doc.docType],
    supplierName: data?.companyName ?? data?.storeName ?? null,
    example: data,
    fieldHints: fieldHints ?? null,
    sampleDocId: doc.id,
    thumbUrl: doc.thumbUrl ?? null,
  });
  return NextResponse.json({ ok: true, template: { id: tpl.id, vatNumber: tpl.vatNumber, docType: tpl.docType } });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "save-template" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/ocr/[id]/save-template/route.ts"
git commit -m "feat(ocr): save-as-template API endpoint"
```

---

## PHASE 3 — Correction UI

### Task 10: Digital-PDF marquee→text mapping (pure)

**Files:**
- Create: `lib/ocr/region-text.ts`
- Test: `lib/ocr/__tests__/region-text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ocr/__tests__/region-text.test.ts
import { describe, it, expect } from 'vitest';
import { textInBox, type TextItem } from '../region-text';

// Coordinates are normalized 0..1 with origin top-left.
const items: TextItem[] = [
  { str: 'ΑΦΜ:',       x: 0.60, y: 0.10, w: 0.08, h: 0.02 },
  { str: '094014201',  x: 0.70, y: 0.10, w: 0.12, h: 0.02 },
  { str: 'ΣΥΝΟΛΟ',     x: 0.10, y: 0.80, w: 0.10, h: 0.02 },
];

describe('textInBox', () => {
  it('joins items whose centre falls inside the box, left-to-right top-to-bottom', () => {
    expect(textInBox(items, { x: 0.58, y: 0.08, w: 0.30, h: 0.06 })).toBe('ΑΦΜ: 094014201');
  });
  it('returns only the items inside a tighter box', () => {
    expect(textInBox(items, { x: 0.69, y: 0.09, w: 0.15, h: 0.04 })).toBe('094014201');
  });
  it('returns empty string when nothing intersects', () => {
    expect(textInBox(items, { x: 0.0, y: 0.0, w: 0.05, h: 0.05 })).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ocr/__tests__/region-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/ocr/region-text.ts
export interface TextItem { str: string; x: number; y: number; w: number; h: number; }
export interface Box { x: number; y: number; w: number; h: number; }

/** Join the text of items whose centre lies within the box (reading order). */
export function textInBox(items: TextItem[], box: Box): string {
  const inside = items.filter((it) => {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  });
  inside.sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x));
  return inside.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ocr/__tests__/region-text.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/region-text.ts lib/ocr/__tests__/region-text.test.ts
git commit -m "feat(ocr): pure marquee→text mapping for digital PDFs"
```

---

### Task 11: read-region API (crop + focused vision)

**Files:**
- Create: `app/api/admin/ocr/[id]/read-region/route.ts`

- [ ] **Step 1: Implement**

```ts
// app/api/admin/ocr/[id]/read-region/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { logAiUsage } from '@/lib/ai/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  field: z.string().min(1),
  page: z.number().int().min(0).default(0),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // x,y,w,h normalized 0..1
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const { field, page, bbox } = Body.parse(await req.json());

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Fetch original bytes from CDN.
  const fileRes = await fetch(doc.publicUrl, { cache: 'no-store' });
  if (!fileRes.ok) return NextResponse.json({ error: 'file unavailable' }, { status: 502 });
  let imgBuf = Buffer.from(await fileRes.arrayBuffer());

  // For PDFs, rasterize the requested page first.
  if (doc.mimeType === 'application/pdf') {
    const { createRequire } = await import('node:module');
    const req2 = createRequire(import.meta.url);
    const workerPath = req2.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(imgBuf, { scale: 3 });
    let i = 0, found: Buffer | null = null;
    for await (const p of document) {
      if (i === page) { found = Buffer.isBuffer(p) ? p : Buffer.from(p as Uint8Array); break; }
      i++;
    }
    if (!found) return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    imgBuf = found;
  }

  // Crop the normalized bbox.
  const meta = await sharp(imgBuf).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  const [nx, ny, nw, nh] = bbox;
  const left = Math.max(0, Math.round(nx * W)), top = Math.max(0, Math.round(ny * H));
  const width = Math.min(W - left, Math.max(8, Math.round(nw * W)));
  const height = Math.min(H - top, Math.max(8, Math.round(nh * H)));
  const crop = await sharp(imgBuf).extract({ left, top, width, height })
    .resize({ width: Math.max(width * 2, 400), withoutEnlargement: false })
    .grayscale().normalize().png().toBuffer();

  // Focused vision call — read ONLY this field.
  const visionKey = (await getSetting<string>('ai.visionApiKey')) ?? process.env.GEMINI_API_KEY ?? '';
  const visionUrl = (await getSetting<string>('ai.visionUrl'))
    ?? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const visionModel = (await getSetting<string>('ai.visionModel')) ?? 'gemini-2.5-flash';
  if (!visionKey) return NextResponse.json({ error: 'vision key not configured' }, { status: 500 });

  const res = await fetch(visionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${visionKey}` },
    body: JSON.stringify({
      model: visionModel, temperature: 0,
      messages: [
        { role: 'system', content: `Read the value of the field "${field}" from this cropped image of a Greek invoice/receipt. Respond with ONLY the raw value text, no labels, no quotes, no explanation.` },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${crop.toString('base64')}` } }] },
      ],
    }),
  });
  if (!res.ok) return NextResponse.json({ error: `vision ${res.status}` }, { status: 502 });
  const data = await res.json();
  const value = String(data?.choices?.[0]?.message?.content ?? '').trim();
  const u = data?.usage ?? {};
  void logAiUsage({ scope: 'OCR_VISION', provider: 'gemini', model: visionModel,
    operation: 'ocr.region', inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0 });

  return NextResponse.json({ value });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "read-region" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/ocr/[id]/read-region/route.ts"
git commit -m "feat(ocr): read-region API (crop + focused vision)"
```

---

### Task 12: Extend PATCH to persist corrected fields + items

**Files:**
- Modify: `app/api/admin/ocr/[id]/route.ts`

- [ ] **Step 1: Extend the PATCH schema + handler**

Replace `PatchSchema` and the `PATCH` function with:

```ts
const ItemSchema = z.object({
  code: z.string().nullable().optional(), name: z.string(),
  quantity: z.number().nullable().optional(), price: z.number().nullable().optional(),
  discount: z.number().nullable().optional(), vatRate: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
});
const PatchSchema = z.object({
  category: z.enum(['EXPENSE','INVOICE_IN','INVOICE_OUT','RECEIPT','CREDIT_NOTE','PAYROLL','TAX','OTHER']).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  extractedData: z.record(z.any()).optional(),
  items: z.array(ItemSchema).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const body = PatchSchema.parse(await req.json());
  const { items, ...scalar } = body;

  const doc = await prisma.ocrDocument.update({ where: { id }, data: scalar });

  if (items) {
    await prisma.$transaction([
      prisma.ocrInvoiceItem.deleteMany({ where: { documentId: id } }),
      prisma.ocrInvoiceItem.createMany({
        data: items.map((it, i) => ({
          documentId: id, rowIndex: i, code: it.code ?? null, name: it.name,
          quantity: it.quantity ?? null, price: it.price ?? null, discount: it.discount ?? null,
          vatRate: it.vatRate ?? null, total: it.total ?? null,
        })),
      }),
    ]);
  }
  const fresh = await prisma.ocrDocument.findUnique({ where: { id }, include: { items: { orderBy: { rowIndex: 'asc' } } } });
  return NextResponse.json(fresh ?? doc);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "ocr/\[id\]/route" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/ocr/[id]/route.ts"
git commit -m "feat(ocr): persist corrected extractedData + line items via PATCH"
```

---

### Task 13: Marquee hook

**Files:**
- Create: `app/admin/ocr/[id]/use-marquee.ts`

- [ ] **Step 1: Implement the hook** (normalized-coords drag over a target element)

```ts
// app/admin/ocr/[id]/use-marquee.ts
'use client';
import { useCallback, useRef, useState } from 'react';

export interface NormBox { x: number; y: number; w: number; h: number; }

/**
 * Drag-to-select over a ref'd element. Returns the live box (normalized 0..1)
 * and pointer handlers. `onComplete` fires with the final box on pointer up.
 */
export function useMarquee(onComplete: (box: NormBox) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<NormBox | null>(null);
  const [active, setActive] = useState(false);

  const rel = useCallback((e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!ref.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = rel(e); setActive(true); setBox({ ...start.current, w: 0, h: 0 });
  }, [rel]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!active || !start.current) return;
    const p = rel(e);
    setBox({ x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y),
      w: Math.abs(p.x - start.current.x), h: Math.abs(p.y - start.current.y) });
  }, [active, rel]);

  const onPointerUp = useCallback(() => {
    setActive(false);
    if (box && box.w > 0.005 && box.h > 0.005) onComplete(box);
    start.current = null; setBox(null);
  }, [box, onComplete]);

  return { ref, box, active, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "use-marquee" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add "app/admin/ocr/[id]/use-marquee.ts"
git commit -m "feat(ocr): marquee selection hook (normalized coords)"
```

---

### Task 14: FieldCorrection component (DG design system)

**Files:**
- Create: `app/admin/ocr/[id]/field-correction.tsx`
- Modify: `app/admin/ocr/[id]/result-view.tsx`

**Design tokens (from `lib/design-system`):** primary actions `Button variant="primary"` (Sisyphus Blue `#0078D4`); destructive/brand reserve `variant="danger"`/`brand` (DG Red `#E31E2A`); inputs via `Input` from `@/lib/design-system`; cards radius 8px (`rounded-lg`), two-layer shadow `shadow-fluent-8`; active-field highlight `ring-2 ring-sisyphus-500`; marquee box `border-2 border-sisyphus-500 bg-sisyphus-500/10`. Greek labels. 4px baseline spacing.

- [ ] **Step 1: Implement the component**

```tsx
// app/admin/ocr/[id]/field-correction.tsx
'use client';
import { useState, useMemo } from 'react';
import { Button, Input } from '@/lib/design-system';
import { useMarquee, type NormBox } from './use-marquee';

type Hints = Record<string, { page: number; bbox: [number, number, number, number] }>;

const FIELD_LABELS: Record<string, string> = {
  companyName: 'Επωνυμία Εκδότη', vatNumber: 'ΑΦΜ Εκδότη',
  customerName: 'Επωνυμία Πελάτη', customerVatNumber: 'ΑΦΜ Πελάτη',
  invoiceNumber: 'Αρ. Παραστατικού', date: 'Ημερομηνία',
  subtotal: 'Καθαρή Αξία', vatAmount: 'ΦΠΑ', totalAmount: 'Σύνολο',
  storeName: 'Κατάστημα',
};

export function FieldCorrection({ docId, mimeType, fileUrl, initialData, fields }: {
  docId: string; mimeType: string; fileUrl: string;
  initialData: Record<string, any>; fields: string[];
}) {
  const [data, setData] = useState<Record<string, any>>(initialData ?? {});
  const [activeField, setActiveField] = useState<string | null>(null);
  const [hints, setHints] = useState<Hints>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const page = 0; // single-page marquee for v1; multipage picker is a later enhancement

  const onComplete = useMemo(() => async (box: NormBox) => {
    if (!activeField) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/read-region`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: activeField, page, bbox: [box.x, box.y, box.w, box.h] }),
      });
      const json = await res.json();
      if (res.ok && json.value) {
        setData((d) => ({ ...d, [activeField]: json.value }));
        setHints((h) => ({ ...h, [activeField]: { page, bbox: [box.x, box.y, box.w, box.h] } }));
      }
    } finally { setBusy(false); setActiveField(null); }
  }, [activeField, docId]);

  const { ref, box, active, handlers } = useMarquee(onComplete);

  async function saveCorrections() {
    setBusy(true);
    try {
      await fetch(`/api/admin/ocr/${docId}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: data, items: Array.isArray(data.items) ? data.items : undefined }) });
      setSaved('Οι διορθώσεις αποθηκεύτηκαν.');
    } finally { setBusy(false); }
  }
  async function saveTemplate() {
    setBusy(true);
    try {
      await fetch(`/api/admin/ocr/${docId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: data }) });
      const res = await fetch(`/api/admin/ocr/${docId}/save-template`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldHints: hints }) });
      const json = await res.json();
      setSaved(res.ok ? 'Αποθηκεύτηκε ως πρότυπο προμηθευτή.' : (json.error ?? 'Σφάλμα'));
    } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Document with marquee overlay */}
      <div className="relative rounded-lg overflow-hidden shadow-fluent-8 bg-neutral-4">
        <div ref={ref} {...handlers}
          className={`relative ${activeField ? 'cursor-crosshair' : ''}`}>
          {mimeType.startsWith('image/')
            ? <img src={fileUrl} alt="" className="w-full select-none pointer-events-none" />
            : <iframe src={fileUrl} className="w-full h-[70vh] pointer-events-none" title="doc" />}
          {active && box && (
            <div className="absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
              style={{ left: `${box.x*100}%`, top: `${box.y*100}%`, width: `${box.w*100}%`, height: `${box.h*100}%` }} />
          )}
        </div>
        {activeField && <p className="p-2 text-xs text-sisyphus-600">Σύρε πλαίσιο πάνω στο «{FIELD_LABELS[activeField] ?? activeField}»…</p>}
      </div>

      {/* Field editors */}
      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f} className={`flex items-end gap-2 p-2 rounded-md ${activeField===f ? 'ring-2 ring-sisyphus-500' : ''}`}>
            <Input label={FIELD_LABELS[f] ?? f} value={data[f] ?? ''}
              onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))} className="flex-1" />
            <Button size="sm" variant="subtle" type="button" disabled={busy}
              onClick={() => setActiveField((cur) => cur===f ? null : f)}>🎯</Button>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Button variant="primary" onClick={saveCorrections} isLoading={busy}>Αποθήκευση διορθώσεων</Button>
          <Button variant="secondary" onClick={saveTemplate} isLoading={busy}>Αποθήκευση ως πρότυπο</Button>
        </div>
        {saved && <p className="text-sm text-green-600">{saved}</p>}
      </div>
    </div>
  );
}
```

> NOTE on the PDF iframe: marquee over a cross-origin `<iframe>` can't read pixels,
> but we don't need to — the overlay sits in our own positioned container and we send
> normalized coords to the server, which rasterizes server-side. For digital PDFs, a
> later enhancement renders pdfjs to a `<canvas>` and uses `textInBox` (Task 10) to
> skip the API call. For v1, marquee → `read-region` works for both.

- [ ] **Step 2: Mount it in `result-view.tsx`**

Import and render `<FieldCorrection>` passing `docId`, `mimeType`, the file URL
(`/api/admin/ocr/${id}/file`), `extractedData`, and the field list derived from
`docType` (`['companyName','vatNumber','customerName','customerVatNumber','invoiceNumber','date','subtotal','vatAmount','totalAmount']` for invoices; `['storeName','vatNumber','invoiceNumber','date','totalAmount']` for receipts). Keep the existing read-only summary below it.

- [ ] **Step 3: Verify build + manual smoke**

Run: `npx tsc --noEmit 2>&1 | grep "field-correction\|result-view" || echo "clean"`
Then manual (see verification skill): `npm run dev`, open an OCR doc, mark the ΑΦΜ region, confirm it fills, save, reload, confirm persisted.

- [ ] **Step 4: Commit**

```bash
git add "app/admin/ocr/[id]/field-correction.tsx" "app/admin/ocr/[id]/result-view.tsx"
git commit -m "feat(ocr): interactive field-correction UI with marquee (DG design system)"
```

---

## PHASE 4 — Templates management + wiki

### Task 15: Templates list/delete API + page

**Files:**
- Create: `app/api/admin/ocr/templates/route.ts`
- Create: `app/admin/ocr/templates/page.tsx`

- [ ] **Step 1: API (GET list, DELETE by id)**

```ts
// app/api/admin/ocr/templates/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('ocr.read');
  const templates = await prisma.supplierTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
  return NextResponse.json(templates);
}

export async function DELETE(req: Request) {
  await requirePermission('ocr.delete');
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.supplierTemplate.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Page (server component lists templates)**

```tsx
// app/admin/ocr/templates/page.tsx
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/page-header'; // adjust import to actual path

export const dynamic = 'force-dynamic';

export default async function OcrTemplatesPage() {
  await requirePermission('ocr.read');
  const templates = await prisma.supplierTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Πρότυπα Προμηθευτών (OCR)" helpAnchor="ocr-templates" />
      <table className="w-full text-sm">
        <thead><tr className="text-left text-neutral-60">
          <th>Προμηθευτής</th><th>ΑΦΜ</th><th>Τύπος</th><th>Χρήσεις</th><th>Ενημ.</th></tr></thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-t border-neutral-8">
              <td className="py-2">{t.supplierName ?? '—'}</td>
              <td>{t.vatNumber}</td><td>{t.docType}</td><td>{t.timesUsed}</td>
              <td>{t.updatedAt.toISOString().slice(0,10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> Verify the actual `PageHeader` import path in this repo before writing (grep
> `components/page-header` or wherever `<PageHeader>` lives). A delete button can be
> added as a small client component calling `DELETE /api/admin/ocr/templates?id=`.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "ocr/templates" || echo "clean"`
```bash
git add "app/api/admin/ocr/templates/route.ts" "app/admin/ocr/templates/page.tsx"
git commit -m "feat(ocr): supplier templates management page + API"
```

---

### Task 16: Wiki entry (mandatory per project CLAUDE.md)

**Files:**
- Create: `docs/wiki/ocr/correction.mdx`
- Modify: `lib/wiki/modules-meta.ts` (if no `ocr` module)
- Modify: correction view `<PageHeader helpAnchor="ocr-correction" />`

- [ ] **Step 1: Ensure the `ocr` module exists**

Open `lib/wiki/modules-meta.ts`; if there's no `ocr` entry, add one (label "OCR Παραστατικά", description, icon, gradient hex colors — follow existing entries; use inline hex, not dynamic Tailwind classes).

- [ ] **Step 2: Scaffold the wiki page**

Run:
```bash
npm run wiki:new -- ocr/correction --roles "ADMIN,EMPLOYEE" --title "Διόρθωση & Πρότυπα OCR"
```

- [ ] **Step 3: Write Greek content** in `docs/wiki/ocr/correction.mdx`:

```mdx
## Επισκόπηση
Μετά το scan ενός παραστατικού, μπορείς να διορθώσεις πεδία που δεν βρέθηκαν ή
βγήκαν λάθος, μαρκάροντας με το ποντίκι την περιοχή του εγγράφου και αντιστοιχίζοντάς
την στο πεδίο. Μπορείς επίσης να αποθηκεύσεις το παραστατικό ως «πρότυπο προμηθευτή»
ώστε τα επόμενα scan του ίδιου ΑΦΜ να είναι πιο εύστοχα.

<Steps>
  <li>Άνοιξε ένα ολοκληρωμένο παραστατικό OCR.</li>
  <li>Πάτησε το 🎯 δίπλα στο πεδίο που θες να διορθώσεις.</li>
  <li>Σύρε πλαίσιο με το ποντίκι πάνω στην αντίστοιχη περιοχή του εγγράφου.</li>
  <li>Η τιμή συμπληρώνεται αυτόματα (ή γράψ’ την χειροκίνητα). Πάτησε «Αποθήκευση διορθώσεων».</li>
  <li>Προαιρετικά: «Αποθήκευση ως πρότυπο» για να βελτιωθούν τα επόμενα scan του προμηθευτή.</li>
</Steps>

<Callout type="warning">
Η «Αποθήκευση ως πρότυπο» αντικαθιστά τυχόν προηγούμενο πρότυπο για τον ίδιο ΑΦΜ και τύπο.
</Callout>

<Callout type="info">
Το πρότυπο χρησιμοποιείται μόνο όταν το πρώτο πέρασμα δεν βρει όλα τα υποχρεωτικά πεδία —
έτσι δεν υπάρχει επιπλέον κόστος όταν το scan πετυχαίνει εξαρχής.
</Callout>
```

Add to the frontmatter: `helpAnchors: [ocr-correction, ocr-templates]` and a
`screenshots:` entry with `route: /admin/ocr` (a completed doc).

- [ ] **Step 4: Build the index**

Run: `npm run wiki:index`
Expected: `public/wiki/index.json` updated.

- [ ] **Step 5: Commit**

```bash
git add docs/wiki/ocr/correction.mdx lib/wiki/modules-meta.ts public/wiki/index.json "app/admin/ocr/[id]/result-view.tsx"
git commit -m "docs(ocr): wiki entry for correction + supplier templates"
```

---

## Self-Review

**Spec coverage:**
- Component 1 (data model) → Task 5. ✓
- Component 2 (validate.ts: isValidAfm/checkTotals/fixSwappedParties/qualityScore + resolveOwnAfm) → Tasks 1–3. ✓
- Component 3 (retry-keep fix, deterministic post-processing, template second pass, few-shot prompt) → Tasks 4, 6, 7, 8. ✓
- Component 4 (correction UI: canvas/marquee, digital text-layer, image/scanned crop) → Tasks 10, 13, 14 (digital text-layer helper built in 10; wired as later enhancement). ✓
- Component 5 (read-region, PATCH persist, save-template, templates page) → Tasks 11, 12, 9, 15. ✓
- Error handling (no ΑΦΜ → fallback; drift; own-ΑΦΜ unreachable) → Tasks 3, 8 logic. ✓
- Testing → Tasks 1, 2, 6, 7, 10 (pure units); manual smoke in 14. ✓
- Wiki → Task 16. ✓

**Known follow-ups (documented, not gaps):** the digital-PDF pdfjs-canvas render that consumes `textInBox` to skip the API call is wired as a v2 enhancement; v1 routes both digital and scanned marquees through `read-region`. Multipage marquee uses `page=0` in v1.

**Placeholder scan:** none — all code steps contain full code; two explicit "verify the import path / softone existence" notes are deliberate environment checks, not placeholders.

**Type consistency:** `qualityScore(data, docType)`, `mergeFromTemplatePass(pass1, pass2, docType)`, `findSupplierTemplate(afm, docType)`, `buildSystemPrompt(docType, lang, example?, fieldHints?)`, `textInBox(items, box)`, `useMarquee(onComplete)` are used consistently across tasks.
