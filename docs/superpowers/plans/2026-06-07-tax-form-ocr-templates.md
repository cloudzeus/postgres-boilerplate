# Tax-Form OCR Templates & Company Financials (②) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins define reusable OCR templates for Greek tax forms (Ε3/Ε1) via region marking, upload a company's form, auto-extract named field values, review/correct them, and store them as company-scoped financial values keyed `{templateCode}.{fieldKey}` per year — the data contract the future evaluation engine (①) will consume.

**Architecture:** Extend the existing admin OCR infrastructure (Gemini Vision pipeline, `useMarquee` region marking, Bunny storage) with four new Prisma models. A new pure `extractTaxForm()` reuses the existing vision/raster/prompt building blocks. UI is built from a reusable `<RegionMarker>` primitive and an embeddable `<TaxFormCapture>` widget. All number/date parsing lives in a new pure, unit-tested `lib/greek-format.ts`.

**Tech Stack:** Next.js 16, Prisma 7 + PostgreSQL, vitest (node, `lib/**/*.test.ts`), Gemini Vision (OpenAI-compat) + DeepSeek, sharp + pdf-to-img, shadcn/ui + DG design system, Bunny CDN private zone.

**Reference spec:** [docs/superpowers/specs/2026-06-07-tax-form-ocr-templates-design.md](../specs/2026-06-07-tax-form-ocr-templates-design.md)

---

## File Structure

**New — pure logic (unit-tested in `lib/`):**
- `lib/greek-format.ts` — `parseGreekNumber/Currency/Percentage/Date`, `coerceFinancialValue`
- `lib/tax/template-prompt.ts` — `templateFieldsToRules()` (TaxFormTemplateField → FieldRuleLite)
- `lib/tax/year-resolve.ts` — `resolveYear(referenceYear, mode)` + `requiredYears(yearsBack, referenceYear)`
- `lib/tax/financial-merge.ts` — `buildFinancialUpserts()` (pure: extracted+edited values → upsert rows)
- `lib/ocr/tax-extract.ts` — `extractTaxForm()` (impure orchestrator; thin)
- `lib/ocr/rasterize.ts` — shared `rasterizeToWebp(buffer, mimeType, {page, scale})`

**New — API routes:**
- `app/api/admin/tax-templates/route.ts` (GET list, POST create)
- `app/api/admin/tax-templates/[id]/route.ts` (GET, PATCH, DELETE)
- `app/api/admin/tax-templates/[id]/fields/route.ts` (PUT replace fields)
- `app/api/admin/tax-templates/[id]/sample/route.ts` (POST upload sample)
- `app/api/admin/tax-templates/[id]/page-image/route.ts` (GET rasterized sample page)
- `app/api/admin/programs/[id]/required-fields/route.ts` (GET, PUT)
- `app/api/admin/companies/[id]/financials/route.ts` (GET list)
- `app/api/admin/companies/[id]/financials/extract/route.ts` (POST upload+extract)
- `app/api/admin/companies/[id]/financials/confirm/route.ts` (POST upsert values)

**New — UI:**
- `components/ui/region-marker.tsx` — reusable primitive (multi-page)
- `components/admin/tax-template-region-editor.tsx`
- `components/admin/tax-form-capture.tsx` — embeddable widget
- `components/admin/company-financials-matrix.tsx`
- `app/admin/tax-templates/page.tsx` + `app/admin/tax-templates/[id]/page.tsx` + `editor.tsx`
- Program editor: new `oikonomika-pedia-tab.tsx`
- Company page: new `financials-tab.tsx`

**Modified:**
- `prisma/schema.prisma` (+4 models, +4 enums, extend OcrDocument/Company/Program)
- `lib/ocr/extract.ts` (add `export` to reused internals if missing)
- `components/admin/supplier-field-rule-dialog.tsx` (refactor onto `<RegionMarker>`)
- `lib/ai/usage.ts` (add `'TAX_FORM'` to the `scope` union if it is typed)

**New — wiki:**
- `docs/wiki/tax-templates/overview.mdx`, `docs/wiki/programs/oikonomika-pedia.mdx`, `docs/wiki/companies/oikonomika.mdx`

---

## Task 1: Greek number/date parsers (pure, TDD)

**Files:**
- Create: `lib/greek-format.ts`
- Test: `lib/__tests__/greek-format.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/greek-format.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseGreekNumber,
  parseGreekCurrency,
  parseGreekPercentage,
  parseGreekDate,
  coerceFinancialValue,
} from '../greek-format';

describe('parseGreekNumber', () => {
  it('parses dot-thousands + comma-decimal', () => {
    expect(parseGreekNumber('1.556.540,27')).toBe(1556540.27);
  });
  it('parses plain integers', () => {
    expect(parseGreekNumber('400000')).toBe(400000);
  });
  it('parses negatives', () => {
    expect(parseGreekNumber('-1.234,50')).toBe(-1234.5);
  });
  it('returns null for blank / garbage', () => {
    expect(parseGreekNumber('')).toBeNull();
    expect(parseGreekNumber('abc')).toBeNull();
    expect(parseGreekNumber(null)).toBeNull();
  });
  it('accepts already-numeric input', () => {
    expect(parseGreekNumber(1556540.27)).toBe(1556540.27);
  });
});

describe('parseGreekCurrency', () => {
  it('strips euro symbol and spaces', () => {
    expect(parseGreekCurrency('400.000,00 €')).toBe(400000);
    expect(parseGreekCurrency('€ 27.604,25')).toBe(27604.25);
  });
});

describe('parseGreekPercentage', () => {
  it('parses a percentage to its numeric value', () => {
    expect(parseGreekPercentage('17,9%')).toBe(17.9);
    expect(parseGreekPercentage('100')).toBe(100);
  });
});

describe('parseGreekDate', () => {
  it('parses dd/mm/yyyy and dd.mm.yyyy', () => {
    expect(parseGreekDate('31/12/2024')?.toISOString().slice(0, 10)).toBe('2024-12-31');
    expect(parseGreekDate('01.06.2025')?.toISOString().slice(0, 10)).toBe('2025-06-01');
  });
  it('passes through ISO', () => {
    expect(parseGreekDate('2024-12-31')?.toISOString().slice(0, 10)).toBe('2024-12-31');
  });
  it('returns null for garbage', () => {
    expect(parseGreekDate('not a date')).toBeNull();
  });
});

describe('coerceFinancialValue', () => {
  it('dispatches by valueType', () => {
    expect(coerceFinancialValue('1.556.540,27', 'CURRENCY')).toBe(1556540.27);
    expect(coerceFinancialValue('17,9%', 'PERCENT')).toBe(17.9);
    expect(coerceFinancialValue('5', 'INTEGER')).toBe(5);
    expect(coerceFinancialValue('5,7', 'INTEGER')).toBe(6); // rounds
    expect(coerceFinancialValue('ΝΑΙ', 'BOOLEAN')).toBe(1);
    expect(coerceFinancialValue('1', 'BOOLEAN')).toBe(1);
    expect(coerceFinancialValue('ΟΧΙ', 'BOOLEAN')).toBe(0);
  });
  it('returns null when unparseable', () => {
    expect(coerceFinancialValue('—', 'CURRENCY')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- greek-format`
Expected: FAIL — `Cannot find module '../greek-format'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/greek-format.ts
export type FinancialValueTypeStr = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN';

/** Parses Greek-formatted numbers: "1.556.540,27" → 1556540.27 (dot=thousands, comma=decimal). */
export function parseGreekNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  // keep digits, sign, separators
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || /^[.,-]+$/.test(s)) return null;
  // remove thousands dots, convert decimal comma to dot
  s = s.replace(/\./g, '').replace(',', '.');
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

export function parseGreekCurrency(v: unknown): number | null {
  return parseGreekNumber(v);
}

export function parseGreekPercentage(v: unknown): number | null {
  return parseGreekNumber(v);
}

/** Parses dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy, or ISO. */
export function parseGreekDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

const TRUTHY = new Set(['1', 'ναι', 'nai', 'yes', 'true', 'αληθες', 'x', '✓']);
const FALSY = new Set(['0', 'οχι', 'όχι', 'ochi', 'no', 'false', '']);

/** Coerces a raw OCR/manual value to a numeric Decimal-ready number per field valueType. */
export function coerceFinancialValue(raw: unknown, valueType: FinancialValueTypeStr): number | null {
  switch (valueType) {
    case 'INTEGER': {
      const n = parseGreekNumber(raw);
      return n == null ? null : Math.round(n);
    }
    case 'BOOLEAN': {
      const s = String(raw ?? '').trim().toLowerCase();
      if (TRUTHY.has(s)) return 1;
      if (FALSY.has(s)) return 0;
      const n = parseGreekNumber(raw);
      return n == null ? null : n !== 0 ? 1 : 0;
    }
    case 'DATE': {
      const d = parseGreekDate(raw);
      return d ? d.getTime() : null; // stored separately as date; numeric epoch only if needed
    }
    case 'PERCENT':
    case 'CURRENCY':
    case 'NUMBER':
    default:
      return parseGreekNumber(raw);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- greek-format`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/greek-format.ts lib/__tests__/greek-format.test.ts
git commit -m "feat(tax): Greek number/date parsers for tax-form values"
```

---

## Task 2: Prisma schema models + enums

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums** (place near other enums, before models)

```prisma
enum TaxTemplateStatus { DRAFT READY }
enum FinancialValueType { CURRENCY NUMBER PERCENT INTEGER DATE BOOLEAN }
enum FinancialValueSource { OCR MANUAL }
enum FinancialYearMode { REFERENCE PRIOR_1 PRIOR_2 PRIOR_3 }
```

- [ ] **Step 2: Add the four new models** (append after `SupplierFieldRule`)

```prisma
model TaxFormTemplate {
  id               String   @id @default(cuid())
  code             String
  name             String
  year             Int?
  description      String?  @db.Text
  status           TaxTemplateStatus @default(DRAFT)
  sampleStorageKey String?
  samplePageCount  Int?
  sampleThumbUrl   String?
  createdById      String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  fields           TaxFormTemplateField[]
  requiredBy       ProgramRequiredField[]
  documents        OcrDocument[]

  @@unique([code, year])
  @@index([status])
}

model TaxFormTemplateField {
  id          String   @id @default(cuid())
  templateId  String
  template    TaxFormTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  fieldKey    String
  label       String
  section     String?
  valueType   FinancialValueType @default(CURRENCY)
  regionHint  Json?
  aiHint      String?  @db.Text
  required    Boolean  @default(false)
  order       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([templateId, fieldKey])
  @@index([templateId])
}

model CompanyFinancialValue {
  id               String   @id @default(cuid())
  companyId        String
  company          Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  fieldKey         String
  templateId       String?
  year             Int
  value            Decimal  @db.Decimal(18, 2)
  valueType        FinancialValueType
  source           FinancialValueSource @default(OCR)
  sourceDocumentId String?
  confidence       Float?
  verified         Boolean  @default(false)
  verifiedById     String?
  periodStart      DateTime?
  periodEnd        DateTime?
  validUntil       DateTime?
  note             String?  @db.Text
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([companyId, fieldKey, year])
  @@index([companyId])
  @@index([fieldKey, year])
}

model ProgramRequiredField {
  id          String   @id @default(cuid())
  programId   String
  program     Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  templateId  String
  template    TaxFormTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  fieldKey    String
  yearsBack   Int      @default(1)
  mandatory   Boolean  @default(true)
  order       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([programId, templateId, fieldKey])
  @@index([programId])
}
```

- [ ] **Step 3: Extend existing models**

In `model OcrDocument` add:
```prisma
  companyId     String?
  company       Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)
  taxTemplateId String?
  taxTemplate   TaxFormTemplate? @relation(fields: [taxTemplateId], references: [id], onDelete: SetNull)
  fiscalYear    Int?
```
and add to its `@@index` block: `@@index([companyId])`

In `model Company` add (in the relations section):
```prisma
  financialValues CompanyFinancialValue[]
  ocrDocuments    OcrDocument[]
```

In `model Program` add (in the relations section):
```prisma
  requiredFields  ProgramRequiredField[]
```

- [ ] **Step 4: Validate the schema (no DB write)**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 5: Generate the client (no DB write)**

Run: `npm run prisma:generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(tax): Prisma models for tax templates + company financials"
```

---

## Task 3: Migration SQL (write only — DO NOT apply without approval)

**Files:**
- Create: `prisma/migrations/20260607120000_tax_form_templates/migration.sql`

> ⚠️ The DB is **shared between prod and dev**. This task only *writes* the SQL and generates the client. Applying it (`prisma db push` / `migrate resolve`) requires explicit user approval — see Step 3.

- [ ] **Step 1: Write the migration SQL** (mirror the style of `prisma/migrations/20260603100001_supplier_field_rule/migration.sql`)

```sql
-- CreateEnum
CREATE TYPE "TaxTemplateStatus" AS ENUM ('DRAFT', 'READY');
CREATE TYPE "FinancialValueType" AS ENUM ('CURRENCY', 'NUMBER', 'PERCENT', 'INTEGER', 'DATE', 'BOOLEAN');
CREATE TYPE "FinancialValueSource" AS ENUM ('OCR', 'MANUAL');
CREATE TYPE "FinancialYearMode" AS ENUM ('REFERENCE', 'PRIOR_1', 'PRIOR_2', 'PRIOR_3');

-- CreateTable
CREATE TABLE "TaxFormTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "year" INTEGER,
  "description" TEXT,
  "status" "TaxTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "sampleStorageKey" TEXT,
  "samplePageCount" INTEGER,
  "sampleThumbUrl" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxFormTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxFormTemplate_code_year_key" ON "TaxFormTemplate"("code", "year");
CREATE INDEX "TaxFormTemplate_status_idx" ON "TaxFormTemplate"("status");

CREATE TABLE "TaxFormTemplateField" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "section" TEXT,
  "valueType" "FinancialValueType" NOT NULL DEFAULT 'CURRENCY',
  "regionHint" JSONB,
  "aiHint" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxFormTemplateField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxFormTemplateField_templateId_fieldKey_key" ON "TaxFormTemplateField"("templateId", "fieldKey");
CREATE INDEX "TaxFormTemplateField_templateId_idx" ON "TaxFormTemplateField"("templateId");

CREATE TABLE "CompanyFinancialValue" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "templateId" TEXT,
  "year" INTEGER NOT NULL,
  "value" DECIMAL(18,2) NOT NULL,
  "valueType" "FinancialValueType" NOT NULL,
  "source" "FinancialValueSource" NOT NULL DEFAULT 'OCR',
  "sourceDocumentId" TEXT,
  "confidence" DOUBLE PRECISION,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedById" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyFinancialValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyFinancialValue_companyId_fieldKey_year_key" ON "CompanyFinancialValue"("companyId", "fieldKey", "year");
CREATE INDEX "CompanyFinancialValue_companyId_idx" ON "CompanyFinancialValue"("companyId");
CREATE INDEX "CompanyFinancialValue_fieldKey_year_idx" ON "CompanyFinancialValue"("fieldKey", "year");

CREATE TABLE "ProgramRequiredField" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "yearsBack" INTEGER NOT NULL DEFAULT 1,
  "mandatory" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgramRequiredField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProgramRequiredField_programId_templateId_fieldKey_key" ON "ProgramRequiredField"("programId", "templateId", "fieldKey");
CREATE INDEX "ProgramRequiredField_programId_idx" ON "ProgramRequiredField"("programId");

-- AlterTable
ALTER TABLE "OcrDocument" ADD COLUMN "companyId" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "taxTemplateId" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "fiscalYear" INTEGER;
CREATE INDEX "OcrDocument_companyId_idx" ON "OcrDocument"("companyId");

-- AddForeignKey
ALTER TABLE "TaxFormTemplateField" ADD CONSTRAINT "TaxFormTemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaxFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyFinancialValue" ADD CONSTRAINT "CompanyFinancialValue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramRequiredField" ADD CONSTRAINT "ProgramRequiredField_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramRequiredField" ADD CONSTRAINT "ProgramRequiredField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaxFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OcrDocument" ADD CONSTRAINT "OcrDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OcrDocument" ADD CONSTRAINT "OcrDocument_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "TaxFormTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 2: Commit the migration file** (writing only; not applied)

```bash
git add prisma/migrations/20260607120000_tax_form_templates/migration.sql
git commit -m "chore(tax): migration SQL for tax templates (not yet applied)"
```

- [ ] **Step 3: STOP — request approval before touching the DB**

Tell the user: "Migration SQL is written. The DB is shared prod+dev. Approve to run `prisma db push` (sync) + `prisma migrate resolve --applied 20260607120000_tax_form_templates`?" Do **not** run any DB-writing command until they confirm.

---

## Task 4: Template → prompt rules mapper (pure, TDD)

**Files:**
- Create: `lib/tax/template-prompt.ts`
- Test: `lib/tax/__tests__/template-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/tax/__tests__/template-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { templateFieldsToRules } from '../template-prompt';

describe('templateFieldsToRules', () => {
  it('maps template fields to FieldRuleLite shape', () => {
    const rules = templateFieldsToRules([
      { fieldKey: '500', label: 'Κύκλος Εργασιών', aiHint: 'Σύνολο πωλήσεων', regionHint: { page: 0, bbox: [0.1, 0.2, 0.3, 0.05] }, valueType: 'CURRENCY' },
      { fieldKey: '581', label: 'Δαπάνες Προσωπικού', aiHint: null, regionHint: null, valueType: 'CURRENCY' },
    ]);
    expect(rules).toEqual([
      { key: '500', label: 'Κύκλος Εργασιών', description: 'Σύνολο πωλήσεων', regionHint: { page: 0, bbox: [0.1, 0.2, 0.3, 0.05] }, scope: 'document', valueType: 'text' },
      { key: '581', label: 'Δαπάνες Προσωπικού', description: null, regionHint: null, scope: 'document', valueType: 'text' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- template-prompt`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/tax/template-prompt.ts
import type { FinancialValueTypeStr } from '@/lib/greek-format';

export type TemplateFieldLite = {
  fieldKey: string;
  label: string;
  aiHint?: string | null;
  regionHint?: unknown;
  valueType: FinancialValueTypeStr;
};

export type FieldRuleLite = {
  key: string;
  label: string;
  description: string | null;
  regionHint: unknown;
  scope: 'document';
  valueType: 'text';
};

/** Adapts tax template fields to the existing buildCustomFieldsPrompt() rule shape. */
export function templateFieldsToRules(fields: TemplateFieldLite[]): FieldRuleLite[] {
  return fields.map((f) => ({
    key: f.fieldKey,
    label: f.label,
    description: f.aiHint ?? null,
    regionHint: f.regionHint ?? null,
    scope: 'document' as const,
    valueType: 'text' as const,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- template-prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tax/template-prompt.ts lib/tax/__tests__/template-prompt.test.ts
git commit -m "feat(tax): map template fields to OCR prompt rules"
```

---

## Task 5: Year resolution (pure, TDD)

**Files:**
- Create: `lib/tax/year-resolve.ts`
- Test: `lib/tax/__tests__/year-resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/tax/__tests__/year-resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveYear, requiredYears } from '../year-resolve';

describe('resolveYear', () => {
  it('maps mode to an absolute year relative to reference', () => {
    expect(resolveYear(2024, 'REFERENCE')).toBe(2024);
    expect(resolveYear(2024, 'PRIOR_1')).toBe(2023);
    expect(resolveYear(2024, 'PRIOR_2')).toBe(2022);
    expect(resolveYear(2024, 'PRIOR_3')).toBe(2021);
  });
});

describe('requiredYears', () => {
  it('expands yearsBack into a descending year list', () => {
    expect(requiredYears(3, 2024)).toEqual([2024, 2023, 2022]);
    expect(requiredYears(1, 2025)).toEqual([2025]);
  });
});
```

- [ ] **Step 2: Run** `npm run test -- year-resolve` → FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// lib/tax/year-resolve.ts
export type FinancialYearModeStr = 'REFERENCE' | 'PRIOR_1' | 'PRIOR_2' | 'PRIOR_3';

const OFFSET: Record<FinancialYearModeStr, number> = {
  REFERENCE: 0, PRIOR_1: 1, PRIOR_2: 2, PRIOR_3: 3,
};

export function resolveYear(referenceYear: number, mode: FinancialYearModeStr): number {
  return referenceYear - OFFSET[mode];
}

export function requiredYears(yearsBack: number, referenceYear: number): number[] {
  const n = Math.max(1, yearsBack);
  return Array.from({ length: n }, (_, i) => referenceYear - i);
}
```

- [ ] **Step 4: Run** `npm run test -- year-resolve` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tax/year-resolve.ts lib/tax/__tests__/year-resolve.test.ts
git commit -m "feat(tax): year resolution helpers"
```

---

## Task 6: Financial upsert builder (pure, TDD)

**Files:**
- Create: `lib/tax/financial-merge.ts`
- Test: `lib/tax/__tests__/financial-merge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/tax/__tests__/financial-merge.test.ts
import { describe, it, expect } from 'vitest';
import { buildFinancialUpserts } from '../financial-merge';

const fields = [
  { fieldKey: '500', valueType: 'CURRENCY' as const },
  { fieldKey: '581', valueType: 'CURRENCY' as const },
  { fieldKey: '999', valueType: 'CURRENCY' as const },
];

describe('buildFinancialUpserts', () => {
  it('builds rows with the composite key and OCR/MANUAL source', () => {
    const rows = buildFinancialUpserts({
      companyId: 'c1', templateId: 't1', templateCode: 'E3', year: 2024,
      sourceDocumentId: 'doc1', fields,
      reviewed: { '500': { raw: '1.556.540,27', edited: false }, '581': { raw: '300.000,00', edited: true } },
    });
    expect(rows).toEqual([
      { companyId: 'c1', fieldKey: 'E3.500', templateId: 't1', year: 2024, value: 1556540.27, valueType: 'CURRENCY', source: 'OCR', sourceDocumentId: 'doc1', verified: true },
      { companyId: 'c1', fieldKey: 'E3.581', templateId: 't1', year: 2024, value: 300000, valueType: 'CURRENCY', source: 'MANUAL', sourceDocumentId: 'doc1', verified: true },
    ]);
  });
  it('skips fields with no parseable value', () => {
    const rows = buildFinancialUpserts({
      companyId: 'c1', templateId: 't1', templateCode: 'E3', year: 2024, sourceDocumentId: null, fields,
      reviewed: { '999': { raw: '', edited: false } },
    });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npm run test -- financial-merge` → FAIL.

- [ ] **Step 3: Implement**

```typescript
// lib/tax/financial-merge.ts
import { coerceFinancialValue, type FinancialValueTypeStr } from '@/lib/greek-format';

export type ReviewedField = { raw: unknown; edited: boolean };

export type BuildUpsertsInput = {
  companyId: string;
  templateId: string;
  templateCode: string;
  year: number;
  sourceDocumentId: string | null;
  fields: { fieldKey: string; valueType: FinancialValueTypeStr }[];
  reviewed: Record<string, ReviewedField>;
};

export type FinancialUpsertRow = {
  companyId: string;
  fieldKey: string;
  templateId: string;
  year: number;
  value: number;
  valueType: FinancialValueTypeStr;
  source: 'OCR' | 'MANUAL';
  sourceDocumentId: string | null;
  verified: boolean;
};

/** Pure: turns reviewed field values into upsert rows keyed `{code}.{fieldKey}`. */
export function buildFinancialUpserts(input: BuildUpsertsInput): FinancialUpsertRow[] {
  const rows: FinancialUpsertRow[] = [];
  for (const f of input.fields) {
    const r = input.reviewed[f.fieldKey];
    if (!r) continue;
    const value = coerceFinancialValue(r.raw, f.valueType);
    if (value == null) continue;
    rows.push({
      companyId: input.companyId,
      fieldKey: `${input.templateCode}.${f.fieldKey}`,
      templateId: input.templateId,
      year: input.year,
      value,
      valueType: f.valueType,
      source: r.edited ? 'MANUAL' : 'OCR',
      sourceDocumentId: input.sourceDocumentId,
      verified: true,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run** `npm run test -- financial-merge` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tax/financial-merge.ts lib/tax/__tests__/financial-merge.test.ts
git commit -m "feat(tax): pure financial upsert row builder"
```

---

## Task 7: Shared rasterize utility + export OCR internals

**Files:**
- Create: `lib/ocr/rasterize.ts`
- Modify: `lib/ocr/extract.ts` (add `export` where needed)

- [ ] **Step 1: Confirm/export reused internals in `lib/ocr/extract.ts`**

Open `lib/ocr/extract.ts`. For each of `resolveCfg`, `callVisionLLM`, `callGeminiPdfNative`, `rasterizePdf`, `enhanceForOcr`, `parseJsonLoose` — if the declaration is not already `export`, add the `export` keyword (additive, no behavior change). Also confirm `lib/ocr/field-rules.ts` exports `buildCustomFieldsPrompt`, `mergeCustomFields`. Add `export` if missing.

- [ ] **Step 2: Create the shared rasterizer** (move the sharp/pdf-to-img logic from `app/api/admin/ocr/[id]/page-image/route.ts`)

```typescript
// lib/ocr/rasterize.ts
import sharp from 'sharp';

/** Rasterizes a page of a PDF (or re-encodes an image) to WebP for crisp browser preview. */
export async function rasterizeToWebp(
  buffer: Buffer,
  mimeType: string,
  opts: { page?: number; scale?: number } = {},
): Promise<Buffer> {
  const page = opts.page ?? 0;
  const scale = Math.min(5, Math.max(2, opts.scale ?? 3));
  let buf = buffer;
  if (mimeType === 'application/pdf') {
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(buf, { scale });
    let i = 0;
    let found: Buffer | null = null;
    for await (const img of doc) {
      if (i === page) { found = Buffer.from(img); break; }
      i++;
    }
    if (!found) throw new Error('page out of range');
    buf = found;
  } else if (!mimeType.startsWith('image/')) {
    throw new Error('unsupported type');
  }
  return sharp(buf)
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}
```

- [ ] **Step 3: Refactor `app/api/admin/ocr/[id]/page-image/route.ts` to call `rasterizeToWebp`** (replace the inline pdf-to-img + sharp block with a single call; keep the Bunny download + response headers).

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ocr/(rasterize|extract)|page-image" || echo "no new type errors in touched files"`
Expected: "no new type errors in touched files" (pre-existing unrelated Next 16 errors may exist — ignore those per project state).

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/rasterize.ts lib/ocr/extract.ts app/api/admin/ocr/[id]/page-image/route.ts
git commit -m "refactor(ocr): shared rasterizeToWebp + export reusable internals"
```

---

## Task 8: `extractTaxForm()` orchestrator

**Files:**
- Create: `lib/ocr/tax-extract.ts`

> No unit test (impure: hits the vision API). Tested via the API route in Task 12 and manual verification.

- [ ] **Step 1: Implement**

```typescript
// lib/ocr/tax-extract.ts
import {
  resolveCfg, callVisionLLM, callGeminiPdfNative, rasterizePdf, enhanceForOcr, parseJsonLoose,
} from '@/lib/ocr/extract';
import { buildCustomFieldsPrompt } from '@/lib/ocr/field-rules';
import { templateFieldsToRules, type TemplateFieldLite } from '@/lib/tax/template-prompt';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';

export type TaxExtractResult = {
  values: Record<string, string | null>; // fieldKey → raw value
  model: string;
  tokensUsed: number | null;
  durationMs: number;
};

/** Extracts named tax-form fields from a PDF/image using region hints + AI vision. */
export async function extractTaxForm(
  buffer: Buffer,
  mimeType: string,
  fields: TemplateFieldLite[],
): Promise<TaxExtractResult> {
  const cfg = await resolveCfg();
  const system = buildCustomFieldsPrompt(templateFieldsToRules(fields));
  const started = Date.now();
  let content = '';
  let model = cfg.visionModel;
  let tokens: number | null = null;

  if (mimeType === 'application/pdf' && cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
    const out = await callGeminiPdfNative(cfg, system, buffer);
    content = out.content; model = out.model; tokens = out.tokens;
  } else if (mimeType === 'application/pdf') {
    const pages = await rasterizePdf(buffer, 3, 2);
    const merged: Record<string, unknown> = {};
    for (const page of pages) {
      const enhanced = await enhanceForOcr(page);
      const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType);
      model = out.model; tokens = (tokens ?? 0) + (out.tokens ?? 0);
      const parsed = parseJsonLoose(out.content) ?? {};
      for (const [k, v] of Object.entries(parsed)) if (v != null && merged[k] == null) merged[k] = v;
    }
    content = JSON.stringify(merged);
  } else {
    const enhanced = await enhanceForOcr(buffer);
    const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType);
    content = out.content; model = out.model; tokens = out.tokens;
  }

  const parsed = parseJsonLoose(content) ?? {};
  const values: Record<string, string | null> = {};
  for (const f of fields) {
    const v = (parsed as Record<string, unknown>)[f.fieldKey];
    values[f.fieldKey] = v == null ? null : String(v);
  }
  const durationMs = Date.now() - started;
  void logAiUsage({
    scope: 'TAX_FORM', provider: providerFromUrl(cfg.visionUrl), model,
    operation: 'tax.form_extraction', totalTokens: tokens ?? 0, durationMs, refType: 'CompanyFinancialValue',
  });
  return { values, model, tokensUsed: tokens, durationMs };
}
```

- [ ] **Step 2: Allow the new usage scope** — in `lib/ai/usage.ts`, if `scope` is a typed union, add `'TAX_FORM'` to it. If it is a free string, no change.

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit 2>&1 | grep "tax-extract" || echo "no type errors in tax-extract"`
Expected: "no type errors in tax-extract".

- [ ] **Step 4: Commit**

```bash
git add lib/ocr/tax-extract.ts lib/ai/usage.ts
git commit -m "feat(tax): extractTaxForm orchestrator reusing OCR pipeline"
```

---

## Task 9: `<RegionMarker>` reusable primitive

**Files:**
- Create: `components/ui/region-marker.tsx`
- Reference: `app/admin/ocr/[id]/use-marquee.ts` (reused as-is)

- [ ] **Step 1: Implement the primitive** (generalizes `supplier-field-rule-dialog`'s preview/overlay; image source is a prop; supports multiple saved regions + page navigation)

```tsx
// components/ui/region-marker.tsx
'use client';
import * as React from 'react';
import { useMarquee, type NormBox } from '@/app/admin/ocr/[id]/use-marquee';

export type SavedRegion = { bbox: [number, number, number, number]; color?: string; active?: boolean };

type Props = {
  /** Returns the image URL for a given 0-based page. */
  pageImageUrl: (page: number) => string;
  pageCount?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  savedRegions?: SavedRegion[];
  isMarking: boolean;
  onRegionComplete: (box: NormBox, page: number) => void;
  className?: string;
};

export function RegionMarker({
  pageImageUrl, pageCount = 1, page = 0, onPageChange, savedRegions = [], isMarking, onRegionComplete, className,
}: Props) {
  const [err, setErr] = React.useState(false);
  const handleComplete = React.useCallback((b: NormBox) => onRegionComplete(b, page), [onRegionComplete, page]);
  const { ref, box, active, handlers } = useMarquee(handleComplete);

  return (
    <div className={className}>
      {pageCount > 1 && (
        <div className="mb-2 flex items-center gap-2 text-[12px]">
          <button type="button" className="rounded border px-2 py-0.5 disabled:opacity-40"
            disabled={page <= 0} onClick={() => onPageChange?.(page - 1)}>←</button>
          <span>Σελίδα {page + 1} / {pageCount}</span>
          <button type="button" className="rounded border px-2 py-0.5 disabled:opacity-40"
            disabled={page >= pageCount - 1} onClick={() => onPageChange?.(page + 1)}>→</button>
        </div>
      )}
      {!err ? (
        <div ref={ref} {...(isMarking ? handlers : {})} className="relative w-full select-none"
          style={{ cursor: isMarking ? 'crosshair' : 'default', touchAction: isMarking ? 'none' : undefined }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pageImageUrl(page)} alt="" className="block w-full" draggable={false} onError={() => setErr(true)} />
          {isMarking && active && box && (
            <div className="pointer-events-none absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
          )}
          {!active && savedRegions.map((r, i) => (
            <div key={i} className="pointer-events-none absolute border-2"
              style={{
                left: `${r.bbox[0] * 100}%`, top: `${r.bbox[1] * 100}%`, width: `${r.bbox[2] * 100}%`, height: `${r.bbox[3] * 100}%`,
                borderColor: r.active ? '#E31E2A' : '#10b981', background: (r.active ? '#E31E2A' : '#10b981') + '1a',
              }} />
          ))}
        </div>
      ) : (
        <div className="p-3 text-[12px] text-muted-foreground">Δεν ήταν δυνατή η προβολή της εικόνας.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Refactor `components/admin/supplier-field-rule-dialog.tsx` to use `<RegionMarker>`** — replace its inline preview/overlay block with `<RegionMarker pageImageUrl={(p) => isPdf ? \`/api/admin/ocr/${docId}/page-image?scale=2&page=${p}\` : fileUrl} isMarking={marking} savedRegions={region ? [{ bbox: region.bbox }] : []} onRegionComplete={(b) => { setRegion({ page: 0, bbox: [b.x,b.y,b.w,b.h] }); setMarking(false); }} />`. Keep all form/submit logic unchanged.

- [ ] **Step 3: Manual verify no regression**

Start dev server (`npm run dev`), open an OCR document, open the field-rule dialog, mark a region. Expected: marquee + green persisted overlay still work exactly as before.

- [ ] **Step 4: Commit**

```bash
git add components/ui/region-marker.tsx components/admin/supplier-field-rule-dialog.tsx
git commit -m "refactor(ocr): extract reusable RegionMarker primitive"
```

---

## Task 10: Tax templates API (CRUD + fields + sample + page-image)

**Files:**
- Create: `app/api/admin/tax-templates/route.ts`, `app/api/admin/tax-templates/[id]/route.ts`, `app/api/admin/tax-templates/[id]/fields/route.ts`, `app/api/admin/tax-templates/[id]/sample/route.ts`, `app/api/admin/tax-templates/[id]/page-image/route.ts`

> Follow the auth guard + `NextResponse.json` patterns from `app/api/admin/ocr/route.ts` and `app/api/admin/programs/[id]/questionnaire/route.ts`. Decimals serialize to strings automatically.

- [ ] **Step 1: List + create** (`app/api/admin/tax-templates/route.ts`)

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth-guard'; // use the project's existing guard helper

export async function GET() {
  await requireAdmin();
  const templates = await prisma.taxFormTemplate.findMany({
    orderBy: [{ code: 'asc' }, { year: 'desc' }],
    include: { _count: { select: { fields: true } } },
  });
  return NextResponse.json(templates);
}

const createSchema = z.object({ code: z.string().min(1), name: z.string().min(1), year: z.number().int().nullable().optional() });

export async function POST(req: Request) {
  const user = await requireAdmin();
  const body = createSchema.parse(await req.json());
  const created = await prisma.taxFormTemplate.create({
    data: { code: body.code, name: body.name, year: body.year ?? null, createdById: user.id },
  });
  return NextResponse.json(created, { status: 201 });
}
```

> Note: confirm the exact guard import (`requireAdmin`/`getServerSession` pattern) by reading an existing `app/api/admin/**/route.ts`; reuse whatever it uses.

- [ ] **Step 2: Get + patch + delete** (`app/api/admin/tax-templates/[id]/route.ts`)

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth-guard';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const t = await prisma.taxFormTemplate.findUnique({ where: { id }, include: { fields: { orderBy: { order: 'asc' } } } });
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(t);
}

const patchSchema = z.object({
  name: z.string().min(1).optional(), year: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(), status: z.enum(['DRAFT', 'READY']).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const data = patchSchema.parse(await req.json());
  const updated = await prisma.taxFormTemplate.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  await prisma.taxFormTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Replace fields** (`app/api/admin/tax-templates/[id]/fields/route.ts`) — mirror the questionnaire route's delete-then-recreate transaction.

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth-guard';

const norm = z.number().min(0).max(1);
const fieldSchema = z.object({
  fieldKey: z.string().min(1), label: z.string().min(1), section: z.string().nullable().optional(),
  valueType: z.enum(['CURRENCY', 'NUMBER', 'PERCENT', 'INTEGER', 'DATE', 'BOOLEAN']),
  regionHint: z.object({ page: z.number().int().min(0), bbox: z.tuple([norm, norm, norm, norm]) }).nullable().optional(),
  aiHint: z.string().nullable().optional(), required: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const fields = z.array(fieldSchema).parse(await req.json());
  await prisma.$transaction([
    prisma.taxFormTemplateField.deleteMany({ where: { templateId: id } }),
    ...fields.map((f, i) => prisma.taxFormTemplateField.create({
      data: {
        templateId: id, fieldKey: f.fieldKey, label: f.label, section: f.section ?? null,
        valueType: f.valueType, regionHint: f.regionHint ?? undefined, aiHint: f.aiHint ?? null,
        required: f.required ?? false, order: i,
      },
    })),
  ]);
  const fresh = await prisma.taxFormTemplate.findUnique({ where: { id }, include: { fields: { orderBy: { order: 'asc' } } } });
  return NextResponse.json(fresh);
}
```

- [ ] **Step 4: Sample upload** (`app/api/admin/tax-templates/[id]/sample/route.ts`) — mirror the Bunny upload in `app/api/admin/ocr/route.ts`; store `sampleStorageKey`, compute `samplePageCount` (for PDFs, count via pdf-to-img), set on the template.

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth-guard';
import { bunnyUploadPrivate } from '@/lib/bunny'; // confirm exact import from ocr route

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const key = `tax-templates/${id}/sample-${Date.now()}.${file.type === 'application/pdf' ? 'pdf' : 'png'}`;
  await bunnyUploadPrivate(key, buf, file.type);
  let pageCount = 1;
  if (file.type === 'application/pdf') {
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(buf, { scale: 1 });
    pageCount = 0; for await (const _ of doc) pageCount++;
  }
  const updated = await prisma.taxFormTemplate.update({
    where: { id }, data: { sampleStorageKey: key, samplePageCount: pageCount },
  });
  return NextResponse.json(updated);
}
```

- [ ] **Step 5: Sample page-image** (`app/api/admin/tax-templates/[id]/page-image/route.ts`) — download `sampleStorageKey` from Bunny, call `rasterizeToWebp(buf, mime, { page, scale })`, return `image/webp`. Mirror response headers from the OCR page-image route.

- [ ] **Step 6: Manual verify**

`curl` or browser: create a template (`POST /api/admin/tax-templates`), GET it. Expected: 201 then JSON with `fields: []`.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/tax-templates
git commit -m "feat(tax): tax-template CRUD + fields + sample + page-image API"
```

---

## Task 11: Tax templates admin pages + region editor

**Files:**
- Create: `app/admin/tax-templates/page.tsx`, `app/admin/tax-templates/[id]/page.tsx`, `app/admin/tax-templates/[id]/editor.tsx`, `components/admin/tax-template-region-editor.tsx`

> Use the `dg-design-system` skill for styling. Follow the layout of `app/admin/programs/page.tsx` (list) and `app/admin/programs/[id]/` (server page → client editor). Use `<PageHeader title=... helpAnchor="tax-templates" />`.

- [ ] **Step 1: List page** (`app/admin/tax-templates/page.tsx`) — server component: fetch templates, render table (code, name, year, #fields, status), "Νέο template" button (POST then navigate to `[id]`).

- [ ] **Step 2: Detail server page** (`app/admin/tax-templates/[id]/page.tsx`) — fetch template+fields, render `<TaxTemplateEditor template={...} />` client component.

- [ ] **Step 3: Region editor component** (`components/admin/tax-template-region-editor.tsx`) — wraps `<RegionMarker>` with: sample upload (if none), a field list (add/remove), and a form per field (`fieldKey`, `label`, `valueType`, `aiHint`). Drawing a region assigns it to the currently-selected field. Clicking a field highlights its region (`active: true`). "Αποθήκευση πεδίων" → `PUT /fields`. Mark READY toggles status via `PATCH`.

```tsx
// sketch of the core wiring (full component built here)
const pageImageUrl = (p: number) => `/api/admin/tax-templates/${template.id}/page-image?scale=2&page=${p}`;
// savedRegions = fields.filter(f => f.regionHint?.page === page).map(f => ({ bbox: f.regionHint.bbox, active: f.id === selectedId }))
// onRegionComplete = (box, page) => updateField(selectedId, { regionHint: { page, bbox: [box.x,box.y,box.w,box.h] } })
```

- [ ] **Step 4: Manual verify**

Dev server → `/admin/tax-templates` → create → upload a sample Ε3 PDF → mark a region for "500 / Κύκλος Εργασιών" → save → reload → region persists, overlay shows.

- [ ] **Step 5: Commit**

```bash
git add app/admin/tax-templates components/admin/tax-template-region-editor.tsx
git commit -m "feat(tax): tax-template admin pages + region editor"
```

---

## Task 12: Company financials — extract + confirm + list API

**Files:**
- Create: `app/api/admin/companies/[id]/financials/route.ts`, `.../financials/extract/route.ts`, `.../financials/confirm/route.ts`

- [ ] **Step 1: Extract route** (`.../financials/extract/route.ts`) — multipart upload: `templateId`, `fiscalYear`, `file`. Flow: upload to Bunny → create `OcrDocument(category: 'TAX', companyId, taxTemplateId, fiscalYear, status: 'PROCESSING')` → load template fields → `extractTaxForm(buf, mime, fields)` → update doc `status: 'COMPLETED', extractedData` → return `{ documentId, values, fields }` (do NOT persist financial values yet; review first).

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth-guard';
import { bunnyUploadPrivate } from '@/lib/bunny';
import { extractTaxForm } from '@/lib/ocr/tax-extract';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: companyId } = await params;
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const templateId = String(form.get('templateId') ?? '');
  const fiscalYear = Number(form.get('fiscalYear'));
  if (!file || !templateId || !fiscalYear) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

  const template = await prisma.taxFormTemplate.findUnique({ where: { id: templateId }, include: { fields: { orderBy: { order: 'asc' } } } });
  if (!template) return NextResponse.json({ error: 'template not found' }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.type === 'application/pdf' ? 'pdf' : 'png';
  const key = `ocr/tax/${companyId}/${templateId}-${fiscalYear}-${Date.now()}.${ext}`;
  await bunnyUploadPrivate(key, buf, file.type);

  const doc = await prisma.ocrDocument.create({
    data: {
      fileName: key.split('/').pop()!, originalName: file.name, storageKey: key, publicUrl: 'bunny:' + key,
      mimeType: file.type, size: buf.length, docType: 'GENERAL_TEXT', category: 'TAX',
      language: 'el', status: 'PROCESSING', companyId, taxTemplateId: templateId, fiscalYear,
    },
  });

  try {
    const result = await extractTaxForm(buf, file.type, template.fields.map((f) => ({
      fieldKey: f.fieldKey, label: f.label, aiHint: f.aiHint, regionHint: f.regionHint, valueType: f.valueType,
    })));
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { status: 'COMPLETED', extractedData: result.values as object, model: result.model, tokensUsed: result.tokensUsed ?? undefined, completedAt: new Date() } });
    return NextResponse.json({ documentId: doc.id, values: result.values, fields: template.fields });
  } catch (e: any) {
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { status: 'FAILED', errorMessage: String(e?.message ?? e).slice(0, 2000) } });
    return NextResponse.json({ error: 'extraction failed' }, { status: 422 });
  }
}
```

- [ ] **Step 2: Confirm route** (`.../financials/confirm/route.ts`) — body: `{ templateId, year, sourceDocumentId, reviewed: Record<fieldKey,{raw,edited}> }`. Load template (code + fields), call `buildFinancialUpserts(...)`, upsert each row.

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth-guard';
import { buildFinancialUpserts } from '@/lib/tax/financial-merge';

const schema = z.object({
  templateId: z.string(), year: z.number().int(), sourceDocumentId: z.string().nullable(),
  reviewed: z.record(z.object({ raw: z.union([z.string(), z.number(), z.null()]), edited: z.boolean() })),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  const { id: companyId } = await params;
  const body = schema.parse(await req.json());
  const template = await prisma.taxFormTemplate.findUnique({ where: { id: body.templateId }, include: { fields: true } });
  if (!template) return NextResponse.json({ error: 'template not found' }, { status: 404 });

  const rows = buildFinancialUpserts({
    companyId, templateId: template.id, templateCode: template.code, year: body.year,
    sourceDocumentId: body.sourceDocumentId, reviewed: body.reviewed,
    fields: template.fields.map((f) => ({ fieldKey: f.fieldKey, valueType: f.valueType })),
  });

  await prisma.$transaction(rows.map((r) => prisma.companyFinancialValue.upsert({
    where: { companyId_fieldKey_year: { companyId: r.companyId, fieldKey: r.fieldKey, year: r.year } },
    create: { ...r, verifiedById: user.id },
    update: { value: r.value, source: r.source, sourceDocumentId: r.sourceDocumentId, verified: true, verifiedById: user.id },
  })));
  return NextResponse.json({ ok: true, count: rows.length });
}
```

- [ ] **Step 3: List route** (`.../financials/route.ts`) — GET: return `companyFinancialValue.findMany({ where: { companyId }, orderBy: [{ fieldKey: 'asc' }, { year: 'desc' }] })`.

- [ ] **Step 4: Manual verify** (after DB migration is applied) — POST a sample Ε3 to `/extract`, inspect returned `values`, then POST `/confirm`, then GET list. Expected: rows keyed `E3.500` etc.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/companies/[id]/financials
git commit -m "feat(tax): company financials extract/confirm/list API"
```

---

## Task 13: `<TaxFormCapture>` embeddable widget

**Files:**
- Create: `components/admin/tax-form-capture.tsx`

- [ ] **Step 1: Implement** — props `{ companyId; programId?; taskId?; templateId?; fiscalYear?; onConfirmed?(count): void }`. UI states: (a) pick template + year + drop file → POST `/extract`; (b) **split review**: left `<RegionMarker>` showing the uploaded doc page (via a doc page-image — reuse `/api/admin/ocr/[id]/page-image`), right an editable table of `field | value | confidence`; clicking a field highlights its template region; (c) "Επιβεβαίωση" → POST `/confirm` → call `onConfirmed`. Use DG tokens, 12/11px, badges (🟢/🟡/✋). Track per-field `edited` flag (true once the user changes the input).

- [ ] **Step 2: Manual verify** — embed on the company financials tab (Task 14) and run the full flow end to end.

- [ ] **Step 3: Commit**

```bash
git add components/admin/tax-form-capture.tsx
git commit -m "feat(tax): embeddable TaxFormCapture widget"
```

---

## Task 14: Company "Οικονομικά" tab + financials matrix

**Files:**
- Create: `components/admin/company-financials-matrix.tsx`, `app/admin/companies/[id]/financials-tab.tsx`
- Modify: the company detail page to add the new tab (follow how existing tabs are registered there)

- [ ] **Step 1: Matrix component** — fetch `/financials`, render `field × year` grid with source/verified/validity badges, inline edit (PATCH a single value via the confirm route with one reviewed entry, `edited: true`).

- [ ] **Step 2: Tab** — compose `<TaxFormCapture companyId={id} onConfirmed={refresh} />` above `<CompanyFinancialsMatrix companyId={id} />`. Add `<PageHeader helpAnchor="company-financials" />`.

- [ ] **Step 3: Register the tab** in the company detail page (mirror the existing tab pattern — read the page to match it exactly).

- [ ] **Step 4: Manual verify** — open a company → «Οικονομικά» → upload Ε3 → review → confirm → matrix updates.

- [ ] **Step 5: Commit**

```bash
git add components/admin/company-financials-matrix.tsx app/admin/companies/[id]
git commit -m "feat(tax): company financials tab + matrix"
```

---

## Task 15: Program "Οικονομικά πεδία" tab + required-fields API

**Files:**
- Create: `app/api/admin/programs/[id]/required-fields/route.ts`, `app/admin/programs/[id]/oikonomika-pedia-tab.tsx`
- Modify: program editor to register the new tab

- [ ] **Step 1: API** — GET returns `programRequiredField.findMany({ where: { programId }, include: { template: true } })`. PUT replaces them (delete-then-create transaction; body: array of `{ templateId, fieldKey, yearsBack, mandatory }`).

- [ ] **Step 2: Tab UI** — pick a template, list its fields with checkboxes (select needed), per selected field set `yearsBack` (1 or 3) + `mandatory`. Save → PUT. Add `<PageHeader helpAnchor="program-financial-fields" />`.

- [ ] **Step 3: Register the tab** in the program editor (mirror `questionnaire-tab` registration).

- [ ] **Step 4: Manual verify** — open a program → «Οικονομικά πεδία» → select Ε3 fields {500, 526, 528} with yearsBack=3 → save → reload persists.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/programs/[id]/required-fields app/admin/programs/[id]/oikonomika-pedia-tab.tsx
git commit -m "feat(tax): program required-fields tab + API"
```

---

## Task 16: Wiki entries

**Files:**
- Create: `docs/wiki/tax-templates/overview.mdx`, `docs/wiki/programs/oikonomika-pedia.mdx`, `docs/wiki/companies/oikonomika.mdx`

- [ ] **Step 1: Scaffold** each page:

```bash
npm run wiki:new -- tax-templates/overview --roles "ADMIN,EMPLOYEE" --title "Πρότυπα Φορολογικών Εντύπων (OCR)"
npm run wiki:new -- programs/oikonomika-pedia --roles "ADMIN,EMPLOYEE" --title "Οικονομικά Πεδία Προγράμματος"
npm run wiki:new -- companies/oikonomika --roles "ADMIN,EMPLOYEE" --title "Οικονομικά Στοιχεία Εταιρίας"
```

If a module is missing from `lib/wiki/modules-meta.ts`, add it (label, description, icon, gradient hex colors).

- [ ] **Step 2: Write content** (Greek) with `<Steps>` for the workflows and `<Callout type="warning">` for the destructive/gotcha notes (e.g. confirming values overwrites prior values for that year). Set frontmatter `helpAnchors` to match the `helpAnchor` props used in Tasks 11/14/15 (`tax-templates`, `company-financials`, `program-financial-fields`).

- [ ] **Step 3: Build the search index**

Run: `npm run wiki:index`

- [ ] **Step 4: Commit**

```bash
git add docs/wiki lib/wiki/modules-meta.ts public/wiki/index.json
git commit -m "docs(wiki): tax templates, program financial fields, company financials"
```

---

## Self-Review

**Spec coverage:**
- §2 data model → Tasks 2, 3 ✓
- §3 flow (template/program/upload/review/store) → Tasks 10–15 ✓
- §4 extraction + parser → Tasks 1, 4, 8 ✓
- §5 UI (RegionMarker, RegionEditor, Capture, Matrix) → Tasks 9, 11, 13, 14 ✓
- §6 testing → Tasks 1, 4, 5, 6 (pure unit) ✓
- §7 migration (approval-gated) → Task 3 ✓
- §8 wiki → Task 16 ✓
- §9 ① bridge → year-resolve (Task 5) + `{code}.{fieldKey}` (Task 6) ✓

**Placeholder scan:** API/UI tasks that say "mirror the existing pattern" reference concrete files to copy; the engineer must read those files (auth guard, Bunny import, tab registration) because exact helper names vary — these are read-then-mirror instructions, not unspecified placeholders. Pure-logic tasks contain full code.

**Type consistency:** `FinancialValueTypeStr` (greek-format) reused in template-prompt + financial-merge ✓. `extractTaxForm` returns `values: Record<fieldKey,string|null>` consumed by `<TaxFormCapture>` and `/confirm` ✓. `buildFinancialUpserts` output matches the `companyFinancialValue.upsert` shape in Task 12 ✓. Composite unique `companyId_fieldKey_year` used consistently ✓.

**Known assumptions to verify during execution (not blockers):**
- Exact auth-guard import in `app/api/admin/**` (read one existing route).
- `bunnyUploadPrivate` exact export path (from `app/api/admin/ocr/route.ts`).
- Whether `resolveCfg/callVisionLLM/...` need `export` added (Task 7 Step 1).
- `lib/ai/usage.ts` `scope` typing (Task 8 Step 2).
- Company/Program detail tab registration mechanism (read the pages).
