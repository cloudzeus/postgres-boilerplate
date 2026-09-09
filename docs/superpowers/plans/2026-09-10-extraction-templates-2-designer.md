# Extraction Templates — Plan 2/4: Designer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing designer for supplier extraction templates: a list page (replacing the legacy supplier-templates page), a five-step designer (supplier, sample, regions & fields with per-field colours and live "test field", mapping to invoice keys or Excel columns, conditions & mode), and a live React Flow panel generated from the saved configuration.

**Architecture:** Server pages load the `TemplateDto` from Prisma via `toTemplateDto` and hand it to one client `TemplateDesigner` that owns the DTO state, calls the plan-1 API routes (`PATCH /templates/[id]`, `POST …/sample`, `PUT …/fields|mappings|conditions`, `POST …/test-field`) and re-renders the flow through the pure `buildFlow`. Every step is a focused client component; the region canvas reuses the existing `RegionMarker`. Design language: DG design system tokens (Sisyphus blue, warm neutrals, Fluent shadows), Greek copy, fluid type.

**Tech Stack:** Next.js 16 App Router, React 19, shadcn-style components in `components/ui`, `@xyflow/react` 12.11.x (new dependency), sonner toasts, react-icons/fi, vitest for the one pure addition.

**Spec:** `docs/superpowers/specs/2026-09-09-extraction-templates-design.md` §2 (files), §3α (designer flow), §5 (UI), §6 (permissions). **Plan 1** (merged) provides the API and pure modules.

---

## Conventions

- Work in a worktree on branch `feat/extraction-templates-designer` from `master`.
- Type-check: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"` (no output = clean). Tests: `npx vitest run`.
- Visual verification uses the running app (`.claude/launch.json` → `dev`) and the logged-in browser pane; each UI task ends with a screenshot check described in its last step.
- API responses used here (from plan 1):
  - `GET /api/admin/ocr/templates` → `{ templates: [{ id, name, vatNumber, supplierName, docType, mode, status, version, fieldsCount, runsCount, timesUsed, hasSample, updatedAt }] }`
  - `POST /api/admin/ocr/templates` `{ name, vatNumber, traderTrdr?, supplierName?, docType }` → 201 `{ ok, id }` | 409 duplicate
  - `GET/PATCH/DELETE /api/admin/ocr/templates/[id]` → `TemplateDto` (PATCH body: `name?, mode?, status?, notifyEmails?, traderTrdr?, supplierName?`; 422 `not_ready`, 403 for AUTO without `ocr.post`, 409 `has_history` on DELETE)
  - `POST …/[id]/sample` multipart `file` → `{ ok, mimeType, pageCount }`
  - `GET …/[id]/page-image?page=N&scale=3&v=<version>` → webp
  - `PUT …/[id]/fields` `{ fields: FieldSchema[] }` → `TemplateDto & { cleanup: { mappings: [{name, removedRows}], conditions: [{id, name, removedClauses, removedActions}] } }`
  - `PUT …/[id]/mappings` `{ mappings }` → `TemplateDto` | 422 `unknown_field|multiple_tables|table_to_header|single_to_line`
  - `PUT …/[id]/conditions` `{ conditions }` → `TemplateDto` | 422 `unknown_field|unknown_mapping|foreign_condition`
  - `POST …/[id]/test-field` `{ fieldKey, region? }` → `{ raw, value, source, model, tokensUsed, color, durationMs }` | 422 `no_sample|no_region` | 502 `read_failed`
  - `GET /api/admin/softone/search?type=suppliers&q=` → `{ results: [{ id: trdr, code, name, sub }] }` (needs ≥2 chars)
- `TemplateDto` type: `import type { TemplateDto } from '@/lib/templates/serialize'` (type-only import is erased, so the `server-only` guard is not triggered in client components).
- All user-facing strings Greek. Colours from `COLOR_PALETTE`; region overlays use the field colour (`RegionMarker` `savedRegions[].color`).

---

## File structure

| File | Responsibility |
|---|---|
| `lib/templates/flow.ts` (+test) | add `toFlowTemplate(dto)` adapter so designer and run views share one mapping |
| `lib/templates/labels.ts` | isomorphic Greek labels for enums (mode, status, kind, valueType, ops, actions, invoice keys grouped) |
| `components/templates/api.ts` | tiny typed fetch helpers for the template endpoints + error → Greek message |
| `app/admin/ocr/templates/page.tsx` | list page (server) — replaces legacy |
| `app/admin/ocr/templates/templates-table.tsx` | client DataTable with badges, open/delete actions |
| `app/admin/ocr/templates/new-template-dialog.tsx` | create dialog with supplier search |
| `app/admin/ocr/templates/[id]/page.tsx` | designer page (server: load DTO) |
| `components/templates/template-designer.tsx` | shell: stepper, DTO state, save helpers, flow panel slot |
| `components/templates/supplier-step.tsx` | name / supplier / docType |
| `components/templates/sample-step.tsx` | upload sample, thumbnail, page count |
| `components/templates/regions-step.tsx` | canvas + field list + field form + test field |
| `components/templates/field-form.tsx` | one field's form (label, kind, type, colour, hint, required, columns) |
| `components/templates/mapping-step.tsx` | mappings editor |
| `components/templates/conditions-step.tsx` | rules editor + mode + notify + activate |
| `components/templates/flow-panel.tsx` | React Flow renderer with custom nodes |
| `components/admin/sidebar.tsx` | nav entry |
| `docs/wiki/ocr/templates.mdx`, `lib/wiki/modules-meta.ts` (no change needed: module `ocr` exists) | wiki |
| `docs/manual/CHANGELOG.md` | entry |

Delete: `app/admin/ocr/templates/delete-button.tsx` (legacy).

---

### Task 1: Dependency, flow adapter, labels

**Files:**
- Modify: `package.json` (via npm)
- Modify: `lib/templates/flow.ts`
- Create: `lib/templates/labels.ts`
- Test: `lib/templates/__tests__/flow.test.ts` (append)

- [ ] **Step 1: Install React Flow**

Run: `npm install @xyflow/react@12.11.6 --no-audit --no-fund`
Expected: `added 1 package` (or a few), `package.json` gains `"@xyflow/react": "^12.11.6"`.

- [ ] **Step 2: Write the failing adapter test** (append to `lib/templates/__tests__/flow.test.ts`)

```ts
import { toFlowTemplate } from '../flow';

describe('toFlowTemplate', () => {
  it('projects a TemplateDto-shaped object onto FlowTemplate, dropping extra keys', () => {
    const dto = {
      id: 't', name: 'N', mode: 'AUTO' as const, sample: { mimeType: 'image/png', pageCount: 3, thumbUrl: '/x' },
      fields: [{ key: 'a', label: 'A', color: '#000000', kind: 'SINGLE' as const, valueType: 'TEXT' as const, region: null, columns: null, aiHint: null, required: false, order: 0 }],
      mappings: [{ id: 'm1', name: 'default', target: 'INVOICE' as const, isDefault: true, rows: [{ fieldKey: 'a', invoiceKey: 'invoiceNumber' }] }],
      conditions: [{ id: 'c1', name: 'C', order: 0, isActive: true, logic: 'AND' as const, clauses: [], actions: [] }],
    };
    const ft = toFlowTemplate(dto);
    expect(ft).toEqual({
      id: 't', name: 'N', mode: 'AUTO', samplePageCount: 3,
      fields: [{ key: 'a', label: 'A', color: '#000000', kind: 'SINGLE', region: null }],
      conditions: [{ id: 'c1', name: 'C', clauses: [], actions: [] }],
      mappings: [{ name: 'default', target: 'INVOICE', rows: [{ fieldKey: 'a', invoiceKey: 'invoiceNumber' }] }],
    });
  });
  it('uses null page count when there is no sample and skips inactive conditions', () => {
    const ft = toFlowTemplate({ id: 't', name: 'N', mode: 'MANUAL', sample: null, fields: [], mappings: [], conditions: [{ id: 'c', name: 'off', order: 0, isActive: false, logic: 'AND', clauses: [], actions: [] }] });
    expect(ft.samplePageCount).toBeNull();
    expect(ft.conditions).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test → FAIL** (`toFlowTemplate` not exported).

- [ ] **Step 4: Add the adapter to `lib/templates/flow.ts`** (append)

```ts
/** Minimal DTO shape the adapter needs — matches `TemplateDto` from serialize.ts without importing it (keeps this module isomorphic). */
export type FlowTemplateSource = {
  id: string;
  name: string;
  mode: TemplateMode;
  sample: { pageCount: number } | null;
  fields: { key: string; label: string; color: string; kind: TemplateFieldKind; region: Region | null }[];
  mappings: { name: string; target: MappingTarget; rows: { fieldKey: string; [k: string]: unknown }[] }[];
  conditions: { id: string; name: string; isActive: boolean; clauses: Clause[]; actions: Action[] }[];
};

/** Designer and run-result views both go through this, so the diagram never drifts between them. */
export function toFlowTemplate(dto: FlowTemplateSource): FlowTemplate {
  return {
    id: dto.id,
    name: dto.name,
    mode: dto.mode,
    samplePageCount: dto.sample?.pageCount ?? null,
    fields: dto.fields.map((f) => ({ key: f.key, label: f.label, color: f.color, kind: f.kind, region: f.region })),
    conditions: dto.conditions.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, clauses: c.clauses, actions: c.actions })),
    mappings: dto.mappings.map((m) => ({ name: m.name, target: m.target, rows: m.rows })),
  };
}
```

- [ ] **Step 5: Create `lib/templates/labels.ts`**

```ts
// lib/templates/labels.ts — ISOMORPHIC Greek labels for template enums (designer + run views).
import { INVOICE_SCHEMA, type ActionType, type ClauseOp, type TemplateFieldKind, type TemplateMode, type TemplateValueType } from './schema';

export const MODE_LABEL: Record<TemplateMode, string> = { AUTO: 'Αυτόματο', SEMI_AUTO: 'Ημιαυτόματο', MANUAL: 'Χειροκίνητο' };
export const MODE_HELP: Record<TemplateMode, string> = {
  AUTO: 'Εξαγωγή → mapping → conditions → ανάρτηση στο SoftOne χωρίς έλεγχο (εκτός αν κανόνας μπλοκάρει).',
  SEMI_AUTO: 'Εξαγωγή → mapping → conditions → «Προς έλεγχο». Η ανάρτηση γίνεται από χρήστη.',
  MANUAL: 'Μόνο εξαγωγή πεδίων. Τα υπόλοιπα γίνονται χειροκίνητα.',
};
export const STATUS_LABEL = { DRAFT: 'Πρόχειρο', ACTIVE: 'Ενεργό' } as const;
export const KIND_LABEL: Record<TemplateFieldKind, string> = { SINGLE: 'Απλή τιμή', TABLE: 'Πίνακας' };
export const VALUE_TYPE_LABEL: Record<TemplateValueType, string> = { TEXT: 'Κείμενο', NUMBER: 'Αριθμός', CURRENCY: 'Ποσό', DATE: 'Ημερομηνία', LIST: 'Λίστα' };
export const OP_LABEL: Record<ClauseOp, string> = {
  eq: 'ίσο με', neq: 'διάφορο από', gt: 'μεγαλύτερο από', gte: '≥', lt: 'μικρότερο από', lte: '≤',
  contains: 'περιέχει', notContains: 'δεν περιέχει', empty: 'είναι κενό', notEmpty: 'δεν είναι κενό', regex: 'ταιριάζει regex', in: 'είναι ένα από',
};
export const OPS_WITHOUT_VALUE: ClauseOp[] = ['empty', 'notEmpty'];
export const ACTION_LABEL: Record<ActionType, string> = {
  SET_FIELD: 'Όρισε τιμή', FLAG_REVIEW: 'Σήμανε για έλεγχο', BLOCK_POSTING: 'Μπλόκαρε ανάρτηση', SWITCH_MAPPING: 'Άλλαξε mapping', NOTIFY: 'Ειδοποίηση email',
};
export const EXTRA_VARS = [
  { key: '$total', label: 'Σύνολο τιμολογίου (OCR)' },
  { key: '$itemsCount', label: 'Πλήθος γραμμών (OCR)' },
  { key: '$pageCount', label: 'Πλήθος σελίδων' },
];
/** Invoice keys grouped for the mapping select. */
export const INVOICE_KEY_GROUPS = [
  { label: 'Κεφαλίδα', keys: INVOICE_SCHEMA.filter((k) => !k.isLine) },
  { label: 'Γραμμές', keys: INVOICE_SCHEMA.filter((k) => k.isLine) },
];
```

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run lib/templates; rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`
Expected: all pass (2 new); no tsc output.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/templates/flow.ts lib/templates/labels.ts lib/templates/__tests__/flow.test.ts
git commit -m "feat(templates): react-flow dependency, DTO→flow adapter, Greek labels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Client API helpers

**Files:**
- Create: `components/templates/api.ts`

- [ ] **Step 1: Create the helper module**

```ts
// components/templates/api.ts — CLIENT. Typed fetch helpers for the template endpoints + Greek error text.
import type { TemplateDto } from '@/lib/templates/serialize';
import type { FieldDef, Region } from '@/lib/templates/schema';

export type Cleanup = { mappings: { name: string; removedRows: number }[]; conditions: { id: string; name: string; removedClauses: number; removedActions: number }[] };
export type TestFieldResult = { raw: string | null; value: unknown; source: string; model: string | null; tokensUsed: number; color: string; durationMs: number };

const ERROR_TEXT: Record<string, string> = {
  invalid_body: 'Μη έγκυρα δεδομένα.',
  duplicate: 'Υπάρχει ήδη πρότυπο με αυτό το όνομα για τον προμηθευτή.',
  not_found: 'Δεν βρέθηκε.',
  not_ready: 'Για ενεργοποίηση χρειάζονται δείγμα, ένα πεδίο με περιοχή και ένα mapping.',
  forbidden: 'Δεν έχεις δικαίωμα για αυτή την ενέργεια.',
  has_history: 'Το πρότυπο έχει ιστορικό εκτελέσεων. Απενεργοποίησέ το αντί να το διαγράψεις.',
  unknown_field: 'Άγνωστο πεδίο.',
  multiple_tables: 'Το mapping χαρτογραφεί γραμμές από δύο πίνακες. Επίλεξε έναν.',
  table_to_header: 'Πεδίο πίνακα μπορεί να χαρτογραφηθεί μόνο σε στήλες γραμμών.',
  single_to_line: 'Απλό πεδίο δεν μπορεί να χαρτογραφηθεί σε στήλη γραμμών.',
  unknown_mapping: 'Άγνωστο mapping στον κανόνα.',
  foreign_condition: 'Μη έγκυρο αναγνωριστικό κανόνα.',
  no_sample: 'Ανέβασε πρώτα δείγμα.',
  no_region: 'Το πεδίο δεν έχει περιοχή.',
  read_failed: 'Η ανάγνωση απέτυχε.',
  unsupported_type: 'Μη υποστηριζόμενος τύπος αρχείου (PDF, PNG, JPEG, WebP).',
  too_large: 'Το αρχείο ξεπερνά τα 25 MB.',
  file_required: 'Επίλεξε αρχείο.',
};

export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string, public issues?: unknown) { super(message); }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: { error?: string; message?: string; issues?: unknown } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  const code = body.error ?? `http_${res.status}`;
  throw new ApiError(code, res.status, body.message ?? ERROR_TEXT[code] ?? `Σφάλμα (${res.status})`, body.issues);
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const base = (id: string) => `/api/admin/ocr/templates/${id}`;

export const templatesApi = {
  create: (b: { name: string; vatNumber: string; traderTrdr?: number | null; supplierName?: string | null; docType: 'INVOICE' | 'RECEIPT' }) =>
    fetch('/api/admin/ocr/templates', json(b)).then((r) => handle<{ ok: true; id: string }>(r)),
  get: (id: string) => fetch(base(id), { cache: 'no-store' }).then((r) => handle<TemplateDto>(r)),
  patch: (id: string, b: Partial<{ name: string; mode: TemplateDto['mode']; status: TemplateDto['status']; notifyEmails: string | null; traderTrdr: number | null; supplierName: string | null }>) =>
    fetch(base(id), json(b, 'PATCH')).then((r) => handle<TemplateDto>(r)),
  remove: (id: string) => fetch(base(id), { method: 'DELETE' }).then((r) => handle<{ ok: true }>(r)),
  uploadSample: (id: string, file: File) => { const fd = new FormData(); fd.append('file', file); return fetch(`${base(id)}/sample`, { method: 'POST', body: fd }).then((r) => handle<{ ok: true; mimeType: string; pageCount: number }>(r)); },
  putFields: (id: string, fields: FieldDef[]) => fetch(`${base(id)}/fields`, json({ fields }, 'PUT')).then((r) => handle<TemplateDto & { cleanup?: Cleanup }>(r)),
  putMappings: (id: string, mappings: TemplateDto['mappings']) => fetch(`${base(id)}/mappings`, json({ mappings }, 'PUT')).then((r) => handle<TemplateDto>(r)),
  putConditions: (id: string, conditions: TemplateDto['conditions']) => fetch(`${base(id)}/conditions`, json({ conditions }, 'PUT')).then((r) => handle<TemplateDto>(r)),
  testField: (id: string, fieldKey: string, region?: Region) => fetch(`${base(id)}/test-field`, json({ fieldKey, region })).then((r) => handle<TestFieldResult>(r)),
  searchSuppliers: (q: string) => fetch(`/api/admin/softone/search?type=suppliers&q=${encodeURIComponent(q)}`).then((r) => handle<{ results: { id: number; code: string; name: string; sub: string }[] }>(r)),
  pageImageUrl: (id: string, page: number, version: number, scale = 3) => `${base(id)}/page-image?page=${page}&scale=${scale}&v=${version}`,
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Απρόσμενο σφάλμα.';
}
```

- [ ] **Step 2: Type-check** → no output.

- [ ] **Step 3: Commit**

```bash
git add components/templates/api.ts
git commit -m "feat(templates): client api helpers with Greek error text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Templates list page (replaces legacy)

**Files:**
- Modify: `app/admin/ocr/templates/page.tsx` (rewrite)
- Create: `app/admin/ocr/templates/templates-table.tsx`
- Create: `app/admin/ocr/templates/new-template-dialog.tsx`
- Delete: `app/admin/ocr/templates/delete-button.tsx`
- Modify: `components/admin/sidebar.tsx` (nav entry)

- [ ] **Step 1: Rewrite `app/admin/ocr/templates/page.tsx`**

```tsx
import { FiLayers } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { TemplatesTable, type TemplateRow } from './templates-table';
import { NewTemplateDialog } from './new-template-dialog';

export const dynamic = 'force-dynamic';

// Πρότυπα εξαγωγής προμηθευτών — λίστα. Αντικαθιστά την παλιά σελίδα SupplierTemplate.
export default async function TemplatesPage() {
  await requirePermission('ocr.read');
  const [rows, canManage] = await Promise.all([
    prisma.extractionTemplate.findMany({
      orderBy: [{ supplierName: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { fields: true, runs: true } } },
    }),
    hasPermission('ocr.categorize'),
  ]);
  const data: TemplateRow[] = rows.map((t) => ({
    id: t.id, name: t.name, vatNumber: t.vatNumber, supplierName: t.supplierName, docType: t.docType,
    mode: t.mode, status: t.status, version: t.version, fieldsCount: t._count.fields, runsCount: t._count.runs,
    timesUsed: t.timesUsed, hasSample: !!t.sampleStorageKey, updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiLayers />}
        title="Πρότυπα προμηθευτών"
        description={`Περιοχές, πεδία, mapping και conditions ανά προμηθευτή (${data.length} πρότυπα).`}
        helpAnchor="templates"
        actions={canManage ? <NewTemplateDialog /> : undefined}
      />
      <TemplatesTable rows={data} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 2: Create `app/admin/ocr/templates/templates-table.tsx`**

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiEdit3, FiTrash2 } from 'react-icons/fi';
import { toast } from 'sonner';
import { DataTable, RowActionsTrigger } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MODE_LABEL, STATUS_LABEL } from '@/lib/templates/labels';
import { templatesApi, errorMessage } from '@/components/templates/api';

export type TemplateRow = {
  id: string; name: string; vatNumber: string; supplierName: string | null; docType: string;
  mode: 'AUTO' | 'SEMI_AUTO' | 'MANUAL'; status: 'DRAFT' | 'ACTIVE'; version: number;
  fieldsCount: number; runsCount: number; timesUsed: number; hasSample: boolean; updatedAt: string;
};

// Inline hex (DG palette) so the JIT never purges them.
const MODE_STYLE: Record<TemplateRow['mode'], { bg: string; fg: string }> = {
  AUTO: { bg: '#E8F7F0', fg: '#047857' }, SEMI_AUTO: { bg: '#EAF4FC', fg: '#0078D4' }, MANUAL: { bg: '#F3F2F1', fg: '#5C5C5C' },
};
const STATUS_STYLE = { ACTIVE: { bg: '#E8F7F0', fg: '#047857' }, DRAFT: { bg: '#FDF3E3', fg: '#B45309' } } as const;

const Pill = ({ text, bg, fg }: { text: string; bg: string; fg: string }) => (
  <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: bg, color: fg }}>{text}</span>
);

export function TemplatesTable({ rows, canManage }: { rows: TemplateRow[]; canManage: boolean }) {
  const router = useRouter();
  const remove = async (r: TemplateRow) => {
    if (!confirm(`Διαγραφή του προτύπου «${r.name}»;`)) return;
    try { await templatesApi.remove(r.id); toast.success('Διαγράφηκε'); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const columns = React.useMemo<ColumnDef<TemplateRow>[]>(() => [
    { accessorKey: 'supplierName', header: 'Προμηθευτής', size: 260, cell: ({ row }) => (
      <div className="min-w-0"><div className="truncate text-[12px] font-medium">{row.original.supplierName || '—'}</div><div className="font-mono text-[10px] text-muted-foreground">{row.original.vatNumber}</div></div>) },
    { accessorKey: 'name', header: 'Πρότυπο', size: 220, cell: ({ row }) => <button type="button" onClick={() => router.push(`/admin/ocr/templates/${row.original.id}`)} className="cursor-pointer text-[13px] font-medium text-sisyphus-700 hover:underline">{row.original.name}</button> },
    { accessorKey: 'docType', header: 'Τύπος', size: 100, cell: ({ row }) => <span className="text-[12px]">{row.original.docType === 'RECEIPT' ? 'Απόδειξη' : 'Τιμολόγιο'}</span> },
    { accessorKey: 'mode', header: 'Λειτουργία', size: 120, cell: ({ row }) => <Pill text={MODE_LABEL[row.original.mode]} {...MODE_STYLE[row.original.mode]} /> },
    { accessorKey: 'status', header: 'Κατάσταση', size: 100, cell: ({ row }) => <Pill text={STATUS_LABEL[row.original.status]} {...STATUS_STYLE[row.original.status]} /> },
    { accessorKey: 'fieldsCount', header: 'Πεδία', size: 70, cell: ({ row }) => <span className="tabular-nums">{row.original.fieldsCount}</span> },
    { accessorKey: 'timesUsed', header: 'Χρήσεις', size: 80, cell: ({ row }) => <span className="tabular-nums">{row.original.timesUsed}</span> },
    { accessorKey: 'updatedAt', header: 'Ενημ.', size: 110, cell: ({ row }) => <span className="text-[11px] text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString('el-GR')}</span> },
    { id: 'actions', header: '', size: 48, enableSorting: false, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><RowActionsTrigger /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => router.push(`/admin/ocr/templates/${row.original.id}`)}><FiEdit3 /> Άνοιγμα</DropdownMenuItem>
          {canManage && <DropdownMenuItem onClick={() => remove(row.original)} className="text-dg-red-600"><FiTrash2 /> Διαγραφή</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>) },
  ], [canManage, router]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchKey="name"
      searchPlaceholder="Αναζήτηση (προμηθευτής, ΑΦΜ, πρότυπο…)"
      persistKey="admin.templates.table.v1"
      emptyState="Δεν υπάρχουν πρότυπα. Πάτησε «Νέο πρότυπο»."
    />
  );
}
```

- [ ] **Step 3: Create `app/admin/ocr/templates/new-template-dialog.tsx`**

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiSearch } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { templatesApi, errorMessage } from '@/components/templates/api';

type Supplier = { id: number; code: string; name: string; sub: string };

export function NewTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Supplier[]>([]);
  const [supplier, setSupplier] = React.useState<Supplier | null>(null);
  const [vat, setVat] = React.useState('');
  const [name, setName] = React.useState('');
  const [docType, setDocType] = React.useState<'INVOICE' | 'RECEIPT'>('INVOICE');
  const [busy, setBusy] = React.useState(false);

  // Debounced supplier search (≥2 chars).
  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const h = setTimeout(() => { templatesApi.searchSuppliers(q.trim()).then((r) => setResults(r.results)).catch(() => setResults([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const pick = (s: Supplier) => {
    setSupplier(s);
    const afm = /\b(\d{9})\b/.exec(s.sub)?.[1] ?? '';
    setVat(afm);
    if (!name) setName(`${s.name} — Τιμολόγιο`);
    setResults([]); setQ(s.name);
  };

  const submit = async () => {
    if (!/^\d{9}$/.test(vat)) { toast.error('ΑΦΜ 9 ψηφίων'); return; }
    if (!name.trim()) { toast.error('Δώσε όνομα προτύπου'); return; }
    setBusy(true);
    try {
      const r = await templatesApi.create({ name: name.trim(), vatNumber: vat, traderTrdr: supplier?.id ?? null, supplierName: supplier?.name ?? null, docType });
      toast.success('Το πρότυπο δημιουργήθηκε');
      setOpen(false);
      router.push(`/admin/ocr/templates/${r.id}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><FiPlus className="mr-1.5 size-3.5" /> Νέο πρότυπο</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Νέο πρότυπο προμηθευτή</DialogTitle>
            <DialogDescription>Διάλεξε προμηθευτή από το SoftOne ή δώσε ΑΦΜ.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Label htmlFor="sup">Προμηθευτής</Label>
              <div className="relative mt-1">
                <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input id="sup" value={q} onChange={(e) => { setQ(e.target.value); setSupplier(null); }} placeholder="Αναζήτηση επωνυμίας / ΑΦΜ…" className="pl-8" autoComplete="off" />
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
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="vat">ΑΦΜ</Label><Input id="vat" value={vat} onChange={(e) => setVat(e.target.value.replace(/\D/g, '').slice(0, 9))} className="mt-1 font-mono" inputMode="numeric" /></div>
              <div><Label htmlFor="dt">Τύπος εγγράφου</Label>
                <select id="dt" value={docType} onChange={(e) => setDocType(e.target.value as 'INVOICE' | 'RECEIPT')} className="mt-1 h-9 w-full rounded-sm border border-input bg-background px-2 text-[13px]">
                  <option value="INVOICE">Τιμολόγιο</option><option value="RECEIPT">Απόδειξη</option>
                </select></div>
            </div>
            <div><Label htmlFor="nm">Όνομα προτύπου</Label><Input id="nm" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="π.χ. COSMOTE — Τιμολόγιο υπηρεσιών" /></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setOpen(false)}>Άκυρο</Button>
              <Button onClick={submit} disabled={busy}>{busy ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Delete the legacy button and add the nav entry**

Run: `git rm -q app/admin/ocr/templates/delete-button.tsx`

In `components/admin/sidebar.tsx`, after the `/admin/ocr/pending` entry add:
```ts
      { href: '/admin/ocr/templates', label: 'Πρότυπα προμηθευτών', icon: FiLayers, permissions: ['ocr.read'] },
```
(`FiLayers` is already imported there; if not, add it to the react-icons/fi import.)

- [ ] **Step 5: Type-check, then visual check**

Run type-check → no output. Start the dev server (`.claude/launch.json` → `dev`), open `http://localhost:3000/admin/ocr/templates`: the list shows the header with «Νέο πρότυπο», the sidebar shows «Πρότυπα προμηθευτών» under Δεδομένα. Open the dialog, type `cos` in the supplier search: suggestions appear from SoftOne mirrors; choosing one fills ΑΦΜ. Take a screenshot.

- [ ] **Step 6: Commit**

```bash
git add app/admin/ocr/templates components/admin/sidebar.tsx
git commit -m "feat(templates): list page with create dialog replaces legacy supplier-templates page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Designer shell and page

**Files:**
- Create: `app/admin/ocr/templates/[id]/page.tsx`
- Create: `components/templates/template-designer.tsx`
- Create: `components/templates/designer-context.ts`

- [ ] **Step 1: Create the context (`components/templates/designer-context.ts`)**

```ts
'use client';
import * as React from 'react';
import type { TemplateDto } from '@/lib/templates/serialize';

export type DesignerCtx = {
  dto: TemplateDto;
  setDto: (next: TemplateDto) => void;
  canManage: boolean;
  canPost: boolean;
  /** Field key currently highlighted (list ⇄ canvas ⇄ flow). */
  focusKey: string | null;
  setFocusKey: (k: string | null) => void;
  /** Ask the shell to switch step (used by flow-node clicks). */
  goToStep: (step: number) => void;
};

export const DesignerContext = React.createContext<DesignerCtx | null>(null);
export function useDesigner(): DesignerCtx {
  const c = React.useContext(DesignerContext);
  if (!c) throw new Error('useDesigner outside DesignerContext');
  return c;
}
```

- [ ] **Step 2: Create `components/templates/template-designer.tsx`**

```tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import { FiArrowLeft, FiCheckCircle, FiChevronRight, FiCpu, FiGitBranch, FiImage, FiLayers, FiUser } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import type { TemplateDto } from '@/lib/templates/serialize';
import { MODE_LABEL, STATUS_LABEL } from '@/lib/templates/labels';
import { DesignerContext } from './designer-context';
import { SupplierStep } from './supplier-step';
import { SampleStep } from './sample-step';
import { RegionsStep } from './regions-step';
import { MappingStep } from './mapping-step';
import { ConditionsStep } from './conditions-step';
import { FlowPanel } from './flow-panel';

const STEPS = [
  { key: 'supplier', label: 'Προμηθευτής', icon: FiUser },
  { key: 'sample', label: 'Δείγμα', icon: FiImage },
  { key: 'regions', label: 'Περιοχές & πεδία', icon: FiLayers },
  { key: 'mapping', label: 'Mapping', icon: FiGitBranch },
  { key: 'conditions', label: 'Conditions & λειτουργία', icon: FiCpu },
] as const;

/** Readiness per step — drives the check marks in the stepper. */
function stepDone(dto: TemplateDto, i: number): boolean {
  switch (i) {
    case 0: return !!dto.name && /^\d{9}$/.test(dto.vatNumber);
    case 1: return !!dto.sample;
    case 2: return dto.fields.some((f) => f.region);
    case 3: return dto.mappings.length > 0;
    case 4: return dto.status === 'ACTIVE';
    default: return false;
  }
}

export function TemplateDesigner({ initial, canManage, canPost }: { initial: TemplateDto; canManage: boolean; canPost: boolean }) {
  const [dto, setDto] = React.useState(initial);
  const [step, setStep] = React.useState(() => (initial.sample ? (initial.fields.length ? 2 : 1) : 0));
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [flowOpen, setFlowOpen] = React.useState(true);

  const ctx = React.useMemo(() => ({ dto, setDto, canManage, canPost, focusKey, setFocusKey, goToStep: setStep }), [dto, canManage, canPost, focusKey]);
  const Current = [SupplierStep, SampleStep, RegionsStep, MappingStep, ConditionsStep][step];

  return (
    <DesignerContext.Provider value={ctx}>
      <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-3 rounded-lg bg-neutral-8 p-3 lg:flex-row lg:gap-4 lg:p-4">
        {/* Stepper */}
        <nav aria-label="Βήματα" className="shrink-0 lg:w-56">
          <Link href="/admin/ocr/templates" className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><FiArrowLeft className="size-3" /> Πρότυπα</Link>
          <div className="rounded-md border border-border bg-white p-1 shadow-fluent-2">
            {STEPS.map((s, i) => {
              const active = i === step; const done = stepDone(dto, i);
              return (
                <button key={s.key} type="button" onClick={() => setStep(i)} aria-current={active ? 'step' : undefined}
                  className={cn('flex h-10 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-[13px] cx-transition',
                    active ? 'bg-sisyphus-50 font-medium text-sisyphus-700' : 'text-foreground/80 hover:bg-[var(--cx-hover)]')}>
                  <span className={cn('grid size-5 place-items-center rounded-full text-[10px] font-semibold', done ? 'bg-[#E8F7F0] text-[#047857]' : active ? 'bg-sisyphus-500 text-white' : 'bg-muted text-muted-foreground')}>
                    {done ? <FiCheckCircle className="size-3.5" /> : i + 1}
                  </span>
                  <s.icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">{s.label}</span>
                  {active && <FiChevronRight className="size-3.5 opacity-60" />}
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-md border border-border bg-white p-3 text-[11px] text-muted-foreground shadow-fluent-2">
            <div className="flex justify-between"><span>Κατάσταση</span><span className="font-medium text-foreground">{STATUS_LABEL[dto.status]}</span></div>
            <div className="mt-1 flex justify-between"><span>Λειτουργία</span><span className="font-medium text-foreground">{MODE_LABEL[dto.mode]}</span></div>
            <div className="mt-1 flex justify-between"><span>Έκδοση</span><span className="font-mono">{dto.version}</span></div>
          </div>
        </nav>

        {/* Step content */}
        <section className="min-w-0 flex-1 rounded-md border border-border bg-white p-4 shadow-fluent-2">
          <Current />
        </section>

        {/* Flow panel */}
        <aside className={cn('shrink-0 rounded-md border border-border bg-white shadow-fluent-2', flowOpen ? 'lg:w-[380px]' : 'lg:w-10')}>
          <button type="button" onClick={() => setFlowOpen((o) => !o)} className="flex h-9 w-full cursor-pointer items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
            {flowOpen ? <><span>Ροή</span><span aria-hidden>›</span></> : <span aria-hidden>‹</span>}
          </button>
          {flowOpen && <div className="h-[420px] border-t border-border lg:h-[calc(100%-2.25rem)]"><FlowPanel /></div>}
        </aside>
      </div>
    </DesignerContext.Provider>
  );
}
```

- [ ] **Step 3: Create `app/admin/ocr/templates/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { FiLayers } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';
import { TemplateDesigner } from '@/components/templates/template-designer';

export const dynamic = 'force-dynamic';

export default async function TemplateDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const [t, canManage, canPost] = await Promise.all([
    prisma.extractionTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE }),
    hasPermission('ocr.categorize'),
    hasPermission('ocr.post'),
  ]);
  if (!t) notFound();
  const dto = toTemplateDto(t);
  return (
    <div className="w-full">
      <PageHeader icon={<FiLayers />} title={dto.name} description={`${dto.supplierName ?? ''} · ΑΦΜ ${dto.vatNumber}`} helpAnchor="templates" />
      <TemplateDesigner initial={dto} canManage={canManage} canPost={canPost} />
    </div>
  );
}
```

`TemplateDto.createdAt/updatedAt` are `Date` objects; Next serialises them to the client as strings. Add to `template-designer.tsx` nothing (dates are not used). If the compiler complains about passing a non-serialisable prop, change `toTemplateDto` consumers here by mapping `createdAt`/`updatedAt` to ISO strings: `const dto = { ...toTemplateDto(t), createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() } as unknown as TemplateDto;`.

- [ ] **Step 4: Stub the step components so the shell compiles** — create each of `supplier-step.tsx`, `sample-step.tsx`, `regions-step.tsx`, `mapping-step.tsx`, `conditions-step.tsx`, `flow-panel.tsx` in `components/templates/` with:

```tsx
'use client';
export function SupplierStep() { return <p className="text-[12px] text-muted-foreground">Βήμα σε εξέλιξη.</p>; }
```
(export name per file: `SampleStep`, `RegionsStep`, `MappingStep`, `ConditionsStep`, `FlowPanel`). Tasks 5–9 replace them.

- [ ] **Step 5: Type-check + visual check**

Type-check → no output. Open a template from the list: stepper on the left, placeholder in the middle, collapsible «Ροή» panel on the right. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add "app/admin/ocr/templates/[id]" components/templates
git commit -m "feat(templates): designer shell with stepper, context and flow slot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Supplier and sample steps

**Files:**
- Replace: `components/templates/supplier-step.tsx`, `components/templates/sample-step.tsx`

- [ ] **Step 1: `supplier-step.tsx`**

```tsx
'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';

export function SupplierStep() {
  const { dto, setDto, canManage } = useDesigner();
  const [name, setName] = React.useState(dto.name);
  const [supplierName, setSupplierName] = React.useState(dto.supplierName ?? '');
  const [busy, setBusy] = React.useState(false);
  const dirty = name !== dto.name || supplierName !== (dto.supplierName ?? '');

  const save = async () => {
    setBusy(true);
    try { setDto(await templatesApi.patch(dto.id, { name: name.trim(), supplierName: supplierName.trim() || null })); toast.success('Αποθηκεύτηκε'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div><h2 className="text-[16px] font-semibold">Προμηθευτής</h2><p className="text-[12px] text-muted-foreground">Το πρότυπο εφαρμόζεται αυτόματα σε έγγραφα με αυτό το ΑΦΜ εκδότη.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>ΑΦΜ</Label><Input value={dto.vatNumber} readOnly className="mt-1 font-mono bg-neutral-4" /></div>
        <div><Label>Τύπος εγγράφου</Label><Input value={dto.docType === 'RECEIPT' ? 'Απόδειξη' : 'Τιμολόγιο'} readOnly className="mt-1 bg-neutral-4" /></div>
        <div className="sm:col-span-2"><Label htmlFor="sn">Επωνυμία προμηθευτή</Label><Input id="sn" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} disabled={!canManage} className="mt-1" /></div>
        <div className="sm:col-span-2"><Label htmlFor="tn">Όνομα προτύπου</Label><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="mt-1" /></div>
      </div>
      {dto.traderTrdr && <p className="text-[11px] text-muted-foreground">Συνδεδεμένο με συναλλασσόμενο SoftOne TRDR {dto.traderTrdr}.</p>}
      {canManage && <Button onClick={save} disabled={!dirty || busy || !name.trim()}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>}
    </div>
  );
}
```

- [ ] **Step 2: `sample-step.tsx`**

```tsx
'use client';

import * as React from 'react';
import { FiUploadCloud } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

export function SampleStep() {
  const { dto, setDto, canManage, goToStep } = useDesigner();
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await templatesApi.uploadSample(dto.id, file);
      setDto(await templatesApi.get(dto.id));
      toast.success('Το δείγμα ανέβηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); };

  return (
    <div className="space-y-4">
      <div><h2 className="text-[16px] font-semibold">Δείγμα εγγράφου</h2><p className="text-[12px] text-muted-foreground">Ένα καθαρό PDF ή εικόνα του προμηθευτή. Πάνω του θα σχεδιάσεις τις περιοχές.</p></div>
      {canManage && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
          onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          className={cn('flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center cx-transition',
            drag ? 'border-sisyphus-500 bg-sisyphus-50' : 'border-border hover:border-sisyphus-300 hover:bg-neutral-4')}>
          <FiUploadCloud className="size-6 text-sisyphus-600" />
          <p className="text-[13px] font-medium">{busy ? 'Ανέβασμα…' : 'Σύρε εδώ ένα PDF ή εικόνα, ή κάνε κλικ'}</p>
          <p className="text-[11px] text-muted-foreground">PDF, PNG, JPEG, WebP · έως 25 MB</p>
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ''; }} />
        </div>
      )}
      {dto.sample ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={templatesApi.pageImageUrl(dto.id, 0, dto.version, 2)} alt="Δείγμα, σελίδα 1" className="w-full max-w-[280px] rounded-md border border-border shadow-fluent-2" />
          <div className="text-[12px] text-muted-foreground">
            <p><span className="font-medium text-foreground">{dto.sample.mimeType}</span> · {dto.sample.pageCount} σελίδ{dto.sample.pageCount === 1 ? 'α' : 'ες'}</p>
            <button type="button" onClick={() => goToStep(2)} className="mt-2 cursor-pointer text-sisyphus-700 hover:underline">Συνέχεια στις περιοχές →</button>
          </div>
        </div>
      ) : <p className="text-[12px] italic text-muted-foreground">Δεν υπάρχει δείγμα ακόμη.</p>}
    </div>
  );
}
```

- [ ] **Step 3: Type-check + visual check**: edit the name and save (toast), upload a PNG via the drop zone, the thumbnail appears with page count. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add components/templates/supplier-step.tsx components/templates/sample-step.tsx
git commit -m "feat(templates): supplier and sample steps

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Regions & fields step

**Files:**
- Replace: `components/templates/regions-step.tsx`
- Create: `components/templates/field-form.tsx`

- [ ] **Step 1: `field-form.tsx`**

```tsx
'use client';

import * as React from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { COLOR_PALETTE, slugKey, type ColumnDef, type FieldDef, type TemplateValueType } from '@/lib/templates/schema';
import { KIND_LABEL, VALUE_TYPE_LABEL } from '@/lib/templates/labels';

const VALUE_TYPES = Object.keys(VALUE_TYPE_LABEL) as TemplateValueType[];

export function FieldForm({ field, usedColors, onChange, disabled }: { field: FieldDef; usedColors: string[]; onChange: (f: FieldDef) => void; disabled?: boolean }) {
  const set = (patch: Partial<FieldDef>) => onChange({ ...field, ...patch });
  const setCol = (i: number, patch: Partial<ColumnDef>) => set({ columns: (field.columns ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const sel = 'mt-1 h-9 w-full rounded-sm border border-input bg-background px-2 text-[13px]';

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label>Ετικέτα</Label>
          <Input value={field.label} disabled={disabled} className="mt-1" onChange={(e) => { const label = e.target.value; set({ label, key: field.key && field.key !== slugKey(field.label) ? field.key : slugKey(label) }); }} />
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">key: {field.key || '—'}</p></div>
        <div><Label>Είδος</Label>
          <select value={field.kind} disabled={disabled} className={sel} onChange={(e) => { const kind = e.target.value as FieldDef['kind']; set({ kind, columns: kind === 'TABLE' ? (field.columns?.length ? field.columns : [{ key: 'col1', label: 'Στήλη 1', valueType: 'TEXT' }]) : null }); }}>
            {(Object.keys(KIND_LABEL) as FieldDef['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select></div>
        <div><Label>Τύπος τιμής</Label>
          <select value={field.valueType} disabled={disabled || field.kind === 'TABLE'} className={sel} onChange={(e) => set({ valueType: e.target.value as TemplateValueType })}>
            {VALUE_TYPES.map((v) => <option key={v} value={v}>{VALUE_TYPE_LABEL[v]}</option>)}
          </select></div>
        <div className="sm:col-span-2"><Label>Οδηγία στο μοντέλο (προαιρετικό)</Label>
          <Input value={field.aiHint ?? ''} disabled={disabled} className="mt-1" placeholder="π.χ. ο αριθμός δίπλα στη λέξη «Αρ.»" onChange={(e) => set({ aiHint: e.target.value || null })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div><Label className="mb-1 block">Χρώμα</Label>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PALETTE.map((c) => { const used = usedColors.includes(c) && c !== field.color; return (
              <button key={c} type="button" disabled={disabled || used} title={used ? 'Χρησιμοποιείται' : c} onClick={() => set({ color: c })}
                className="size-6 cursor-pointer rounded-full border-2 disabled:cursor-not-allowed disabled:opacity-30" style={{ backgroundColor: c, borderColor: field.color === c ? '#1F1F1F' : 'transparent' }} aria-label={`Χρώμα ${c}`} />); })}
          </div></div>
        <label className="inline-flex items-center gap-2 text-[12px]"><Switch checked={field.required} disabled={disabled} onCheckedChange={(v) => set({ required: v })} /> Υποχρεωτικό</label>
      </div>
      {field.kind === 'TABLE' && (
        <div className="rounded-md border border-border bg-neutral-4 p-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Στήλες πίνακα</span>
            {!disabled && <button type="button" onClick={() => set({ columns: [...(field.columns ?? []), { key: `col${(field.columns?.length ?? 0) + 1}`, label: `Στήλη ${(field.columns?.length ?? 0) + 1}`, valueType: 'TEXT' }] })} className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-sisyphus-700 hover:underline"><FiPlus className="size-3" /> Στήλη</button>}</div>
          <div className="space-y-2">
            {(field.columns ?? []).map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_120px_28px] items-center gap-2">
                <Input value={c.label} disabled={disabled} placeholder="Ετικέτα" onChange={(e) => setCol(i, { label: e.target.value, key: slugKey(e.target.value) || c.key })} />
                <Input value={c.key} disabled={disabled} placeholder="key" className="font-mono text-[12px]" onChange={(e) => setCol(i, { key: e.target.value })} />
                <select value={c.valueType} disabled={disabled} className="h-9 rounded-sm border border-input bg-background px-2 text-[12px]" onChange={(e) => setCol(i, { valueType: e.target.value as TemplateValueType })}>
                  {VALUE_TYPES.map((v) => <option key={v} value={v}>{VALUE_TYPE_LABEL[v]}</option>)}</select>
                {!disabled && <button type="button" aria-label="Αφαίρεση στήλης" onClick={() => set({ columns: (field.columns ?? []).filter((_, j) => j !== i) })} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-dg-red-600"><FiX className="size-3.5" /></button>}
              </div>))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `regions-step.tsx`**

```tsx
'use client';

import * as React from 'react';
import { FiCrosshair, FiPlus, FiSave, FiTrash2, FiZap } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RegionMarker } from '@/components/ui/region-marker';
import { nextColor, type FieldDef, type Region } from '@/lib/templates/schema';
import { KIND_LABEL } from '@/lib/templates/labels';
import { useDesigner } from './designer-context';
import { FieldForm } from './field-form';
import { templatesApi, errorMessage, type TestFieldResult } from './api';

const newField = (fields: FieldDef[]): FieldDef => ({
  key: '', label: '', kind: 'SINGLE', valueType: 'TEXT', color: nextColor(fields.map((f) => f.color)),
  region: null, columns: null, aiHint: null, required: false, order: fields.length,
});

export function RegionsStep() {
  const { dto, setDto, canManage, focusKey, setFocusKey } = useDesigner();
  const [fields, setFields] = React.useState<FieldDef[]>(dto.fields);
  const [page, setPage] = React.useState(0);
  const [marking, setMarking] = React.useState<string | null>(null);         // key of the field receiving the next drawn box
  const [tests, setTests] = React.useState<Record<string, TestFieldResult | { error: string } | 'busy'>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setFields(dto.fields), [dto.fields]);

  const dirty = JSON.stringify(fields) !== JSON.stringify(dto.fields);
  const selected = fields.find((f) => f.key === focusKey) ?? null;
  const update = (key: string, f: FieldDef) => setFields((fs) => fs.map((x) => (x.key === key ? f : x)));

  const add = () => { const f = newField(fields); setFields((fs) => [...fs, f]); setFocusKey(''); };
  const remove = (key: string) => { setFields((fs) => fs.filter((f) => f.key !== key).map((f, i) => ({ ...f, order: i }))); if (focusKey === key) setFocusKey(null); };

  const onRegion = (box: { x: number; y: number; w: number; h: number }, pg: number) => {
    const key = marking; setMarking(null);
    if (key == null) return;
    const region: Region = { page: pg, bbox: [round(box.x), round(box.y), round(box.w), round(box.h)] };
    update(key, { ...fields.find((f) => f.key === key)!, region });
  };

  const save = async () => {
    if (fields.some((f) => !f.label.trim())) { toast.error('Κάθε πεδίο χρειάζεται ετικέτα'); return; }
    setBusy(true);
    try {
      const res = await templatesApi.putFields(dto.id, fields);
      const { cleanup, ...next } = res;
      setDto(next);
      const removed = (cleanup?.mappings.length ?? 0) + (cleanup?.conditions.length ?? 0);
      toast.success(removed ? `Αποθηκεύτηκε · καθαρίστηκαν ${removed} αναφορές σε mappings/conditions` : 'Αποθηκεύτηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const test = async (f: FieldDef) => {
    if (!f.region) { toast.error('Σχεδίασε πρώτα περιοχή'); return; }
    if (!dto.fields.some((x) => x.key === f.key)) { toast.error('Αποθήκευσε πρώτα το πεδίο'); return; }
    setTests((t) => ({ ...t, [f.key]: 'busy' }));
    try { setTests((t) => ({ ...t, [f.key]: null as never })); const r = await templatesApi.testField(dto.id, f.key, f.region); setTests((t) => ({ ...t, [f.key]: r })); }
    catch (e) { setTests((t) => ({ ...t, [f.key]: { error: errorMessage(e) } })); }
  };

  if (!dto.sample) return <p className="text-[12px] text-muted-foreground">Ανέβασε πρώτα δείγμα στο βήμα «Δείγμα».</p>;

  const saved = fields.filter((f) => f.region && f.region.page === page).map((f) => ({ bbox: f.region!.bbox, color: f.color, active: f.key === focusKey }));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      {/* Canvas */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-semibold">Περιοχές</span>
          {marking != null && <span className="rounded-full bg-[#FFF1E6] px-2 py-0.5 text-[11px] font-medium text-[#C2410C]">Σύρε πλαίσιο πάνω στο έγγραφο για «{fields.find((f) => f.key === marking)?.label || 'νέο πεδίο'}» · Esc για ακύρωση</span>}
          <span className="ml-auto text-muted-foreground">Σελίδα {page + 1} / {dto.sample.pageCount}</span>
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</Button>
          <Button variant="ghost" size="sm" disabled={page >= dto.sample.pageCount - 1} onClick={() => setPage((p) => p + 1)}>›</Button>
        </div>
        <div onKeyDown={(e) => { if (e.key === 'Escape') setMarking(null); }} tabIndex={-1} className="rounded-md border border-border bg-neutral-6 p-2">
          <RegionMarker
            pageImageUrl={(p) => templatesApi.pageImageUrl(dto.id, p, dto.version)}
            pageCount={dto.sample.pageCount} page={page} onPageChange={setPage}
            savedRegions={saved} isMarking={marking != null} onRegionComplete={onRegion} showNav={false}
          />
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {fields.filter((f) => f.region).map((f) => (
            <li key={f.key}><button type="button" onClick={() => { setFocusKey(f.key); setPage(f.region!.page); }} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]', f.key === focusKey ? 'border-transparent text-white' : 'border-border bg-white')} style={f.key === focusKey ? { backgroundColor: f.color } : undefined}>
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: f.color }} />{f.label || f.key}<span className="opacity-60">σ.{f.region!.page + 1}</span></button></li>))}
        </ul>
      </div>

      {/* Field list + form */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold">Πεδία <span className="ml-1 rounded-full bg-sisyphus-50 px-1.5 text-[10px] text-sisyphus-700">{fields.length}</span></span>
          {canManage && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={add}><FiPlus className="mr-1 size-3.5" /> Πεδίο</Button><Button size="sm" onClick={save} disabled={!dirty || busy}><FiSave className="mr-1 size-3.5" /> {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button></div>}
        </div>
        <ul className="max-h-[260px] divide-y divide-border overflow-auto rounded-md border border-border">
          {fields.length === 0 && <li className="p-3 text-[12px] italic text-muted-foreground">Κανένα πεδίο. Πάτησε «Πεδίο».</li>}
          {fields.map((f) => { const t = tests[f.key]; return (
            <li key={f.key || '__new'} className={cn('flex items-center gap-2 px-2 py-1.5 text-[12px]', f.key === focusKey && 'bg-sisyphus-50')}>
              <button type="button" onClick={() => setFocusKey(f.key)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: f.color }} />
                <span className="truncate font-medium">{f.label || 'Νέο πεδίο'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{KIND_LABEL[f.kind]}{f.region ? '' : ' · χωρίς περιοχή'}</span>
              </button>
              {t && t !== 'busy' && ('error' in t ? <span className="max-w-[120px] truncate text-[10px] text-dg-red-600" title={t.error}>{t.error}</span> : <span className="max-w-[140px] truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: f.color + '1A', color: f.color }} title={`${t.raw ?? ''} (${t.source}, ${t.model ?? ''})`}>{String(t.value ?? '∅')}</span>)}
              {canManage && <>
                <button type="button" title="Σχεδίασε περιοχή" onClick={() => { setFocusKey(f.key); setMarking(f.key); }} className={cn('grid size-7 cursor-pointer place-items-center rounded-sm hover:bg-[var(--cx-hover)]', marking === f.key ? 'text-[#C2410C]' : 'text-muted-foreground')}><FiCrosshair className="size-3.5" /></button>
                <button type="button" title="Δοκιμή ανάγνωσης" disabled={t === 'busy'} onClick={() => test(f)} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] disabled:opacity-40"><FiZap className={cn('size-3.5', t === 'busy' && 'animate-pulse')} /></button>
                <button type="button" title="Διαγραφή" onClick={() => remove(f.key)} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>
              </>}
            </li>); })}
        </ul>
        {selected && (
          <div className="rounded-md border border-border p-3" style={{ borderLeft: `4px solid ${selected.color}` }}>
            <FieldForm field={selected} usedColors={fields.map((f) => f.color)} disabled={!canManage} onChange={(f) => update(selected.key, f)} />
            {selected.region && <p className="mt-2 font-mono text-[10px] text-muted-foreground">σελίδα {selected.region.page + 1} · bbox {selected.region.bbox.map((n) => n.toFixed(3)).join(', ')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;
```

Note on keys: a brand-new field has `key: ''` until a label is typed; `update(selected.key, …)` therefore matches the `''` key. Because two unsaved new fields would share `''`, the «Πεδίο» button must be disabled while a field with empty key exists — add `disabled={fields.some((f) => !f.key)}` to that button.

- [ ] **Step 3: Type-check + visual check**: add a field, type a label (key auto-slugs), press the crosshair, drag a box on the sample — the overlay appears in the field's colour; save; press the bolt — the read value shows in the list in the same colour. Switch pages if the sample has more than one. Screenshot with two coloured regions.

- [ ] **Step 4: Commit**

```bash
git add components/templates/regions-step.tsx components/templates/field-form.tsx
git commit -m "feat(templates): regions & fields step with coloured overlays and live test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Mapping step

**Files:**
- Replace: `components/templates/mapping-step.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';

import * as React from 'react';
import { FiPlus, FiSave, FiTrash2 } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TemplateDto } from '@/lib/templates/serialize';
import type { MappingRowExcel, MappingRowInvoice } from '@/lib/templates/schema';
import { INVOICE_KEY_GROUPS } from '@/lib/templates/labels';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';

type Mapping = TemplateDto['mappings'][number];

export function MappingStep() {
  const { dto, setDto, canManage } = useDesigner();
  const [mappings, setMappings] = React.useState<Mapping[]>(dto.mappings);
  const [active, setActive] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setMappings(dto.mappings), [dto.mappings]);
  const dirty = JSON.stringify(mappings) !== JSON.stringify(dto.mappings);

  // Source keys: SINGLE fields by key, TABLE columns as `table.col`.
  const sources = React.useMemo(() => dto.fields.flatMap((f) => f.kind === 'TABLE'
    ? (f.columns ?? []).map((c) => ({ key: `${f.key}.${c.key}`, label: `${f.label} › ${c.label}`, color: f.color, line: true }))
    : [{ key: f.key, label: f.label, color: f.color, line: false }]), [dto.fields]);

  const m = mappings[active];
  const setM = (patch: Partial<Mapping>) => setMappings((ms) => ms.map((x, i) => (i === active ? ({ ...x, ...patch } as Mapping) : x)));
  const addMapping = (target: 'INVOICE' | 'EXCEL') => { setMappings((ms) => [...ms, { id: '', name: ms.length ? `${target === 'EXCEL' ? 'excel' : 'mapping'}-${ms.length + 1}` : 'default', target, isDefault: ms.length === 0, rows: [] } as Mapping]); setActive(mappings.length); };
  const removeMapping = () => { setMappings((ms) => ms.filter((_, i) => i !== active)); setActive(0); };

  const setRow = (i: number, row: MappingRowInvoice | MappingRowExcel) => setM({ rows: (m.rows as (MappingRowInvoice | MappingRowExcel)[]).map((r, j) => (j === i ? row : r)) as Mapping['rows'] });
  const addRow = () => setM({ rows: [...m.rows, m.target === 'INVOICE' ? { fieldKey: sources[0]?.key ?? '', invoiceKey: 'invoiceNumber' } : { fieldKey: sources[0]?.key ?? '', column: '', order: m.rows.length + 1 }] as Mapping['rows'] });
  const delRow = (i: number) => setM({ rows: (m.rows as unknown[]).filter((_, j) => j !== i) as Mapping['rows'] });

  const save = async () => {
    setBusy(true);
    try { setDto(await templatesApi.putMappings(dto.id, mappings)); toast.success('Αποθηκεύτηκε'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const sel = 'h-9 w-full rounded-sm border border-input bg-background px-2 text-[12px]';
  const SourceSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={sel} style={{ borderLeft: `4px solid ${sources.find((s) => s.key === value)?.color ?? '#D1D1D1'}` }}>
      {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>);

  return (
    <div className="space-y-4">
      <div><h2 className="text-[16px] font-semibold">Mapping</h2><p className="text-[12px] text-muted-foreground">Πού πηγαίνει κάθε εξαγόμενο πεδίο: στα πεδία του παραστατικού ή σε στήλες Excel. Οι κανόνες μπορούν να αλλάζουν mapping.</p></div>
      <div className="flex flex-wrap items-center gap-1.5">
        {mappings.map((x, i) => (
          <button key={i} type="button" onClick={() => setActive(i)} className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] cx-transition', i === active ? 'border-sisyphus-500 bg-sisyphus-50 font-medium text-sisyphus-700' : 'border-border bg-white hover:border-sisyphus-300')}>
            {x.target === 'EXCEL' ? 'Excel' : 'Παραστατικό'}: {x.name}{x.isDefault && <span className="text-[10px] opacity-70">· προεπιλογή</span>}</button>))}
        {canManage && <><Button size="sm" variant="secondary" onClick={() => addMapping('INVOICE')}><FiPlus className="mr-1 size-3.5" /> Παραστατικό</Button><Button size="sm" variant="secondary" onClick={() => addMapping('EXCEL')}><FiPlus className="mr-1 size-3.5" /> Excel</Button></>}
        {canManage && <Button size="sm" className="ml-auto" onClick={save} disabled={!dirty || busy}><FiSave className="mr-1 size-3.5" /> {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>}
      </div>
      {m && (
        <div className="rounded-md border border-border p-3">
          <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div><label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Όνομα</label><Input value={m.name} disabled={!canManage} onChange={(e) => setM({ name: e.target.value })} className="mt-1" /></div>
            <label className="inline-flex items-center gap-2 text-[12px]"><input type="radio" checked={m.isDefault} disabled={!canManage} onChange={() => setMappings((ms) => ms.map((x, i) => ({ ...x, isDefault: i === active })))} /> Προεπιλογή</label>
            {canManage && mappings.length > 1 && <Button variant="ghost" size="sm" onClick={removeMapping} className="text-dg-red-600"><FiTrash2 className="mr-1 size-3.5" /> Αφαίρεση</Button>}
          </div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground"><th className="pb-1">Πεδίο προτύπου</th><th className="pb-1">{m.target === 'EXCEL' ? 'Στήλη Excel' : 'Πεδίο παραστατικού'}</th>{m.target === 'EXCEL' && <th className="w-20 pb-1">Σειρά</th>}<th className="w-8" /></tr></thead>
            <tbody>
              {m.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-2"><SourceSelect value={r.fieldKey} onChange={(v) => setRow(i, { ...r, fieldKey: v } as MappingRowInvoice | MappingRowExcel)} /></td>
                  <td className="py-1.5 pr-2">{m.target === 'INVOICE'
                    ? <select value={(r as MappingRowInvoice).invoiceKey} className={sel} onChange={(e) => setRow(i, { ...r, invoiceKey: e.target.value } as MappingRowInvoice)}>
                        {INVOICE_KEY_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.keys.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</optgroup>)}
                        <option value={`customFields.${r.fieldKey.replace('.', '_')}`}>Ειδικό πεδίο: {r.fieldKey}</option>
                      </select>
                    : <Input value={(r as MappingRowExcel).column} placeholder="Όνομα στήλης" onChange={(e) => setRow(i, { ...r, column: e.target.value } as MappingRowExcel)} />}</td>
                  {m.target === 'EXCEL' && <td className="py-1.5 pr-2"><Input type="number" min={0} value={(r as MappingRowExcel).order} onChange={(e) => setRow(i, { ...r, order: Number(e.target.value) } as MappingRowExcel)} /></td>}
                  <td className="py-1.5">{canManage && <button type="button" aria-label="Αφαίρεση" onClick={() => delRow(i)} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>}</td>
                </tr>))}
              {m.rows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[12px] italic text-muted-foreground">Καμία γραμμή.</td></tr>}
            </tbody>
          </table>
          {canManage && <Button size="sm" variant="secondary" className="mt-2" onClick={addRow} disabled={sources.length === 0}><FiPlus className="mr-1 size-3.5" /> Γραμμή</Button>}
          {m.target === 'INVOICE' && <p className="mt-2 text-[11px] text-muted-foreground">Στήλες πίνακα → «Γραμμές». Απλά πεδία → «Κεφαλίδα» ή «Ειδικό πεδίο».</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + visual check**: add a Παραστατικό mapping, map a field to «Αριθμός παραστατικού», save; try mapping a table column to a header key → the server's 422 shows as a Greek toast. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add components/templates/mapping-step.tsx
git commit -m "feat(templates): mapping step (invoice keys / excel columns, multiple mappings)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Conditions & mode step

**Files:**
- Replace: `components/templates/conditions-step.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';

import * as React from 'react';
import { FiPlus, FiSave, FiTrash2, FiZap } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { TemplateDto } from '@/lib/templates/serialize';
import type { Action, Clause, ClauseOp, TemplateMode } from '@/lib/templates/schema';
import { ACTION_LABEL, EXTRA_VARS, MODE_HELP, MODE_LABEL, OP_LABEL, OPS_WITHOUT_VALUE } from '@/lib/templates/labels';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';

type Cond = TemplateDto['conditions'][number];
const sel = 'h-9 rounded-sm border border-input bg-background px-2 text-[12px]';

export function ConditionsStep() {
  const { dto, setDto, canManage, canPost } = useDesigner();
  const [conds, setConds] = React.useState<Cond[]>(dto.conditions);
  const [mode, setMode] = React.useState<TemplateMode>(dto.mode);
  const [emails, setEmails] = React.useState(dto.notifyEmails ?? '');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setConds(dto.conditions); setMode(dto.mode); setEmails(dto.notifyEmails ?? ''); }, [dto]);
  const dirtyRules = JSON.stringify(conds) !== JSON.stringify(dto.conditions);
  const dirtyMode = mode !== dto.mode || emails !== (dto.notifyEmails ?? '');

  const fieldOptions = [...dto.fields.map((f) => ({ key: f.key, label: f.label, color: f.color })), ...EXTRA_VARS.map((v) => ({ key: v.key, label: v.label, color: '#5C5C5C' }))];
  const setC = (i: number, patch: Partial<Cond>) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addRule = () => setConds((cs) => [...cs, { id: '', name: `Κανόνας ${cs.length + 1}`, order: cs.length, isActive: true, logic: 'AND', clauses: [{ fieldKey: fieldOptions[0]?.key ?? '$total', op: 'notEmpty' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'Έλεγχος' } }] }]);

  const saveRules = async () => {
    setBusy(true);
    try { setDto(await templatesApi.putConditions(dto.id, conds.map((c) => ({ ...c, id: c.id || undefined })) as Cond[])); toast.success('Οι κανόνες αποθηκεύτηκαν'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const saveMode = async () => {
    setBusy(true);
    try { setDto(await templatesApi.patch(dto.id, { mode, notifyEmails: emails.trim() || null })); toast.success('Η λειτουργία αποθηκεύτηκε'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const setStatus = async (status: 'DRAFT' | 'ACTIVE') => {
    setBusy(true);
    try { setDto(await templatesApi.patch(dto.id, { status })); toast.success(status === 'ACTIVE' ? 'Το πρότυπο ενεργοποιήθηκε' : 'Το πρότυπο έγινε πρόχειρο'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const ActionEditor = ({ a, onChange, onRemove }: { a: Action; onChange: (a: Action) => void; onRemove: () => void }) => (
    <div className="grid grid-cols-[160px_1fr_28px] items-center gap-2">
      <select value={a.type} className={sel} disabled={!canManage} onChange={(e) => { const type = e.target.value as Action['type']; onChange(type === 'SET_FIELD' ? { type, params: { fieldKey: dto.fields[0]?.key, value: '' } } : type === 'SWITCH_MAPPING' ? { type, params: { mappingName: dto.mappings[0]?.name ?? 'default' } } : type === 'NOTIFY' ? { type, params: { subject: 'Ειδοποίηση' } } : { type, params: { reason: 'Έλεγχος' } } as Action); }}>
        {(Object.keys(ACTION_LABEL) as Action['type'][]).map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}</select>
      <div className="flex gap-2">
        {a.type === 'SET_FIELD' && <><select value={a.params.fieldKey ?? ''} className={sel} disabled={!canManage} onChange={(e) => onChange({ type: 'SET_FIELD', params: { ...a.params, fieldKey: e.target.value } })}>{dto.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select><Input value={a.params.value} placeholder="τιμή" disabled={!canManage} onChange={(e) => onChange({ type: 'SET_FIELD', params: { ...a.params, value: e.target.value } })} /></>}
        {(a.type === 'FLAG_REVIEW' || a.type === 'BLOCK_POSTING') && <Input value={a.params.reason} placeholder="λόγος" disabled={!canManage} onChange={(e) => onChange({ type: a.type, params: { reason: e.target.value } })} />}
        {a.type === 'SWITCH_MAPPING' && <select value={a.params.mappingName} className={sel} disabled={!canManage} onChange={(e) => onChange({ type: 'SWITCH_MAPPING', params: { mappingName: e.target.value } })}>{dto.mappings.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select>}
        {a.type === 'NOTIFY' && <><Input value={a.params.subject} placeholder="θέμα" disabled={!canManage} onChange={(e) => onChange({ type: 'NOTIFY', params: { ...a.params, subject: e.target.value } })} /><Input value={a.params.emails ?? ''} placeholder="emails (προαιρ.)" disabled={!canManage} onChange={(e) => onChange({ type: 'NOTIFY', params: { ...a.params, emails: e.target.value || undefined } })} /></>}
      </div>
      {canManage && <button type="button" aria-label="Αφαίρεση" onClick={onRemove} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>}
    </div>);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div><h2 className="text-[16px] font-semibold">Conditions</h2><p className="text-[12px] text-muted-foreground">Κανόνες πάνω στα εξαγόμενα πεδία. Όλοι όσοι ισχύουν εφαρμόζουν τις ενέργειές τους.</p></div>
          {canManage && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={addRule}><FiPlus className="mr-1 size-3.5" /> Κανόνας</Button><Button size="sm" onClick={saveRules} disabled={!dirtyRules || busy}><FiSave className="mr-1 size-3.5" /> Αποθήκευση</Button></div>}
        </div>
        {conds.length === 0 && <p className="text-[12px] italic text-muted-foreground">Κανένας κανόνας.</p>}
        {conds.map((c, i) => (
          <div key={i} className={cn('rounded-md border border-border p-3', !c.isActive && 'opacity-60')}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Input value={c.name} disabled={!canManage} onChange={(e) => setC(i, { name: e.target.value })} className="h-8 max-w-[260px]" />
              <label className="inline-flex items-center gap-1.5 text-[12px]"><Switch checked={c.isActive} disabled={!canManage} onCheckedChange={(v) => setC(i, { isActive: v })} /> Ενεργός</label>
              <select value={c.logic} className={sel} disabled={!canManage} onChange={(e) => setC(i, { logic: e.target.value as 'AND' | 'OR' })}><option value="AND">Όλες οι ρήτρες (AND)</option><option value="OR">Οποιαδήποτε ρήτρα (OR)</option></select>
              {canManage && <button type="button" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[12px] text-dg-red-600 hover:underline"><FiTrash2 className="size-3.5" /> Διαγραφή</button>}
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Αν</p>
              {c.clauses.map((cl, k) => (
                <div key={k} className="grid grid-cols-[1fr_170px_1fr_28px] items-center gap-2">
                  <select value={cl.fieldKey} className={sel} disabled={!canManage} style={{ borderLeft: `4px solid ${fieldOptions.find((f) => f.key === cl.fieldKey)?.color ?? '#D1D1D1'}` }} onChange={(e) => setC(i, { clauses: c.clauses.map((x, j) => (j === k ? { ...x, fieldKey: e.target.value } : x)) })}>{fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                  <select value={cl.op} className={sel} disabled={!canManage} onChange={(e) => setC(i, { clauses: c.clauses.map((x, j) => (j === k ? { ...x, op: e.target.value as ClauseOp } : x)) })}>{(Object.keys(OP_LABEL) as ClauseOp[]).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
                  {OPS_WITHOUT_VALUE.includes(cl.op) ? <span /> : <Input value={cl.value ?? ''} disabled={!canManage} placeholder="τιμή" onChange={(e) => setC(i, { clauses: c.clauses.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} />}
                  {canManage && <button type="button" aria-label="Αφαίρεση ρήτρας" onClick={() => setC(i, { clauses: c.clauses.filter((_, j) => j !== k) })} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>}
                </div>))}
              {canManage && <button type="button" onClick={() => setC(i, { clauses: [...c.clauses, { fieldKey: fieldOptions[0]?.key ?? '$total', op: 'notEmpty' } as Clause] })} className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-sisyphus-700 hover:underline"><FiPlus className="size-3" /> Ρήτρα</button>}
              <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Τότε</p>
              {c.actions.map((a, k) => <ActionEditor key={k} a={a} onChange={(na) => setC(i, { actions: c.actions.map((x, j) => (j === k ? na : x)) })} onRemove={() => setC(i, { actions: c.actions.filter((_, j) => j !== k) })} />)}
              {canManage && <button type="button" onClick={() => setC(i, { actions: [...c.actions, { type: 'FLAG_REVIEW', params: { reason: 'Έλεγχος' } }] })} className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-sisyphus-700 hover:underline"><FiPlus className="size-3" /> Ενέργεια</button>}
            </div>
          </div>))}
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <h2 className="text-[16px] font-semibold">Λειτουργία</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(MODE_LABEL) as TemplateMode[]).map((m) => { const locked = m === 'AUTO' && !canPost; return (
            <button key={m} type="button" disabled={!canManage || locked} onClick={() => setMode(m)} aria-pressed={mode === m}
              className={cn('cursor-pointer rounded-md border p-3 text-left cx-transition disabled:cursor-not-allowed disabled:opacity-50', mode === m ? 'border-sisyphus-500 bg-sisyphus-50' : 'border-border bg-white hover:border-sisyphus-300')}>
              <div className="text-[13px] font-semibold">{MODE_LABEL[m]}{locked && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(απαιτεί ocr.post)</span>}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{MODE_HELP[m]}</div></button>); })}
        </div>
        <div><label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Emails ειδοποίησης (χωρισμένα με ;)</label><Input value={emails} disabled={!canManage} onChange={(e) => setEmails(e.target.value)} className="mt-1 max-w-lg" placeholder="logistirio@example.gr; admin@example.gr" /></div>
        {canManage && <Button size="sm" onClick={saveMode} disabled={!dirtyMode || busy}><FiSave className="mr-1 size-3.5" /> Αποθήκευση λειτουργίας</Button>}
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-neutral-4 p-3">
        <div className="flex-1 text-[12px]"><span className="font-semibold">Κατάσταση:</span> {dto.status === 'ACTIVE' ? 'Ενεργό — εφαρμόζεται αυτόματα σε νέα έγγραφα του προμηθευτή.' : 'Πρόχειρο — δεν εφαρμόζεται. Χρειάζεται δείγμα, πεδίο με περιοχή και mapping.'}</div>
        {canManage && (dto.status === 'ACTIVE'
          ? <Button size="sm" variant="secondary" onClick={() => setStatus('DRAFT')} disabled={busy}>Απενεργοποίηση</Button>
          : <Button size="sm" onClick={() => setStatus('ACTIVE')} disabled={busy}><FiZap className="mr-1 size-3.5" /> Ενεργοποίηση</Button>)}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + visual check**: add a rule «Σύνολο > 1000 → Σήμανε για έλεγχο», save; set mode Ημιαυτόματο, save; press Ενεργοποίηση (or see the Greek `not_ready` toast if a prerequisite is missing). Screenshot.

- [ ] **Step 3: Commit**

```bash
git add components/templates/conditions-step.tsx
git commit -m "feat(templates): conditions, mode, notify and activation step

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: React Flow panel

**Files:**
- Replace: `components/templates/flow-panel.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';

import * as React from 'react';
import { ReactFlow, Background, Controls, Handle, Position, type Node, type Edge, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FiCpu, FiFileText, FiGitBranch, FiImage, FiUploadCloud } from 'react-icons/fi';
import { buildFlow, toFlowTemplate } from '@/lib/templates/flow';
import { useDesigner } from './designer-context';

type D = Record<string, unknown>;
const card = 'rounded-md border bg-white px-2.5 py-2 text-[11px] shadow-fluent-2 min-w-[150px]';

function SampleNode({ data }: NodeProps<Node<D>>) {
  return <div className={`${card} border-border`}><Handle type="source" position={Position.Right} /><div className="flex items-center gap-1.5 font-semibold"><FiImage className="size-3.5 text-sisyphus-600" /> {String(data.label)}</div><div className="text-muted-foreground">{Number(data.pageCount)} σελίδ{Number(data.pageCount) === 1 ? 'α' : 'ες'}</div></div>;
}
function FieldNode({ data }: NodeProps<Node<D>>) {
  const color = String(data.color); const status = data.status as string | undefined;
  return (
    <div className={`${card} border-border`} style={{ borderLeft: `4px solid ${color}` }}>
      <Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5 font-semibold" style={{ color }}>{String(data.label)}{status && <span className={`ml-auto rounded-full px-1.5 text-[9px] ${status === 'ok' ? 'bg-[#E8F7F0] text-[#047857]' : 'bg-[#FFF1E6] text-[#C2410C]'}`}>{status === 'ok' ? 'ok' : 'κενό'}</span>}</div>
      <div className="text-muted-foreground">{data.kind === 'TABLE' ? 'πίνακας' : 'τιμή'}{data.hasRegion ? ` · σ.${Number(data.page) + 1}` : ' · χωρίς περιοχή'}</div>
      {data.value != null && <div className="mt-0.5 truncate font-mono text-[10px]">{String(data.value)}</div>}
    </div>);
}
function ConditionNode({ data }: NodeProps<Node<D>>) {
  const matched = data.matched as boolean | undefined;
  return (
    <div className={`${card} ${matched === true ? 'border-[#047857]' : 'border-border'}`}>
      <Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5 font-semibold"><FiGitBranch className="size-3.5 text-[#B45309]" /> {String(data.label)}</div>
      <div className="text-muted-foreground">{Number(data.clauses)} ρήτρ{Number(data.clauses) === 1 ? 'α' : 'ες'} · {(data.actions as string[]).length} ενέργ.</div>
    </div>);
}
function MappingNode({ data }: NodeProps<Node<D>>) {
  return (
    <div className={`${card} ${data.active ? 'border-sisyphus-500' : 'border-border'}`}>
      <Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5 font-semibold"><FiFileText className="size-3.5 text-sisyphus-600" /> {String(data.label)}</div>
      <div className="text-muted-foreground">{Number(data.rows)} αντιστοιχίσεις</div>
    </div>);
}
function OutputNode({ data }: NodeProps<Node<D>>) {
  return (
    <div className={`${card} border-border bg-neutral-4`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-1.5 font-semibold">{data.mode === 'AUTO' ? <FiUploadCloud className="size-3.5 text-[#047857]" /> : <FiCpu className="size-3.5 text-muted-foreground" />} {String(data.label)}</div>
      {data.runStatus != null && <div className="text-muted-foreground">τελευταία: {String(data.runStatus)}</div>}
    </div>);
}
const nodeTypes = { sample: SampleNode, field: FieldNode, condition: ConditionNode, mapping: MappingNode, output: OutputNode };

export function FlowPanel() {
  const { dto, setFocusKey, goToStep } = useDesigner();
  const { nodes, edges } = React.useMemo(() => buildFlow(toFlowTemplate(dto)), [dto]);
  const rfNodes = React.useMemo<Node<D>[]>(() => nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data, draggable: false })), [nodes]);
  const rfEdges = React.useMemo<Edge[]>(() => edges.map((e) => ({ ...e, type: 'smoothstep' })), [edges]);

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    if (node.id === 'sample') goToStep(1);
    else if (node.id.startsWith('field:')) { setFocusKey(node.id.slice(6)); goToStep(2); }
    else if (node.id.startsWith('map:')) goToStep(3);
    else if (node.id.startsWith('cond:') || node.id === 'output') goToStep(4);
  };

  return (
    <div className="h-full w-full" data-testid="flow-panel">
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} fitView fitViewOptions={{ padding: 0.2 }} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
        <Background gap={16} color="#EDEBE9" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
```

If Tailwind's preflight interferes with React Flow's CSS, the imported stylesheet wins for its own classes; keep the container sized (`h-full`) or the canvas renders empty.

- [ ] **Step 2: Type-check + visual check**: the panel shows Δείγμα → coloured field nodes → conditions → mappings → output, edges in field colours; clicking a field node jumps to the regions step with that field focused. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add components/templates/flow-panel.tsx
git commit -m "feat(templates): live React Flow panel with coloured field nodes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Wiki, changelog, final checks

**Files:**
- Create: `docs/wiki/ocr/templates.mdx`
- Modify: `docs/manual/CHANGELOG.md`
- Run: `npm run wiki:index`

- [ ] **Step 1: Wiki page** (`docs/wiki/ocr/templates.mdx`)

```mdx
---
title: "Πρότυπα προμηθευτών"
module: ocr
slug: templates
roles: [SUPER_ADMIN, ADMIN, EMPLOYEE]
order: 60
updatedAt: 2026-09-10
description: "Σχεδίαση περιοχών ανά προμηθευτή, πεδία με χρώμα, mapping σε παραστατικό ή Excel, conditions και λειτουργία (αυτόματη, ημιαυτόματη, χειροκίνητη)."
screenshots:
  - file: designer.png
    route: /admin/ocr/templates
    caption: "Λίστα προτύπων και designer"
related: [ocr-overview]
helpAnchors: [templates, ocr-templates]
---

## Τι είναι

Ένα πρότυπο λέει στην εφαρμογή **πού** βρίσκεται κάθε πληροφορία στα παραστατικά ενός προμηθευτή και **τι** να κάνει με αυτήν. Εφαρμόζεται αυτόματα όταν ένα σαρωμένο έγγραφο έχει ΑΦΜ εκδότη ίδιο με του προτύπου.

<Steps>
  <li><strong>Προμηθευτής</strong> — «Νέο πρότυπο», διάλεξε προμηθευτή από το SoftOne (ή δώσε ΑΦΜ) και τύπο εγγράφου.</li>
  <li><strong>Δείγμα</strong> — ανέβασε ένα καθαρό PDF ή εικόνα του προμηθευτή.</li>
  <li><strong>Περιοχές & πεδία</strong> — πρόσθεσε πεδίο, πάτησε το στόχαστρο και σύρε πλαίσιο πάνω στο δείγμα. Κάθε πεδίο έχει δικό του χρώμα: το ίδιο χρώμα εμφανίζεται στην περιοχή, στην τιμή και στο διάγραμμα. Με τον κεραυνό δοκιμάζεις την ανάγνωση αμέσως.</li>
  <li><strong>Mapping</strong> — πες σε ποιο πεδίο παραστατικού (ή στήλη Excel) πηγαίνει κάθε πεδίο. Στήλες πίνακα → «Γραμμές».</li>
  <li><strong>Conditions & λειτουργία</strong> — κανόνες (αν … τότε …), λειτουργία AUTO / ημιαυτόματη / χειροκίνητη, emails ειδοποίησης, ενεργοποίηση.</li>
</Steps>

<Callout type="info">
  Το διάγραμμα δεξιά ξαναζωγραφίζεται σε κάθε αποθήκευση. Κλικ σε κόμβο ανοίγει το αντίστοιχο βήμα.
</Callout>

<Callout type="warning">
  Η αυτόματη λειτουργία (AUTO) αναρτά στο SoftOne χωρίς έλεγχο. Απαιτεί δικαίωμα <RoleBadge role="ADMIN" /> με ανάρτηση και συνιστάται μόνο για δοκιμασμένα πρότυπα.
</Callout>

<Callout type="danger">
  Αν διαγράψεις ή μετονομάσεις πεδίο, οι αντιστοιχίσεις και οι ρήτρες που το αναφέρουν αφαιρούνται αυτόματα. Η εφαρμογή σε ενημερώνει με μήνυμα.
</Callout>
```

- [ ] **Step 2: Changelog** — prepend to `docs/manual/CHANGELOG.md`:

```markdown
## 2026-09-10 — Designer προτύπων προμηθευτών

- Νέα σελίδα `/admin/ocr/templates` (αντικαθιστά τα παλιά «Πρότυπα Προμηθευτών (OCR)») με δημιουργία προτύπου από αναζήτηση προμηθευτή SoftOne.
- Designer 5 βημάτων: προμηθευτής, δείγμα, περιοχές & πεδία (χρώμα ανά πεδίο, ζωντανή δοκιμή ανάγνωσης), mapping (παραστατικό / Excel), conditions & λειτουργία.
- Διάγραμμα ροής (React Flow) που παράγεται από τη ρύθμιση και ενημερώνεται σε κάθε αποθήκευση.
- Σύνδεσμος στο sidebar και σελίδα wiki.
```

- [ ] **Step 3: Rebuild wiki index, full verification**

Run: `npm run wiki:index; npx vitest run; rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`
Expected: index written; all tests pass; no tsc output.

- [ ] **Step 4: End-to-end check in the browser** — create a template for a real supplier, upload a sample invoice PDF, draw three fields (title, number, total as Ποσό), test each, map number → Αριθμός παραστατικού and total → Γενικό σύνολο, add a rule «Σύνολο > 1000 → Σήμανε για έλεγχο», set Ημιαυτόματο, activate. The flow panel shows the full chain. Then delete the template from the list.

- [ ] **Step 5: Commit**

```bash
git add docs/wiki/ocr/templates.mdx docs/manual/CHANGELOG.md public/wiki/index.json
git commit -m "docs(templates): wiki page and changelog for the designer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (plan 2 scope):** §3α steps 1–6 → Tasks 3 (create), 5 (sample, supplier), 6 (regions/fields/test), 7 (mapping, multiple), 8 (conditions, mode, notify, activate), 9 (flow panel, node click). §5 UI (stepper, canvas card on neutral canvas, coloured regions with 2px border via `RegionMarker`, chips with colour swatch, Fluent shadows) → Tasks 4, 6, 9. §6 AUTO gating → Task 8 (`canPost`). Legacy page replacement noted in plan 1 → Task 3. Wiki per project rule → Task 10. Not in scope (plan 3): run-result view, pipeline, Excel routes, field-rules migration; (plan 4): training tab, jobs pages.

**Type consistency:** `TemplateDto` shape from `serialize.ts` is used for `dto` everywhere; `FieldDef`/`Region`/`MappingRowInvoice|Excel`/`Clause`/`Action` from `schema.ts`; `toFlowTemplate` (Task 1) consumed by Task 9; `templatesApi` (Task 2) consumed by Tasks 3, 5–8; `DesignerContext` (Task 4) consumed by 5–9. `RegionMarker` props (`pageImageUrl`, `savedRegions[{bbox,color,active}]`, `isMarking`, `onRegionComplete(box,page)`, `showNav`) match `components/ui/region-marker.tsx`.

**Placeholders:** none — every step has complete code or an exact command.
