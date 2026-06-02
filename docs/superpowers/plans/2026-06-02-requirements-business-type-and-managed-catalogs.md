# Requirements Scoped by Business Type + Managed Catalogs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins scope each program document requirement to one or more legal/business forms (limited to the forms the program scan found), so that when a company is enrolled the app auto-derives exactly which documents it needs from the company's legal form; plus turn document categories and phase names into admin-managed catalogs picked via creatable combo boxes.

**Architecture:** A thin seeded `BusinessType` lookup (`code` = canonical legal-form key from the existing `canonicalLegalForm()`). Requirements link many-to-many to `BusinessType` (`RequirementBusinessType`) with an `appliesToAll` flag; the UI only offers the program's eligible forms (derived from `ProgramEligibleLegalForm` via `canonicalLegalForm`). A company resolves to a `BusinessType` by canonicalising its `legalForm` (cached `businessTypeId` + manual `businessTypeOverride`). The required-documents list is computed on-demand (pure functions), never stored. `DocumentCategory` and `PhaseTemplate` are managed catalogs selected via a new reusable creatable `Combobox`.

**Tech Stack:** Next.js 16 (App Router, Route Handlers), Prisma + PostgreSQL, shadcn/ui (Radix `Popover`/`Select`), React, vitest. Greek UI strings. Spec: [`docs/superpowers/specs/2026-06-02-requirements-business-type-and-managed-catalogs-design.md`](../specs/2026-06-02-requirements-business-type-and-managed-catalogs-design.md).

**Conventions (read before starting):**
- Prisma migrate is special here (`migrate dev` is broken). For every schema change: edit `prisma/schema.prisma` → `npx prisma db push` → hand-write `prisma/migrations/<timestamp>_<slug>/migration.sql` → `npx prisma migrate resolve --applied <timestamp>_<slug>` → `npx prisma generate`. Use a fixed timestamp string you pick (e.g. `20260602120000`), not a live clock.
- API route handlers start with `export const runtime = 'nodejs';` and `export const dynamic = 'force-dynamic';`.
- Permission gate: `await requirePermission('x.y')` (server pages also use `await hasPermission('x.y')` for `canManage`). Reuse existing keys only: `metadata.read`, `metadata.manage`, `programs.read`, `programs.update`, `companies.read`, `companies.update`. No new permission keys.
- Run a single vitest file with: `npx vitest run <path>`.
- Phases 1–5 below are shippable checkpoints; commit at the end of every task.

---

## Phase 1 — Schema, migration, seed, Combobox component

### Task 1: Prisma schema — new models + field additions

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260602120000_business_types_and_catalogs/migration.sql`

- [ ] **Step 1: Add the new models + relations to `prisma/schema.prisma`**

Add these models (place near the other lookup tables / `DocumentType`):

```prisma
model BusinessType {
  id        String   @id @default(cuid())
  code      String   @unique           // canonical key from canonicalLegalForm(): "ΑΕ","ΕΠΕ","ΙΚΕ"…
  name      String                     // Greek label, e.g. "Ανώνυμη Εταιρεία"
  order     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  companies    Company[]
  requirements RequirementBusinessType[]

  @@index([active])
  @@index([order])
}

model DocumentCategory {
  id        String   @id @default(cuid())
  name      String   @unique
  order     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  documentTypes DocumentType[]

  @@index([active])
}

model PhaseTemplate {
  id        String   @id @default(cuid())
  name      String   @unique
  order     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  phases ProgramPhase[]
}

model RequirementBusinessType {
  id             String   @id @default(cuid())
  requirementId  String
  requirement    PhaseDocumentRequirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  businessTypeId String
  businessType   BusinessType @relation(fields: [businessTypeId], references: [id], onDelete: Cascade)

  @@unique([requirementId, businessTypeId])
  @@index([requirementId])
  @@index([businessTypeId])
}
```

- [ ] **Step 2: Add fields to existing models**

In `model Company` add (next to `legalTypeId`/`legalForm`):

```prisma
  businessTypeId       String?
  businessType         BusinessType? @relation(fields: [businessTypeId], references: [id], onDelete: SetNull)
  businessTypeOverride Boolean       @default(false)
```
and add to its `@@index` block:
```prisma
  @@index([businessTypeId])
```

In `model DocumentType` add:
```prisma
  categoryId  String?
  categoryRef DocumentCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@index([categoryId])
```
(Keep the existing `category String?` for now — it is migrated then dropped in Task 12.)

In `model PhaseDocumentRequirement` add:
```prisma
  appliesToAll  Boolean @default(false)
  businessTypes RequirementBusinessType[]
```

In `model ProgramPhase` add:
```prisma
  phaseTemplateId String?
  phaseTemplate   PhaseTemplate? @relation(fields: [phaseTemplateId], references: [id], onDelete: SetNull)
```

- [ ] **Step 3: Push schema to the dev database**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." (no data loss prompt — all changes are additive/nullable).

- [ ] **Step 4: Hand-write the migration SQL**

Create `prisma/migrations/20260602120000_business_types_and_catalogs/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "BusinessType" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessType_code_key" ON "BusinessType"("code");
CREATE INDEX "BusinessType_active_idx" ON "BusinessType"("active");
CREATE INDEX "BusinessType_order_idx" ON "BusinessType"("order");

CREATE TABLE "DocumentCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentCategory_name_key" ON "DocumentCategory"("name");
CREATE INDEX "DocumentCategory_active_idx" ON "DocumentCategory"("active");

CREATE TABLE "PhaseTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhaseTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PhaseTemplate_name_key" ON "PhaseTemplate"("name");

CREATE TABLE "RequirementBusinessType" (
  "id" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "businessTypeId" TEXT NOT NULL,
  CONSTRAINT "RequirementBusinessType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RequirementBusinessType_requirementId_businessTypeId_key" ON "RequirementBusinessType"("requirementId","businessTypeId");
CREATE INDEX "RequirementBusinessType_requirementId_idx" ON "RequirementBusinessType"("requirementId");
CREATE INDEX "RequirementBusinessType_businessTypeId_idx" ON "RequirementBusinessType"("businessTypeId");

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "businessTypeId" TEXT;
ALTER TABLE "Company" ADD COLUMN "businessTypeOverride" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Company_businessTypeId_idx" ON "Company"("businessTypeId");

ALTER TABLE "DocumentType" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "DocumentType_categoryId_idx" ON "DocumentType"("categoryId");

ALTER TABLE "PhaseDocumentRequirement" ADD COLUMN "appliesToAll" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProgramPhase" ADD COLUMN "phaseTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "RequirementBusinessType" ADD CONSTRAINT "RequirementBusinessType_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PhaseDocumentRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementBusinessType" ADD CONSTRAINT "RequirementBusinessType_businessTypeId_fkey" FOREIGN KEY ("businessTypeId") REFERENCES "BusinessType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_businessTypeId_fkey" FOREIGN KEY ("businessTypeId") REFERENCES "BusinessType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentType" ADD CONSTRAINT "DocumentType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocumentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgramPhase" ADD CONSTRAINT "ProgramPhase_phaseTemplateId_fkey" FOREIGN KEY ("phaseTemplateId") REFERENCES "PhaseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Register the migration + regenerate client**

Run: `npx prisma migrate resolve --applied 20260602120000_business_types_and_catalogs`
Then: `npx prisma generate`
Expected: resolve prints "Migration … marked as applied."; generate prints "Generated Prisma Client".

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260602120000_business_types_and_catalogs/migration.sql
git commit -m "feat(db): business types, document categories, phase templates, requirement scoping"
```

---

### Task 2: Seed the BusinessType catalog

**Files:**
- Modify: `scripts/seed.js`

- [ ] **Step 1: Add the seed data + function**

Near the top constants of `scripts/seed.js` add:

```javascript
const BUSINESS_TYPES = [
  { code: 'ΑΕ',            name: 'Ανώνυμη Εταιρεία (Α.Ε.)',                 order: 1 },
  { code: 'ΕΠΕ',           name: 'Εταιρεία Περιορισμένης Ευθύνης (Ε.Π.Ε.)', order: 2 },
  { code: 'ΙΚΕ',           name: 'Ιδιωτική Κεφαλαιουχική Εταιρεία (Ι.Κ.Ε.)', order: 3 },
  { code: 'ΟΕ',            name: 'Ομόρρυθμη Εταιρεία (Ο.Ε.)',               order: 4 },
  { code: 'ΕΕ',            name: 'Ετερόρρυθμη Εταιρεία (Ε.Ε.)',             order: 5 },
  { code: 'ΑΤΟΜΙΚΗ',       name: 'Ατομική Επιχείρηση',                      order: 6 },
  { code: 'ΣΥΝΕΤΑΙΡΙΣΜΟΣ', name: 'Συνεταιρισμός',                           order: 7 },
  { code: 'ΚΟΙΝΣΕΠ',       name: 'Κοιν.Σ.Επ.',                              order: 8 },
  { code: 'ΚΟΙΣΠΕ',        name: 'Κοι.Σ.Π.Ε.',                              order: 9 },
  { code: 'ΑΜΚΕ',          name: 'Αστική Μη Κερδοσκοπική Εταιρεία',         order: 10 },
];

async function seedBusinessTypes() {
  for (const b of BUSINESS_TYPES) {
    await prisma.businessType.upsert({
      where: { code: b.code },
      update: { name: b.name, order: b.order },
      create: { code: b.code, name: b.name, order: b.order, active: true },
    });
  }
  console.log(`✓ Seeded ${BUSINESS_TYPES.length} business types`);
}
```

- [ ] **Step 2: Call it from the main seed runner**

Find where `seedCompanyTypes()` / `seedVatCategories()` are awaited in the main runner and add `await seedBusinessTypes();` next to them.

- [ ] **Step 3: Run the seed**

Run: `npm run seed:db`
Expected: output includes `✓ Seeded 10 business types`.

- [ ] **Step 4: Verify in DB**

Run: `npx prisma studio` is not needed — instead run a quick check:
`node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().businessType.count().then(c=>{console.log('businessTypes:',c);process.exit(0)})"`
Expected: `businessTypes: 10`

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.js
git commit -m "feat(seed): seed BusinessType catalog (legal forms)"
```

---

### Task 3: Reusable creatable Combobox component

**Files:**
- Create: `components/ui/combobox.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
import * as React from 'react';
import { FiChevronDown, FiCheck, FiPlus } from 'react-icons/fi';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export type ComboItem = { value: string; label: string };

export function Combobox({
  value, items, onSelect, onCreate, placeholder, allowCreate = false, disabled = false,
}: {
  value: string | null;
  items: ComboItem[];
  onSelect: (value: string) => void;
  onCreate?: (label: string) => void | Promise<void>;
  placeholder?: string;
  allowCreate?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const selected = items.find((i) => i.value === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  const exact = items.some((i) => i.label.trim().toLowerCase() === q);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="w-full justify-between font-normal">
          <span className={selected ? '' : 'text-muted-foreground'}>{selected ? selected.label : (placeholder ?? 'Επίλεξε…')}</span>
          <FiChevronDown className="ml-2 size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Αναζήτηση…" className="mb-1 h-8" />
        <div className="max-h-56 overflow-auto">
          {filtered.map((i) => (
            <button key={i.value} type="button"
              onClick={() => { onSelect(i.value); setOpen(false); setQuery(''); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body-sm hover:bg-muted">
              <FiCheck className={`size-4 ${i.value === value ? 'opacity-100' : 'opacity-0'}`} />
              {i.label}
            </button>
          ))}
          {filtered.length === 0 && !q && <p className="px-2 py-1.5 text-xs text-muted-foreground">Καμία επιλογή.</p>}
          {allowCreate && onCreate && q && !exact && (
            <button type="button"
              onClick={async () => { await onCreate(query.trim()); setOpen(false); setQuery(''); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body-sm text-primary hover:bg-muted">
              <FiPlus className="size-4" /> Δημιουργία «{query.trim()}»
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `components/ui/combobox.tsx`. (Pre-existing unrelated errors may exist — see memory `espa-build-prexisting-state`; verify none are in this file.)

- [ ] **Step 3: Commit**

```bash
git add components/ui/combobox.tsx
git commit -m "feat(ui): reusable creatable Combobox (popover + filter + create)"
```

---

## Phase 2 — Pure libraries + unit tests

### Task 4: Export `canonicalLegalForm` + company business-type resolver

**Files:**
- Modify: `lib/programs/eligibility.ts:41`
- Create: `lib/companies/business-type.ts`
- Create: `lib/companies/__tests__/business-type.test.ts`

- [ ] **Step 1: Export the existing canonicaliser**

In `lib/programs/eligibility.ts`, change the function declaration on line 41 from:
```typescript
function canonicalLegalForm(s: string): string {
```
to:
```typescript
export function canonicalLegalForm(s: string): string {
```
(Leave the body and all existing internal callers unchanged.)

- [ ] **Step 2: Write the failing test**

Create `lib/companies/__tests__/business-type.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveBusinessTypeId } from '../business-type';

const catalog = [
  { id: 'bt_ae', code: 'ΑΕ' },
  { id: 'bt_ike', code: 'ΙΚΕ' },
  { id: 'bt_atomiki', code: 'ΑΤΟΜΙΚΗ' },
];

describe('resolveBusinessTypeId', () => {
  it('keeps the existing id when override is set', () => {
    const r = resolveBusinessTypeId({ legalForm: 'Ι.Κ.Ε.', legalTypeDescr: null, businessTypeId: 'bt_ae', businessTypeOverride: true }, catalog);
    expect(r).toBe('bt_ae');
  });
  it('maps free-text legalForm via canonicalLegalForm', () => {
    expect(resolveBusinessTypeId({ legalForm: 'Ιδιωτική Κεφαλαιουχική Εταιρεία', legalTypeDescr: null, businessTypeId: null, businessTypeOverride: false }, catalog)).toBe('bt_ike');
    expect(resolveBusinessTypeId({ legalForm: 'Α.Ε.', legalTypeDescr: null, businessTypeId: null, businessTypeOverride: false }, catalog)).toBe('bt_ae');
  });
  it('falls back to legalTypeDescr when legalForm is empty', () => {
    expect(resolveBusinessTypeId({ legalForm: null, legalTypeDescr: 'Ατομική', businessTypeId: null, businessTypeOverride: false }, catalog)).toBe('bt_atomiki');
  });
  it('returns null when nothing matches the catalog', () => {
    expect(resolveBusinessTypeId({ legalForm: 'Σωματείο', legalTypeDescr: null, businessTypeId: null, businessTypeOverride: false }, catalog)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify failure**

Run: `npx vitest run lib/companies/__tests__/business-type.test.ts`
Expected: FAIL — cannot find module `../business-type`.

- [ ] **Step 4: Implement**

Create `lib/companies/business-type.ts`:

```typescript
import { canonicalLegalForm } from '@/lib/programs/eligibility';

export interface BusinessTypeRef { id: string; code: string }

export interface CompanyTypeInput {
  legalForm: string | null;
  legalTypeDescr: string | null;
  businessTypeId: string | null;
  businessTypeOverride: boolean;
}

/**
 * Resolve a company's BusinessType id. Honors a manual override; otherwise
 * canonicalises the company's legal form (free-text, fallback to ΓΕΜΗ descr)
 * and matches it against the BusinessType catalog by `code`.
 */
export function resolveBusinessTypeId(input: CompanyTypeInput, catalog: BusinessTypeRef[]): string | null {
  if (input.businessTypeOverride) return input.businessTypeId;
  const raw = (input.legalForm ?? '').trim() || (input.legalTypeDescr ?? '').trim();
  if (!raw) return null;
  const key = canonicalLegalForm(raw);
  return catalog.find((b) => b.code === key)?.id ?? null;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/companies/__tests__/business-type.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/programs/eligibility.ts lib/companies/business-type.ts lib/companies/__tests__/business-type.test.ts
git commit -m "feat(companies): resolveBusinessTypeId via canonicalLegalForm"
```

---

### Task 5: Program eligible-business-types derivation

**Files:**
- Create: `lib/programs/eligible-business-types.ts`
- Create: `lib/programs/__tests__/eligible-business-types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { eligibleBusinessTypeIds } from '../eligible-business-types';

const catalog = [
  { id: 'bt_ae', code: 'ΑΕ' },
  { id: 'bt_epe', code: 'ΕΠΕ' },
  { id: 'bt_ike', code: 'ΙΚΕ' },
];

describe('eligibleBusinessTypeIds', () => {
  it('maps scanned free-text forms to catalog ids, deduped', () => {
    const r = eligibleBusinessTypeIds(['Α.Ε.', 'Ανώνυμη Εταιρεία', 'Ι.Κ.Ε.'], catalog);
    expect([...r].sort()).toEqual(['bt_ae', 'bt_ike']);
  });
  it('ignores forms with no catalog match', () => {
    expect(eligibleBusinessTypeIds(['Σωματείο'], catalog).size).toBe(0);
  });
  it('returns empty set for empty input', () => {
    expect(eligibleBusinessTypeIds([], catalog).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/programs/__tests__/eligible-business-types.test.ts`
Expected: FAIL — cannot find module `../eligible-business-types`.

- [ ] **Step 3: Implement**

Create `lib/programs/eligible-business-types.ts`:

```typescript
import { canonicalLegalForm } from '@/lib/programs/eligibility';
import type { BusinessTypeRef } from '@/lib/companies/business-type';

/**
 * Given a program's scanned eligible legal-form names (free text from
 * ProgramEligibleLegalForm) and the BusinessType catalog, return the set of
 * BusinessType ids that participate in the program. Used to constrain the
 * legal-form options offered when scoping a requirement.
 */
export function eligibleBusinessTypeIds(formNames: string[], catalog: BusinessTypeRef[]): Set<string> {
  const byCode = new Map(catalog.map((b) => [b.code, b.id]));
  const out = new Set<string>();
  for (const name of formNames) {
    const id = byCode.get(canonicalLegalForm(name));
    if (id) out.add(id);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/programs/__tests__/eligible-business-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/programs/eligible-business-types.ts lib/programs/__tests__/eligible-business-types.test.ts
git commit -m "feat(programs): derive eligible business types from scan"
```

---

### Task 6: Requirement-scope matching

**Files:**
- Create: `lib/documents/requirement-scope.ts`
- Create: `lib/documents/__tests__/requirement-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { requirementApplies, filterRequirements } from '../requirement-scope';

const reqAll = { id: 'r1', appliesToAll: true, businessTypeIds: [] };
const reqAE = { id: 'r2', appliesToAll: false, businessTypeIds: ['bt_ae'] };
const reqNone = { id: 'r3', appliesToAll: false, businessTypeIds: [] };

describe('requirementApplies', () => {
  it('appliesToAll is always required', () => {
    expect(requirementApplies(reqAll, 'bt_ike')).toBe(true);
    expect(requirementApplies(reqAll, null)).toBe(true);
  });
  it('matches when company type is in the list', () => {
    expect(requirementApplies(reqAE, 'bt_ae')).toBe(true);
    expect(requirementApplies(reqAE, 'bt_ike')).toBe(false);
  });
  it('empty list + not all => required by nobody', () => {
    expect(requirementApplies(reqNone, 'bt_ae')).toBe(false);
  });
  it('null company type only matches appliesToAll', () => {
    expect(requirementApplies(reqAE, null)).toBe(false);
  });
});

describe('filterRequirements', () => {
  it('returns only applicable requirements', () => {
    expect(filterRequirements([reqAll, reqAE, reqNone], 'bt_ae').map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/documents/__tests__/requirement-scope.test.ts`
Expected: FAIL — cannot find module `../requirement-scope`.

- [ ] **Step 3: Implement**

Create `lib/documents/requirement-scope.ts`:

```typescript
export interface ScopedRequirement {
  id: string;
  appliesToAll: boolean;
  businessTypeIds: string[];
}

/** A requirement is requested for a company iff it applies to all forms, or the
 *  company's resolved business type is explicitly listed. Empty list + not-all
 *  means it is requested from nobody. */
export function requirementApplies<T extends ScopedRequirement>(req: T, companyBusinessTypeId: string | null): boolean {
  if (req.appliesToAll) return true;
  if (!companyBusinessTypeId) return false;
  return req.businessTypeIds.includes(companyBusinessTypeId);
}

export function filterRequirements<T extends ScopedRequirement>(reqs: T[], companyBusinessTypeId: string | null): T[] {
  return reqs.filter((r) => requirementApplies(r, companyBusinessTypeId));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/documents/__tests__/requirement-scope.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/documents/requirement-scope.ts lib/documents/__tests__/requirement-scope.test.ts
git commit -m "feat(documents): requirement-scope matching by business type"
```

---

### Task 7: Catalog input normalizers (categories + phase templates)

**Files:**
- Create: `lib/documents/document-categories.ts`
- Create: `lib/programs/phase-templates.ts`
- Create: `lib/documents/__tests__/document-categories.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeNamedCatalogInput } from '../document-categories';

describe('normalizeNamedCatalogInput', () => {
  it('trims name and defaults order/active', () => {
    expect(normalizeNamedCatalogInput({ name: '  Νομιμοποιητικά  ' })).toEqual({ ok: true, value: { name: 'Νομιμοποιητικά', order: 0, active: true } });
  });
  it('rejects empty name', () => {
    expect(normalizeNamedCatalogInput({ name: '   ' })).toEqual({ ok: false, error: 'name is required' });
  });
  it('coerces order and active', () => {
    expect(normalizeNamedCatalogInput({ name: 'X', order: '3', active: false })).toEqual({ ok: true, value: { name: 'X', order: 3, active: false } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/documents/__tests__/document-categories.test.ts`
Expected: FAIL — cannot find module `../document-categories`.

- [ ] **Step 3: Implement the shared normalizer (categories)**

Create `lib/documents/document-categories.ts`:

```typescript
export interface NamedCatalogInput { name?: unknown; order?: unknown; active?: unknown }
export interface NormalizedNamedCatalog { name: string; order: number; active: boolean }
export type NamedCatalogResult =
  | { ok: true; value: NormalizedNamedCatalog }
  | { ok: false; error: string };

export function normalizeNamedCatalogInput(input: NamedCatalogInput): NamedCatalogResult {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  const order = Number.isFinite(Number(input.order)) ? Math.trunc(Number(input.order)) : 0;
  const active = typeof input.active === 'boolean' ? input.active : true;
  return { ok: true, value: { name, order, active } };
}
```

- [ ] **Step 4: Implement the phase-templates re-export**

Create `lib/programs/phase-templates.ts`:

```typescript
// Phase templates use the same name/order/active catalog shape as document categories.
export { normalizeNamedCatalogInput } from '@/lib/documents/document-categories';
export type { NamedCatalogInput, NormalizedNamedCatalog, NamedCatalogResult } from '@/lib/documents/document-categories';
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/documents/__tests__/document-categories.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/documents/document-categories.ts lib/programs/phase-templates.ts lib/documents/__tests__/document-categories.test.ts
git commit -m "feat(catalogs): shared named-catalog input normalizer"
```

---

## Phase 3 — Catalog CRUD APIs + admin pages

### Task 8: BusinessType CRUD API

**Files:**
- Create: `app/api/admin/business-types/route.ts`
- Create: `app/api/admin/business-types/[id]/route.ts`

- [ ] **Step 1: Create list + create route**

`app/api/admin/business-types/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('metadata.read');
  const data = await prisma.businessType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!code || !name) return NextResponse.json({ error: 'code και name υποχρεωτικά' }, { status: 400 });
  const order = Number.isFinite(Number(body.order)) ? Math.trunc(Number(body.order)) : 0;
  const existing = await prisma.businessType.findUnique({ where: { code } });
  if (existing) return NextResponse.json({ error: 'Υπάρχει ήδη μορφή με αυτόν τον κωδικό' }, { status: 409 });
  const created = await prisma.businessType.create({ data: { code, name, order, active: true } });
  return NextResponse.json({ data: created }, { status: 201 });
}
```

- [ ] **Step 2: Create patch + delete route**

`app/api/admin/business-types/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { code?: string; name?: string; order?: number; active?: boolean } = {};
  if (typeof body.code === 'string' && body.code.trim()) data.code = body.code.trim();
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (Number.isFinite(Number(body.order))) data.order = Math.trunc(Number(body.order));
  if (typeof body.active === 'boolean') data.active = body.active;
  if (data.code) {
    const clash = await prisma.businessType.findFirst({ where: { code: data.code, NOT: { id } }, select: { id: true } });
    if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη μορφή με αυτόν τον κωδικό' }, { status: 409 });
  }
  const updated = await prisma.businessType.update({ where: { id }, data });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const usedByCompanies = await prisma.company.count({ where: { businessTypeId: id } });
  const usedByReqs = await prisma.requirementBusinessType.count({ where: { businessTypeId: id } });
  if (usedByCompanies + usedByReqs > 0) {
    return NextResponse.json({ error: `Η μορφή χρησιμοποιείται (${usedByCompanies} εταιρίες, ${usedByReqs} δικαιολογητικά). Απενεργοποίησέ τη αντί να τη διαγράψεις.` }, { status: 409 });
  }
  await prisma.businessType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Smoke-test the GET**

Start the dev server if not running (`npm run dev`), then:
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/business-types`
Expected: `200` if authenticated session cookie present, or a redirect/forbidden otherwise — either way the route resolves (not 404/500). (Manual auth verification is fine here.)

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/business-types
git commit -m "feat(api): business-types CRUD"
```

---

### Task 9: BusinessType admin page + sidebar item

**Files:**
- Create: `app/admin/business-types/page.tsx`
- Create: `app/admin/business-types/business-types-client.tsx`
- Modify: `components/admin/sidebar.tsx`

- [ ] **Step 1: Create the client component**

`app/admin/business-types/business-types-client.tsx`:

```tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiEdit2, FiTrash2, FiMoreVertical } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export type BusinessTypeRow = { id: string; code: string; name: string; order: number; active: boolean };
type FormState = { code: string; name: string; order: number; active: boolean };
const EMPTY: FormState = { code: '', name: '', order: 0, active: true };

export function BusinessTypesClient({ rows, canManage }: { rows: BusinessTypeRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<BusinessTypeRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function openCreate() { setForm(EMPTY); setCreating(true); setError(null); }
  function openEdit(r: BusinessTypeRow) { setForm({ code: r.code, name: r.name, order: r.order, active: r.active }); setEditing(r); setError(null); }
  function close() { setCreating(false); setEditing(null); }

  async function save() {
    setSaving(true); setError(null);
    const url = editing ? `/api/admin/business-types/${editing.id}` : '/api/admin/business-types';
    const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    close(); router.refresh();
  }
  async function remove(r: BusinessTypeRow) {
    if (!confirm(`Διαγραφή μορφής «${r.name}»;`)) return;
    const res = await fetch(`/api/admin/business-types/${r.id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    router.refresh();
  }
  const open = creating || editing !== null;

  return (
    <div className="space-y-4">
      {canManage && (<div className="flex justify-end"><Button onClick={openCreate}><FiPlus className="mr-1.5" /> Νέα μορφή</Button></div>)}
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-body-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-3 py-2">Κωδικός</th>
              <th className="text-left font-medium px-3 py-2">Ονομασία</th>
              <th className="text-left font-medium px-3 py-2">Σειρά</th>
              <th className="text-left font-medium px-3 py-2">Κατάσταση</th>
              {canManage && <th className="px-3 py-2 w-16" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (<tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-muted-foreground">Καμία μορφή.</td></tr>)}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{r.code}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.order}</td>
                <td className="px-3 py-2">{r.active ? <Badge>Ενεργό</Badge> : <Badge variant="outline">Ανενεργό</Badge>}</td>
                {canManage && (
                  <td className="px-3 py-2"><div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Ενέργειες"><FiMoreVertical /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(r)}><FiEdit2 className="mr-2 size-4" /> Επεξεργασία</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(r)}><FiTrash2 className="mr-2 size-4" /> Διαγραφή</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Επεξεργασία μορφής' : 'Νέα νομική μορφή'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Κωδικός * (canonical)</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="π.χ. ΑΕ" /></div>
            <div><Label>Ονομασία *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Ανώνυμη Εταιρεία" /></div>
            <div><Label>Σειρά</Label><Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></div>
            <div className="flex items-center justify-between"><Label>Ενεργό</Label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" /></div>
            {error && <p className="text-body-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>Άκυρο</Button>
            <Button onClick={save} disabled={saving || !form.code.trim() || !form.name.trim()}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Create the server page**

`app/admin/business-types/page.tsx`:

```tsx
import { FiBriefcase } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { BusinessTypesClient, type BusinessTypeRow } from './business-types-client';

export const dynamic = 'force-dynamic';

export default async function BusinessTypesPage() {
  await requirePermission('metadata.read');
  const canManage = await hasPermission('metadata.manage');
  const types = await prisma.businessType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  const rows: BusinessTypeRow[] = types.map((t) => ({ id: t.id, code: t.code, name: t.name, order: t.order, active: t.active }));
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiBriefcase />}
        title="Νομικές Μορφές"
        description="Κατάλογος νομικών μορφών επιχειρήσεων. Χρησιμοποιείται για να ζητούνται τα σωστά δικαιολογητικά ανά τύπο εταιρίας."
        helpAnchor="business-types"
      />
      <BusinessTypesClient rows={rows} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 3: Add the sidebar nav item**

In `components/admin/sidebar.tsx`, find the line declaring the document-types item:
```tsx
{ href: '/admin/document-types', label: 'Τύποι Δικαιολογητικών', icon: FiFileText, permissions: ['metadata.read'] },
```
Add immediately after it:
```tsx
{ href: '/admin/business-types', label: 'Νομικές Μορφές', icon: FiBriefcase, permissions: ['metadata.read'] },
```
Ensure `FiBriefcase` is imported from `react-icons/fi` at the top of the file (add to the existing import if missing).

- [ ] **Step 4: Verify the page renders**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors in the created files.
Then manually open `http://localhost:3000/admin/business-types` — the 10 seeded forms appear; create/edit/delete work.

- [ ] **Step 5: Commit**

```bash
git add app/admin/business-types components/admin/sidebar.tsx
git commit -m "feat(admin): business-types page + sidebar item"
```

---

### Task 10: DocumentCategory CRUD API

**Files:**
- Create: `app/api/admin/document-categories/route.ts`
- Create: `app/api/admin/document-categories/[id]/route.ts`

- [ ] **Step 1: Create list + create route (creatable: duplicate name returns existing 200)**

`app/api/admin/document-categories/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/documents/document-categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('metadata.read');
  const data = await prisma.documentCategory.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  // Creatable: if it already exists, return it (200) so the combo box doesn't error.
  const existing = await prisma.documentCategory.findUnique({ where: { name: norm.value.name } });
  if (existing) return NextResponse.json({ data: existing });
  const created = await prisma.documentCategory.create({ data: norm.value });
  return NextResponse.json({ data: created }, { status: 201 });
}
```

- [ ] **Step 2: Create patch + delete route**

`app/api/admin/document-categories/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/documents/document-categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const clash = await prisma.documentCategory.findFirst({ where: { name: norm.value.name, NOT: { id } }, select: { id: true } });
  if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη κατηγορία με αυτό το όνομα' }, { status: 409 });
  const updated = await prisma.documentCategory.update({ where: { id }, data: norm.value });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const usedBy = await prisma.documentType.count({ where: { categoryId: id } });
  if (usedBy > 0) return NextResponse.json({ error: `Η κατηγορία χρησιμοποιείται σε ${usedBy} τύπους. Απενεργοποίησέ τη.` }, { status: 409 });
  await prisma.documentCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/document-categories
git commit -m "feat(api): document-categories CRUD (creatable)"
```

---

### Task 11: PhaseTemplate CRUD API

**Files:**
- Create: `app/api/admin/phase-templates/route.ts`
- Create: `app/api/admin/phase-templates/[id]/route.ts`

- [ ] **Step 1: Create list + create route**

`app/api/admin/phase-templates/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/programs/phase-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('metadata.read');
  const data = await prisma.phaseTemplate.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const existing = await prisma.phaseTemplate.findUnique({ where: { name: norm.value.name } });
  if (existing) return NextResponse.json({ data: existing });
  const created = await prisma.phaseTemplate.create({ data: norm.value });
  return NextResponse.json({ data: created }, { status: 201 });
}
```

- [ ] **Step 2: Create patch + delete route**

`app/api/admin/phase-templates/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/programs/phase-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const clash = await prisma.phaseTemplate.findFirst({ where: { name: norm.value.name, NOT: { id } }, select: { id: true } });
  if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη πρότυπο με αυτό το όνομα' }, { status: 409 });
  const updated = await prisma.phaseTemplate.update({ where: { id }, data: norm.value });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const usedBy = await prisma.programPhase.count({ where: { phaseTemplateId: id } });
  if (usedBy > 0) return NextResponse.json({ error: `Το πρότυπο χρησιμοποιείται σε ${usedBy} φάσεις. Απενεργοποίησέ το.` }, { status: 409 });
  await prisma.phaseTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/phase-templates
git commit -m "feat(api): phase-templates CRUD (creatable)"
```

---

### Task 12: Document types — categoryId support + creatable combo + Categories tab

**Files:**
- Modify: `lib/documents/document-types.ts`
- Modify: `app/api/admin/document-types/route.ts`
- Modify: `app/api/admin/document-types/[id]/route.ts`
- Modify: `app/admin/document-types/page.tsx`
- Modify: `app/admin/document-types/document-types-client.tsx`

- [ ] **Step 1: Add `categoryId` to the normalizer**

In `lib/documents/document-types.ts`, extend `DocumentTypeInput` with `categoryId?: unknown;`, extend `NormalizedDocumentType` with `categoryId: string | null;`, and in the returned `value` add:
```typescript
      categoryId: typeof input.categoryId === 'string' && input.categoryId.trim() ? input.categoryId.trim() : null,
```
(Keep the existing `category` field handling as-is for now.)

- [ ] **Step 2: Persist categoryId on create**

In `app/api/admin/document-types/route.ts` the `POST` already does `prisma.documentType.create({ data: norm.value })`. Because `norm.value` now includes `categoryId`, no change is needed beyond Step 1. Confirm `create` compiles with the new field.

- [ ] **Step 3: Confirm update route uses normalizer**

`app/api/admin/document-types/[id]/route.ts` `PATCH` uses `normalizeDocumentTypeInput` and writes `norm.value`; the new `categoryId` flows through automatically. No change needed beyond Step 1.

- [ ] **Step 4: Load categories + map categoryId in the server page**

In `app/admin/document-types/page.tsx`:
- After loading `types`, also load:
```tsx
  const categories = await prisma.documentCategory.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true } });
```
- Extend each row mapping with `categoryId: t.categoryId,`.
- Pass `categories={categories}` to `<DocumentTypesClient ... />`.
- In `DocumentTypeRow` (defined in the client) add `categoryId: string | null;` — done in Step 5.

- [ ] **Step 5: Client — combo box for category + Categories tab**

In `app/admin/document-types/document-types-client.tsx`:
- Add imports:
```tsx
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
```
- Extend `DocumentTypeRow` type with `categoryId: string | null;` and `FormState`/`EMPTY` with `categoryId: string | null` (default `null`).
- Change the component signature to accept categories and manage them locally:
```tsx
export function DocumentTypesClient({ rows, canManage, categories: initialCategories }: { rows: DocumentTypeRow[]; canManage: boolean; categories: { id: string; name: string }[] }) {
  const [categories, setCategories] = React.useState(initialCategories);
```
- In `openEdit`/`openDuplicate` set `categoryId: r.categoryId ?? null` (replace the old `category` string handling in form state; the free-text `category` is no longer edited).
- Replace the «Κατηγορία» field (the `<Input ... form.category ...>` block) with:
```tsx
            <div>
              <Label>Κατηγορία</Label>
              <Combobox
                value={form.categoryId}
                items={categories.map((c) => ({ value: c.id, label: c.name }))}
                onSelect={(v) => setForm({ ...form, categoryId: v })}
                allowCreate
                placeholder="Επίλεξε ή δημιούργησε κατηγορία…"
                onCreate={async (label) => {
                  const res = await fetch('/api/admin/document-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label }) });
                  const json = await res.json();
                  if (json.data) { setCategories((prev) => prev.some((c) => c.id === json.data.id) ? prev : [...prev, { id: json.data.id, name: json.data.name }]); setForm((f) => ({ ...f, categoryId: json.data.id })); }
                }}
              />
            </div>
```
- In the table «Κατηγορία» cell, replace `{r.category ?? '—'}` with the category name lookup:
```tsx
                <td className="px-3 py-2 text-muted-foreground">{categories.find((c) => c.id === r.categoryId)?.name ?? '—'}</td>
```
- Wrap the existing table + dialog in a Tabs with a second "Κατηγορίες" tab. Add the categories management UI:
```tsx
  const [catName, setCatName] = React.useState('');
  async function addCategory() {
    const name = catName.trim(); if (!name) return;
    const res = await fetch('/api/admin/document-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const json = await res.json();
    if (json.data) setCategories((p) => p.some((c) => c.id === json.data.id) ? p : [...p, { id: json.data.id, name: json.data.name }]);
    setCatName('');
  }
  async function removeCategory(id: string) {
    const res = await fetch(`/api/admin/document-categories/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    setCategories((p) => p.filter((c) => c.id !== id));
  }
```
and render (place the existing types table inside `<TabsContent value="types">` and add):
```tsx
      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">Τύποι</TabsTrigger>
          <TabsTrigger value="categories">Κατηγορίες</TabsTrigger>
        </TabsList>
        <TabsContent value="types">{/* existing create button + table + dialog */}</TabsContent>
        <TabsContent value="categories">
          <div className="space-y-3">
            {canManage && (
              <div className="flex gap-2">
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Νέα κατηγορία" onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
                <Button onClick={addCategory}><FiPlus className="mr-1.5" /> Προσθήκη</Button>
              </div>
            )}
            <ul className="rounded-md border border-border divide-y divide-border">
              {categories.length === 0 && <li className="px-3 py-2 text-muted-foreground text-body-sm">Καμία κατηγορία.</li>}
              {categories.map((c) => (
                <li key={c.id} className="flex items-center px-3 py-2 text-body-sm">
                  <span className="flex-1">{c.name}</span>
                  {canManage && <Button size="icon" variant="ghost" onClick={() => removeCategory(c.id)} aria-label="Διαγραφή"><FiTrash2 /></Button>}
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>
```

- [ ] **Step 6: Data migration — backfill categories from the old free-text `category`**

Create a one-off script `scripts/migrate-document-categories.js`:

```javascript
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const types = await prisma.documentType.findMany({ where: { category: { not: null }, categoryId: null } });
  const seen = new Map();
  for (const t of types) {
    const name = (t.category || '').trim();
    if (!name) continue;
    let cat = seen.get(name);
    if (!cat) {
      cat = await prisma.documentCategory.upsert({ where: { name }, update: {}, create: { name } });
      seen.set(name, cat);
    }
    await prisma.documentType.update({ where: { id: t.id }, data: { categoryId: cat.id } });
  }
  console.log(`✓ Migrated ${types.length} document types into ${seen.size} categories`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Run: `node scripts/migrate-document-categories.js`
Expected: `✓ Migrated N document types into M categories` (N/M may be 0 if no free-text categories existed).

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors in touched files).
Manually: open `/admin/document-types`, create a type, pick/create a category via the combo box; check the "Κατηγορίες" tab lists it.

- [ ] **Step 8: Commit**

```bash
git add lib/documents/document-types.ts app/api/admin/document-types app/admin/document-types scripts/migrate-document-categories.js
git commit -m "feat(document-types): managed categories via creatable combobox + tab"
```

> **Note:** The old `DocumentType.category` text column is intentionally retained until this ships and is verified in production, then dropped in a follow-up migration. Do not drop it in this plan.

---

### Task 13: Phase add — creatable combo box from PhaseTemplate

**Files:**
- Modify: `app/api/admin/programs/[id]/phases/route.ts`
- Modify: `app/api/admin/programs/[id]/phases/[phaseId]/route.ts`
- Modify: `app/admin/programs/[id]/phases-tab.tsx`

- [ ] **Step 1: Accept `phaseTemplateId` on phase create**

In `app/api/admin/programs/[id]/phases/route.ts` `POST`, after computing `name`, read an optional template id and set it on create:
```typescript
  const phaseTemplateId = typeof body.phaseTemplateId === 'string' && body.phaseTemplateId.trim() ? body.phaseTemplateId.trim() : null;
```
Change the create call to:
```typescript
  const phase = await prisma.programPhase.create({ data: { programId: id, name, order: count, phaseTemplateId } });
```

- [ ] **Step 2: Fetch phase templates in the tab + use the Combobox for adding a phase**

In `app/admin/programs/[id]/phases-tab.tsx`:
- Add import: `import { Combobox } from '@/components/ui/combobox';`
- Add state + load for templates:
```tsx
  const [templates, setTemplates] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => { fetch('/api/admin/phase-templates').then((r) => r.json()).then((j) => setTemplates(j.data ?? [])); }, []);
```
- Replace the "add phase" `<Input>`+`<Button>` block (currently using `newName`) with a creatable combo:
```tsx
      {canManage && (
        <div className="flex gap-2 items-center">
          <div className="w-72">
            <Combobox
              value={null}
              items={templates.map((t) => ({ value: t.id, label: t.name }))}
              placeholder="Προσθήκη φάσης (π.χ. Υποβολή)…"
              allowCreate
              onSelect={async (id) => {
                const t = templates.find((x) => x.id === id); if (!t) return;
                await fetch(`/api/admin/programs/${programId}/phases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: t.name, phaseTemplateId: t.id }) });
                load();
              }}
              onCreate={async (label) => {
                const res = await fetch('/api/admin/phase-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label }) });
                const json = await res.json();
                if (json.data) {
                  setTemplates((p) => p.some((x) => x.id === json.data.id) ? p : [...p, { id: json.data.id, name: json.data.name }]);
                  await fetch(`/api/admin/programs/${programId}/phases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: json.data.name, phaseTemplateId: json.data.id }) });
                  load();
                }
              }}
            />
          </div>
        </div>
      )}
```
- Remove the now-unused `newName` state and `addPhase` function (the old `<Input>` referencing them is gone).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors).
Manually: in a program's «Φάσεις & Δικαιολογητικά» tab, add a phase by picking a template and by typing a new name (which creates a template).

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/programs/[id]/phases app/admin/programs/[id]/phases-tab.tsx
git commit -m "feat(phases): add phases via creatable phase-template combobox"
```

---

## Phase 4 — Company resolution, requirement scoping, auto-derived documents

### Task 14: Company business-type resolution + form field

**Files:**
- Create: `app/api/admin/business-types/resolve/route.ts`
- Modify: the company save route (find via grep below)
- Modify: `app/admin/companies/companies-view.tsx`

- [ ] **Step 1: Locate the company save route and lookups source**

Run: `grep -rln "legalTypeId" app/api/admin/companies lib | head` and `grep -rln "legalTypes" app/api/admin | head`
Open the route that handles company create/update (the one writing `legalForm`/`legalTypeId`) and the one returning `lookups` (legalTypes etc.). You will modify the save route (Step 3) and the lookups route (Step 4).

- [ ] **Step 2: Add a bulk re-resolve endpoint (used after ΓΕΜΗ/AADE sync or mapping changes)**

`app/api/admin/business-types/resolve/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { resolveBusinessTypeId } from '@/lib/companies/business-type';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Re-resolves businessTypeId for all companies that are NOT manually overridden.
export async function POST() {
  await requirePermission('metadata.manage');
  const catalog = await prisma.businessType.findMany({ select: { id: true, code: true } });
  const companies = await prisma.company.findMany({
    where: { businessTypeOverride: false },
    select: { id: true, legalForm: true, businessTypeId: true, legalTypeRef: { select: { descr: true } } },
  });
  let changed = 0;
  for (const c of companies) {
    const next = resolveBusinessTypeId(
      { legalForm: c.legalForm, legalTypeDescr: c.legalTypeRef?.descr ?? null, businessTypeId: c.businessTypeId, businessTypeOverride: false },
      catalog,
    );
    if (next !== c.businessTypeId) { await prisma.company.update({ where: { id: c.id }, data: { businessTypeId: next } }); changed++; }
  }
  return NextResponse.json({ ok: true, changed });
}
```

- [ ] **Step 3: Resolve on company save (when not overridden)**

In the company save route, after the company row is created/updated and you have its `id`, add a resolution pass. Insert this helper call (adjust the variable holding the saved company id to `companyId`):

```typescript
import { resolveBusinessTypeId } from '@/lib/companies/business-type';
// … after save …
{
  // body may include businessTypeId (manual override from the form) + businessTypeOverride flag.
  const override = body.businessTypeOverride === true;
  if (override) {
    await prisma.company.update({ where: { id: companyId }, data: { businessTypeOverride: true, businessTypeId: typeof body.businessTypeId === 'string' && body.businessTypeId ? body.businessTypeId : null } });
  } else {
    const saved = await prisma.company.findUnique({ where: { id: companyId }, select: { legalForm: true, businessTypeId: true, legalTypeRef: { select: { descr: true } } } });
    const catalog = await prisma.businessType.findMany({ select: { id: true, code: true } });
    const next = resolveBusinessTypeId({ legalForm: saved?.legalForm ?? null, legalTypeDescr: saved?.legalTypeRef?.descr ?? null, businessTypeId: saved?.businessTypeId ?? null, businessTypeOverride: false }, catalog);
    await prisma.company.update({ where: { id: companyId }, data: { businessTypeOverride: false, businessTypeId: next } });
  }
}
```
(If the save route does not currently `select`/`include` `legalTypeRef`, the standalone queries above handle it independently.)

- [ ] **Step 4: Add `businessTypes` to the company lookups response**

In the lookups route identified in Step 1 (the one returning `legalTypes`, `vatCategories`, …), add:
```typescript
  const businessTypes = await prisma.businessType.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true } });
```
and include `businessTypes` in the JSON response object.

- [ ] **Step 5: Add the form field in companies-view.tsx**

In `app/admin/companies/companies-view.tsx`:
- Extend the `lookups` state type with `businessTypes: { id: string; code: string; name: string }[];`.
- In the `setForm({...})` load block add: `businessTypeId: c.businessTypeId ?? '', businessTypeOverride: c.businessTypeOverride ?? false,`
- Near the «Νομική μορφή» field (around the `LookupSelect` for legalForm), add a new field using the existing `Field` + a native select (the page already uses `<select>`/`LookupSelect`; use a native select for simplicity):
```tsx
<Field label="Τύπος (νομική μορφή) για δικαιολογητικά" id="c-btype">
  <select
    id="c-btype"
    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-body-sm"
    value={form.businessTypeId ?? ''}
    onChange={(e) => { set('businessTypeId', e.target.value); set('businessTypeOverride', e.target.value !== ''); }}
  >
    <option value="">(αυτόματα από τη νομική μορφή)</option>
    {(lookups?.businessTypes ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
  </select>
</Field>
```
(Selecting a value sets the manual override; the empty option reverts to automatic resolution on save.)
- Ensure the save payload includes `businessTypeId` and `businessTypeOverride` (they are part of `form`; confirm the submit sends the whole form or add them explicitly).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors in touched files).
Manually: edit a company whose `legalForm` is e.g. "ΙΚΕ" → save with the select on "(αυτόματα)" → reload and confirm its business type resolves to ΙΚΕ; then set an explicit override and confirm it sticks after save.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/business-types/resolve app/admin/companies/companies-view.tsx
git add <company-save-route> <company-lookups-route>
git commit -m "feat(companies): resolve + override business type on the company form"
```

---

### Task 15: Requirement business-types API + eligible options + phases include

**Files:**
- Modify: `app/api/admin/programs/[id]/phases/route.ts`
- Create: `app/api/admin/programs/[id]/phases/[phaseId]/requirements/[reqId]/business-types/route.ts`
- Create: `app/api/admin/programs/[id]/eligible-business-types/route.ts`

- [ ] **Step 1: Include `appliesToAll` + `businessTypes` in the phases GET**

In `app/api/admin/programs/[id]/phases/route.ts` `GET`, change the `include` to:
```typescript
    include: {
      requirements: {
        include: {
          documentType: { select: { id: true, name: true } },
          businessTypes: { select: { businessTypeId: true } },
        },
      },
    },
```
(`appliesToAll` is a scalar on the requirement and is returned automatically.)

- [ ] **Step 2: Create the PUT endpoint that sets a requirement's scope**

`app/api/admin/programs/[id]/phases/[phaseId]/requirements/[reqId]/business-types/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; phaseId: string; reqId: string }> }) {
  await requirePermission('programs.update');
  const { id, phaseId, reqId } = await params;
  const body = await req.json().catch(() => ({}));
  const appliesToAll = body.appliesToAll === true;
  const businessTypeIds: string[] = Array.isArray(body.businessTypeIds) ? body.businessTypeIds.filter((x: unknown) => typeof x === 'string') : [];

  // Verify the requirement belongs to the phase belongs to the program.
  const reqRow = await prisma.phaseDocumentRequirement.findFirst({
    where: { id: reqId, phaseId, phase: { programId: id } },
    select: { id: true },
  });
  if (!reqRow) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Validate ids exist as BusinessType rows (ignore unknown ids).
  const valid = appliesToAll ? [] : (await prisma.businessType.findMany({ where: { id: { in: businessTypeIds } }, select: { id: true } })).map((b) => b.id);

  await prisma.$transaction([
    prisma.phaseDocumentRequirement.update({ where: { id: reqId }, data: { appliesToAll } }),
    prisma.requirementBusinessType.deleteMany({ where: { requirementId: reqId } }),
    ...(valid.length ? [prisma.requirementBusinessType.createMany({ data: valid.map((businessTypeId) => ({ requirementId: reqId, businessTypeId })) })] : []),
  ]);

  return NextResponse.json({ ok: true, appliesToAll, businessTypeIds: valid });
}
```

- [ ] **Step 3: Create the eligible-business-types GET endpoint**

`app/api/admin/programs/[id]/eligible-business-types/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { eligibleBusinessTypeIds } from '@/lib/programs/eligible-business-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const [forms, catalog] = await Promise.all([
    prisma.programEligibleLegalForm.findMany({ where: { programId: id }, select: { name: true } }),
    prisma.businessType.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true } }),
  ]);
  const eligibleIds = eligibleBusinessTypeIds(forms.map((f) => f.name), catalog);
  // If the scan produced no recognisable forms, fall back to the whole active catalog.
  const options = eligibleIds.size ? catalog.filter((b) => eligibleIds.has(b.id)) : catalog;
  return NextResponse.json({ data: options, derivedFromScan: eligibleIds.size > 0 });
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/programs/[id]/phases/route.ts app/api/admin/programs/[id]/phases/[phaseId]/requirements/[reqId] app/api/admin/programs/[id]/eligible-business-types
git commit -m "feat(api): requirement business-type scope (PUT) + eligible options"
```

---

### Task 16: Phases tab — per-requirement business-type scoping UI

**Files:**
- Modify: `app/admin/programs/[id]/phases-tab.tsx`

- [ ] **Step 1: Extend types + load eligible options**

In `app/admin/programs/[id]/phases-tab.tsx`:
- Update the `Requirement` type:
```tsx
type Requirement = { id: string; documentTypeId: string; mandatory: boolean; appliesToAll: boolean; businessTypes: { businessTypeId: string }[]; documentType: { id: string; name: string } };
```
- Add state + load for eligible business types:
```tsx
  const [bizTypes, setBizTypes] = React.useState<{ id: string; code: string; name: string }[]>([]);
  React.useEffect(() => { fetch(`/api/admin/programs/${programId}/eligible-business-types`).then((r) => r.json()).then((j) => setBizTypes(j.data ?? [])); }, [programId]);
```

- [ ] **Step 2: Add a scope setter + render the multi-select per requirement**

Add this function inside the component:
```tsx
  async function setScope(phaseId: string, reqId: string, appliesToAll: boolean, businessTypeIds: string[]) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements/${reqId}/business-types`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliesToAll, businessTypeIds }),
    });
    load();
  }
```
In the requirement row (inside `p.requirements.map((r) => ...)`), below the existing name + mandatory controls, add the scope UI (only when `canManage`):
```tsx
                {canManage && (
                  <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 pl-1">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={r.appliesToAll} onChange={(e) => setScope(p.id, r.id, e.target.checked, e.target.checked ? [] : r.businessTypes.map((b) => b.businessTypeId))} className="h-3.5 w-3.5" />
                      Όλες οι μορφές
                    </label>
                    {!r.appliesToAll && bizTypes.map((b) => {
                      const on = r.businessTypes.some((x) => x.businessTypeId === b.id);
                      return (
                        <button key={b.id} type="button"
                          onClick={() => setScope(p.id, r.id, false, on ? r.businessTypes.filter((x) => x.businessTypeId !== b.id).map((x) => x.businessTypeId) : [...r.businessTypes.map((x) => x.businessTypeId), b.id])}
                          className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                          {b.code}
                        </button>
                      );
                    })}
                    {!r.appliesToAll && r.businessTypes.length === 0 && (
                      <span className="text-xs text-amber-600">⚠ δεν θα ζητηθεί από καμία εταιρία</span>
                    )}
                  </div>
                )}
```
- For the read-only branch (`!canManage`), optionally show the selected codes as badges (use `r.appliesToAll ? 'Όλες' : r.businessTypes...`); a minimal text line is acceptable.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors).
Manually: in a program with scanned legal forms, the chips show only those forms; toggling chips and «Όλες» persists after reload; a requirement with no chips and not-all shows the amber warning.

- [ ] **Step 4: Commit**

```bash
git add app/admin/programs/[id]/phases-tab.tsx
git commit -m "feat(phases): per-requirement business-type scoping UI (program-eligible forms)"
```

---

### Task 17: Auto-derived required-documents API + AssessmentDialog section

**Files:**
- Create: `app/api/admin/companies/[id]/required-documents/route.ts`
- Modify: `components/companies/assessment-dialog.tsx`

- [ ] **Step 1: Create the derivation endpoint**

`app/api/admin/companies/[id]/required-documents/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { requirementApplies } from '@/lib/documents/requirement-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.read');
  const { id } = await params;
  const programId = new URL(req.url).searchParams.get('programId') ?? '';
  if (!programId) return NextResponse.json({ error: 'programId required' }, { status: 400 });

  const company = await prisma.company.findUnique({ where: { id }, select: { businessTypeId: true, businessType: { select: { name: true } } } });
  if (!company) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const phases = await prisma.programPhase.findMany({
    where: { programId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      requirements: {
        include: { documentType: { select: { id: true, name: true } }, businessTypes: { select: { businessTypeId: true } } },
      },
    },
  });

  const result = phases.map((ph) => ({
    phaseId: ph.id,
    phaseName: ph.name,
    requirements: ph.requirements
      .filter((r) => requirementApplies({ id: r.id, appliesToAll: r.appliesToAll, businessTypeIds: r.businessTypes.map((b) => b.businessTypeId) }, company.businessTypeId))
      .map((r) => ({ id: r.id, documentTypeId: r.documentTypeId, name: r.documentType.name, mandatory: r.mandatory })),
  })).filter((ph) => ph.requirements.length > 0);

  return NextResponse.json({
    businessTypeId: company.businessTypeId,
    businessTypeName: company.businessType?.name ?? null,
    phases: result,
  });
}
```

- [ ] **Step 2: Render the required-documents section in AssessmentDialog**

In `components/companies/assessment-dialog.tsx`:
- Add state + load that runs when a program is selected (use the same `presetProgramId`/selected program id the dialog already tracks; call it `programId`):
```tsx
  const [reqDocs, setReqDocs] = React.useState<{ businessTypeName: string | null; phases: { phaseId: string; phaseName: string; requirements: { id: string; name: string; mandatory: boolean }[] }[] } | null>(null);
  React.useEffect(() => {
    if (!companyId || !programId) { setReqDocs(null); return; }
    fetch(`/api/admin/companies/${companyId}/required-documents?programId=${programId}`).then((r) => r.json()).then(setReqDocs).catch(() => setReqDocs(null));
  }, [companyId, programId]);
```
- Add the rendering block inside the dialog body (e.g. after the criteria table):
```tsx
  {reqDocs && (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Απαιτούμενα δικαιολογητικά {reqDocs.businessTypeName ? <Badge variant="outline">{reqDocs.businessTypeName}</Badge> : null}</h4>
      {!reqDocs.businessTypeName && (
        <p className="text-xs text-amber-600">⚠ Η εταιρία δεν έχει αναγνωρισμένη νομική μορφή — όρισέ τη στην καρτέλα εταιρίας ώστε να φιλτράρονται σωστά τα δικαιολογητικά.</p>
      )}
      {reqDocs.phases.length === 0 ? (
        <p className="text-xs text-muted-foreground">Κανένα δικαιολογητικό για αυτόν τον τύπο εταιρίας.</p>
      ) : reqDocs.phases.map((ph) => (
        <div key={ph.phaseId}>
          <div className="text-xs font-medium text-muted-foreground">{ph.phaseName}</div>
          <ul className="ml-3 list-disc">
            {ph.requirements.map((r) => (
              <li key={r.id} className="text-body-sm">{r.name} {r.mandatory ? <Badge variant="secondary" className="ml-1">Υποχρεωτικό</Badge> : <span className="text-xs text-muted-foreground">(προαιρετικό)</span>}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )}
```
(If the dialog's selected-program variable has a different name, adapt `programId` accordingly — grep the file for `presetProgramId` / `programId` / the program `<select>`.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors).
Manually: open the assessment dialog for a company on a program; the required documents list shows only the requirements matching the company's business type; a company with no resolved type shows the amber warning.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/companies/[id]/required-documents components/companies/assessment-dialog.tsx
git commit -m "feat(companies): auto-derived required documents in assessment dialog"
```

---

## Phase 5 — Wiki (mandatory per CLAUDE.md)

### Task 18: Wiki entries + helpAnchors

**Files:**
- Create/scaffold: `docs/wiki/companies/business-types.mdx`
- Create/scaffold: `docs/wiki/companies/required-documents.mdx`
- Modify: `docs/wiki/documents/document-types.mdx`
- Modify: the program phases wiki page (find under `docs/wiki/`)
- Modify: `lib/wiki/modules-meta.ts` (only if a needed module is missing)
- Verify `helpAnchor` props on the relevant `<PageHeader>`s

- [ ] **Step 1: Scaffold the new wiki pages**

Run:
```bash
npm run wiki:new -- companies/business-types --roles "ADMIN,EMPLOYEE" --title "Νομικές Μορφές"
npm run wiki:new -- companies/required-documents --roles "ADMIN,EMPLOYEE" --title "Απαιτούμενα Δικαιολογητικά ανά Εταιρία"
```
Expected: two new `.mdx` files created under `docs/wiki/companies/`. If the `companies` module is missing from `lib/wiki/modules-meta.ts`, the command will say so — add a module entry (label «Εταιρίες», description, icon, gradient hex colors) following the existing entries, then re-run.

- [ ] **Step 2: Write `docs/wiki/companies/business-types.mdx` content (Greek)**

Set frontmatter `helpAnchors: [business-types]` and `description:`; body:
```mdx
## Επισκόπηση
Ο κατάλογος **Νομικών Μορφών** ορίζει τους τύπους επιχειρήσεων (ΑΕ, ΕΠΕ, ΙΚΕ, ΟΕ, ΕΕ, Ατομική…) που χρησιμοποιεί η εφαρμογή για να ζητά τα σωστά δικαιολογητικά ανά τύπο εταιρίας.

<Callout type="info">
Ο τύπος κάθε εταιρίας αναγνωρίζεται **αυτόματα** από τη νομική της μορφή (ΑΑΔΕ/ΓΕΜΗ). Μπορείς να τον αλλάξεις χειροκίνητα στην καρτέλα της εταιρίας.
</Callout>

<Steps>
<li>Δες/επεξεργάσου τις μορφές εδώ (κωδικός = canonical, ονομασία = εμφάνιση).</li>
<li>Σε κάθε πρόγραμμα, τα δικαιολογητικά συνδέονται με μία ή περισσότερες μορφές.</li>
<li>Όταν εντάσσεται μια εταιρία, ζητούνται μόνο τα δικαιολογητικά της μορφής της.</li>
</Steps>
```

- [ ] **Step 3: Write `docs/wiki/companies/required-documents.mdx` content (Greek)**

Set frontmatter `helpAnchors: [required-documents]`; body explains that the list is auto-derived from the company's legal form × the program's requirements, shown in the assessment dialog, with the warning when the type is unresolved. Use `<Callout type="warning">` for the unresolved-type note.

- [ ] **Step 4: Update existing wiki pages**

- In `docs/wiki/documents/document-types.mdx`: add a short section that the «Κατηγορία» is now a managed catalog (creatable combo box) with a «Κατηγορίες» tab.
- In the program phases wiki page: add a section that each requirement can be scoped to one or more legal forms (limited to the program's scanned forms) or to «Όλες», and that empty scope means requested from nobody. Use a `<Callout type="warning">` for the empty-scope gotcha.

- [ ] **Step 5: Add/verify `helpAnchor` on PageHeaders**

- Confirm `app/admin/business-types/page.tsx` `<PageHeader helpAnchor="business-types" />` (added in Task 9).
- Confirm `app/admin/document-types/page.tsx` keeps `helpAnchor="document-types"`.
- The phases scoping lives inside the program editor tab; if the program detail `<PageHeader>` has no helpAnchor for phases, add `helpAnchor="program-phases"` (matching the phases wiki page's `helpAnchors`).

- [ ] **Step 6: Rebuild the wiki search index**

Run: `npm run wiki:index`
Expected: `public/wiki/index.json` updated without error.

- [ ] **Step 7: Commit**

```bash
git add docs/wiki lib/wiki/modules-meta.ts public/wiki/index.json app/admin/programs/[id]/page.tsx
git commit -m "docs(wiki): business types, required documents, scoped requirements + helpAnchors"
```

---

## Final verification

- [ ] **Run the full unit suite for the new libs**

Run: `npx vitest run lib/companies/__tests__/business-type.test.ts lib/programs/__tests__/eligible-business-types.test.ts lib/documents/__tests__/requirement-scope.test.ts lib/documents/__tests__/document-categories.test.ts`
Expected: all PASS.

- [ ] **Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no NEW errors introduced by this work (compare against the known pre-existing baseline — see memory `espa-build-prexisting-state`; do not be alarmed by unrelated pre-existing failures, but confirm none are in files this plan created/modified).

- [ ] **End-to-end manual smoke**

With `npm run dev`: (1) seed shows 10 business types at `/admin/business-types`; (2) a document type can pick/create a category; (3) a program phase can be added via the template combo; (4) a requirement can be scoped to specific scanned forms or «Όλες»; (5) a company resolves/overrides its business type; (6) the assessment dialog lists exactly the documents matching the company's type.

---

## Self-review notes (coverage map)

- Spec §1.1 BusinessType → Task 1, 2, 8, 9.
- Spec §1.2 company resolution via canonicalLegalForm → Task 4, 14.
- Spec §1.3 RequirementBusinessType + appliesToAll + matching + eligible options → Task 1, 6, 15, 16.
- Spec §1.4 DocumentCategory + categoryId → Task 1, 10, 12.
- Spec §1.5 PhaseTemplate + ProgramPhase link → Task 1, 11, 13.
- Spec §2 API routes → Task 8, 10, 11, 13, 14, 15, 17.
- Spec §3 UI (business-types page, company field, doc-types combo+tab, phases combo+scope, derived docs) → Task 9, 12, 13, 14, 16, 17.
- Spec §3.5 auto-derived list → Task 17.
- Spec §4 pure modules → Task 4, 5, 6, 7.
- Spec §5 seeding + wiki → Task 2, 18.
- Spec §6 testing → Task 4, 5, 6, 7 + Final verification.
