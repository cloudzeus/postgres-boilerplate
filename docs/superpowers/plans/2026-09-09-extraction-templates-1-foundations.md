# Extraction Templates — Plan 1/3: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data model, the pure logic (schema, coercion, conditions, mapping, flow graph), the server extraction engine and the JSON API for supplier extraction templates, so that plan 2 (designer UI) and plan 3 (pipeline integration, outputs, field-rules migration) build on tested foundations.

**Architecture:** New Prisma models (`ExtractionTemplate`, `TemplateField`, `TemplateMapping`, `TemplateCondition`, `TemplateRun`). Isomorphic pure modules in `lib/templates/*` with vitest coverage. Server-only modules reuse the existing OCR helpers: `cropRegionToImage` / `rasterizeToWebp` (`lib/ocr/rasterize.ts`), the OpenAI-compatible vision call pattern from `app/api/admin/ocr/[id]/read-region/route.ts` (extracted into a shared `lib/templates/vision.ts`), `logAiUsage`, Bunny private storage, `requirePermission`. Route handlers under `app/api/admin/ocr/templates/**`.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (PostgreSQL, `prisma migrate deploy` with hand-written SQL, as this repo does), zod 4, vitest 4, sharp, pdfjs-dist (text layer), existing `lib/greek-format.ts`.

**Spec:** `docs/superpowers/specs/2026-09-09-extraction-templates-design.md`

**Related plans (written after this one ships):**
- Plan 2/3 — Designer UI: `/admin/ocr/templates` list + 5-step designer, React Flow panel (`@xyflow/react` 12.11.x), sidebar, wiki.
- Plan 3/3 — Pipeline: `runTemplateOnDocument`, upload hook, manual run, run-result view with per-field colours, Excel outputs, modes/notify, field-rules migration and cleanup.
- Plan 4/4 — Training samples (spec §11) and batch scan jobs (spec §12): sample upload/verify/score API + UI, job queue worker, jobs pages. Models for both are created in this plan's Task 1 so a single migration covers everything.

---

## Conventions for every task

- Run tests with `npx vitest run lib/templates` (the vitest config includes `lib/**/*.test.ts`, alias `@` → repo root).
- Type-check with `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"` (the dev server writes stale route types under `.next/dev/types`; they must be ignored).
- Prisma client regeneration: `npx prisma generate`. Migrations are hand-written SQL in `prisma/migrations/<timestamp>_<name>/migration.sql` and applied with `npx prisma migrate deploy` (the `.env` `DATABASE_URL` points at the live dev database; migrations here are additive).
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- All user-facing strings are Greek. Code comments may be Greek or English.

---

## File structure (this plan)

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | 7 new enums, 5 new models, `OcrDocument.templateRuns` relation |
| `prisma/migrations/20260910090000_extraction_templates/migration.sql` | DDL for the above |
| `lib/templates/schema.ts` | Isomorphic types (`Bbox`, `Region`, `FieldDef`, `ColumnDef`, `MappingRow*`, `Clause`, `Action`, `FieldValue`), `INVOICE_SCHEMA`, `COLOR_PALETTE`, `nextColor`, `slugKey`, `isValidBbox` |
| `lib/templates/coerce.ts` | `coerceValue(raw, valueType)` → typed value or null |
| `lib/templates/conditions.ts` | `evaluateClause`, `evaluateRule`, `applyRules` |
| `lib/templates/mapping.ts` | `projectToInvoice`, `projectToExcel` |
| `lib/templates/flow.ts` | `buildFlow(template, run?)` → React-Flow-shaped `{nodes, edges}` (plain objects, no React import) |
| `lib/templates/vision.ts` | Server: `readCropValue`, `readCropTable` — shared OpenAI-compatible vision call with model fallback + usage logging |
| `lib/templates/pdf-text.ts` | Server: `extractPdfTextItems(buffer, page)` → normalized `TextItem[]` via pdfjs text layer |
| `lib/templates/extract.ts` | Server: `extractTemplateFields(buffer, mimeType, fields)` → `Record<key, FieldValue>` (text layer first, then vision crop) |
| `lib/templates/__tests__/*.test.ts` | Unit tests for every pure module + mocked tests for extract |
| `app/api/admin/ocr/templates/route.ts` | `GET` list, `POST` create |
| `app/api/admin/ocr/templates/[id]/route.ts` | `GET` full template, `PATCH` meta, `DELETE` |
| `app/api/admin/ocr/templates/[id]/sample/route.ts` | `POST` multipart sample upload → Bunny |
| `app/api/admin/ocr/templates/[id]/page-image/route.ts` | `GET ?page=` rasterized sample page (webp) |
| `app/api/admin/ocr/templates/[id]/fields/route.ts` | `PUT` bulk upsert fields |
| `app/api/admin/ocr/templates/[id]/mappings/route.ts` | `PUT` bulk replace mappings |
| `app/api/admin/ocr/templates/[id]/conditions/route.ts` | `PUT` bulk replace conditions |
| `app/api/admin/ocr/templates/[id]/test-field/route.ts` | `POST { fieldKey }` → live read of one field from the sample |
| `app/api/admin/ocr/[id]/read-region/route.ts` | Refactored to call `readCropValue` (behaviour unchanged) |

---

### Task 1: Prisma models and migration

**Files:**
- Modify: `prisma/schema.prisma` (append after `model SupplierFieldRule`, and add one line inside `model OcrDocument`)
- Create: `prisma/migrations/20260910090000_extraction_templates/migration.sql`

- [ ] **Step 1: Add enums and models to the schema**

Append at the end of `prisma/schema.prisma`:

```prisma
// ─── Πρότυπα εξαγωγής προμηθευτή (extraction templates) ─────────────────────
// Spec: docs/superpowers/specs/2026-09-09-extraction-templates-design.md

enum TemplateMode      { AUTO SEMI_AUTO MANUAL }
enum TemplateStatus    { DRAFT ACTIVE }
enum TemplateFieldKind { SINGLE TABLE }
enum TemplateValueType { TEXT NUMBER CURRENCY DATE LIST }
enum MappingTarget     { INVOICE EXCEL }
enum TemplateRunStatus { EXTRACTED REVIEW BLOCKED POSTED FAILED }

model ExtractionTemplate {
  id               String          @id @default(cuid())
  name             String
  vatNumber        String                          // ΑΦΜ προμηθευτή (9 ψηφία, normalized)
  traderTrdr       Int?                            // → SoftoneTrader.trdr (προαιρετικό)
  supplierName     String?                         // denormalized για λίστες
  docType          OcrDocType      @default(INVOICE)
  mode             TemplateMode    @default(SEMI_AUTO)
  status           TemplateStatus  @default(DRAFT)
  version          Int             @default(1)
  sampleStorageKey String?                         // Bunny private — δείγμα εικόνας/PDF
  sampleMimeType   String?
  samplePageCount  Int?
  sampleThumbUrl   String?
  notifyEmails     String?                         // ";"-separated (NOTIFY)
  timesUsed        Int             @default(0)
  createdById      String?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  fields           TemplateField[]
  mappings         TemplateMapping[]
  conditions       TemplateCondition[]
  runs             TemplateRun[]

  @@unique([vatNumber, docType, name])
  @@index([vatNumber, docType, status])
}

model TemplateField {
  id         String             @id @default(cuid())
  templateId String
  template   ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  key        String                                // slug (auto από label), σταθερό
  label      String
  kind       TemplateFieldKind  @default(SINGLE)
  valueType  TemplateValueType  @default(TEXT)
  color      String                                // hex, μοναδικό μέσα στο πρότυπο
  region     Json?                                 // { page:number, bbox:[x,y,w,h] } 0-1
  columns    Json?                                 // TABLE → [{ key, label, valueType }]
  aiHint     String?            @db.Text
  required   Boolean            @default(false)
  order      Int                @default(0)

  @@unique([templateId, key])
  @@index([templateId])
}

model TemplateMapping {
  id         String             @id @default(cuid())
  templateId String
  template   ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  name       String             @default("default")
  target     MappingTarget
  isDefault  Boolean            @default(true)
  rows       Json                                  // INVOICE: [{fieldKey, invoiceKey}] · EXCEL: [{fieldKey, column, order}]

  @@unique([templateId, name])
}

model TemplateCondition {
  id         String             @id @default(cuid())
  templateId String
  template   ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  name       String
  order      Int                @default(0)
  isActive   Boolean            @default(true)
  logic      String             @default("AND")   // AND | OR
  clauses    Json                                  // [{ fieldKey, op, value }]
  actions    Json                                  // [{ type, params }]

  @@index([templateId, order])
}

model TemplateRun {
  id              String             @id @default(cuid())
  templateId      String
  template        ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  templateVersion Int
  documentId      String
  document        OcrDocument        @relation(fields: [documentId], references: [id], onDelete: Cascade)
  status          TemplateRunStatus
  values          Json                              // { key: FieldValue }
  matched         Json                              // [{ conditionId, name, actions }]
  flags           Json?                             // { review?: string[], blocked?: string[] }
  mappingName     String
  model           String?
  tokensUsed      Int?
  durationMs      Int?
  createdAt       DateTime           @default(now())

  @@index([documentId])
  @@index([templateId, createdAt])
}

enum TemplateSampleStatus { PENDING READ VERIFIED }
enum TemplateJobStatus    { QUEUED RUNNING DONE FAILED CANCELLED }
enum TemplateJobItemStatus { QUEUED RUNNING DONE FAILED }

// Δείγματα εκπαίδευσης (spec §11) — πολλά αρχεία ανά πρότυπο, με επιβεβαιωμένες τιμές.
model TemplateSample {
  id          String               @id @default(cuid())
  templateId  String
  template    ExtractionTemplate   @relation(fields: [templateId], references: [id], onDelete: Cascade)
  fileName    String
  storageKey  String
  mimeType    String
  pageCount   Int?
  status      TemplateSampleStatus @default(PENDING)
  expected    Json?                                 // { fieldKey: value } επιβεβαιωμένο από χρήστη
  lastResult  Json?                                 // { fieldKey: { raw, value, source, match } }
  score       Float?                                // 0-1 ποσοστό πεδίων που ταιριάζουν
  createdById String?
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  @@index([templateId])
}

// Εργασίες μαζικής σάρωσης (spec §12).
model TemplateJob {
  id              String            @id @default(cuid())
  templateId      String
  template        ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  templateVersion Int
  status          TemplateJobStatus @default(QUEUED)
  total           Int               @default(0)
  done            Int               @default(0)
  failed          Int               @default(0)
  createdById     String?
  createdAt       DateTime          @default(now())
  startedAt       DateTime?
  finishedAt      DateTime?
  items           TemplateJobItem[]

  @@index([status, createdAt])
  @@index([templateId, createdAt])
}

model TemplateJobItem {
  id         String                @id @default(cuid())
  jobId      String
  job        TemplateJob           @relation(fields: [jobId], references: [id], onDelete: Cascade)
  order      Int
  fileName   String
  storageKey String
  mimeType   String
  size       Int
  status     TemplateJobItemStatus @default(QUEUED)
  values     Json?                                  // { fieldKey: FieldValue }
  matched    Json?
  flags      Json?
  model      String?
  tokensUsed Int?
  durationMs Int?
  error      String?
  startedAt  DateTime?
  finishedAt DateTime?

  @@index([jobId, order])
  @@index([status])
}
```

Inside `model ExtractionTemplate`, after `  runs             TemplateRun[]` add:

```prisma
  samples          TemplateSample[]
  jobs             TemplateJob[]
```

Inside `model OcrDocument`, after the line `  taxTemplate   TaxFormTemplate? @relation(fields: [taxTemplateId], references: [id], onDelete: SetNull)` add:

```prisma
  templateRuns  TemplateRun[]
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260910090000_extraction_templates/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "TemplateMode" AS ENUM ('AUTO', 'SEMI_AUTO', 'MANUAL');
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'ACTIVE');
CREATE TYPE "TemplateFieldKind" AS ENUM ('SINGLE', 'TABLE');
CREATE TYPE "TemplateValueType" AS ENUM ('TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'LIST');
CREATE TYPE "MappingTarget" AS ENUM ('INVOICE', 'EXCEL');
CREATE TYPE "TemplateRunStatus" AS ENUM ('EXTRACTED', 'REVIEW', 'BLOCKED', 'POSTED', 'FAILED');

-- CreateTable
CREATE TABLE "ExtractionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vatNumber" TEXT NOT NULL,
    "traderTrdr" INTEGER,
    "supplierName" TEXT,
    "docType" "OcrDocType" NOT NULL DEFAULT 'INVOICE',
    "mode" "TemplateMode" NOT NULL DEFAULT 'SEMI_AUTO',
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sampleStorageKey" TEXT,
    "sampleMimeType" TEXT,
    "samplePageCount" INTEGER,
    "sampleThumbUrl" TEXT,
    "notifyEmails" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExtractionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "TemplateFieldKind" NOT NULL DEFAULT 'SINGLE',
    "valueType" "TemplateValueType" NOT NULL DEFAULT 'TEXT',
    "color" TEXT NOT NULL,
    "region" JSONB,
    "columns" JSONB,
    "aiHint" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TemplateField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateMapping" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "target" "MappingTarget" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "rows" JSONB NOT NULL,
    CONSTRAINT "TemplateMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateCondition" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "logic" TEXT NOT NULL DEFAULT 'AND',
    "clauses" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    CONSTRAINT "TemplateCondition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateRun" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "TemplateRunStatus" NOT NULL,
    "values" JSONB NOT NULL,
    "matched" JSONB NOT NULL,
    "flags" JSONB,
    "mappingName" TEXT NOT NULL,
    "model" TEXT,
    "tokensUsed" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateRun_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "TemplateSampleStatus" AS ENUM ('PENDING', 'READ', 'VERIFIED');
CREATE TYPE "TemplateJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
CREATE TYPE "TemplateJobItemStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "TemplateSample" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" "TemplateSampleStatus" NOT NULL DEFAULT 'PENDING',
    "expected" JSONB,
    "lastResult" JSONB,
    "score" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TemplateSample_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateJob" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "status" "TemplateJobStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TemplateJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "TemplateJobItemStatus" NOT NULL DEFAULT 'QUEUED',
    "values" JSONB,
    "matched" JSONB,
    "flags" JSONB,
    "model" TEXT,
    "tokensUsed" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TemplateJobItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "ExtractionTemplate_vatNumber_docType_name_key" ON "ExtractionTemplate"("vatNumber", "docType", "name");
CREATE INDEX "ExtractionTemplate_vatNumber_docType_status_idx" ON "ExtractionTemplate"("vatNumber", "docType", "status");
CREATE UNIQUE INDEX "TemplateField_templateId_key_key" ON "TemplateField"("templateId", "key");
CREATE INDEX "TemplateField_templateId_idx" ON "TemplateField"("templateId");
CREATE UNIQUE INDEX "TemplateMapping_templateId_name_key" ON "TemplateMapping"("templateId", "name");
CREATE INDEX "TemplateCondition_templateId_order_idx" ON "TemplateCondition"("templateId", "order");
CREATE INDEX "TemplateRun_documentId_idx" ON "TemplateRun"("documentId");
CREATE INDEX "TemplateRun_templateId_createdAt_idx" ON "TemplateRun"("templateId", "createdAt");
CREATE INDEX "TemplateSample_templateId_idx" ON "TemplateSample"("templateId");
CREATE INDEX "TemplateJob_status_createdAt_idx" ON "TemplateJob"("status", "createdAt");
CREATE INDEX "TemplateJob_templateId_createdAt_idx" ON "TemplateJob"("templateId", "createdAt");
CREATE INDEX "TemplateJobItem_jobId_order_idx" ON "TemplateJobItem"("jobId", "order");
CREATE INDEX "TemplateJobItem_status_idx" ON "TemplateJobItem"("status");

-- Foreign keys
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateMapping" ADD CONSTRAINT "TemplateMapping_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateCondition" ADD CONSTRAINT "TemplateCondition_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateRun" ADD CONSTRAINT "TemplateRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateSample" ADD CONSTRAINT "TemplateSample_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateJob" ADD CONSTRAINT "TemplateJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateJobItem" ADD CONSTRAINT "TemplateJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TemplateJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateRun" ADD CONSTRAINT "TemplateRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OcrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate schema, generate client, apply migration**

Run:
```bash
npx prisma validate && npx prisma generate && npx prisma migrate deploy
```
Expected: `The schema is valid`, `Generated Prisma Client`, `Applying migration 20260910090000_extraction_templates` … `All migrations have been successfully applied.`

- [ ] **Step 4: Type-check**

Run: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260910090000_extraction_templates
git commit -m "feat(templates): extraction template models + migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Isomorphic schema module

**Files:**
- Create: `lib/templates/schema.ts`
- Test: `lib/templates/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/templates/__tests__/schema.test.ts
import { describe, it, expect } from 'vitest';
import {
  COLOR_PALETTE, nextColor, slugKey, isValidBbox, INVOICE_SCHEMA, invoiceKeyInfo,
} from '../schema';

describe('COLOR_PALETTE / nextColor', () => {
  it('has 12 distinct hex colours', () => {
    expect(COLOR_PALETTE).toHaveLength(12);
    expect(new Set(COLOR_PALETTE).size).toBe(12);
    for (const c of COLOR_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('returns the first unused colour', () => {
    expect(nextColor([])).toBe(COLOR_PALETTE[0]);
    expect(nextColor([COLOR_PALETTE[0]])).toBe(COLOR_PALETTE[1]);
    expect(nextColor([COLOR_PALETTE[0], COLOR_PALETTE[2]])).toBe(COLOR_PALETTE[1]);
  });
  it('wraps around when every colour is used', () => {
    expect(nextColor([...COLOR_PALETTE])).toBe(COLOR_PALETTE[0]);
    expect(nextColor([...COLOR_PALETTE, COLOR_PALETTE[0]])).toBe(COLOR_PALETTE[1]);
  });
  it('ignores case when comparing used colours', () => {
    expect(nextColor([COLOR_PALETTE[0].toLowerCase()])).toBe(COLOR_PALETTE[1]);
  });
});

describe('slugKey', () => {
  it('transliterates Greek to an ascii snake_case key', () => {
    expect(slugKey('Αριθμός Παραγγελίας')).toBe('arithmos_paraggelias');
  });
  it('keeps ascii, collapses punctuation', () => {
    expect(slugKey('PO Number / 2026')).toBe('po_number_2026');
  });
  it('is deterministic for empty input', () => {
    expect(slugKey('')).toBe(slugKey(''));
    expect(slugKey('').startsWith('field_')).toBe(true);
  });
});

describe('isValidBbox', () => {
  it('accepts a normalized box', () => { expect(isValidBbox([0.1, 0.2, 0.3, 0.4])).toBe(true); });
  it('rejects out-of-range, zero-size, or wrong arity', () => {
    expect(isValidBbox([0, 0, 1.2, 0.1])).toBe(false);
    expect(isValidBbox([0, 0, 0, 0.1])).toBe(false);
    expect(isValidBbox([0, 0, 0.5])).toBe(false);
    expect(isValidBbox('x')).toBe(false);
  });
});

describe('INVOICE_SCHEMA', () => {
  it('contains header keys and line keys with isLine flag', () => {
    expect(invoiceKeyInfo('invoiceNumber')?.isLine).toBe(false);
    expect(invoiceKeyInfo('items.quantity')?.isLine).toBe(true);
    expect(invoiceKeyInfo('nope')).toBeNull();
  });
  it('treats any customFields.* key as a valid TEXT header key', () => {
    expect(invoiceKeyInfo('customFields.orderNo')).toEqual({ key: 'customFields.orderNo', label: 'orderNo', valueType: 'TEXT', isLine: false });
  });
  it('has unique keys', () => {
    expect(new Set(INVOICE_SCHEMA.map((k) => k.key)).size).toBe(INVOICE_SCHEMA.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/templates`
Expected: FAIL — `Cannot find module '../schema'`.

- [ ] **Step 3: Implement `lib/templates/schema.ts`**

```ts
// lib/templates/schema.ts — ISOMORPHIC (no prisma, no React). Shared by client + server.
import { slugifyFieldKey } from '@/lib/ocr/field-rules';

export type Bbox = [number, number, number, number];           // x, y, w, h normalized 0-1
export type Region = { page: number; bbox: Bbox };
export type TemplateFieldKind = 'SINGLE' | 'TABLE';
export type TemplateValueType = 'TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'LIST';
export type TemplateMode = 'AUTO' | 'SEMI_AUTO' | 'MANUAL';
export type MappingTarget = 'INVOICE' | 'EXCEL';

export type ColumnDef = { key: string; label: string; valueType: TemplateValueType };

export type FieldDef = {
  key: string;
  label: string;
  kind: TemplateFieldKind;
  valueType: TemplateValueType;
  color: string;
  region: Region | null;
  columns: ColumnDef[] | null;
  aiHint: string | null;
  required: boolean;
  order: number;
};

/** Value of one extracted field, as stored in TemplateRun.values[key]. */
export type FieldValue = {
  raw: string | null;                                // what the reader returned
  value: string | number | string[] | Record<string, unknown>[] | null; // coerced (TABLE → rows)
  confidence: number | null;
  source: 'text' | 'vision' | 'manual';
  page: number | null;
  bbox: Bbox | null;
  color: string;
};

export type MappingRowInvoice = { fieldKey: string; invoiceKey: string };
export type MappingRowExcel = { fieldKey: string; column: string; order: number };

export type ClauseOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'notContains' | 'empty' | 'notEmpty' | 'regex' | 'in';
export type Clause = { fieldKey: string; op: ClauseOp; value?: string };

export type ActionType = 'SET_FIELD' | 'FLAG_REVIEW' | 'BLOCK_POSTING' | 'SWITCH_MAPPING' | 'NOTIFY';
export type Action =
  | { type: 'SET_FIELD'; params: { fieldKey?: string; invoiceKey?: string; value: string } }
  | { type: 'FLAG_REVIEW'; params: { reason: string } }
  | { type: 'BLOCK_POSTING'; params: { reason: string } }
  | { type: 'SWITCH_MAPPING'; params: { mappingName: string } }
  | { type: 'NOTIFY'; params: { emails?: string; subject: string } };

/** Fixed palette (all legible on white, distinct from each other). Order matters: assigned first-free. */
export const COLOR_PALETTE = [
  '#0078D4', '#047857', '#C2410C', '#6D28D9', '#BE185D', '#0F766E',
  '#B45309', '#1D4ED8', '#7C2D12', '#4D7C0F', '#9F1239', '#334155',
] as const;

/** First palette colour not in `used` (case-insensitive); wraps to the least-used when all are taken. */
export function nextColor(used: string[]): string {
  const counts = new Map<string, number>();
  for (const c of COLOR_PALETTE) counts.set(c, 0);
  for (const u of used) {
    const k = u.toUpperCase();
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string = COLOR_PALETTE[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of COLOR_PALETTE) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) { best = c; bestCount = n; }
  }
  return best;
}

/** Stable machine key from a label (Greek → Latin, snake_case). Reuses the OCR field-rules slugger. */
export function slugKey(label: string): string {
  return slugifyFieldKey(label);
}

export function isValidBbox(b: unknown): b is Bbox {
  if (!Array.isArray(b) || b.length !== 4) return false;
  const [x, y, w, h] = b;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001;
}

export type InvoiceKeyInfo = { key: string; label: string; valueType: TemplateValueType; isLine: boolean };

/** The app's invoice schema keys a template can map onto (OcrDocument.extractedData). */
export const INVOICE_SCHEMA: InvoiceKeyInfo[] = [
  // Header keys — exactly the names the OCR pipeline writes into OcrDocument.extractedData
  // (see lib/ocr/templates.ts TEMPLATE_SCHEMAS.invoice.jsonStructure).
  { key: 'companyName',        label: 'Επωνυμία εκδότη',            valueType: 'TEXT',     isLine: false },
  { key: 'vatNumber',          label: 'ΑΦΜ εκδότη',                 valueType: 'TEXT',     isLine: false },
  { key: 'companyAddress',     label: 'Διεύθυνση εκδότη',           valueType: 'TEXT',     isLine: false },
  { key: 'companyDoy',         label: 'ΔΟΥ εκδότη',                 valueType: 'TEXT',     isLine: false },
  { key: 'companyProfession',  label: 'Επάγγελμα εκδότη',           valueType: 'TEXT',     isLine: false },
  { key: 'companyPhone',       label: 'Τηλέφωνο εκδότη',            valueType: 'TEXT',     isLine: false },
  { key: 'companyEmail',       label: 'Email εκδότη',               valueType: 'TEXT',     isLine: false },
  { key: 'customerName',       label: 'Επωνυμία παραλήπτη',         valueType: 'TEXT',     isLine: false },
  { key: 'customerVatNumber',  label: 'ΑΦΜ παραλήπτη',              valueType: 'TEXT',     isLine: false },
  { key: 'documentTypeLabel',  label: 'Τύπος παραστατικού',         valueType: 'TEXT',     isLine: false },
  { key: 'invoiceNumber',      label: 'Αριθμός παραστατικού',       valueType: 'TEXT',     isLine: false },
  { key: 'aadeMark',           label: 'ΜΑΡΚ ΑΑΔΕ',                  valueType: 'TEXT',     isLine: false },
  { key: 'date',               label: 'Ημερομηνία',                 valueType: 'DATE',     isLine: false },
  { key: 'time',               label: 'Ώρα',                        valueType: 'TEXT',     isLine: false },
  { key: 'itemsCount',         label: 'Πλήθος ειδών',               valueType: 'NUMBER',   isLine: false },
  { key: 'subtotal',           label: 'Καθαρή αξία',                valueType: 'CURRENCY', isLine: false },
  { key: 'vatAmount',          label: 'ΦΠΑ',                        valueType: 'CURRENCY', isLine: false },
  { key: 'totalAmount',        label: 'Γενικό σύνολο',              valueType: 'CURRENCY', isLine: false },
  { key: 'items.code',         label: 'Γραμμή: κωδικός',            valueType: 'TEXT',     isLine: true },
  { key: 'items.name',         label: 'Γραμμή: περιγραφή',          valueType: 'TEXT',     isLine: true },
  { key: 'items.quantity',     label: 'Γραμμή: ποσότητα',           valueType: 'NUMBER',   isLine: true },
  { key: 'items.price',        label: 'Γραμμή: τιμή μονάδας',       valueType: 'CURRENCY', isLine: true },
  { key: 'items.discount',     label: 'Γραμμή: έκπτωση',            valueType: 'NUMBER',   isLine: true },
  { key: 'items.vatRate',      label: 'Γραμμή: ΦΠΑ %',              valueType: 'NUMBER',   isLine: true },
  { key: 'items.total',        label: 'Γραμμή: αξία',               valueType: 'CURRENCY', isLine: true },
];

/** Info for a mapping target key. `customFields.<anything>` is always accepted as a TEXT header key. */
export function invoiceKeyInfo(key: string): InvoiceKeyInfo | null {
  const found = INVOICE_SCHEMA.find((k) => k.key === key);
  if (found) return found;
  const m = /^customFields\.([a-z0-9_]+)$/.exec(key);   // slugKey output charset
  if (m) return { key, label: m[1], valueType: 'TEXT', isLine: false };
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/templates`
Expected: `schema.test.ts` all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/templates/schema.ts lib/templates/__tests__/schema.test.ts
git commit -m "feat(templates): isomorphic schema, palette, invoice keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Value coercion

**Files:**
- Create: `lib/templates/coerce.ts`
- Test: `lib/templates/__tests__/coerce.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/templates/__tests__/coerce.test.ts
import { describe, it, expect } from 'vitest';
import { coerceValue } from '../coerce';

describe('coerceValue', () => {
  it('TEXT trims and collapses whitespace, null on empty', () => {
    expect(coerceValue('  Τιμολόγιο   123 ', 'TEXT')).toBe('Τιμολόγιο 123');
    expect(coerceValue('   ', 'TEXT')).toBeNull();
    expect(coerceValue(null, 'TEXT')).toBeNull();
  });
  it('NUMBER parses Greek and plain formats', () => {
    expect(coerceValue('1.234,56', 'NUMBER')).toBe(1234.56);
    expect(coerceValue('1234.56', 'NUMBER')).toBe(1234.56);
    expect(coerceValue('12', 'NUMBER')).toBe(12);
    expect(coerceValue('abc', 'NUMBER')).toBeNull();
  });
  it('CURRENCY strips € and thousands separators', () => {
    expect(coerceValue('€ 1.240,00', 'CURRENCY')).toBe(1240);
    expect(coerceValue('45,20 EUR', 'CURRENCY')).toBe(45.2);
  });
  it('DATE returns ISO yyyy-mm-dd for dd/mm/yyyy and dd-mm-yy', () => {
    expect(coerceValue('05/03/2026', 'DATE')).toBe('2026-03-05');
    expect(coerceValue('5-3-26', 'DATE')).toBe('2026-03-05');
    expect(coerceValue('2026-03-05', 'DATE')).toBe('2026-03-05');
    expect(coerceValue('χθες', 'DATE')).toBeNull();
  });
  it('LIST splits on newline, semicolon or comma and drops empties', () => {
    expect(coerceValue('A123; B456,C789\nD000', 'LIST')).toEqual(['A123', 'B456', 'C789', 'D000']);
    expect(coerceValue('', 'LIST')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/templates/__tests__/coerce.test.ts`
Expected: FAIL — `Cannot find module '../coerce'`.

- [ ] **Step 3: Implement `lib/templates/coerce.ts`**

```ts
// lib/templates/coerce.ts — PURE. Turns a raw reader string into a typed value.
import { parseGreekNumber, parseGreekCurrency, parseGreekDate } from '@/lib/greek-format';
import type { TemplateValueType } from './schema';

export type Coerced = string | number | string[] | null;

export function coerceValue(raw: unknown, valueType: TemplateValueType): Coerced {
  const s = raw == null ? '' : String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  switch (valueType) {
    case 'TEXT':
      return s;
    case 'NUMBER': {
      const n = parseGreekNumber(s);
      return n == null || !Number.isFinite(n) ? null : n;
    }
    case 'CURRENCY': {
      const n = parseGreekCurrency(s.replace(/EUR|€/gi, '').trim());
      return n == null || !Number.isFinite(n) ? null : n;
    }
    case 'DATE': {
      const d = parseGreekDate(s);
      if (!d || Number.isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    case 'LIST': {
      const parts = s.split(/[\n;,]/).map((p) => p.trim()).filter(Boolean);
      return parts.length ? parts : null;
    }
    default:
      return s;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/templates/__tests__/coerce.test.ts`
Expected: PASS. If the `dd-mm-yy` case fails, open `lib/greek-format.ts::parseGreekDate` and confirm it accepts `-` separators and two-digit years; if it does not, extend `coerceValue`'s DATE branch with this pre-normalisation before calling `parseGreekDate`:

```ts
      const norm = s.replace(/[.\-]/g, '/').replace(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, (_m, d1, m1, y2) => `${d1}/${m1}/20${y2}`);
      const d = parseGreekDate(norm);
```

- [ ] **Step 5: Commit**

```bash
git add lib/templates/coerce.ts lib/templates/__tests__/coerce.test.ts
git commit -m "feat(templates): value coercion (Greek numbers, currency, dates, lists)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Conditions evaluator

**Files:**
- Create: `lib/templates/conditions.ts`
- Test: `lib/templates/__tests__/conditions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/templates/__tests__/conditions.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateClause, evaluateRule, applyRules, type RuleDef } from '../conditions';
import type { FieldValue } from '../schema';

const fv = (value: FieldValue['value'], color = '#0078D4'): FieldValue =>
  ({ raw: value == null ? null : String(value), value, confidence: null, source: 'vision', page: 0, bbox: null, color });

const values = {
  total: fv(1240),
  kind: fv('Τιμολόγιο Παροχής'),
  serials: fv(['A1', 'B2']),
  empty: fv(null),
};
const types = { total: 'CURRENCY', kind: 'TEXT', serials: 'LIST', empty: 'TEXT' } as const;
const ctx = { values, valueTypes: types, extras: { $total: 1240, $itemsCount: 3, $pageCount: 1 } };

describe('evaluateClause', () => {
  it('compares numbers numerically', () => {
    expect(evaluateClause({ fieldKey: 'total', op: 'gt', value: '1000' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'total', op: 'lte', value: '1000' }, ctx)).toBe(false);
    expect(evaluateClause({ fieldKey: 'total', op: 'eq', value: '1.240,00' }, ctx)).toBe(true);
  });
  it('compares text case-insensitively', () => {
    expect(evaluateClause({ fieldKey: 'kind', op: 'contains', value: 'παροχής' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'eq', value: 'τιμολόγιο παροχής' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'notContains', value: 'πιστωτικό' }, ctx)).toBe(true);
  });
  it('supports in / regex', () => {
    expect(evaluateClause({ fieldKey: 'kind', op: 'in', value: 'Απόδειξη; Τιμολόγιο Παροχής' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'regex', value: '^Τιμ' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'regex', value: '[' }, ctx)).toBe(false);
  });
  it('LIST contains checks membership', () => {
    expect(evaluateClause({ fieldKey: 'serials', op: 'contains', value: 'b2' }, ctx)).toBe(true);
  });
  it('empty semantics: missing value → empty true, every other op false', () => {
    expect(evaluateClause({ fieldKey: 'empty', op: 'empty' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'empty', op: 'notEmpty' }, ctx)).toBe(false);
    expect(evaluateClause({ fieldKey: 'empty', op: 'eq', value: '' }, ctx)).toBe(false);
    expect(evaluateClause({ fieldKey: 'unknown', op: 'empty' }, ctx)).toBe(true);
  });
  it('reads $ extras', () => {
    expect(evaluateClause({ fieldKey: '$itemsCount', op: 'gte', value: '3' }, ctx)).toBe(true);
  });
});

const rule = (over: Partial<RuleDef>): RuleDef => ({
  id: 'r1', name: 'R', order: 0, isActive: true, logic: 'AND',
  clauses: [{ fieldKey: 'total', op: 'gt', value: '1000' }],
  actions: [{ type: 'FLAG_REVIEW', params: { reason: 'Μεγάλο ποσό' } }],
  ...over,
});

describe('evaluateRule', () => {
  it('AND requires all clauses, OR any', () => {
    const both = [{ fieldKey: 'total', op: 'gt', value: '1000' }, { fieldKey: 'kind', op: 'contains', value: 'πιστωτικό' }] as const;
    expect(evaluateRule(rule({ logic: 'AND', clauses: [...both] }), ctx)).toBe(false);
    expect(evaluateRule(rule({ logic: 'OR', clauses: [...both] }), ctx)).toBe(true);
  });
  it('inactive rules never match; a rule with no clauses never matches', () => {
    expect(evaluateRule(rule({ isActive: false }), ctx)).toBe(false);
    expect(evaluateRule(rule({ clauses: [] }), ctx)).toBe(false);
  });
});

describe('applyRules', () => {
  it('accumulates actions from every matching rule, in order; SWITCH_MAPPING last wins', () => {
    const rules: RuleDef[] = [
      rule({ id: 'a', order: 0, actions: [{ type: 'SWITCH_MAPPING', params: { mappingName: 'credit' } }, { type: 'SET_FIELD', params: { fieldKey: 'kind', value: 'X' } }] }),
      rule({ id: 'b', order: 1, actions: [{ type: 'SWITCH_MAPPING', params: { mappingName: 'special' } }, { type: 'BLOCK_POSTING', params: { reason: 'Έλεγχος' } }, { type: 'NOTIFY', params: { subject: 'Hi' } }] }),
      rule({ id: 'c', order: 2, clauses: [{ fieldKey: 'kind', op: 'contains', value: 'πιστωτικό' }] }),
    ];
    const out = applyRules(rules, ctx);
    expect(out.matched.map((m) => m.id)).toEqual(['a', 'b']);
    expect(out.mappingName).toBe('special');
    expect(out.setFields).toEqual([{ fieldKey: 'kind', value: 'X' }]);
    expect(out.flags).toEqual({ review: [], blocked: ['Έλεγχος'] });
    expect(out.notifications).toEqual([{ subject: 'Hi', emails: undefined }]);
  });
  it('FLAG_REVIEW collects reasons', () => {
    const out = applyRules([rule({})], ctx);
    expect(out.flags).toEqual({ review: ['Μεγάλο ποσό'], blocked: [] });
    expect(out.mappingName).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/templates/__tests__/conditions.test.ts`
Expected: FAIL — `Cannot find module '../conditions'`.

- [ ] **Step 3: Implement `lib/templates/conditions.ts`**

```ts
// lib/templates/conditions.ts — PURE rule evaluation. No I/O.
import type { Action, Clause, FieldValue, TemplateValueType } from './schema';
import { coerceValue } from './coerce';

export type RuleDef = {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  logic: 'AND' | 'OR';
  clauses: Clause[];
  actions: Action[];
};

export type EvalContext = {
  values: Record<string, FieldValue>;
  valueTypes: Record<string, TemplateValueType>;
  /** $total, $itemsCount, $pageCount … from the base OCR result. */
  extras?: Record<string, number | string | null>;
};

export type ApplyResult = {
  matched: { id: string; name: string; actions: Action[] }[];
  setFields: { fieldKey?: string; invoiceKey?: string; value: string }[];
  flags: { review: string[]; blocked: string[] };
  mappingName: string | null;
  notifications: { subject: string; emails?: string }[];
};

type Resolved = { value: string | number | string[] | null; type: TemplateValueType };

function resolve(fieldKey: string, ctx: EvalContext): Resolved {
  if (fieldKey.startsWith('$')) {
    const v = ctx.extras?.[fieldKey];
    return { value: v == null ? null : v, type: typeof v === 'number' ? 'NUMBER' : 'TEXT' };
  }
  const fv = ctx.values[fieldKey];
  const type = ctx.valueTypes[fieldKey] ?? 'TEXT';
  if (!fv || fv.value == null) return { value: null, type };
  // TABLE rows are not comparable as a whole; treat as "has rows" text for empty checks.
  if (Array.isArray(fv.value) && fv.value.length && typeof fv.value[0] === 'object') {
    return { value: `${fv.value.length}`, type: 'NUMBER' };
  }
  return { value: fv.value as string | number | string[], type };
}

const isEmpty = (v: Resolved['value']) =>
  v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

function asNumber(v: Resolved['value'], type: TemplateValueType): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const c = coerceValue(v, type === 'TEXT' ? 'NUMBER' : type);
    return typeof c === 'number' ? c : null;
  }
  return null;
}

export function evaluateClause(clause: Clause, ctx: EvalContext): boolean {
  const r = resolve(clause.fieldKey, ctx);
  const empty = isEmpty(r.value);
  if (clause.op === 'empty') return empty;
  if (clause.op === 'notEmpty') return !empty;
  if (empty) return false;

  const expected = clause.value ?? '';
  const numeric = r.type === 'NUMBER' || r.type === 'CURRENCY';

  switch (clause.op) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': {
      if (numeric || r.type === 'DATE') {
        const a = r.type === 'DATE' ? String(r.value) : asNumber(r.value, r.type);
        const b = r.type === 'DATE' ? (coerceValue(expected, 'DATE') as string | null) : asNumber(expected, r.type);
        if (a == null || b == null) return false;
        switch (clause.op) {
          case 'eq': return a === b; case 'neq': return a !== b;
          case 'gt': return a > b; case 'gte': return a >= b;
          case 'lt': return a < b; case 'lte': return a <= b;
        }
      }
      const a = norm(Array.isArray(r.value) ? r.value.join(', ') : r.value);
      const b = norm(expected);
      if (clause.op === 'eq') return a === b;
      if (clause.op === 'neq') return a !== b;
      return false; // ordering ops are meaningless for text
    }
    case 'contains': case 'notContains': {
      const hit = Array.isArray(r.value)
        ? r.value.some((x) => norm(x) === norm(expected))
        : norm(r.value).includes(norm(expected));
      return clause.op === 'contains' ? hit : !hit;
    }
    case 'in': {
      const set = expected.split(/[;,\n]/).map(norm).filter(Boolean);
      const a = Array.isArray(r.value) ? r.value.map(norm) : [norm(r.value)];
      return a.some((x) => set.includes(x));
    }
    case 'regex': {
      try {
        const re = new RegExp(expected, 'iu');
        const a = Array.isArray(r.value) ? r.value.join('\n') : String(r.value);
        return re.test(a);
      } catch { return false; }
    }
    default:
      return false;
  }
}

export function evaluateRule(rule: RuleDef, ctx: EvalContext): boolean {
  if (!rule.isActive || rule.clauses.length === 0) return false;
  const results = rule.clauses.map((c) => evaluateClause(c, ctx));
  return rule.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

/** Evaluates rules in `order`; every matching rule contributes its actions. SWITCH_MAPPING: last wins. */
export function applyRules(rules: RuleDef[], ctx: EvalContext): ApplyResult {
  const out: ApplyResult = { matched: [], setFields: [], flags: { review: [], blocked: [] }, mappingName: null, notifications: [] };
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  for (const rule of ordered) {
    if (!evaluateRule(rule, ctx)) continue;
    out.matched.push({ id: rule.id, name: rule.name, actions: rule.actions });
    for (const a of rule.actions) {
      switch (a.type) {
        case 'SET_FIELD': out.setFields.push({ fieldKey: a.params.fieldKey, invoiceKey: a.params.invoiceKey, value: a.params.value }); break;
        case 'FLAG_REVIEW': out.flags.review.push(a.params.reason); break;
        case 'BLOCK_POSTING': out.flags.blocked.push(a.params.reason); break;
        case 'SWITCH_MAPPING': out.mappingName = a.params.mappingName; break;
        case 'NOTIFY': out.notifications.push({ subject: a.params.subject, emails: a.params.emails }); break;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/templates/__tests__/conditions.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/templates/conditions.ts lib/templates/__tests__/conditions.test.ts
git commit -m "feat(templates): pure conditions evaluator with actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Mapping projection

**Files:**
- Create: `lib/templates/mapping.ts`
- Test: `lib/templates/__tests__/mapping.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/templates/__tests__/mapping.test.ts
import { describe, it, expect } from 'vitest';
import { projectToInvoice, projectToExcel } from '../mapping';
import type { FieldValue } from '../schema';

const fv = (value: FieldValue['value']): FieldValue =>
  ({ raw: null, value, confidence: null, source: 'vision', page: 0, bbox: null, color: '#000000' });

describe('projectToInvoice', () => {
  it('writes header keys, customFields and nested items columns, deep-merging into existing data', () => {
    const values = {
      no: fv('ΤΙΜ-451'),
      order: fv('PO-77'),
      lines: fv([{ code: 'A1', qty: 2, price: 10 }, { code: 'B2', qty: 1, price: 5.5 }]),
    };
    const rows = [
      { fieldKey: 'no', invoiceKey: 'invoiceNumber' },
      { fieldKey: 'order', invoiceKey: 'customFields.orderNo' },
      { fieldKey: 'lines.code', invoiceKey: 'items.code' },
      { fieldKey: 'lines.qty', invoiceKey: 'items.quantity' },
      { fieldKey: 'lines.price', invoiceKey: 'items.price' },
    ];
    const existing = { vatNumber: '123456789', customFields: { keep: 'me' }, items: [{ name: 'old' }] };
    const out = projectToInvoice(values, rows, existing);
    expect(out.vatNumber).toBe('123456789');
    expect(out.invoiceNumber).toBe('ΤΙΜ-451');
    expect(out.customFields).toEqual({ keep: 'me', orderNo: 'PO-77' });
    expect(out.items).toEqual([{ code: 'A1', quantity: 2, price: 10 }, { code: 'B2', quantity: 1, price: 5.5 }]);
  });
  it('skips null values and unknown invoice keys, keeps existing items when no line mapping', () => {
    const out = projectToInvoice({ x: fv(null), y: fv('v') }, [{ fieldKey: 'x', invoiceKey: 'invoiceNumber' }, { fieldKey: 'y', invoiceKey: 'nope' }], { items: [{ name: 'old' }] });
    expect(out).toEqual({ items: [{ name: 'old' }] });
  });
  it('does not mutate the input object', () => {
    const existing = { a: 1 };
    projectToInvoice({ n: fv('x') }, [{ fieldKey: 'n', invoiceKey: 'aadeMark' }], existing);
    expect(existing).toEqual({ a: 1 });
  });
});

describe('projectToExcel', () => {
  it('orders columns and stringifies values; lists join with ", "', () => {
    const values = { no: fv('ΤΙΜ-451'), total: fv(1240.5), serials: fv(['A', 'B']), miss: fv(null) };
    const rows = [
      { fieldKey: 'total', column: 'Σύνολο', order: 2 },
      { fieldKey: 'no', column: 'Αριθμός', order: 1 },
      { fieldKey: 'serials', column: 'Serials', order: 3 },
      { fieldKey: 'miss', column: 'Κενό', order: 4 },
    ];
    expect(projectToExcel(values, rows)).toEqual({
      columns: ['Αριθμός', 'Σύνολο', 'Serials', 'Κενό'],
      row: ['ΤΙΜ-451', 1240.5, 'A, B', ''],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/templates/__tests__/mapping.test.ts`
Expected: FAIL — `Cannot find module '../mapping'`.

- [ ] **Step 3: Implement `lib/templates/mapping.ts`**

```ts
// lib/templates/mapping.ts — PURE projections of extracted values onto outputs.
import { invoiceKeyInfo, type FieldValue, type MappingRowExcel, type MappingRowInvoice } from './schema';

type Json = Record<string, unknown>;

/**
 * Merge mapped values into a copy of `existing` (OcrDocument.extractedData).
 * - header keys → top-level
 * - customFields.<k> → extractedData.customFields[k]
 * - items.<col> mapped from a TABLE field `<tableKey>.<colKey>` → rebuilds items[] from the table rows
 *   (when at least one line mapping is present); otherwise items are left untouched.
 */
export function projectToInvoice(
  values: Record<string, FieldValue>,
  rows: MappingRowInvoice[],
  existing: Json = {},
): Json {
  const out: Json = { ...existing };
  const custom: Json = { ...((existing.customFields as Json) ?? {}) };
  let customTouched = false;
  const lineMaps: { tableKey: string; colKey: string; itemKey: string }[] = [];

  for (const r of rows) {
    const info = invoiceKeyInfo(r.invoiceKey);
    if (!info) continue;
    if (info.isLine) {
      const dot = r.fieldKey.indexOf('.');
      if (dot <= 0) continue;
      lineMaps.push({ tableKey: r.fieldKey.slice(0, dot), colKey: r.fieldKey.slice(dot + 1), itemKey: r.invoiceKey.slice('items.'.length) });
      continue;
    }
    const v = values[r.fieldKey]?.value;
    if (v == null) continue;
    if (r.invoiceKey.startsWith('customFields.')) { custom[info.label] = v; customTouched = true; }
    else out[r.invoiceKey] = v;
  }
  if (customTouched) out.customFields = custom;

  if (lineMaps.length) {
    const tableKey = lineMaps[0].tableKey;
    const tableRows = values[tableKey]?.value;
    if (Array.isArray(tableRows)) {
      out.items = (tableRows as Json[]).map((row) => {
        const item: Json = {};
        for (const m of lineMaps) if (m.tableKey === tableKey && row[m.colKey] != null) item[m.itemKey] = row[m.colKey];
        return item;
      });
    }
  }
  return out;
}

/** One Excel row for a document: ordered column headers + cell values. */
export function projectToExcel(
  values: Record<string, FieldValue>,
  rows: MappingRowExcel[],
): { columns: string[]; row: (string | number)[] } {
  const ordered = [...rows].sort((a, b) => a.order - b.order);
  const columns = ordered.map((r) => r.column);
  const row = ordered.map((r) => {
    const v = values[r.fieldKey]?.value;
    if (v == null) return '';
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    return String(v);
  });
  return { columns, row };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/templates/__tests__/mapping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/templates/mapping.ts lib/templates/__tests__/mapping.test.ts
git commit -m "feat(templates): invoice and excel mapping projections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Flow graph builder (React Flow shape, no React)

**Files:**
- Create: `lib/templates/flow.ts`
- Test: `lib/templates/__tests__/flow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/templates/__tests__/flow.test.ts
import { describe, it, expect } from 'vitest';
import { buildFlow, type FlowTemplate, type FlowRun } from '../flow';

const tpl: FlowTemplate = {
  id: 't1', name: 'ACME', mode: 'SEMI_AUTO', samplePageCount: 2,
  fields: [
    { key: 'no', label: 'Αριθμός', color: '#0078D4', kind: 'SINGLE', region: { page: 0, bbox: [0.1, 0.1, 0.2, 0.05] } },
    { key: 'lines', label: 'Γραμμές', color: '#047857', kind: 'TABLE', region: { page: 1, bbox: [0, 0.3, 1, 0.5] } },
  ],
  conditions: [{ id: 'c1', name: 'Μεγάλο ποσό', clauses: [{ fieldKey: 'no', op: 'notEmpty' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'x' } }] }],
  mappings: [{ name: 'default', target: 'INVOICE', rows: [{ fieldKey: 'no', invoiceKey: 'invoiceNumber' }] }, { name: 'xls', target: 'EXCEL', rows: [{ fieldKey: 'no', column: 'A', order: 1 }] }],
};

describe('buildFlow', () => {
  it('creates sample, field, condition, mapping and output nodes with edges', () => {
    const { nodes, edges } = buildFlow(tpl);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('sample');
    expect(ids).toContain('field:no');
    expect(ids).toContain('field:lines');
    expect(ids).toContain('cond:c1');
    expect(ids).toContain('map:default');
    expect(ids).toContain('map:xls');
    expect(ids).toContain('output');
    expect(edges).toContainEqual(expect.objectContaining({ source: 'sample', target: 'field:no' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'field:no', target: 'cond:c1' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'cond:c1', target: 'map:default', label: 'ναι' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'field:no', target: 'map:default' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'map:default', target: 'output' }));
  });
  it('field nodes carry their colour and type, output carries the mode', () => {
    const { nodes } = buildFlow(tpl);
    const f = nodes.find((n) => n.id === 'field:no')!;
    expect(f.type).toBe('field');
    expect(f.data).toMatchObject({ label: 'Αριθμός', color: '#0078D4', kind: 'SINGLE', page: 0 });
    expect(nodes.find((n) => n.id === 'output')!.data).toMatchObject({ mode: 'SEMI_AUTO' });
  });
  it('lays nodes out in columns left to right', () => {
    const { nodes } = buildFlow(tpl);
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x;
    expect(x('sample')).toBeLessThan(x('field:no'));
    expect(x('field:no')).toBeLessThan(x('cond:c1'));
    expect(x('cond:c1')).toBeLessThan(x('map:default'));
    expect(x('map:default')).toBeLessThan(x('output'));
  });
  it('overlays live run status when a run is given', () => {
    const run: FlowRun = { status: 'REVIEW', values: { no: { value: 'ΤΙΜ-1' }, lines: { value: null } }, matchedIds: ['c1'], mappingName: 'default' };
    const { nodes, edges } = buildFlow(tpl, run);
    expect(nodes.find((n) => n.id === 'field:no')!.data).toMatchObject({ value: 'ΤΙΜ-1', status: 'ok' });
    expect(nodes.find((n) => n.id === 'field:lines')!.data).toMatchObject({ status: 'missing' });
    expect(nodes.find((n) => n.id === 'cond:c1')!.data).toMatchObject({ matched: true });
    expect(nodes.find((n) => n.id === 'output')!.data).toMatchObject({ runStatus: 'REVIEW' });
    expect(edges.find((e) => e.source === 'cond:c1' && e.target === 'map:default')!.animated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/templates/__tests__/flow.test.ts`
Expected: FAIL — `Cannot find module '../flow'`.

- [ ] **Step 3: Implement `lib/templates/flow.ts`**

```ts
// lib/templates/flow.ts — PURE. Builds the React-Flow node/edge arrays from a template (+ optional run).
// Kept free of React so the designer, the run-result view and tests share one source of truth.
import type { Action, Clause, Region, TemplateFieldKind, TemplateMode, MappingTarget } from './schema';

export type FlowTemplate = {
  id: string;
  name: string;
  mode: TemplateMode;
  samplePageCount: number | null;
  fields: { key: string; label: string; color: string; kind: TemplateFieldKind; region: Region | null }[];
  conditions: { id: string; name: string; clauses: Clause[]; actions: Action[] }[];
  mappings: { name: string; target: MappingTarget; rows: { fieldKey: string }[] }[];
};

export type FlowRun = {
  status: 'EXTRACTED' | 'REVIEW' | 'BLOCKED' | 'POSTED' | 'FAILED';
  values: Record<string, { value: unknown }>;
  matchedIds: string[];
  mappingName: string;
};

export type FlowNode = { id: string; type: 'sample' | 'field' | 'condition' | 'mapping' | 'output'; position: { x: number; y: number }; data: Record<string, unknown> };
export type FlowEdge = { id: string; source: string; target: string; label?: string; animated?: boolean; style?: { stroke: string } };

const COL_X = [0, 260, 540, 820, 1100];
const ROW_H = 96;

export function buildFlow(t: FlowTemplate, run?: FlowRun): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const col = (i: number, row: number) => ({ x: COL_X[i], y: row * ROW_H });

  nodes.push({ id: 'sample', type: 'sample', position: col(0, 0), data: { label: 'Δείγμα', pageCount: t.samplePageCount ?? 0, templateName: t.name } });

  t.fields.forEach((f, i) => {
    const v = run?.values[f.key]?.value;
    const status = run ? (v == null || (Array.isArray(v) && v.length === 0) ? 'missing' : 'ok') : undefined;
    nodes.push({
      id: `field:${f.key}`, type: 'field', position: col(1, i),
      data: { label: f.label, key: f.key, color: f.color, kind: f.kind, page: f.region?.page ?? null, hasRegion: !!f.region, value: v ?? null, status },
    });
    edges.push({ id: `e:sample->${f.key}`, source: 'sample', target: `field:${f.key}`, style: { stroke: f.color } });
  });

  const fieldsUsedBy = (keys: string[]) => keys.map((k) => k.split('.')[0]).filter((k) => t.fields.some((f) => f.key === k));

  t.conditions.forEach((c, i) => {
    const matched = run ? run.matchedIds.includes(c.id) : undefined;
    nodes.push({ id: `cond:${c.id}`, type: 'condition', position: col(2, i), data: { label: c.name, clauses: c.clauses.length, actions: c.actions.map((a) => a.type), matched } });
    for (const key of new Set(fieldsUsedBy(c.clauses.map((cl) => cl.fieldKey)))) {
      const color = t.fields.find((f) => f.key === key)!.color;
      edges.push({ id: `e:${key}->${c.id}`, source: `field:${key}`, target: `cond:${c.id}`, style: { stroke: color } });
    }
  });

  const defaultMapping = t.mappings[0]?.name ?? null;
  t.mappings.forEach((m, i) => {
    const active = run ? run.mappingName === m.name : undefined;
    nodes.push({ id: `map:${m.name}`, type: 'mapping', position: col(3, i), data: { label: m.target === 'EXCEL' ? `Excel: ${m.name}` : `Παραστατικό: ${m.name}`, target: m.target, rows: m.rows.length, active } });
    for (const key of new Set(fieldsUsedBy(m.rows.map((r) => r.fieldKey)))) {
      const color = t.fields.find((f) => f.key === key)!.color;
      edges.push({ id: `e:${key}->map:${m.name}`, source: `field:${key}`, target: `map:${m.name}`, style: { stroke: color } });
    }
    edges.push({ id: `e:map:${m.name}->output`, source: `map:${m.name}`, target: 'output', animated: active === true });
  });

  // Conditions feed the mapping they switch to (or the default one): true edge «ναι», false edge «όχι» to default.
  t.conditions.forEach((c) => {
    const sw = c.actions.find((a) => a.type === 'SWITCH_MAPPING') as Extract<Action, { type: 'SWITCH_MAPPING' }> | undefined;
    const target = sw?.params.mappingName ?? defaultMapping;
    if (!target) return;
    const matched = run ? run.matchedIds.includes(c.id) : undefined;
    edges.push({ id: `e:${c.id}->map:${target}:yes`, source: `cond:${c.id}`, target: `map:${target}`, label: 'ναι', animated: matched === true, style: { stroke: '#047857' } });
    if (sw && defaultMapping && defaultMapping !== target) {
      edges.push({ id: `e:${c.id}->map:${defaultMapping}:no`, source: `cond:${c.id}`, target: `map:${defaultMapping}`, label: 'όχι', animated: matched === false, style: { stroke: '#8A8A8A' } });
    }
  });

  nodes.push({ id: 'output', type: 'output', position: col(4, 0), data: { label: outputLabel(t.mode), mode: t.mode, runStatus: run?.status ?? null } });
  return { nodes, edges };
}

function outputLabel(mode: TemplateMode): string {
  if (mode === 'AUTO') return 'Ανάρτηση SoftOne (αυτόματα)';
  if (mode === 'SEMI_AUTO') return 'Προς έλεγχο → SoftOne';
  return 'Μόνο εξαγωγή';
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/templates/__tests__/flow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/templates/flow.ts lib/templates/__tests__/flow.test.ts
git commit -m "feat(templates): pure flow graph builder for React Flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Shared vision reader (server) and read-region refactor

**Files:**
- Create: `lib/templates/vision.ts`
- Modify: `app/api/admin/ocr/[id]/read-region/route.ts` (replace the crop+vision block, lines ~66-140)
- Test: `lib/templates/__tests__/vision.test.ts`

- [ ] **Step 1: Write the failing test (mocks fetch + settings)**

```ts
// lib/templates/__tests__/vision.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => ({
  'ai.visionApiKey': 'key', 'ai.visionUrl': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'ai.visionModel': 'gemini-2.5-flash', 'ai.visionFallbackModels': 'gemini-2.5-pro',
} as Record<string, string>)[k] ?? null) }));
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}), providerFromUrl: () => 'gemini' }));
const fetchMock = vi.fn();
vi.mock('@/lib/ocr/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => fetchMock(...a) }));

import { readCropValue, readCropTable, prepareCrop } from '../vision';
import { logAiUsage } from '@/lib/ai/usage';

const png = Buffer.from('89504e470d0a1a0a', 'hex');

beforeEach(() => { fetchMock.mockReset(); (logAiUsage as any).mockClear(); });

describe('readCropValue', () => {
  it('returns the trimmed content, model and tokens, and logs usage', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: ' ΤΙΜ-451 \n' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) });
    const r = await readCropValue({ crop: png, prompt: 'Read the invoice number', operation: 'template.field' });
    expect(r).toEqual({ value: 'ΤΙΜ-451', model: 'gemini-2.5-flash', tokensUsed: 12 });
    expect(logAiUsage).toHaveBeenCalledWith(expect.objectContaining({ scope: 'OCR_VISION', model: 'gemini-2.5-flash', operation: 'template.field', totalTokens: 12 }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gemini-2.5-flash');
    expect(body.messages[1].content[0].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('falls back to the next model when the primary fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'busy' });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'X' } }], usage: {} }) });
    const r = await readCropValue({ crop: png, prompt: 'p', operation: 'template.field' });
    expect(r.model).toBe('gemini-2.5-pro');
    expect(r.value).toBe('X');
  });
  it('normalises "null"/"—" answers to empty string', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'null' } }] }) });
    expect((await readCropValue({ crop: png, prompt: 'p', operation: 'x' })).value).toBe('');
  });
});

describe('readCropTable', () => {
  it('parses a JSON rows answer (tolerating code fences)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"rows":[{"code":"A1","qty":"2"}]}\n```' } }], usage: { total_tokens: 5 } }) });
    const r = await readCropTable({ crop: png, columns: [{ key: 'code', label: 'Κωδικός' }, { key: 'qty', label: 'Ποσότητα' }], operation: 'template.table' });
    expect(r.rows).toEqual([{ code: 'A1', qty: '2' }]);
    expect(r.tokensUsed).toBe(5);
  });
});

describe('prepareCrop', () => {
  it('is exported (sharp pipeline exercised in route/manual tests)', () => {
    expect(typeof prepareCrop).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/templates/__tests__/vision.test.ts`
Expected: FAIL — `Cannot find module '../vision'`.

- [ ] **Step 3: Implement `lib/templates/vision.ts`**

```ts
// lib/templates/vision.ts — SERVER. One place for "read this crop with the vision model".
// Same OpenAI-compatible call shape as app/api/admin/ocr/[id]/read-region (now delegated here).
import 'server-only';
import sharp from 'sharp';
import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { fetchWithRetry } from '@/lib/ocr/fetch-retry';
import { buildModelChain, tryModels } from '@/lib/ocr/model-fallback';
import type { Bbox } from './schema';

const DEFAULT_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

async function visionConfig() {
  const key = (await getSetting<string>('ai.visionApiKey')) ?? process.env.GEMINI_API_KEY ?? '';
  const url = (await getSetting<string>('ai.visionUrl')) ?? DEFAULT_VISION_URL;
  const model = (await getSetting<string>('ai.visionModel')) ?? 'gemini-2.5-flash';
  const fallbackRaw = (await getSetting<string>('ai.visionFallbackModels')) ?? '';
  const fallbacks = fallbackRaw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
  if (!key) throw new Error('Δεν έχει ρυθμιστεί κλειδί vision (ai.visionApiKey)');
  return { key, url, models: buildModelChain(model, fallbacks) };
}

/** Crop a normalized bbox from a page bitmap and enhance it for reading (upscale ×2 min 400px, grayscale, normalize). */
export async function prepareCrop(pageBuf: Buffer, bbox: Bbox): Promise<Buffer> {
  const meta = await sharp(pageBuf).metadata();
  const W = meta.width ?? 0; const H = meta.height ?? 0;
  if (W < 2 || H < 2) throw new Error('unreadable page');
  const [nx, ny, nw, nh] = bbox;
  const left = Math.min(W - 1, Math.max(0, Math.round(nx * W)));
  const top = Math.min(H - 1, Math.max(0, Math.round(ny * H)));
  const width = Math.min(W - left, Math.max(1, Math.round(nw * W)));
  const height = Math.min(H - top, Math.max(1, Math.round(nh * H)));
  return sharp(pageBuf).extract({ left, top, width, height })
    .resize({ width: Math.max(width * 2, 400), withoutEnlargement: false })
    .grayscale().normalize().png().toBuffer();
}

type CallResult = { content: string; model: string; tokensUsed: number | null };

async function callVision(crop: Buffer, system: string, operation: string): Promise<CallResult> {
  const cfg = await visionConfig();
  return tryModels(cfg.models, async (model) => {
    const res = await fetchWithRetry(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model, temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${crop.toString('base64')}` } }] },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: new Error(`vision ${res.status}: ${await res.text().catch(() => '')}`) };
    const data = await res.json();
    const u = data?.usage ?? {};
    const tokensUsed = typeof u.total_tokens === 'number' ? u.total_tokens : null;
    void logAiUsage({ scope: 'OCR_VISION', provider: providerFromUrl(cfg.url), model, operation, inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: tokensUsed ?? 0 });
    return { ok: true, value: { content: String(data?.choices?.[0]?.message?.content ?? ''), model, tokensUsed } };
  });
}

const NULLISH = new Set(['', 'null', 'none', '—', '-', 'n/a', 'κενό']);

/** Read one field's value from a crop. `prompt` describes the field (label + hint). */
export async function readCropValue(input: { crop: Buffer; prompt: string; operation: string }): Promise<{ value: string; model: string; tokensUsed: number | null }> {
  const system = `${input.prompt}\nThe image is a cropped area of a Greek invoice/receipt. Respond with ONLY the raw value text as printed, no labels, no quotes, no explanation. If the area is empty respond with an empty string.`;
  const r = await callVision(input.crop, system, input.operation);
  const v = r.content.trim();
  return { value: NULLISH.has(v.toLowerCase()) ? '' : v, model: r.model, tokensUsed: r.tokensUsed };
}

/** Read a table crop into rows keyed by the template's column keys. */
export async function readCropTable(input: { crop: Buffer; columns: { key: string; label: string }[]; operation: string; hint?: string | null }): Promise<{ rows: Record<string, string>[]; model: string; tokensUsed: number | null }> {
  const cols = input.columns.map((c) => `"${c.key}" (${c.label})`).join(', ');
  const system = `Extract every row of the table in this cropped image of a Greek document.${input.hint ? ` ${input.hint}` : ''}\nReturn ONLY JSON: {"rows":[{${input.columns.map((c) => `"${c.key}":"…"`).join(',')}}]} with columns ${cols}. Values are raw strings exactly as printed; use "" when a cell is empty. No markdown.`;
  const r = await callVision(input.crop, system, input.operation);
  const rows = parseRows(r.content, input.columns.map((c) => c.key));
  return { rows, model: r.model, tokensUsed: r.tokensUsed };
}

function parseRows(content: string, keys: string[]): Record<string, string>[] {
  const stripped = content.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{'); const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1)) as { rows?: unknown };
    if (!Array.isArray(obj.rows)) return [];
    return obj.rows.map((row) => {
      const out: Record<string, string> = {};
      for (const k of keys) out[k] = row && typeof row === 'object' && (row as Record<string, unknown>)[k] != null ? String((row as Record<string, unknown>)[k]) : '';
      return out;
    });
  } catch { return []; }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run lib/templates/__tests__/vision.test.ts`
Expected: PASS (5 tests). Note: `server-only` is a Next.js virtual module; if vitest fails to resolve it, add to `vitest.config.ts` → `resolve.alias`: `'server-only': path.resolve(__dirname, 'lib/__mocks__/server-only.ts')` and create `lib/__mocks__/server-only.ts` with content `export {};`.

- [ ] **Step 5: Refactor `read-region` to delegate**

In `app/api/admin/ocr/[id]/read-region/route.ts` replace everything from the comment `// Crop the normalized bbox.` down to the final `return NextResponse.json({ value });` with:

```ts
  let crop: Buffer;
  try {
    crop = await prepareCrop(imgBuf, bbox);
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg === 'unreadable page' ? 'unreadable page' : 'invalid region' }, { status: 422 });
  }
  try {
    const r = await readCropValue({ crop, prompt: `Read the value of the field "${field}".`, operation: 'ocr.region' });
    return NextResponse.json({ value: r.value });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
```

and change the imports at the top to:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { prepareCrop, readCropValue } from '@/lib/templates/vision';
```

(remove the now-unused `sharp`, `getSetting`, `logAiUsage`, `providerFromUrl`, `fetchWithRetry` imports).

- [ ] **Step 6: Type-check and run the whole suite**

Run: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"; npx vitest run`
Expected: no tsc output; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/templates/vision.ts lib/templates/__tests__/vision.test.ts "app/api/admin/ocr/[id]/read-region/route.ts" vitest.config.ts lib/__mocks__ 2>/dev/null
git commit -m "feat(templates): shared vision crop reader with model fallback; read-region delegates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: PDF text layer + extraction engine (server)

**Files:**
- Create: `lib/templates/pdf-text.ts`
- Create: `lib/templates/extract.ts`
- Test: `lib/templates/__tests__/extract.test.ts`

- [ ] **Step 1: Write the failing tests (mocks for crop/vision/text layer)**

```ts
// lib/templates/__tests__/extract.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const textItems = vi.fn();
const readValue = vi.fn();
const readTable = vi.fn();
vi.mock('../pdf-text', () => ({ extractPdfTextItems: (...a: unknown[]) => textItems(...a) }));
vi.mock('../vision', () => ({
  prepareCrop: vi.fn(async () => Buffer.from('crop')),
  readCropValue: (...a: unknown[]) => readValue(...a),
  readCropTable: (...a: unknown[]) => readTable(...a),
}));
vi.mock('@/lib/ocr/rasterize', () => ({
  isPdfBuffer: (b: Buffer) => b.subarray(0, 4).toString() === '%PDF',
  renderPage: vi.fn(async () => Buffer.from('page-png')),
}));

import { extractTemplateFields } from '../extract';
import type { FieldDef } from '../schema';

const field = (over: Partial<FieldDef>): FieldDef => ({
  key: 'no', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4',
  region: { page: 0, bbox: [0.1, 0.1, 0.3, 0.05] }, columns: null, aiHint: null, required: false, order: 0, ...over,
});
const pdf = Buffer.from('%PDF-1.4 fake');
const png = Buffer.from('not a pdf');

beforeEach(() => { textItems.mockReset(); readValue.mockReset(); readTable.mockReset(); });

describe('extractTemplateFields', () => {
  it('uses the PDF text layer when it yields text (no vision call)', async () => {
    textItems.mockResolvedValueOnce([{ str: 'ΤΙΜ-451', x: 0.12, y: 0.11, w: 0.1, h: 0.02 }]);
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({})]);
    expect(out.values.no).toMatchObject({ raw: 'ΤΙΜ-451', value: 'ΤΙΜ-451', source: 'text', page: 0, color: '#0078D4' });
    expect(readValue).not.toHaveBeenCalled();
    expect(out.tokensUsed).toBe(0);
  });
  it('falls back to vision when the text layer is empty, coercing by type', async () => {
    textItems.mockResolvedValueOnce([]);
    readValue.mockResolvedValueOnce({ value: '1.240,00', model: 'm', tokensUsed: 7 });
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({ key: 'total', valueType: 'CURRENCY' })]);
    expect(out.values.total).toMatchObject({ raw: '1.240,00', value: 1240, source: 'vision' });
    expect(out.model).toBe('m'); expect(out.tokensUsed).toBe(7);
    expect(readValue.mock.calls[0][0].prompt).toContain('Αριθμός');
  });
  it('images always go through vision; TABLE fields use readCropTable and coerce columns', async () => {
    readTable.mockResolvedValueOnce({ rows: [{ code: 'A1', qty: '2,5' }], model: 'm', tokensUsed: 3 });
    const f = field({ key: 'lines', kind: 'TABLE', valueType: 'TEXT', columns: [{ key: 'code', label: 'Κωδ', valueType: 'TEXT' }, { key: 'qty', label: 'Ποσ', valueType: 'NUMBER' }] });
    const out = await extractTemplateFields(png, 'image/png', [f]);
    expect(out.values.lines.value).toEqual([{ code: 'A1', qty: 2.5 }]);
    expect(textItems).not.toHaveBeenCalled();
  });
  it('fields without a region are returned as null without any call; per-field errors do not abort the batch', async () => {
    readValue.mockRejectedValueOnce(new Error('boom'));
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'a', region: null }), field({ key: 'b' })]);
    expect(out.values.a).toMatchObject({ value: null, source: 'vision', bbox: null });
    expect(out.values.b).toMatchObject({ value: null });
    expect(out.errors).toEqual([{ fieldKey: 'b', message: 'boom' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/templates/__tests__/extract.test.ts`
Expected: FAIL — `Cannot find module '../extract'`.

- [ ] **Step 3: Add `renderPage` to `lib/ocr/rasterize.ts`**

`cropRegionToImage` already renders a PDF page via a private `renderPdfPagePng`. Export a page renderer next to it (append to the file):

```ts
/** Page bitmap (PNG) for a PDF page, or the original bytes for an image. Shared by the template extractor. */
export async function renderPage(buffer: Buffer, mimeType: string, page: number, scale = 3): Promise<Buffer> {
  const treatAsPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);
  return treatAsPdf ? renderPdfPagePng(buffer, page, scale) : buffer;
}
```

- [ ] **Step 4: Implement `lib/templates/pdf-text.ts`**

```ts
// lib/templates/pdf-text.ts — SERVER. Positioned text items of one PDF page, normalized 0-1
// (origin top-left), matching lib/ocr/region-text.ts::TextItem so textInBox can be reused.
import 'server-only';
import type { TextItem } from '@/lib/ocr/region-text';

export async function extractPdfTextItems(buffer: Buffer, page: number): Promise<TextItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  try {
    if (page < 0 || page >= doc.numPages) return [];
    const p = await doc.getPage(page + 1);
    const vp = p.getViewport({ scale: 1 });
    const content = await p.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      if (!it.str || !it.transform) continue;
      const [, , , , tx, ty] = it.transform;
      const w = (it.width ?? 0) / vp.width;
      const h = (it.height ?? Math.abs(it.transform[3] ?? 0)) / vp.height;
      const x = tx / vp.width;
      const y = 1 - ty / vp.height - h;               // PDF y grows upward; flip to top-left origin
      const str = it.str.trim();
      if (str) items.push({ str, x, y, w, h });
    }
    return items;
  } finally {
    await doc.destroy().catch(() => {});
  }
}
```

- [ ] **Step 5: Implement `lib/templates/extract.ts`**

```ts
// lib/templates/extract.ts — SERVER. Reads every template field from a document.
// Digital PDFs: text layer first (free). Otherwise: crop the region → vision model.
import 'server-only';
import { isPdfBuffer, renderPage } from '@/lib/ocr/rasterize';
import { textInBox } from '@/lib/ocr/region-text';
import { extractPdfTextItems } from './pdf-text';
import { prepareCrop, readCropTable, readCropValue } from './vision';
import { coerceValue } from './coerce';
import type { FieldDef, FieldValue } from './schema';

export type ExtractResult = {
  values: Record<string, FieldValue>;
  model: string | null;
  tokensUsed: number;
  errors: { fieldKey: string; message: string }[];
};

const MIN_TEXT_CHARS = 2;

export async function extractTemplateFields(buffer: Buffer, mimeType: string, fields: FieldDef[]): Promise<ExtractResult> {
  const out: ExtractResult = { values: {}, model: null, tokensUsed: 0, errors: [] };
  const isPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);
  const pageBitmaps = new Map<number, Buffer>();
  const pageText = new Map<number, Awaited<ReturnType<typeof extractPdfTextItems>>>();

  const bitmap = async (page: number) => {
    let b = pageBitmaps.get(page);
    if (!b) { b = await renderPage(buffer, mimeType, page); pageBitmaps.set(page, b); }
    return b;
  };
  const text = async (page: number) => {
    let t = pageText.get(page);
    if (!t) { t = await extractPdfTextItems(buffer, page); pageText.set(page, t); }
    return t;
  };

  for (const f of fields) {
    const base: FieldValue = { raw: null, value: null, confidence: null, source: 'vision', page: f.region?.page ?? null, bbox: f.region?.bbox ?? null, color: f.color };
    if (!f.region) { out.values[f.key] = base; continue; }
    const { page, bbox } = f.region;
    try {
      if (f.kind === 'TABLE') {
        const crop = await prepareCrop(await bitmap(page), bbox);
        const cols = (f.columns ?? []).map((c) => ({ key: c.key, label: c.label }));
        const r = await readCropTable({ crop, columns: cols, operation: 'template.table', hint: f.aiHint });
        out.model = r.model; out.tokensUsed += r.tokensUsed ?? 0;
        const rows = r.rows.map((row) => {
          const o: Record<string, unknown> = {};
          for (const c of f.columns ?? []) o[c.key] = coerceValue(row[c.key], c.valueType);
          return o;
        });
        out.values[f.key] = { ...base, raw: JSON.stringify(r.rows), value: rows, source: 'vision', confidence: null };
        continue;
      }

      if (isPdf) {
        const items = await text(page);
        const [x, y, w, h] = bbox;
        const s = textInBox(items, { x, y, w, h });
        if (s.length >= MIN_TEXT_CHARS) {
          out.values[f.key] = { ...base, raw: s, value: coerceValue(s, f.valueType), source: 'text', confidence: 1 };
          continue;
        }
      }

      const crop = await prepareCrop(await bitmap(page), bbox);
      const prompt = `Read the value of the field "${f.label}"${f.aiHint ? ` (${f.aiHint})` : ''}. Expected type: ${f.valueType.toLowerCase()}.`;
      const r = await readCropValue({ crop, prompt, operation: 'template.field' });
      out.model = r.model; out.tokensUsed += r.tokensUsed ?? 0;
      out.values[f.key] = { ...base, raw: r.value || null, value: coerceValue(r.value, f.valueType), source: 'vision', confidence: r.value ? 0.8 : null };
    } catch (e) {
      out.values[f.key] = base;
      out.errors.push({ fieldKey: f.key, message: (e as Error).message });
    }
  }
  return out;
}
```

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run lib/templates/__tests__/extract.test.ts; rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`
Expected: 4 tests PASS; no tsc output.

- [ ] **Step 7: Commit**

```bash
git add lib/templates/pdf-text.ts lib/templates/extract.ts lib/templates/__tests__/extract.test.ts lib/ocr/rasterize.ts
git commit -m "feat(templates): extraction engine (pdf text layer first, vision crops, tables)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Template CRUD API

**Files:**
- Create: `lib/templates/serialize.ts` (Prisma row → API shape, shared by routes)
- Create: `app/api/admin/ocr/templates/route.ts`
- Create: `app/api/admin/ocr/templates/[id]/route.ts`

- [ ] **Step 1: Create `lib/templates/serialize.ts`**

```ts
// lib/templates/serialize.ts — SERVER. Prisma rows → API/UI shapes (FieldDef etc.) in one place.
import 'server-only';
import type { ExtractionTemplate, TemplateField, TemplateMapping, TemplateCondition } from '@prisma/client';
import type { Action, Clause, ColumnDef, FieldDef, MappingRowExcel, MappingRowInvoice, Region } from './schema';
import { isValidBbox } from './schema';

export function toFieldDef(f: TemplateField): FieldDef {
  const region = f.region as { page?: unknown; bbox?: unknown } | null;
  const ok = region && typeof region.page === 'number' && isValidBbox(region.bbox);
  return {
    key: f.key, label: f.label, kind: f.kind, valueType: f.valueType, color: f.color,
    region: ok ? ({ page: region!.page as number, bbox: region!.bbox } as Region) : null,
    columns: Array.isArray(f.columns) ? (f.columns as ColumnDef[]) : null,
    aiHint: f.aiHint, required: f.required, order: f.order,
  };
}

export function toMappingDto(m: TemplateMapping) {
  return { id: m.id, name: m.name, target: m.target, isDefault: m.isDefault, rows: (m.rows as (MappingRowInvoice | MappingRowExcel)[]) ?? [] };
}

export function toConditionDto(c: TemplateCondition) {
  return { id: c.id, name: c.name, order: c.order, isActive: c.isActive, logic: (c.logic === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR', clauses: (c.clauses as Clause[]) ?? [], actions: (c.actions as Action[]) ?? [] };
}

export function toTemplateDto(t: ExtractionTemplate & { fields: TemplateField[]; mappings: TemplateMapping[]; conditions: TemplateCondition[] }) {
  return {
    id: t.id, name: t.name, vatNumber: t.vatNumber, traderTrdr: t.traderTrdr, supplierName: t.supplierName,
    docType: t.docType, mode: t.mode, status: t.status, version: t.version,
    sample: t.sampleStorageKey ? { mimeType: t.sampleMimeType, pageCount: t.samplePageCount ?? 1, thumbUrl: t.sampleThumbUrl } : null,
    notifyEmails: t.notifyEmails, timesUsed: t.timesUsed, createdAt: t.createdAt, updatedAt: t.updatedAt,
    fields: [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef),
    mappings: t.mappings.map(toMappingDto),
    conditions: [...t.conditions].sort((a, b) => a.order - b.order).map(toConditionDto),
  };
}
export type TemplateDto = ReturnType<typeof toTemplateDto>;

export const TEMPLATE_INCLUDE = { fields: true, mappings: true, conditions: true } as const;
```

- [ ] **Step 2: Create `app/api/admin/ocr/templates/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — λίστα προτύπων (για τη σελίδα /admin/ocr/templates)
export async function GET() {
  await requirePermission('ocr.read');
  const rows = await prisma.extractionTemplate.findMany({
    orderBy: [{ supplierName: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { fields: true, runs: true } } },
  });
  return NextResponse.json({
    templates: rows.map((t) => ({
      id: t.id, name: t.name, vatNumber: t.vatNumber, supplierName: t.supplierName, docType: t.docType,
      mode: t.mode, status: t.status, version: t.version, fieldsCount: t._count.fields, runsCount: t._count.runs,
      timesUsed: t.timesUsed, hasSample: !!t.sampleStorageKey, updatedAt: t.updatedAt,
    })),
  });
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  vatNumber: z.string().trim().regex(/^\d{9}$/, 'ΑΦΜ 9 ψηφίων'),
  traderTrdr: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
  docType: z.enum(['INVOICE', 'RECEIPT']).default('INVOICE'),
});

// POST — νέο πρότυπο (DRAFT)
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const exists = await prisma.extractionTemplate.findUnique({ where: { vatNumber_docType_name: { vatNumber: b.vatNumber, docType: b.docType, name: b.name } } });
  if (exists) return NextResponse.json({ error: 'duplicate', message: 'Υπάρχει ήδη πρότυπο με αυτό το όνομα για τον προμηθευτή' }, { status: 409 });

  const t = await prisma.extractionTemplate.create({
    data: { name: b.name, vatNumber: b.vatNumber, traderTrdr: b.traderTrdr ?? null, supplierName: b.supplierName ?? null, docType: b.docType, createdById: u.id },
  });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.create', resource: 'extractionTemplate', resourceId: t.id, metadata: { name: t.name, vatNumber: t.vatNumber } });
  return NextResponse.json({ ok: true, id: t.id }, { status: 201 });
}
```

- [ ] **Step 3: Create `app/api/admin/ocr/templates/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { bunnyDelete } from '@/lib/bunny';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(toTemplateDto(t));
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(['AUTO', 'SEMI_AUTO', 'MANUAL']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  notifyEmails: z.string().trim().max(500).nullable().optional(),
  traderTrdr: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // AUTO mode needs the posting right; ACTIVE needs ≥1 field with a region and ≥1 mapping.
  const mode = b.mode ?? t.mode;
  if (mode === 'AUTO' && u.role.key !== 'SUPER_ADMIN' && !u.permissionKeys.has('ocr.post')) {
    return NextResponse.json({ error: 'forbidden', message: 'Η αυτόματη λειτουργία απαιτεί δικαίωμα ανάρτησης (ocr.post)' }, { status: 403 });
  }
  if (b.status === 'ACTIVE') {
    const hasRegion = t.fields.some((f) => f.region != null);
    if (!hasRegion || t.mappings.length === 0 || !t.sampleStorageKey) {
      return NextResponse.json({ error: 'not_ready', message: 'Για ενεργοποίηση χρειάζονται δείγμα, ένα πεδίο με περιοχή και ένα mapping' }, { status: 422 });
    }
  }

  const updated = await prisma.extractionTemplate.update({
    where: { id },
    data: {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.mode !== undefined && { mode: b.mode }),
      ...(b.status !== undefined && { status: b.status }),
      ...(b.notifyEmails !== undefined && { notifyEmails: b.notifyEmails }),
      ...(b.traderTrdr !== undefined && { traderTrdr: b.traderTrdr }),
      ...(b.supplierName !== undefined && { supplierName: b.supplierName }),
      version: { increment: 1 },
    },
    include: TEMPLATE_INCLUDE,
  });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.update', resource: 'extractionTemplate', resourceId: id, metadata: b });
  return NextResponse.json(toTemplateDto(updated));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.extractionTemplate.delete({ where: { id } });
  if (t.sampleStorageKey) await bunnyDelete([t.sampleStorageKey]).catch(() => null);
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.delete', resource: 'extractionTemplate', resourceId: id, metadata: { name: t.name } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Type-check**

Run: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`
Expected: no output. If `u.permissionKeys` / `u.role.key` are not on the `requirePermission` return type, open `lib/rbac.ts::requireUser` and use the exact property names it returns (they are used in `app/admin/layout.tsx` as `user.permissionKeys` and `user.role.key`).

- [ ] **Step 5: Commit**

```bash
git add lib/templates/serialize.ts app/api/admin/ocr/templates/route.ts "app/api/admin/ocr/templates/[id]/route.ts"
git commit -m "feat(templates): template list/create/get/patch/delete API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Sample upload and page image

**Files:**
- Create: `app/api/admin/ocr/templates/[id]/sample/route.ts`
- Create: `app/api/admin/ocr/templates/[id]/page-image/route.ts`

- [ ] **Step 1: Create the sample upload route**

```ts
// app/api/admin/ocr/templates/[id]/sample/route.ts
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate, bunnyDelete } from '@/lib/bunny';
import { countPdfPages, isPdfBuffer } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 25 * 1024 * 1024;

// POST multipart { file } — αποθηκεύει το δείγμα στο private Bunny zone και μετρά σελίδες.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large', message: 'Μέγιστο 25 MB' }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = isPdfBuffer(buffer) ? 'application/pdf' : file.type;
  if (!ALLOWED.has(mimeType)) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });

  const pageCount = mimeType === 'application/pdf' ? await countPdfPages(buffer).catch(() => 1) : 1;
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const key = `templates/${t.vatNumber}/${id}/sample-${nanoid(8)}.${ext}`;
  await bunnyUploadPrivate({ key, body: buffer, contentType: mimeType });

  const old = t.sampleStorageKey;
  await prisma.extractionTemplate.update({
    where: { id },
    data: { sampleStorageKey: key, sampleMimeType: mimeType, samplePageCount: pageCount, sampleThumbUrl: `/api/admin/ocr/templates/${id}/page-image?page=0&scale=2`, version: { increment: 1 } },
  });
  if (old && old !== key) await bunnyDelete([old]).catch(() => null);

  return NextResponse.json({ ok: true, mimeType, pageCount });
}
```

- [ ] **Step 2: Create the page-image route**

```ts
// app/api/admin/ocr/templates/[id]/page-image/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { rasterizeToWebp } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?page=0&scale=3 — rasterized σελίδα του δείγματος (webp), όπως το ocr/[id]/page-image.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const scale = Math.min(5, Math.max(2, Number(url.searchParams.get('scale') ?? 3) || 3));

  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t?.sampleStorageKey) return NextResponse.json({ error: 'no_sample' }, { status: 404 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  try {
    const out = await rasterizeToWebp(buf, t.sampleMimeType ?? 'application/pdf', { page, scale });
    return new NextResponse(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' } });
  } catch (err: any) {
    if (err?.message === 'page out of range') return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    if (err?.message === 'unsupported type') return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
    return NextResponse.json({ error: `render failed: ${err?.message ?? err}` }, { status: 502 });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`
Expected: no output. (`countPdfPages` and `isPdfBuffer` are existing exports of `lib/ocr/rasterize.ts`; `nanoid` is an existing dependency.)

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/ocr/templates/[id]/sample/route.ts" "app/api/admin/ocr/templates/[id]/page-image/route.ts"
git commit -m "feat(templates): sample upload to Bunny + page image route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Fields, mappings, conditions bulk endpoints

**Files:**
- Create: `lib/templates/validate.ts` (zod schemas shared by the three routes; isomorphic so plan 2's forms reuse them)
- Create: `app/api/admin/ocr/templates/[id]/fields/route.ts`
- Create: `app/api/admin/ocr/templates/[id]/mappings/route.ts`
- Create: `app/api/admin/ocr/templates/[id]/conditions/route.ts`
- Test: `lib/templates/__tests__/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/templates/__tests__/validate.test.ts
import { describe, it, expect } from 'vitest';
import { FieldsBody, MappingsBody, ConditionsBody } from '../validate';

describe('FieldsBody', () => {
  it('accepts fields, auto-derives key from label when missing, rejects duplicate keys', () => {
    const ok = FieldsBody.safeParse({ fields: [{ label: 'Αριθμός', color: '#0078D4' }, { key: 'x', label: 'X', color: '#047857', kind: 'TABLE', columns: [{ key: 'c', label: 'C', valueType: 'TEXT' }] }] });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.fields[0].key).toBe('arithmos');
    const dup = FieldsBody.safeParse({ fields: [{ key: 'a', label: 'A', color: '#0078D4' }, { key: 'a', label: 'B', color: '#047857' }] });
    expect(dup.success).toBe(false);
  });
  it('rejects invalid bbox and non-hex colour', () => {
    expect(FieldsBody.safeParse({ fields: [{ key: 'a', label: 'A', color: 'red' }] }).success).toBe(false);
    expect(FieldsBody.safeParse({ fields: [{ key: 'a', label: 'A', color: '#0078D4', region: { page: 0, bbox: [0, 0, 2, 1] } }] }).success).toBe(false);
  });
});

describe('MappingsBody', () => {
  it('validates INVOICE rows against the invoice schema and EXCEL rows shape', () => {
    expect(MappingsBody.safeParse({ mappings: [{ name: 'default', target: 'INVOICE', isDefault: true, rows: [{ fieldKey: 'no', invoiceKey: 'invoiceNumber' }] }] }).success).toBe(true);
    expect(MappingsBody.safeParse({ mappings: [{ name: 'default', target: 'INVOICE', isDefault: true, rows: [{ fieldKey: 'no', invoiceKey: 'bogus' }] }] }).success).toBe(false);
    expect(MappingsBody.safeParse({ mappings: [{ name: 'x', target: 'EXCEL', isDefault: false, rows: [{ fieldKey: 'no', column: 'A', order: 1 }] }] }).success).toBe(true);
  });
  it('requires unique mapping names', () => {
    expect(MappingsBody.safeParse({ mappings: [{ name: 'a', target: 'EXCEL', isDefault: true, rows: [] }, { name: 'a', target: 'EXCEL', isDefault: false, rows: [] }] }).success).toBe(false);
  });
});

describe('ConditionsBody', () => {
  it('validates clauses and typed actions', () => {
    const ok = ConditionsBody.safeParse({ conditions: [{ name: 'R', order: 0, isActive: true, logic: 'AND', clauses: [{ fieldKey: 'total', op: 'gt', value: '1000' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'x' } }, { type: 'SWITCH_MAPPING', params: { mappingName: 'credit' } }] }] });
    expect(ok.success).toBe(true);
    expect(ConditionsBody.safeParse({ conditions: [{ name: 'R', order: 0, isActive: true, logic: 'AND', clauses: [], actions: [{ type: 'NOPE', params: {} }] }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/templates/__tests__/validate.test.ts`
Expected: FAIL — `Cannot find module '../validate'`.

- [ ] **Step 3: Implement `lib/templates/validate.ts`**

```ts
// lib/templates/validate.ts — ISOMORPHIC zod schemas for the bulk endpoints (and plan-2 forms).
import { z } from 'zod';
import { invoiceKeyInfo, isValidBbox, slugKey } from './schema';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Χρώμα hex');
const norm = z.number().min(0).max(1);
const Bbox = z.tuple([norm, norm, norm, norm]).refine(isValidBbox, 'Μη έγκυρη περιοχή');
export const RegionSchema = z.object({ page: z.number().int().min(0), bbox: Bbox });
const ValueType = z.enum(['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'LIST']);
export const ColumnSchema = z.object({ key: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(120), valueType: ValueType.default('TEXT') });

export const FieldSchema = z.object({
  key: z.string().trim().min(1).max(60).optional(),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(['SINGLE', 'TABLE']).default('SINGLE'),
  valueType: ValueType.default('TEXT'),
  color: hex,
  region: RegionSchema.nullable().optional(),
  columns: z.array(ColumnSchema).max(30).nullable().optional(),
  aiHint: z.string().trim().max(1000).nullable().optional(),
  required: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
}).transform((f) => ({ ...f, key: f.key ?? slugKey(f.label), region: f.region ?? null, columns: f.columns ?? null, aiHint: f.aiHint ?? null }));

export const FieldsBody = z.object({ fields: z.array(FieldSchema).max(100) })
  .refine((b) => new Set(b.fields.map((f) => f.key)).size === b.fields.length, { message: 'Διπλό κλειδί πεδίου', path: ['fields'] });

const InvoiceRow = z.object({ fieldKey: z.string().min(1), invoiceKey: z.string().min(1).refine((k) => invoiceKeyInfo(k) != null, 'Άγνωστο πεδίο παραστατικού') });
const ExcelRow = z.object({ fieldKey: z.string().min(1), column: z.string().trim().min(1).max(80), order: z.number().int().min(0) });
export const MappingSchema = z.discriminatedUnion('target', [
  z.object({ name: z.string().trim().min(1).max(60), target: z.literal('INVOICE'), isDefault: z.boolean().default(false), rows: z.array(InvoiceRow).max(200) }),
  z.object({ name: z.string().trim().min(1).max(60), target: z.literal('EXCEL'), isDefault: z.boolean().default(false), rows: z.array(ExcelRow).max(200) }),
]);
export const MappingsBody = z.object({ mappings: z.array(MappingSchema).max(20) })
  .refine((b) => new Set(b.mappings.map((m) => m.name)).size === b.mappings.length, { message: 'Διπλό όνομα mapping', path: ['mappings'] });

const Clause = z.object({ fieldKey: z.string().min(1), op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'empty', 'notEmpty', 'regex', 'in']), value: z.string().max(500).optional() });
const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SET_FIELD'), params: z.object({ fieldKey: z.string().optional(), invoiceKey: z.string().optional(), value: z.string().max(500) }).refine((p) => !!(p.fieldKey || p.invoiceKey), 'Χρειάζεται πεδίο') }),
  z.object({ type: z.literal('FLAG_REVIEW'), params: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  z.object({ type: z.literal('BLOCK_POSTING'), params: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  z.object({ type: z.literal('SWITCH_MAPPING'), params: z.object({ mappingName: z.string().trim().min(1).max(60) }) }),
  z.object({ type: z.literal('NOTIFY'), params: z.object({ emails: z.string().trim().max(500).optional(), subject: z.string().trim().min(1).max(200) }) }),
]);
export const ConditionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  order: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  logic: z.enum(['AND', 'OR']).default('AND'),
  clauses: z.array(Clause).max(20),
  actions: z.array(ActionSchema).max(10),
});
export const ConditionsBody = z.object({ conditions: z.array(ConditionSchema).max(50) });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/templates/__tests__/validate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the three routes**

`app/api/admin/ocr/templates/[id]/fields/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT { fields } — αντικαθιστά το σύνολο των πεδίων (upsert by key, διαγραφή όσων λείπουν).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = FieldsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const keys = parsed.data.fields.map((f) => f.key);
  await prisma.$transaction(async (tx) => {
    await tx.templateField.deleteMany({ where: { templateId: id, key: { notIn: keys } } });
    for (const f of parsed.data.fields) {
      const data = { label: f.label, kind: f.kind, valueType: f.valueType, color: f.color.toUpperCase(), region: f.region ?? undefined, columns: f.columns ?? undefined, aiHint: f.aiHint, required: f.required, order: f.order };
      await tx.templateField.upsert({
        where: { templateId_key: { templateId: id, key: f.key } },
        update: { ...data, region: f.region === null ? null : data.region, columns: f.columns === null ? null : data.columns },
        create: { templateId: id, key: f.key, ...data },
      });
    }
    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  return NextResponse.json(toTemplateDto(full));
}
```

`app/api/admin/ocr/templates/[id]/mappings/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { MappingsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT { mappings } — αντικαθιστά όλα τα mappings. Ακριβώς ένα isDefault=true (το πρώτο αν κανένα).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = MappingsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true, kind: true, columns: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Every row must reference an existing field key (or `<tableKey>.<columnKey>` for TABLE fields).
  const valid = new Set<string>();
  for (const f of t.fields) {
    valid.add(f.key);
    for (const c of (Array.isArray(f.columns) ? (f.columns as { key: string }[]) : [])) valid.add(`${f.key}.${c.key}`);
  }
  const bad = parsed.data.mappings.flatMap((m) => m.rows.map((r) => r.fieldKey)).filter((k) => !valid.has(k));
  if (bad.length) return NextResponse.json({ error: 'unknown_field', message: `Άγνωστα πεδία: ${bad.join(', ')}` }, { status: 422 });

  let seenDefault = false;
  const mappings = parsed.data.mappings.map((m, i) => {
    const isDefault = m.isDefault && !seenDefault ? true : false;
    if (isDefault) seenDefault = true;
    return { ...m, isDefault: isDefault || (i === parsed.data.mappings.length - 1 && !seenDefault && !parsed.data.mappings.some((x) => x.isDefault)) };
  });
  if (mappings.length && !mappings.some((m) => m.isDefault)) mappings[0].isDefault = true;

  await prisma.$transaction(async (tx) => {
    await tx.templateMapping.deleteMany({ where: { templateId: id } });
    for (const m of mappings) await tx.templateMapping.create({ data: { templateId: id, name: m.name, target: m.target, isDefault: m.isDefault, rows: m.rows } });
    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  return NextResponse.json(toTemplateDto(full));
}
```

`app/api/admin/ocr/templates/[id]/conditions/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { ConditionsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT { conditions } — αντικαθιστά όλους τους κανόνες (κρατά τα ids που δίνονται ώστε να μείνουν σταθερά για το διάγραμμα).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = ConditionsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true } }, mappings: { select: { name: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const fieldKeys = new Set(t.fields.map((f) => f.key));
  const mappingNames = new Set(t.mappings.map((m) => m.name));
  for (const c of parsed.data.conditions) {
    for (const cl of c.clauses) if (!cl.fieldKey.startsWith('$') && !fieldKeys.has(cl.fieldKey)) return NextResponse.json({ error: 'unknown_field', message: `Άγνωστο πεδίο στη ρήτρα: ${cl.fieldKey}` }, { status: 422 });
    for (const a of c.actions) if (a.type === 'SWITCH_MAPPING' && !mappingNames.has(a.params.mappingName)) return NextResponse.json({ error: 'unknown_mapping', message: `Άγνωστο mapping: ${a.params.mappingName}` }, { status: 422 });
  }

  const keepIds = parsed.data.conditions.map((c) => c.id).filter((x): x is string => !!x);
  await prisma.$transaction(async (tx) => {
    await tx.templateCondition.deleteMany({ where: { templateId: id, id: { notIn: keepIds } } });
    for (const c of parsed.data.conditions) {
      const data = { name: c.name, order: c.order, isActive: c.isActive, logic: c.logic, clauses: c.clauses, actions: c.actions };
      if (c.id) await tx.templateCondition.upsert({ where: { id: c.id }, update: data, create: { id: c.id, templateId: id, ...data } });
      else await tx.templateCondition.create({ data: { templateId: id, ...data } });
    }
    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  return NextResponse.json(toTemplateDto(full));
}
```

- [ ] **Step 6: Type-check**

Run: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`
Expected: no output. If Prisma complains about `Json` typing on `region`/`columns`/`rows`/`clauses`/`actions`, cast the value with `as Prisma.InputJsonValue` (import `Prisma` from `@prisma/client`).

- [ ] **Step 7: Commit**

```bash
git add lib/templates/validate.ts lib/templates/__tests__/validate.test.ts "app/api/admin/ocr/templates/[id]/fields/route.ts" "app/api/admin/ocr/templates/[id]/mappings/route.ts" "app/api/admin/ocr/templates/[id]/conditions/route.ts"
git commit -m "feat(templates): bulk fields/mappings/conditions endpoints with validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Test-field endpoint (live read from the sample)

**Files:**
- Create: `app/api/admin/ocr/templates/[id]/test-field/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/admin/ocr/templates/[id]/test-field/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { extractTemplateFields } from '@/lib/templates/extract';
import { toFieldDef } from '@/lib/templates/serialize';
import { RegionSchema } from '@/lib/templates/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  fieldKey: z.string().min(1),
  /** Optional unsaved region from the designer, so the user can test before saving. */
  region: RegionSchema.optional(),
});

// POST { fieldKey, region? } → { raw, value, source, model, tokensUsed, color }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: true } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  const row = t.fields.find((f) => f.key === parsed.data.fieldKey);
  if (!row) return NextResponse.json({ error: 'unknown_field' }, { status: 404 });

  const field = toFieldDef(row);
  if (parsed.data.region) field.region = parsed.data.region;
  if (!field.region) return NextResponse.json({ error: 'no_region', message: 'Το πεδίο δεν έχει περιοχή' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  const r = await extractTemplateFields(buf, t.sampleMimeType ?? 'application/pdf', [field]);
  const v = r.values[field.key];
  if (r.errors.length) return NextResponse.json({ error: 'read_failed', message: r.errors[0].message }, { status: 502 });
  return NextResponse.json({ raw: v.raw, value: v.value, source: v.source, model: r.model, tokensUsed: r.tokensUsed, color: v.color, durationMs: Date.now() - started });
}
```

- [ ] **Step 2: Type-check and run the full suite**

Run: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"; npx vitest run`
Expected: no tsc output; all tests PASS.

- [ ] **Step 3: Manual smoke test through the running app**

With the dev server up (`.claude/launch.json` → `dev`) and a logged-in admin session in the browser pane, run in the browser console (the session cookie is sent automatically):

```js
const t = await (await fetch('/api/admin/ocr/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Δοκιμή', vatNumber: '123456789', supplierName: 'TEST', docType: 'INVOICE' }) })).json();
console.log(t); // { ok: true, id: '…' }
const fd = new FormData(); fd.append('file', await (await fetch('/wiki/screenshots/ocr/list.png')).blob(), 'sample.png');
console.log(await (await fetch(`/api/admin/ocr/templates/${t.id}/sample`, { method: 'POST', body: fd })).json()); // { ok:true, mimeType:'image/png', pageCount:1 }
console.log(await (await fetch(`/api/admin/ocr/templates/${t.id}/fields`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: [{ label: 'Τίτλος', color: '#0078D4', region: { page: 0, bbox: [0.05, 0.02, 0.5, 0.08] } }] }) })).json());
console.log(await (await fetch(`/api/admin/ocr/templates/${t.id}/test-field`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldKey: 'titlos' }) })).json()); // { raw:'…', value:'…', source:'vision', model:'gemini-…' }
console.log(await (await fetch(`/api/admin/ocr/templates/${t.id}`, { method: 'DELETE' })).json()); // { ok:true }
```

Expected: each call returns the shape shown in the comment; the test-field value is the text visible in the top strip of the screenshot. If `/wiki/screenshots/ocr/list.png` does not exist, use any PNG from `public/wiki/screenshots/`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/ocr/templates/[id]/test-field/route.ts"
git commit -m "feat(templates): test-field endpoint reads one region from the sample

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Wiki note and changelog for the foundations

**Files:**
- Modify: `docs/manual/CHANGELOG.md` (prepend an entry)

- [ ] **Step 1: Add a changelog entry**

Prepend to `docs/manual/CHANGELOG.md`:

```markdown
## 2026-09-10 — Πρότυπα εξαγωγής προμηθευτή (θεμέλια)

- Νέα μοντέλα `ExtractionTemplate`, `TemplateField`, `TemplateMapping`, `TemplateCondition`, `TemplateRun`.
- Καθαρή λογική σε `lib/templates/*`: σχήμα/παλέτα χρωμάτων, coercion, conditions, mapping, διάγραμμα ροής.
- Μηχανή εξαγωγής: text layer για ψηφιακά PDF, crop + vision για σαρωμένα, πίνακες.
- API `/api/admin/ocr/templates/**` (CRUD, δείγμα, εικόνα σελίδας, πεδία, mappings, conditions, δοκιμή πεδίου).
- Το `read-region` του OCR χρησιμοποιεί πλέον τον κοινό vision reader (ίδια συμπεριφορά).
- UI designer και ενσωμάτωση στο pipeline ακολουθούν (plans 2 και 3).
```

- [ ] **Step 2: Commit**

```bash
git add docs/manual/CHANGELOG.md
git commit -m "docs: changelog for extraction template foundations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

**Spec coverage for this plan's scope:** §1 data model → Task 1. §2 `schema.ts`, `coerce.ts`, `conditions.ts`, `mapping.ts`, `flow.ts`, `extract.ts` → Tasks 2–8. §2 API routes for templates (list/create/get/patch/delete/sample/page-image/fields/test-field/mappings/conditions) → Tasks 9–12. §4 condition semantics (typed comparison, empty semantics, all-match, SWITCH_MAPPING last wins, `$` extras) → Task 4. §6 permissions (`ocr.categorize`, AUTO needs `ocr.post`) → Task 9. Colour palette + per-field colour stored → Tasks 2, 11. Not in this plan by design: designer UI and React Flow rendering (plan 2); `run.ts`, upload hook, run-result view, Excel routes, notify, field-rules migration and cleanup (plan 3).

**Type consistency:** `FieldDef`/`FieldValue`/`Region`/`Bbox` defined in Task 2 and used unchanged in Tasks 4–8, 11, 12. `RuleDef`/`EvalContext` (Task 4) match the `ConditionSchema` shape (Task 11) plus `id`. `readCropValue`/`readCropTable`/`prepareCrop` (Task 7) used with the same signatures in Task 8. `renderPage` added in Task 8 Step 3 before use. `toFieldDef`/`TEMPLATE_INCLUDE`/`toTemplateDto` (Task 9) reused in Tasks 11–12.

**Placeholders:** none. Every code step shows complete code; every command shows expected output.
