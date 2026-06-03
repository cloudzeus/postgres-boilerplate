# Supplier Custom Field Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user define a custom extra field to extract from a supplier's documents (from the OCR row actions menu), have it auto-extracted on every future upload from that supplier, and manage all such rules on a dedicated page.

**Architecture:** A new `SupplierFieldRule` Prisma model keyed by issuer ΑΦΜ + docType. Extraction runs a best-effort **second targeted pass** (after the ΑΦΜ is resolved, mirroring `applySupplierTemplate`) that asks the vision/text model only for the active custom fields and stores values in `extractedData.customFields = { [key]: value }`. UI: a dialog from the row actions dropdown (optional 🎯 region hint), a read-only "Ειδικά πεδία" display block, and a management list page.

**Tech Stack:** Next.js 16 (App Router, RSC), Prisma 7 + Postgres, vitest, Tailwind + DG/shadcn tokens, existing OCR helpers in `lib/ocr/*`.

**Spec:** `docs/superpowers/specs/2026-06-03-supplier-custom-field-rules-design.md`

---

## File Structure

- Create `lib/ocr/field-rules.ts` — pure helpers (`slugifyFieldKey`, `buildCustomFieldsPrompt`, `mergeCustomFields`) + DB accessor (`findActiveFieldRules`, `upsertFieldRule`).
- Create `lib/ocr/__tests__/field-rules.test.ts` — unit tests for the pure helpers.
- Modify `prisma/schema.prisma` — add `SupplierFieldRule` model.
- Modify `lib/ocr/extract.ts` — add `applyCustomFieldRules` pass; wire into `extractDocument`.
- Create `app/api/admin/ocr/[id]/field-rules/route.ts` — POST (create + apply to current doc).
- Create `app/api/admin/ocr/field-rules/route.ts` — GET (list).
- Create `app/api/admin/ocr/field-rules/[ruleId]/route.ts` — PATCH + DELETE.
- Create `components/admin/supplier-field-rule-dialog.tsx` — the create dialog.
- Modify `app/admin/ocr/ocr-table.tsx` — add "Νέο ειδικό πεδίο…" menu item + dialog state.
- Modify `app/admin/ocr/row-detail.tsx` — add "Ειδικά πεδία" display block.
- Modify `app/admin/ocr/[id]/result-view.tsx` — add "Ειδικά πεδία" display block.
- Create `app/admin/ocr/field-rules/page.tsx` + `app/admin/ocr/field-rules/field-rules-client.tsx` — list page.
- Create `docs/wiki/ocr/field-rules.mdx` — wiki entry.

---

## Task 1: Prisma model `SupplierFieldRule`

**Files:**
- Modify: `prisma/schema.prisma` (after the `SupplierTemplate` model, ~line 1325)

- [ ] **Step 1: Add the model**

Insert immediately after the closing `}` of `model SupplierTemplate { … }`:

```prisma
model SupplierFieldRule {
  id           String     @id @default(cuid())
  vatNumber    String                 // issuer ΑΦΜ (normalized, 9 digits)
  docType      OcrDocType             // INVOICE | RECEIPT (never GENERAL_TEXT)
  key          String                 // stable machine key (slug) → extractedData.customFields[key]
  label        String                 // user-facing field name, e.g. "Αριθμός Παραγγελίας"
  description  String?    @db.Text     // instruction to the AI (what / where to look)
  regionHint   Json?                  // optional { page, bbox:[x,y,w,h] } from the 🎯 marker
  isActive     Boolean    @default(true)
  supplierName String?                // denormalized for the list page
  timesUsed    Int        @default(0)
  createdById  String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@unique([vatNumber, docType, key])
  @@index([vatNumber, docType])
}
```

- [ ] **Step 2: Push schema + regenerate client** (this project's workflow — `migrate dev` is broken)

Run:
```bash
npx prisma db push && npx prisma generate
```
Expected: "Your database is now in sync with your Prisma schema." and "Generated Prisma Client".

- [ ] **Step 3: Create a manual migration record + resolve** (keeps migration history consistent)

Run:
```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_supplier_field_rule
```
Then write the SQL to a `migration.sql` in that folder (use the exact folder name created above):
```sql
CREATE TABLE "SupplierFieldRule" (
  "id" TEXT NOT NULL,
  "vatNumber" TEXT NOT NULL,
  "docType" "OcrDocType" NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "regionHint" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "supplierName" TEXT,
  "timesUsed" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierFieldRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierFieldRule_vatNumber_docType_key_key" ON "SupplierFieldRule"("vatNumber", "docType", "key");
CREATE INDEX "SupplierFieldRule_vatNumber_docType_idx" ON "SupplierFieldRule"("vatNumber", "docType");
```
Then mark it applied:
```bash
npx prisma migrate resolve --applied $(ls -dt prisma/migrations/*_supplier_field_rule | head -1 | xargs basename)
```
Expected: "Migration … marked as applied."

- [ ] **Step 4: Verify the client has the model**

Run:
```bash
node -e "const{PrismaClient}=require('@prisma/client');console.log(typeof new PrismaClient().supplierFieldRule)"
```
Expected: `object`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(ocr): SupplierFieldRule model (per-supplier custom extract fields)"
```

---

## Task 2: Pure helpers + unit tests — `lib/ocr/field-rules.ts`

**Files:**
- Create: `lib/ocr/field-rules.ts`
- Test: `lib/ocr/__tests__/field-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/ocr/__tests__/field-rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { slugifyFieldKey, buildCustomFieldsPrompt, mergeCustomFields } from '../field-rules';

describe('slugifyFieldKey', () => {
  it('transliterates a Greek label to an ascii slug', () => {
    expect(slugifyFieldKey('Αριθμός Παραγγελίας')).toBe('arithmos_paraggelias');
  });
  it('collapses punctuation/spaces to single underscores', () => {
    expect(slugifyFieldKey('  Κωδικός  Σύμβασης / 2026 ')).toBe('kodikos_symvasis_2026');
  });
  it('keeps an already-ascii label', () => {
    expect(slugifyFieldKey('PO Number')).toBe('po_number');
  });
  it('falls back to a deterministic hash when nothing is transliterable', () => {
    const a = slugifyFieldKey('★★★');
    const b = slugifyFieldKey('★★★');
    expect(a).toBe(b);
    expect(a.startsWith('field_')).toBe(true);
  });
});

describe('buildCustomFieldsPrompt', () => {
  it('lists every active field key + description', () => {
    const p = buildCustomFieldsPrompt([
      { key: 'po', label: 'Αρ. Παραγγελίας', description: 'πάνω δεξιά' } as any,
    ]);
    expect(p).toContain('"po"');
    expect(p).toContain('Αρ. Παραγγελίας');
    expect(p).toContain('πάνω δεξιά');
    expect(p.toLowerCase()).toContain('json');
  });
});

describe('mergeCustomFields', () => {
  it('writes found values and normalizes empty → null, ignoring unknown keys', () => {
    const data: any = { vatNumber: '999863881' };
    const rules = [{ key: 'po' }, { key: 'contract' }] as any;
    const out = mergeCustomFields(data, { po: 'PO-1', contract: '', extra: 'x' }, rules);
    expect(out.customFields).toEqual({ po: 'PO-1', contract: null });
  });
  it('preserves previously stored custom fields not in this pass', () => {
    const data: any = { customFields: { old: 'keep' } };
    const out = mergeCustomFields(data, { po: 'PO-2' }, [{ key: 'po' }] as any);
    expect(out.customFields).toEqual({ old: 'keep', po: 'PO-2' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ocr/__tests__/field-rules.test.ts`
Expected: FAIL — "Failed to resolve import '../field-rules'".

- [ ] **Step 3: Implement the helpers**

Create `lib/ocr/field-rules.ts`:
```ts
import type { DocType } from '@/lib/ocr/templates';

export type FieldRuleLite = {
  key: string;
  label: string;
  description?: string | null;
  regionHint?: unknown;
};

const GREEK_MAP: Record<string, string> = {
  α:'a',ά:'a',β:'v',γ:'g',δ:'d',ε:'e',έ:'e',ζ:'z',η:'i',ή:'i',θ:'th',ι:'i',ί:'i',ϊ:'i',ΐ:'i',
  κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',ό:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',ύ:'y',ϋ:'y',ΰ:'y',
  φ:'f',χ:'ch',ψ:'ps',ω:'o',ώ:'o',
};

/** Stable, readable machine key for a custom field label. */
export function slugifyFieldKey(label: string): string {
  const lower = String(label ?? '').trim().toLowerCase();
  let out = '';
  for (const ch of lower) out += GREEK_MAP[ch] ?? ch;
  out = out.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!out) {
    let h = 5381;
    for (let i = 0; i < lower.length; i++) h = ((h << 5) + h + lower.charCodeAt(i)) >>> 0;
    out = `field_${h.toString(36)}`;
  }
  return out.slice(0, 60);
}

/** Focused system prompt for the targeted custom-fields pass. */
export function buildCustomFieldsPrompt(rules: FieldRuleLite[]): string {
  const fields = rules.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description ?? null,
  }));
  return [
    'You are a precise field extractor for a Greek financial document.',
    'Extract ONLY the fields listed below. Respond with a single raw JSON object',
    'mapping each field KEY to the value found on the document, or null if absent.',
    'Do not wrap in markdown fences. Do not add extra keys or commentary.',
    '',
    'Fields:',
    JSON.stringify(fields, null, 2),
    '',
    'Output shape:',
    `{ ${rules.map((r) => `"${r.key}": "value or null"`).join(', ')} }`,
  ].join('\n');
}

/** Merge a parsed targeted-pass result into data.customFields (in place). */
export function mergeCustomFields<T extends Record<string, any>>(
  data: T, parsed: Record<string, unknown> | null | undefined, rules: { key: string }[],
): T {
  const cf: Record<string, unknown> = { ...((data as any).customFields ?? {}) };
  for (const r of rules) {
    const v = parsed?.[r.key];
    cf[r.key] = v == null || v === '' ? null : v;
  }
  (data as any).customFields = cf;
  return data;
}

const docTypeToEnum: Record<DocType, 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT'> = {
  invoice: 'INVOICE', receipt: 'RECEIPT', general_text: 'GENERAL_TEXT',
};

/** Active custom-field rules for a normalized ΑΦΜ + docType. Empty for general_text. */
export async function findActiveFieldRules(vatNumber: string, docType: DocType) {
  const afm = String(vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm) || docType === 'general_text') return [];
  const { prisma } = await import('@/lib/db');
  return prisma.supplierFieldRule.findMany({
    where: { vatNumber: afm, docType: docTypeToEnum[docType], isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Upsert a rule by (ΑΦΜ, docType, key). Used by the create route. */
export async function upsertFieldRule(args: {
  vatNumber: string; docType: DocType; key: string; label: string;
  description?: string | null; regionHint?: unknown; supplierName?: string | null;
  createdById?: string | null;
}) {
  const { prisma } = await import('@/lib/db');
  const afm = String(args.vatNumber ?? '').replace(/\D+/g, '');
  const enumType = docTypeToEnum[args.docType];
  return prisma.supplierFieldRule.upsert({
    where: { vatNumber_docType_key: { vatNumber: afm, docType: enumType, key: args.key } },
    create: {
      vatNumber: afm, docType: enumType, key: args.key, label: args.label,
      description: args.description ?? null, regionHint: (args.regionHint ?? null) as any,
      supplierName: args.supplierName ?? null, createdById: args.createdById ?? null,
    },
    update: {
      label: args.label, description: args.description ?? null,
      regionHint: (args.regionHint ?? null) as any, supplierName: args.supplierName ?? null,
      isActive: true,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ocr/__tests__/field-rules.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add lib/ocr/field-rules.ts lib/ocr/__tests__/field-rules.test.ts
git commit -m "feat(ocr): field-rules helpers (slug, prompt, merge, db accessors)"
```
Expected: tsc clean.

---

## Task 3: Extraction integration — targeted pass in `extract.ts`

**Files:**
- Modify: `lib/ocr/extract.ts` (imports near top; new function before `extractDocument`; call inside `extractDocument`)

- [ ] **Step 1: Add imports**

At the top of `lib/ocr/extract.ts`, after the existing `templates-store` import line, add:
```ts
import { findActiveFieldRules, buildCustomFieldsPrompt, mergeCustomFields } from '@/lib/ocr/field-rules';
```

- [ ] **Step 2: Add the targeted pass function**

Insert immediately ABOVE `export async function extractDocument`:
```ts
/**
 * After the standard extraction has resolved the issuer ΑΦΜ, run ONE targeted
 * pass asking only for this supplier's active custom-field rules and store the
 * values under data.customFields. Best-effort: never throws, costs nothing when
 * the supplier has no active rules. Uses the default vision model.
 */
async function applyCustomFieldRules(input: ExtractInput, base: ExtractResult): Promise<ExtractResult> {
  try {
    const data = base.data;
    if (!data) return base;
    const docTypeForRules = input.docType === 'general_text' ? 'general_text' : input.docType;
    const rules = await findActiveFieldRules(String(data.vatNumber ?? ''), docTypeForRules);
    if (rules.length === 0) return base;

    const cfg = await resolveCfg();
    const system = buildCustomFieldsPrompt(rules.map((r) => ({
      key: r.key, label: r.label, description: r.description, regionHint: r.regionHint,
    })));

    let parsed: Record<string, unknown> | null = null;
    if (input.mimeType === 'application/pdf'
        && cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
      const out = await callGeminiPdfNative(cfg, system, input.buffer);
      parsed = parseJsonLoose(out.content);
    } else if (input.mimeType.startsWith('image/')) {
      const enhanced = await enhanceForOcr(input.buffer);
      const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType);
      parsed = parseJsonLoose(out.content);
    } else if (base.rawText) {
      const out = await callTextLLM(cfg, system,
        `Here is the digital text payload extracted from the document:\n\n${base.rawText}`);
      parsed = parseJsonLoose(out.content);
    }

    if (parsed) {
      mergeCustomFields(data, parsed, rules);
      const { prisma } = await import('@/lib/db');
      await prisma.supplierFieldRule.updateMany({
        where: { id: { in: rules.map((r) => r.id) } },
        data: { timesUsed: { increment: 1 } },
      }).catch(() => null);
    }
    return { ...base, data };
  } catch {
    return base; // best-effort
  }
}
```

- [ ] **Step 3: Wire it into `extractDocument`**

Replace the body of `extractDocument` with:
```ts
export async function extractDocument(input: ExtractInput): Promise<ExtractResult> {
  const base = await extractDocumentRaw(input);
  const withTemplate = await applySupplierTemplate(input, base);
  // Strip country prefixes (EL999863881 → 999863881) so the stored ΑΦΜ is what
  // AADE / SoftOne searches expect — everything downstream reads this value.
  if (withTemplate.data) normalizeAfmFields(withTemplate.data);
  // Supplier-specific custom fields (best-effort, after ΑΦΜ is resolved+normalized).
  return applyCustomFieldRules(input, withTemplate);
}
```

- [ ] **Step 4: Typecheck + run OCR tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run lib/ocr`
Expected: tsc clean; all OCR tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/extract.ts
git commit -m "feat(ocr): apply supplier custom-field rules as a targeted extraction pass"
```

---

## Task 4: Create + apply route — `POST /api/admin/ocr/[id]/field-rules`

**Files:**
- Create: `app/api/admin/ocr/[id]/field-rules/route.ts`

- [ ] **Step 1: Implement the route**

Create `app/api/admin/ocr/[id]/field-rules/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeAfm } from '@/lib/ocr/validate';
import { slugifyFieldKey, upsertFieldRule } from '@/lib/ocr/field-rules';
import { extractDocument } from '@/lib/ocr/extract';
import { bunnyDownload } from '@/lib/bunny';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const norm = z.number().min(0).max(1);
const Body = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  regionHint: z.object({ page: z.number().int().min(0), bbox: z.tuple([norm, norm, norm, norm]) }).optional(),
});

const docEnumToType = { INVOICE: 'invoice', RECEIPT: 'receipt', GENERAL_TEXT: 'general_text' } as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('ocr.categorize');
  const { id } = await params;
  const body = Body.parse(await req.json());

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.docType === 'GENERAL_TEXT') {
    return NextResponse.json({ error: 'Τα ειδικά πεδία υποστηρίζονται μόνο σε τιμολόγια/αποδείξεις.' }, { status: 422 });
  }

  const data = (doc.extractedData ?? {}) as any;
  const afm = normalizeAfm(data?.vatNumber);
  if (!afm || !/^\d{9}$/.test(afm)) {
    return NextResponse.json({ error: 'Δεν υπάρχει έγκυρο ΑΦΜ εκδότη για να οριστεί κανόνας.' }, { status: 422 });
  }

  const docType = docEnumToType[doc.docType];
  const key = slugifyFieldKey(body.label);

  const rule = await upsertFieldRule({
    vatNumber: afm, docType, key, label: body.label,
    description: body.description ?? null, regionHint: body.regionHint ?? null,
    supplierName: data?.companyName ?? data?.storeName ?? null, createdById: user.id,
  });

  // Immediately apply to THIS document so the user sees the value now.
  let value: unknown = null;
  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const result = await extractDocument({
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer),
      mimeType: doc.mimeType,
      docType,
      language: (doc.language as any) ?? 'el',
      pdfSource: doc.mimeType === 'application/pdf' ? 'auto' : undefined,
    });
    value = (result.data?.customFields ?? {})[key] ?? null;
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { extractedData: result.data } });
  } catch {
    // Rule is saved; immediate apply is best-effort.
  }

  return NextResponse.json({ ok: true, rule: { id: rule.id, key: rule.key, label: rule.label }, value });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/ocr/[id]/field-rules/route.ts"
git commit -m "feat(ocr): POST field-rules — create rule + apply to current doc"
```

---

## Task 5: List/manage routes — `field-rules` GET + `[ruleId]` PATCH/DELETE

**Files:**
- Create: `app/api/admin/ocr/field-rules/route.ts`
- Create: `app/api/admin/ocr/field-rules/[ruleId]/route.ts`

- [ ] **Step 1: Implement the list route**

Create `app/api/admin/ocr/field-rules/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('ocr.read');
  const rules = await prisma.supplierFieldRule.findMany({
    orderBy: [{ supplierName: 'asc' }, { vatNumber: 'asc' }, { docType: 'asc' }, { label: 'asc' }],
  });
  return NextResponse.json({ data: rules });
}
```

- [ ] **Step 2: Implement PATCH + DELETE**

Create `app/api/admin/ocr/field-rules/[ruleId]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const norm = z.number().min(0).max(1);
const Patch = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  regionHint: z.object({ page: z.number().int().min(0), bbox: z.tuple([norm, norm, norm, norm]) }).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  await requirePermission('ocr.categorize');
  const { ruleId } = await params;
  const body = Patch.parse(await req.json());
  // key is immutable (keeps already-stored values linked) — never updated here.
  const rule = await prisma.supplierFieldRule.update({
    where: { id: ruleId },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.regionHint !== undefined ? { regionHint: (body.regionHint ?? null) as any } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });
  return NextResponse.json({ ok: true, rule });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  await requirePermission('ocr.categorize');
  const { ruleId } = await params;
  await prisma.supplierFieldRule.delete({ where: { id: ruleId } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add "app/api/admin/ocr/field-rules/route.ts" "app/api/admin/ocr/field-rules/[ruleId]/route.ts"
git commit -m "feat(ocr): field-rules list + PATCH/DELETE routes"
```

---

## Task 6: Create dialog — `SupplierFieldRuleDialog`

**Files:**
- Create: `components/admin/supplier-field-rule-dialog.tsx`

Reuses the marquee hook `app/admin/ocr/[id]/use-marquee.ts` (exports `useMarquee`, `NormBox`) for the optional region hint, and renders the doc preview the same way `field-correction.tsx` does (img for images, iframe for PDFs).

- [ ] **Step 1: Implement the dialog**

Create `components/admin/supplier-field-rule-dialog.tsx`:
```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMarquee, type NormBox } from '@/app/admin/ocr/[id]/use-marquee';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  docId: string | null;
  mimeType: string | null;
  supplierName?: string | null;
  vatNumber?: string | null;
};

export function SupplierFieldRuleDialog({ open, onOpenChange, docId, mimeType, supplierName, vatNumber }: Props) {
  const router = useRouter();
  const [label, setLabel] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [region, setRegion] = React.useState<{ page: number; bbox: [number, number, number, number] } | null>(null);
  const [marking, setMarking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [foundValue, setFoundValue] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setLabel(''); setDescription(''); setRegion(null); setMarking(false); setFoundValue(null); }
  }, [open, docId]);

  const onMarqueeComplete = React.useCallback((box: NormBox) => {
    setRegion({ page: 0, bbox: [box.x, box.y, box.w, box.h] });
    setMarking(false);
  }, []);
  const { ref, box, active, handlers } = useMarquee(onMarqueeComplete);

  const fileUrl = docId ? `/api/admin/ocr/${docId}/file` : '';
  const isPdf = mimeType === 'application/pdf';

  async function submit() {
    if (!docId || !label.trim()) { toast.error('Δώσε όνομα πεδίου.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/field-rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), description: description.trim() || undefined, regionHint: region ?? undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setFoundValue(json.value != null ? String(json.value) : '—');
      toast.success('Ο κανόνας αποθηκεύτηκε.');
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Νέο ειδικό πεδίο{supplierName ? ` — ${supplierName}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Όνομα πεδίου</span>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="π.χ. Αριθμός Παραγγελίας" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Οδηγία (πού/τι να ψάξει)</span>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="π.χ. Ο αριθμός παραγγελίας, συνήθως πάνω δεξιά κάτω από τον τίτλο."
                className="rounded-md border border-input bg-background p-2 text-[12px]"
              />
            </label>
            <button
              type="button" onClick={() => setMarking((m) => !m)}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-[12px] font-semibold hover:bg-muted"
            >
              🎯 {region ? 'Περιοχή ορίστηκε — ξανά' : marking ? 'Σύρε πλαίσιο στο έγγραφο…' : 'Μαρκάρισμα περιοχής (προαιρετικό)'}
            </button>
            {foundValue !== null && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[12px]">
                Βρέθηκε: <strong>{foundValue}</strong>
              </div>
            )}
          </div>

          <div className="relative max-h-[420px] overflow-auto rounded-lg border border-border bg-muted">
            {docId && (isPdf ? (
              <iframe src={fileUrl} title="doc" className="h-[420px] w-full border-0 bg-white" />
            ) : (
              <div ref={ref} {...(marking ? handlers : {})} className="relative select-none" style={{ cursor: marking ? 'crosshair' : 'default' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl} alt="" className="w-full" draggable={false} />
                {marking && active && box && (
                  <div className="pointer-events-none absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
                    style={{ left: `${box.x*100}%`, top: `${box.y*100}%`, width: `${box.w*100}%`, height: `${box.h*100}%` }} />
                )}
              </div>
            ))}
            {isPdf && marking && (
              <p className="p-2 text-[11px] text-muted-foreground">Το μαρκάρισμα περιοχής υποστηρίζεται σε εικόνες· για PDF δώσε οδηγία με κείμενο.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <button type="button" disabled={busy} onClick={() => onOpenChange(false)}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-[12px] font-semibold hover:bg-muted">
            Κλείσιμο
          </button>
          <button type="button" disabled={busy || !label.trim()} onClick={submit}
            className="inline-flex h-8 items-center rounded-md bg-sisyphus-500 px-3.5 text-[12px] font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50">
            {busy ? 'Αποθήκευση…' : 'Αποθήκευση & εφαρμογή'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> NOTE for executor: confirm `@/components/ui/dialog` exports `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter` (it is used elsewhere, e.g. `components/admin/create-supplier-from-aade-dialog.tsx`). If `use-marquee` is not a separate file, extract the hook used inside `field-correction.tsx` into `app/admin/ocr/[id]/use-marquee.ts` first (it is already imported from there by `field-correction.tsx`).

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add components/admin/supplier-field-rule-dialog.tsx
git commit -m "feat(ocr): SupplierFieldRuleDialog (define custom field + optional region)"
```

---

## Task 7: Wire the dropdown action in `ocr-table.tsx`

**Files:**
- Modify: `app/admin/ocr/ocr-table.tsx`

- [ ] **Step 1: Import the dialog + add state**

Add near the other imports:
```tsx
import { SupplierFieldRuleDialog } from '@/components/admin/supplier-field-rule-dialog';
```
Inside the table component (near `const [reextractingId, setReextractingId] = …`), add:
```tsx
const [fieldRuleDoc, setFieldRuleDoc] = React.useState<OcrRow | null>(null);
```

- [ ] **Step 2: Add the menu item**

In the actions `DropdownMenuContent` (after the "Επανασκανάρισμα" item, before the create-supplier items), add:
```tsx
{r.docType !== 'GENERAL_TEXT' && r.vatNumber && (
  <DropdownMenuItem onClick={() => setFieldRuleDoc(r)}>
    Νέο ειδικό πεδίο…
  </DropdownMenuItem>
)}
```

- [ ] **Step 3: Render the dialog once (near the other modals at the end of the component's JSX)**

```tsx
<SupplierFieldRuleDialog
  open={fieldRuleDoc != null}
  onOpenChange={(o) => { if (!o) setFieldRuleDoc(null); }}
  docId={fieldRuleDoc?.id ?? null}
  mimeType={fieldRuleDoc?.mimeType ?? null}
  supplierName={fieldRuleDoc?.companyName ?? null}
  vatNumber={fieldRuleDoc?.vatNumber ?? null}
/>
```

> NOTE for executor: verify `OcrRow` includes `mimeType`, `vatNumber`, `companyName`, `docType` (it already exposes `vatNumber`, `customerVatNumber`, `docType`, `mimeType` per existing usage). If `companyName` is not on `OcrRow`, pass `null` — the dialog only uses it for the title.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add app/admin/ocr/ocr-table.tsx
git commit -m "feat(ocr): 'Νέο ειδικό πεδίο' action in the row dropdown"
```

---

## Task 8: Display "Ειδικά πεδία" in expand + detail views

**Files:**
- Modify: `app/admin/ocr/row-detail.tsx`
- Modify: `app/admin/ocr/[id]/result-view.tsx`

The values are in `extractedData.customFields = { [key]: value }`. Labels come from the rules; for the detail/expand views we render `key → value` and prettify the key as a fallback label (the full label join happens on the list page; here we show the key humanized, which is acceptable and avoids an extra fetch).

- [ ] **Step 1: Add a shared renderer in `row-detail.tsx`**

Add this helper near the other small components in `row-detail.tsx`:
```tsx
function CustomFieldsBlock({ data }: { data: Record<string, any> }) {
  const cf = (data?.customFields ?? {}) as Record<string, unknown>;
  const entries = Object.entries(cf);
  if (entries.length === 0) return null;
  const human = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground">
        Ειδικά πεδία
      </header>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 p-3 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-[11px] font-semibold text-muted-foreground">{human(k)}</dt>
            <dd className="text-[12px] text-foreground">{v == null || v === '' ? '—' : String(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 2: Render it in the "Πεδία" tab of `row-detail.tsx`**

In `<TabsContent value="fields" …>`, add `<CustomFieldsBlock data={data} />` at the end of BOTH the invoice branch's `<div className="space-y-3">` and the non-invoice branch's `<div className="space-y-3">` (just after the `{totalsBox}`):
```tsx
{totalsBox}
<CustomFieldsBlock data={data} />
```

- [ ] **Step 3: Render it in `result-view.tsx`**

Add the same `CustomFieldsBlock` helper (copy it) to `result-view.tsx`, and render `<CustomFieldsBlock data={data} />` right after the `<BankAccounts accounts={data.bankAccounts} />` in BOTH the INVOICE and RECEIPT branches.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add app/admin/ocr/row-detail.tsx "app/admin/ocr/[id]/result-view.tsx"
git commit -m "feat(ocr): show custom fields block in expand + detail views"
```

---

## Task 9: List/management page — `/admin/ocr/field-rules`

**Files:**
- Create: `app/admin/ocr/field-rules/page.tsx`
- Create: `app/admin/ocr/field-rules/field-rules-client.tsx`

- [ ] **Step 1: Server page**

Create `app/admin/ocr/field-rules/page.tsx`:
```tsx
import { FiSliders } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { FieldRulesClient, type FieldRuleRow } from './field-rules-client';

export const dynamic = 'force-dynamic';

export default async function OcrFieldRulesPage() {
  await requirePermission('ocr.read');
  const canManage = await hasPermission('ocr.categorize');
  const rules = await prisma.supplierFieldRule.findMany({
    orderBy: [{ supplierName: 'asc' }, { vatNumber: 'asc' }, { docType: 'asc' }, { label: 'asc' }],
  });
  const rows: FieldRuleRow[] = rules.map((r) => ({
    id: r.id, vatNumber: r.vatNumber, supplierName: r.supplierName,
    docType: r.docType, label: r.label, description: r.description,
    isActive: r.isActive, timesUsed: r.timesUsed,
  }));
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiSliders />}
        title="Ειδικά πεδία προμηθευτών"
        description="Κανόνες για επιπλέον πεδία που εξάγονται αυτόματα από τα παραστατικά συγκεκριμένων προμηθευτών."
        helpAnchor="ocr-field-rules"
      />
      <FieldRulesClient rows={rows} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 2: Client table with edit/delete/toggle**

Create `app/admin/ocr/field-rules/field-rules-client.tsx`:
```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiTrash2, FiEdit2, FiCheck, FiX } from 'react-icons/fi';

export type FieldRuleRow = {
  id: string; vatNumber: string; supplierName: string | null;
  docType: 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT';
  label: string; description: string | null; isActive: boolean; timesUsed: number;
};

const DOC_LABEL: Record<string, string> = { INVOICE: 'Τιμολόγιο', RECEIPT: 'Απόδειξη', GENERAL_TEXT: '—' };

export function FieldRulesClient({ rows, canManage }: { rows: FieldRuleRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<FieldRuleRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/ocr/field-rules/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε'); setEditing(null); router.refresh();
    } catch (e: any) { toast.error(`Σφάλμα: ${e?.message ?? e}`); }
    finally { setBusyId(null); }
  }
  async function remove(id: string) {
    if (!confirm('Διαγραφή κανόνα;')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/ocr/field-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Διαγράφηκε'); router.refresh();
    } catch (e: any) { toast.error(`Σφάλμα: ${e?.message ?? e}`); }
    finally { setBusyId(null); }
  }

  if (rows.length === 0) {
    return <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Δεν υπάρχουν κανόνες ακόμη. Δημιούργησε έναν από τις ενέργειες ενός σκαναρισμένου παραστατικού.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Προμηθευτής</th>
            <th className="px-3 py-2">Τύπος</th>
            <th className="px-3 py-2">Πεδίο</th>
            <th className="px-3 py-2">Οδηγία</th>
            <th className="px-3 py-2 text-right">Χρήσεις</th>
            <th className="px-3 py-2 text-center">Ενεργό</th>
            {canManage && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="px-3 py-2">
                <div className="font-medium text-foreground">{r.supplierName ?? '—'}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{r.vatNumber}</div>
              </td>
              <td className="px-3 py-2">{DOC_LABEL[r.docType]}</td>
              <td className="px-3 py-2 font-semibold">
                {editing?.id === r.id
                  ? <input className="w-full rounded border border-input bg-background px-2 py-1 text-[12px]" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                  : r.label}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {editing?.id === r.id
                  ? <input className="w-full rounded border border-input bg-background px-2 py-1 text-[12px]" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                  : (r.description ?? '—')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.timesUsed}</td>
              <td className="px-3 py-2 text-center">
                <button type="button" disabled={!canManage || busyId === r.id}
                  onClick={() => patch(r.id, { isActive: !r.isActive })}
                  className={r.isActive ? 'text-emerald-600' : 'text-muted-foreground'} title={r.isActive ? 'Ενεργό' : 'Ανενεργό'}>
                  {r.isActive ? <FiCheck /> : <FiX />}
                </button>
              </td>
              {canManage && (
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {editing?.id === r.id ? (
                      <>
                        <button type="button" disabled={busyId === r.id} onClick={() => patch(r.id, { label: editing.label.trim(), description: (editing.description ?? '').trim() || null })}
                          className="rounded-md px-2 py-1 text-[12px] font-semibold text-emerald-600 hover:bg-emerald-500/10">Αποθήκευση</button>
                        <button type="button" onClick={() => setEditing(null)}
                          className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted">Άκυρο</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => setEditing(r)} title="Επεξεργασία"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><FiEdit2 className="size-3.5" /></button>
                        <button type="button" disabled={busyId === r.id} onClick={() => remove(r.id)} title="Διαγραφή"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-dg-red-500/10 hover:text-dg-red-500"><FiTrash2 className="size-3.5" /></button>
                      </>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Add a link to the page from the OCR list**

In `app/admin/ocr/page.tsx`, inside the `<PageHeader … actions={…}>` (or near the header), add a link:
```tsx
<a href="/admin/ocr/field-rules" className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-[12px] font-semibold hover:bg-muted">
  Ειδικά πεδία
</a>
```

> NOTE for executor: open `app/admin/ocr/page.tsx` and place this link in the existing `PageHeader` `actions` slot (match the existing actions markup; if there is no `actions` prop yet, add `actions={<…>}`).

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add app/admin/ocr/field-rules/page.tsx app/admin/ocr/field-rules/field-rules-client.tsx app/admin/ocr/page.tsx
git commit -m "feat(ocr): supplier field-rules management page + nav link"
```

---

## Task 10: Wiki entry (mandatory per CLAUDE.md)

**Files:**
- Create: `docs/wiki/ocr/field-rules.mdx`

- [ ] **Step 1: Scaffold the wiki page**

Run:
```bash
npm run wiki:new -- ocr/field-rules --roles "SUPER_ADMIN,ADMIN,EMPLOYEE" --title "Ειδικά πεδία προμηθευτών"
```
Expected: creates `docs/wiki/ocr/field-rules.mdx`.

- [ ] **Step 2: Write the content**

Replace the scaffolded body of `docs/wiki/ocr/field-rules.mdx` with frontmatter `helpAnchors: [ocr-field-rules]`, `description`, a `screenshots` entry for `/admin/ocr/field-rules`, and this Greek content:
```mdx
## Τι είναι

Κανόνες που λένε στην εφαρμογή να εξάγει **επιπλέον πεδία** από τα παραστατικά ενός συγκεκριμένου προμηθευτή — πέρα από τα στάνταρ (ΑΦΜ, ποσά, ημερομηνία κ.λπ.).

## Δημιουργία κανόνα

<Steps>
  <li>Άνοιξε το μενού ενεργειών (⋯) ενός σκαναρισμένου παραστατικού του προμηθευτή.</li>
  <li>Διάλεξε <strong>«Νέο ειδικό πεδίο…»</strong>.</li>
  <li>Δώσε <strong>Όνομα</strong> (π.χ. «Αριθμός Παραγγελίας») και μια <strong>Οδηγία</strong> (πού/τι να ψάξει). Προαιρετικά μαρκάρισε την περιοχή πάνω στο έγγραφο (εικόνες).</li>
  <li>Πάτα <strong>Αποθήκευση & εφαρμογή</strong> — η τιμή βρίσκεται αμέσως στο τρέχον παραστατικό.</li>
</Steps>

<Callout type="info">
  Ο κανόνας ισχύει ανά <strong>ΑΦΜ προμηθευτή + τύπο παραστατικού</strong>. Κάθε μελλοντικό upload από τον ίδιο προμηθευτή θα ψάχνει αυτόματα και αυτό το πεδίο. Οι τιμές εμφανίζονται στο μπλοκ «Ειδικά πεδία».
</Callout>

## Διαχείριση

Στη σελίδα <strong>Ειδικά πεδία προμηθευτών</strong> βλέπεις όλους τους κανόνες και μπορείς να τους <strong>επεξεργαστείς</strong>, να τους <strong>ενεργοποιήσεις/απενεργοποιήσεις</strong> ή να τους <strong>διαγράψεις</strong>.

<Callout type="warning">
  Οι ανενεργοί κανόνες δεν εκτελούνται σε νέα uploads. Η διαγραφή δεν σβήνει τιμές που έχουν ήδη εξαχθεί σε παλιά παραστατικά.
</Callout>
```

- [ ] **Step 3: Rebuild the search index**

Run:
```bash
npm run wiki:index
```
Expected: updates `public/wiki/index.json`.

- [ ] **Step 4: Commit**

```bash
git add docs/wiki/ocr/field-rules.mdx public/wiki/index.json lib/wiki/modules-meta.ts
git commit -m "docs(wiki): supplier custom field rules page"
```

---

## Final verification

- [ ] Run `npx tsc --noEmit -p tsconfig.json` → clean.
- [ ] Run `npx vitest run lib/ocr` → all pass (including new field-rules tests).
- [ ] Manual smoke (dev server): scan an invoice → row actions → «Νέο ειδικό πεδίο…» → define a field → see found value → re-upload same supplier → field auto-extracted → `/admin/ocr/field-rules` shows + edits + toggles + deletes the rule.
- [ ] Push: `git push origin master`.

---

## Self-review notes (addressed)

- **Spec coverage:** model (T1), targeted pass + chicken-and-egg (T3), create+apply (T4), list/PATCH/DELETE (T5), dialog with optional region (T6), dropdown action (T7), display block (T8), management page + toggle/edit/delete (T9), wiki (T10). All spec sections mapped.
- **Type consistency:** `slugifyFieldKey`/`buildCustomFieldsPrompt`/`mergeCustomFields`/`findActiveFieldRules`/`upsertFieldRule` signatures match across T2→T3→T4; `customFields` key shape `{ [key]: value }` consistent in T3/T4/T8; `FieldRuleRow` shape consistent T9 page↔client.
- **Executor NOTEs** flag the three existing-code assumptions to verify (ui/dialog exports, `use-marquee` location, `OcrRow` fields, `ocr/page.tsx` actions slot) rather than assuming silently.
