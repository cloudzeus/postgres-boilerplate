# Extraction Templates — Plan 3: Execution pipeline (runs, result view, Excel/JSON, legacy cleanup)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a template on a document (automatically at upload by ΑΦΜ, or manually), store the run, show it on the document page with coloured regions and a live flow, export JSON/Excel per document and per folder, and retire the legacy supplier field-rules/template code.

**Architecture:** Spec `docs/superpowers/specs/2026-09-09-extraction-templates-design.md` — read §3β–3δ, §4, §6, §7, §14.1(5), §14.8 and **§15** (the decisions for this plan) before any task. Pure logic in `lib/templates/{run-logic,output,excel}.ts` (vitest), server orchestration in `lib/templates/run.ts` + `lib/templates/notify.ts` + `lib/ocr/post-softone.ts`, routes under `app/api/admin/ocr/**`, UI in `components/templates/{run-result,run-field-list,template-picker,flow-canvas}.tsx` wired into `app/admin/ocr/[id]/page.tsx`, list/batch columns, wiki, and a migration script + cleanup for `SupplierFieldRule`/`SupplierTemplate`.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (PostgreSQL, hand-written SQL migrations, `npx prisma migrate deploy`), zod 4, vitest 4, exceljs, Mailgun (`lib/mailgun.ts`), `@xyflow/react`, DG design system, react-icons/fi, sonner.

**Conventions (from CLAUDE.md and previous plans):**
- Type-check: `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"` → no output = clean. Tests: `npm test` (vitest, `lib/**/*.test.ts`; `server-only` is aliased to a shim; server modules are mocked with `vi.mock`, see `lib/templates/__tests__/extract.test.ts` and `list.test.ts`).
- Greek UI text, no dynamic Tailwind classes (inline hex only for data colours such as field colours), `cursor-pointer` on clickable non-buttons, every UI feature gets a wiki entry.
- `.env` points at the customer's live DB: migrations only via `npx prisma migrate deploy` + `npx prisma generate`; never `migrate dev`/`reset`/`db push`. Scripts run with `npx tsx --import ./scripts/templates/register.mjs <script>` (the `server-only` loader) and `import 'dotenv/config'`.
- Commit after every task with a conventional message.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/migrations/20260910120000_template_runs_pipeline/migration.sql` | `TemplateRun.trigger`, `TemplateRun.error`, `OcrDocument.reviewFlags` |
| `lib/templates/run-logic.ts` | pure: set-field application, required check, mapping pick, status decision, extras, items rows, review flags |
| `lib/templates/output.ts` | + `toRunOutput` (classic keys + template values) |
| `lib/templates/excel.ts` | pure: runs → sheets (columns/rows), name sanitising |
| `lib/templates/excel-server.ts` | exceljs workbook buffer |
| `lib/ocr/post-softone.ts` | `postDocumentToSoftone(docId)` shared by the route and the runner |
| `lib/templates/notify.ts` | NOTIFY emails with per-document/per-rule throttling |
| `lib/templates/run.ts` | `findTemplateForVat`, `runTemplateOnDocument` (server orchestration, non-fatal) |
| `lib/templates/labels.ts` | + run status labels |
| `app/api/admin/ocr/route.ts`, `app/api/admin/ocr/[id]/reextract/route.ts` | call the runner after extraction |
| `app/api/admin/ocr/[id]/template-runs/route.ts` | GET list / POST run |
| `app/api/admin/ocr/[id]/template-runs/[runId]/route.ts` | PATCH manual values, GET output JSON |
| `app/api/admin/ocr/[id]/template-excel/route.ts` | Excel per document |
| `app/api/admin/ocr/batches/[id]/template-excel/route.ts`, `.../template-json/route.ts` | Excel / JSON array per folder |
| `components/templates/flow-canvas.tsx`, `flow-panel.tsx` | canvas extracted, orientation prop |
| `components/templates/template-picker.tsx`, `run-field-list.tsx`, `run-result.tsx` | document-page run card |
| `app/admin/ocr/[id]/page.tsx` | loads runs + templates, renders `RunResult` |
| `app/admin/ocr/page.tsx`, `ocr-table.tsx` | «Πρότυπο» column |
| `app/admin/ocr/batches/[id]/{page,batch-detail-client}.tsx` | Excel/JSON buttons + run status per row |
| `docs/wiki/ocr/template-runs.mdx`, `docs/wiki/ocr/templates.mdx`, `docs/manual/CHANGELOG.md` | docs |
| `scripts/templates/migrate-field-rules.ts` | field rules → templates (with backup) |
| `lib/templates/slug.ts` | `slugifyFieldKey` moved out of `lib/ocr/field-rules.ts` |
| `prisma/migrations/20260910130000_drop_supplier_field_rules/migration.sql` | drop legacy tables |

---

### Task 1: Migration — run trigger/error, document review flags

**Files:**
- Create: `prisma/migrations/20260910120000_template_runs_pipeline/migration.sql`
- Modify: `prisma/schema.prisma` (`model TemplateRun`, `model OcrDocument`), `lib/templates/serialize.ts` (no change needed unless it maps runs — check)

- [ ] **Step 1: SQL**

```sql
-- Plan 3: runs record what triggered them and why they failed; documents cache the latest run's flags for the list.
ALTER TABLE "TemplateRun" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "TemplateRun" ADD COLUMN "error" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "reviewFlags" JSONB;
```

- [ ] **Step 2: Prisma** — in `model TemplateRun` add after `status`:
```prisma
  trigger         String             @default("upload")   // upload | manual | reextract
  error           String?            @db.Text
```
and in `model OcrDocument` after `templateRuns  TemplateRun[]`:
```prisma
  reviewFlags   Json?                                 // { review: string[], blocked: string[], templateSlug, templateName, runStatus, runId } — latest run, for the list
```

- [ ] **Step 3:** `npx prisma migrate status` (must say up to date, 22 migrations) → `npx prisma migrate deploy` → `npx prisma generate`. Type-check clean, `npm test` green.
- [ ] **Step 4: Commit** — `git add prisma && git commit -m "feat(templates): run trigger/error columns and document reviewFlags"`

---

### Task 2: Pure run logic + run output

**Files:**
- Create: `lib/templates/run-logic.ts`, `lib/templates/__tests__/run-logic.test.ts`
- Modify: `lib/templates/output.ts`, `lib/templates/__tests__/output.test.ts`, `lib/templates/labels.ts`

- [ ] **Step 1: Failing tests** — `lib/templates/__tests__/run-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applySetFields, requiredMissing, pickMapping, decideStatus, extrasFrom, itemsToRows, setInvoicePath, buildReviewFlags } from '../run-logic';
import type { FieldDef, FieldValue } from '../schema';

const f = (key: string, over: Partial<FieldDef> = {}): FieldDef => ({ key, label: key, kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4', region: { page: 0, bbox: [0, 0, 0.1, 0.1] }, columns: null, aiHint: null, required: false, order: 0, ...over });
const v = (value: FieldValue['value'], source: FieldValue['source'] = 'vision'): FieldValue => ({ raw: value == null ? null : String(value), value, confidence: 0.8, source, page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

describe('applySetFields', () => {
  it('coerces by the field type and marks the value manual', () => {
    const out = applySetFields({ total: v('1') }, [f('total', { valueType: 'CURRENCY' })], [{ fieldKey: 'total', value: '1.234,50' }]);
    expect(out.total.value).toBe(1234.5);
    expect(out.total.source).toBe('manual');
    expect(out.total.raw).toBe('1.234,50');
  });
  it('creates a value for a field that had none and ignores unknown keys', () => {
    const out = applySetFields({}, [f('note')], [{ fieldKey: 'note', value: 'x' }, { fieldKey: 'nope', value: 'y' }]);
    expect(out.note.value).toBe('x');
    expect(out.nope).toBeUndefined();
  });
});

describe('requiredMissing', () => {
  it('lists required fields whose value is null or empty', () => {
    const fields = [f('a', { required: true }), f('b', { required: true }), f('c', { required: true }), f('d')];
    expect(requiredMissing(fields, { a: v('ok'), b: v(''), c: v(null) })).toEqual([fields[1], fields[2]]);
  });
});

describe('pickMapping', () => {
  const maps = [{ name: 'default', target: 'INVOICE' as const, isDefault: true, rows: [] }, { name: 'credit', target: 'INVOICE' as const, isDefault: false, rows: [] }, { name: 'xls', target: 'EXCEL' as const, isDefault: false, rows: [] }];
  it('prefers the switched name, then the default INVOICE mapping, then the first INVOICE one', () => {
    expect(pickMapping(maps, 'credit')?.name).toBe('credit');
    expect(pickMapping(maps, null)?.name).toBe('default');
    expect(pickMapping(maps.slice(1), null)?.name).toBe('credit');
    expect(pickMapping([maps[2]], null)).toBeNull();
    expect(pickMapping(maps, 'xls')?.name).toBe('default'); // EXCEL mappings never drive the invoice projection
  });
});

describe('decideStatus', () => {
  it('follows the mode and the blocked flags', () => {
    expect(decideStatus('MANUAL', { review: [], blocked: [] })).toBe('EXTRACTED');
    expect(decideStatus('SEMI_AUTO', { review: ['x'], blocked: [] })).toBe('REVIEW');
    expect(decideStatus('AUTO', { review: [], blocked: ['x'] })).toBe('BLOCKED');
    expect(decideStatus('AUTO', { review: [], blocked: [] })).toBe('POST');
  });
});

describe('extrasFrom', () => {
  it('reads $total/$itemsCount/$pageCount from the base OCR result', () => {
    expect(extrasFrom({ totalAmount: 12.5 }, 3, 2)).toEqual({ $total: 12.5, $itemsCount: 3, $pageCount: 2 });
    expect(extrasFrom({}, 0, 1).$total).toBeNull();
  });
});

describe('setInvoicePath', () => {
  it('writes header keys and customFields.<k>, ignores items.*', () => {
    const d: Record<string, unknown> = { customFields: { a: 1 } };
    setInvoicePath(d, 'invoiceNumber', '9');
    setInvoicePath(d, 'customFields.po', 'PO-1');
    setInvoicePath(d, 'items.total', '1');
    expect(d).toEqual({ invoiceNumber: '9', customFields: { a: 1, po: 'PO-1' } });
  });
});

describe('itemsToRows', () => {
  it('maps extracted items to OcrInvoiceItem rows with numeric coercion', () => {
    expect(itemsToRows([{ code: 'A', name: 'x', quantity: '2', price: 1.5, total: null }])).toEqual([{ rowIndex: 0, code: 'A', name: 'x', quantity: 2, price: 1.5, discount: null, vatRate: null, total: null }]);
  });
});

describe('buildReviewFlags', () => {
  it('summarises a run for the document list', () => {
    expect(buildReviewFlags({ slug: 's', name: 'N' }, 'REVIEW', 'r1', { review: ['a'], blocked: [] })).toEqual({ review: ['a'], blocked: [], templateSlug: 's', templateName: 'N', runStatus: 'REVIEW', runId: 'r1' });
  });
});
```

Append to `output.test.ts`:
```ts
import { toRunOutput } from '../output';
describe('toRunOutput', () => {
  it('merges classic invoice keys with template values, template wins', () => {
    const out = toRunOutput({ slug: 's', version: 2, file: 'a.pdf', documentId: 'd1', createdAt: new Date('2026-09-10T10:00:00Z'), extractedData: { invoiceNumber: '1', totalAmount: 5, companyName: 'X', items: [{ name: 'n' }], rawJunk: 1 }, values: { totalAmount: fv(7), kwh: fv(3) } });
    expect(out).toEqual({ template: 's', version: 2, extractedAt: '2026-09-10T10:00:00.000Z', file: 'a.pdf', documentId: 'd1', values: { invoiceNumber: '1', companyName: 'X', totalAmount: 7, kwh: 3 } });
  });
  it('omits classic keys that are null/empty and skips items', () => {
    expect(toRunOutput({ slug: 's', version: 1, file: 'f', documentId: 'd', createdAt: new Date(0), extractedData: { invoiceNumber: '', date: null, items: [] }, values: {} }).values).toEqual({});
  });
});
```
(`fv` is the existing helper in that test file.)

- [ ] **Step 2: Run** → FAIL. 
- [ ] **Step 3: Implement `lib/templates/run-logic.ts`**

```ts
// lib/templates/run-logic.ts — PURE pieces of a template run (spec §15.3). No I/O.
import { coerceValue } from './coerce';
import { invoiceKeyInfo, type FieldDef, type FieldValue, type MappingTarget, type TemplateMode } from './schema';

export type RunFlags = { review: string[]; blocked: string[] };
export type MappingLike = { name: string; target: MappingTarget; isDefault: boolean; rows: unknown[] };
export type RunDecision = 'EXTRACTED' | 'REVIEW' | 'BLOCKED' | 'POST';

/** SET_FIELD actions that target a template field: coerce by the field's type and mark the value as manual. */
export function applySetFields(values: Record<string, FieldValue>, fields: FieldDef[], sets: { fieldKey?: string; value: string }[]): Record<string, FieldValue> {
  const out = { ...values };
  for (const s of sets) {
    if (!s.fieldKey) continue;
    const f = fields.find((x) => x.key === s.fieldKey);
    if (!f) continue;
    const prev = out[f.key];
    out[f.key] = { raw: s.value, value: coerceValue(s.value, f.valueType), confidence: 1, source: 'manual', page: prev?.page ?? f.region?.page ?? null, bbox: prev?.bbox ?? f.region?.bbox ?? null, color: f.color };
  }
  return out;
}

const isBlank = (v: FieldValue['value']) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

export function requiredMissing(fields: FieldDef[], values: Record<string, FieldValue>): FieldDef[] {
  return fields.filter((f) => f.required && isBlank(values[f.key]?.value ?? null));
}

/** The INVOICE mapping that drives the projection: the switched one if it exists and is INVOICE, else the default, else the first. */
export function pickMapping<M extends MappingLike>(mappings: M[], switched: string | null): M | null {
  const invoice = mappings.filter((m) => m.target === 'INVOICE');
  if (switched) { const hit = invoice.find((m) => m.name === switched); if (hit) return hit; }
  return invoice.find((m) => m.isDefault) ?? invoice[0] ?? null;
}

export function decideStatus(mode: TemplateMode, flags: RunFlags): RunDecision {
  if (mode === 'MANUAL') return 'EXTRACTED';
  if (mode === 'SEMI_AUTO') return 'REVIEW';
  return flags.blocked.length ? 'BLOCKED' : 'POST';
}

export function extrasFrom(extracted: Record<string, unknown>, itemsCount: number, pageCount: number): Record<string, number | string | null> {
  const t = extracted.totalAmount;
  return { $total: typeof t === 'number' ? t : typeof t === 'string' && t.trim() ? t : null, $itemsCount: itemsCount, $pageCount: pageCount };
}

/** SET_FIELD actions that target an invoice key, applied after the projection. `items.*` cannot be set as a whole — ignored. */
export function setInvoicePath(data: Record<string, unknown>, invoiceKey: string, value: string): void {
  const info = invoiceKeyInfo(invoiceKey);
  if (!info || info.isLine) return;
  if (invoiceKey.startsWith('customFields.')) {
    const prev = data.customFields;
    const cf = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as Record<string, unknown>) } : {};
    cf[invoiceKey.slice('customFields.'.length)] = value;
    data.customFields = cf;
    return;
  }
  data[invoiceKey] = info.valueType === 'TEXT' ? value : (coerceValue(value, info.valueType) ?? value);
}

export type ItemRow = { rowIndex: number; code: string | null; name: string; quantity: number | null; price: number | null; discount: number | null; vatRate: number | null; total: number | null };
const num = (x: unknown): number | null => { if (x == null || x === '') return null; const n = typeof x === 'number' ? x : Number(String(x).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** extractedData.items → OcrInvoiceItem rows (same shape the upload route writes). */
export function itemsToRows(items: unknown[]): ItemRow[] {
  return items.map((raw, i) => { const it = (raw ?? {}) as Record<string, unknown>; return { rowIndex: i, code: it.code == null ? null : String(it.code), name: String(it.name ?? ''), quantity: num(it.quantity), price: num(it.price), discount: num(it.discount), vatRate: num(it.vatRate), total: num(it.total) }; });
}

export type ReviewFlags = RunFlags & { templateSlug: string; templateName: string; runStatus: string; runId: string };
export function buildReviewFlags(t: { slug: string; name: string }, status: string, runId: string, flags: RunFlags): ReviewFlags {
  return { review: flags.review, blocked: flags.blocked, templateSlug: t.slug, templateName: t.name, runStatus: status, runId };
}
```

- [ ] **Step 4: `toRunOutput`** — append to `lib/templates/output.ts`:

```ts
import { INVOICE_SCHEMA } from './schema';
export type RunOutputJson = OutputJson & { file: string; documentId: string };

/** JSON for one run: classic invoice keys present in the base OCR result, then the template's values (template wins). Spec §14.8. */
export function toRunOutput(input: { slug: string; version: number; file: string; documentId: string; createdAt: Date; extractedData: Record<string, unknown> | null; values: Record<string, FieldValue> }): RunOutputJson {
  const values: OutputJson['values'] = {};
  const data = input.extractedData ?? {};
  for (const k of INVOICE_SCHEMA) {
    if (k.isLine) continue;
    const v = data[k.key];
    if (v == null || v === '') continue;
    values[k.key] = v as OutputJson['values'][string];
  }
  for (const [key, v] of Object.entries(input.values)) values[key] = v.value;
  return { template: input.slug, version: input.version, extractedAt: input.createdAt.toISOString(), file: input.file, documentId: input.documentId, values };
}
```

- [ ] **Step 5: Labels** — add to `lib/templates/labels.ts`:
```ts
export const RUN_STATUS_LABEL = { EXTRACTED: 'Εξήχθη', REVIEW: 'Προς έλεγχο', BLOCKED: 'Μπλοκαρισμένο', POSTED: 'Αναρτήθηκε', FAILED: 'Απέτυχε' } as const;
export const TRIGGER_LABEL = { upload: 'στο upload', manual: 'χειροκίνητα', reextract: 'στην επανεξαγωγή' } as const;
```
- [ ] **Step 6: Run** tests → PASS; commit `feat(templates): pure run logic and run output JSON`.

---

### Task 3: Shared SoftOne posting + rule notifications

**Files:**
- Create: `lib/ocr/post-softone.ts`, `lib/templates/notify.ts`, `lib/templates/__tests__/notify.test.ts`
- Modify: `app/api/admin/ocr/[id]/post-softone/route.ts`

- [ ] **Step 1: `lib/ocr/post-softone.ts`** — move the route's body (the stub that marks the document POSTED with `OCR-<id>` and the `TODO` comment) into:
```ts
// lib/ocr/post-softone.ts — SERVER. One place for "post this document to SoftOne" (route + template runner).
import 'server-only';
import { prisma } from '@/lib/db';

export class PostError extends Error { constructor(public code: 'not_found' | 'not_completed' | 'no_category', message: string) { super(message); } }

/** Posts the document. Throws PostError for precondition failures; rethrows transport errors after marking FAILED. */
export async function postDocumentToSoftone(id: string): Promise<{ ref: string }> {
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, include: { items: true } });
  if (!doc) throw new PostError('not_found', 'not found');
  if (doc.status !== 'COMPLETED') throw new PostError('not_completed', 'OCR document is not in COMPLETED state');
  if (!doc.category) throw new PostError('no_category', 'Set a category before posting (EXPENSE / INVOICE_IN / …).');
  await prisma.ocrDocument.update({ where: { id }, data: { postStatus: 'PENDING' } });
  try {
    // TODO (unchanged from the route): route by doc.category to PURDOC / SODOC via lib/softone.
    const ref = `OCR-${doc.id.slice(0, 8).toUpperCase()}`;
    await prisma.ocrDocument.update({ where: { id }, data: { postStatus: 'POSTED', postedAt: new Date(), postedRef: ref, postError: null } });
    return { ref };
  } catch (err) {
    await prisma.ocrDocument.update({ where: { id }, data: { postStatus: 'FAILED', postError: String((err as Error)?.message ?? err).slice(0, 2000) } });
    throw err;
  }
}
```
The route keeps `requirePermission('ocr.post')` and maps `PostError.code` → 404 / 422 / 422, other errors → 502, success → `{ ok: true, ref }`.

- [ ] **Step 2: Notify test** — `lib/templates/__tests__/notify.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const send = vi.fn(async () => ({}));
vi.mock('@/lib/mailgun', () => ({ sendTransactionalEmail: (...a: unknown[]) => send(...a) }));
import { sendRuleNotifications, notificationHtml } from '../notify';

beforeEach(() => send.mockClear());
describe('sendRuleNotifications', () => {
  const base = { docId: 'd1', fileName: 'a.pdf', templateName: 'T', defaultEmails: 'a@x.gr; b@x.gr', values: { total: { value: 12, color: '#000' } }, appUrl: 'https://app' };
  it('sends one email per rule, to the rule emails or the template default, and returns the notified ids', async () => {
    const ids = await sendRuleNotifications({ ...base, notifications: [{ conditionId: 'c1', subject: 'S1' }, { conditionId: 'c2', subject: 'S2', emails: 'z@x.gr' }], alreadyNotified: [] });
    expect(ids).toEqual(['c1', 'c2']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBe('a@x.gr, b@x.gr');
    expect(send.mock.calls[1][0]).toBe('z@x.gr');
  });
  it('skips rules already notified for this document and rules with no recipients', async () => {
    const ids = await sendRuleNotifications({ ...base, defaultEmails: null, notifications: [{ conditionId: 'c1', subject: 'S1' }, { conditionId: 'c2', subject: 'S2', emails: 'z@x.gr' }], alreadyNotified: ['c2'] });
    expect(ids).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  it('a failed send does not throw and is not recorded', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    const ids = await sendRuleNotifications({ ...base, notifications: [{ conditionId: 'c1', subject: 'S1' }], alreadyNotified: [] });
    expect(ids).toEqual([]);
  });
});
describe('notificationHtml', () => {
  it('escapes values and links to the document', () => {
    const html = notificationHtml({ fileName: 'a<b>.pdf', templateName: 'T', values: { x: { value: '<i>', color: '#0078D4' } }, link: 'https://app/admin/ocr/d1' });
    expect(html).toContain('a&lt;b&gt;.pdf');
    expect(html).toContain('&lt;i&gt;');
    expect(html).toContain('https://app/admin/ocr/d1');
  });
});
```
- [ ] **Step 3: Implement `lib/templates/notify.ts`** (server-only import of mailgun; keep the module otherwise pure so the test can mock it):
```ts
// lib/templates/notify.ts — NOTIFY actions → Mailgun, one email per document and rule (spec §6, §15.3).
import { sendTransactionalEmail } from '@/lib/mailgun';

export type Notification = { conditionId: string; subject: string; emails?: string };
type ValueLike = { value: unknown; color: string };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const recipients = (s: string | null | undefined) => String(s ?? '').split(/[;,\s]+/).map((x) => x.trim()).filter((x) => /.+@.+\..+/.test(x));

export function notificationHtml(i: { fileName: string; templateName: string; values: Record<string, ValueLike>; link: string }): string {
  const rows = Object.entries(i.values).map(([k, v]) => `<tr><td style="padding:4px 8px;color:${esc(v.color)};font-family:monospace">${esc(k)}</td><td style="padding:4px 8px">${esc(Array.isArray(v.value) ? `${v.value.length} γραμμές` : v.value ?? '—')}</td></tr>`).join('');
  return `<p>Το έγγραφο <strong>${esc(i.fileName)}</strong> διαβάστηκε με το πρότυπο <strong>${esc(i.templateName)}</strong>.</p><table>${rows}</table><p><a href="${esc(i.link)}">Άνοιγμα εγγράφου</a></p>`;
}

export async function sendRuleNotifications(i: { docId: string; fileName: string; templateName: string; defaultEmails: string | null; values: Record<string, ValueLike>; appUrl: string; notifications: Notification[]; alreadyNotified: string[] }): Promise<string[]> {
  const done: string[] = [];
  const seen = new Set(i.alreadyNotified);
  for (const n of i.notifications) {
    if (seen.has(n.conditionId)) continue;
    const to = recipients(n.emails).length ? recipients(n.emails) : recipients(i.defaultEmails);
    if (to.length === 0) continue;
    try {
      await sendTransactionalEmail(to.join(', '), n.subject, notificationHtml({ fileName: i.fileName, templateName: i.templateName, values: i.values, link: `${i.appUrl}/admin/ocr/${i.docId}` }));
      done.push(n.conditionId); seen.add(n.conditionId);
    } catch (e) { console.error('[templates] notify failed', n.conditionId, (e as Error).message); }
  }
  return done;
}
```
`appUrl`: the runner reads `process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? ''` — check `.env.example`/`grep -rn "NEXTAUTH_URL\|APP_URL" lib app | head` and use the variable the app already uses for absolute links.
- [ ] **Step 4:** tests green, tsc clean, commit `feat(templates): shared SoftOne posting and rule notifications`.

---

### Task 4: The runner — `lib/templates/run.ts`

**Files:**
- Create: `lib/templates/run.ts`, `lib/templates/__tests__/run.test.ts`

- [ ] **Step 1: Failing tests** — mock `@/lib/db` (prisma with `ocrDocument.findUnique/update`, `extractionTemplate.findUnique/update`, `templateRun.create/findMany`, `ocrInvoiceItem.deleteMany/createMany`, `$transaction: (ops) => Promise.all(ops)` — note the runner passes an array of promises to `$transaction`, so mocked model methods must return promises), `@/lib/bunny` (`bunnyDownload` → `Buffer.from('x')`), `../extract` (`extractTemplateFields`), `@/lib/ocr/post-softone` (`postDocumentToSoftone`), `../notify` (`sendRuleNotifications` → `[]`). Fixture template: two fields (`total` CURRENCY required with region; `note` TEXT), one INVOICE default mapping `[{ fieldKey: 'total', invoiceKey: 'totalAmount' }]`, one condition `{ id: 'c1', name: 'big', clauses: [{ fieldKey: 'total', op: 'gt', value: '100' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'μεγάλο ποσό' } }, { type: 'NOTIFY', params: { subject: 'S' } }] }`. Cases:
  1. MANUAL → run `EXTRACTED`, `extractedData` untouched (no `ocrDocument.update` with `extractedData`), `reviewFlags` written, `timesUsed` incremented, `trigger` stored.
  2. SEMI_AUTO with values total=150 → `REVIEW`, `extractedData.totalAmount === 150`, flags.review contains 'μεγάλο ποσό', notifications called with `conditionId: 'c1'`.
  3. AUTO with `total` missing (extract returns source 'none') → `BLOCKED`, `postDocumentToSoftone` not called, flags.blocked mentions the field label.
  4. AUTO with everything fine → `postDocumentToSoftone` called → `POSTED`.
  5. AUTO where posting throws → `FAILED` with `error`.
  6. `extractTemplateFields` throws → run `FAILED`, `error` set, function resolves (does not throw), `reviewFlags.runStatus === 'FAILED'`.
  7. `findTemplateForVat`: returns the ACTIVE template id for a 9-digit ΑΦΜ (assert the `where`), null for junk.

- [ ] **Step 2: Implement**

```ts
// lib/templates/run.ts — SERVER. Runs one template on one OcrDocument (spec §3β + §15). Never throws for extraction/posting failures.
import 'server-only';
import type { Prisma, TemplateRunStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bunnyDownload } from '@/lib/bunny';
import { postDocumentToSoftone } from '@/lib/ocr/post-softone';
import { extractTemplateFields } from './extract';
import { applyRules, type RuleDef } from './conditions';
import { projectToInvoice } from './mapping';
import { TEMPLATE_INCLUDE, toConditionDto, toFieldDef, toMappingDto } from './serialize';
import { sendRuleNotifications } from './notify';
import { applySetFields, buildReviewFlags, decideStatus, extrasFrom, itemsToRows, pickMapping, requiredMissing, setInvoicePath, type RunFlags } from './run-logic';
import type { FieldValue, MappingRowInvoice } from './schema';

export type RunTrigger = 'upload' | 'manual' | 'reextract';
export type RunOutcome = { runId: string; status: TemplateRunStatus; flags: RunFlags; error: string | null };

const APP_URL = () => process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? '';

/** The ACTIVE template linked to this issuer ΑΦΜ (most recently updated wins). */
export async function findTemplateForVat(vat: unknown): Promise<string | null> {
  const afm = String(vat ?? '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(afm)) return null;
  const t = await prisma.extractionTemplate.findFirst({ where: { vatNumber: afm, status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  return t?.id ?? null;
}

export async function runTemplateOnDocument(input: { documentId: string; templateId: string; trigger: RunTrigger }): Promise<RunOutcome> {
  const started = Date.now();
  const [doc, t] = await Promise.all([
    prisma.ocrDocument.findUnique({ where: { id: input.documentId }, include: { items: { orderBy: { rowIndex: 'asc' } } } }),
    prisma.extractionTemplate.findUnique({ where: { id: input.templateId }, include: TEMPLATE_INCLUDE }),
  ]);
  if (!doc) throw new Error('document not found');
  if (!t) throw new Error('template not found');
  const fields = [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef);
  const rules: RuleDef[] = [...t.conditions].sort((a, b) => a.order - b.order).map(toConditionDto).map((c) => ({ id: c.id, name: c.name, order: c.order, isActive: c.isActive, logic: c.logic, clauses: c.clauses, actions: c.actions }));
  const mappings = t.mappings.map(toMappingDto);
  const base = { templateId: t.id, templateVersion: t.version, documentId: doc.id, trigger: input.trigger };
  const extracted = (doc.extractedData ?? {}) as Record<string, unknown>;

  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const ex = await extractTemplateFields(buffer, doc.mimeType, fields, { ref: { refType: 'OcrDocument', refId: doc.id } });
    const pageCount = Math.max(1, ...fields.map((f) => (f.region?.page ?? 0) + 1));
    const applied = applyRules(rules, { values: ex.values, valueTypes: Object.fromEntries(fields.map((f) => [f.key, f.valueType])), extras: extrasFrom(extracted, doc.items.length, pageCount) });
    const values = applySetFields(ex.values, fields, applied.setFields);
    const missing = requiredMissing(fields, values);
    const flags: RunFlags = {
      review: [...applied.flags.review, ...missing.map((f) => `Λείπει υποχρεωτικό πεδίο «${f.label}»`)],
      blocked: [...applied.flags.blocked, ...(t.mode === 'AUTO' ? missing.map((f) => `Λείπει υποχρεωτικό πεδίο «${f.label}»`) : [])],
    };
    const mapping = t.mode === 'MANUAL' ? null : pickMapping(mappings, applied.mappingName);
    let nextData: Record<string, unknown> | null = null;
    if (mapping) {
      nextData = projectToInvoice(values, mapping.rows as MappingRowInvoice[], extracted);
      for (const s of applied.setFields) if (s.invoiceKey) setInvoicePath(nextData, s.invoiceKey, s.value);
    }
    const itemsChanged = nextData != null && nextData.items !== extracted.items && Array.isArray(nextData.items);

    // Persist the document changes BEFORE posting, so the poster sees the mapped data.
    const docUpdate: Prisma.OcrDocumentUpdateInput = {};
    if (nextData) docUpdate.extractedData = nextData as Prisma.InputJsonValue;
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (itemsChanged) {
      ops.push(prisma.ocrInvoiceItem.deleteMany({ where: { documentId: doc.id } }));
      ops.push(prisma.ocrInvoiceItem.createMany({ data: itemsToRows(nextData!.items as unknown[]).map((r) => ({ ...r, documentId: doc.id })) }));
    }

    const decision = decideStatus(t.mode, flags);
    let status: TemplateRunStatus = decision === 'POST' ? 'POSTED' : decision;
    let error: string | null = null;
    if (Object.keys(docUpdate).length || ops.length) await prisma.$transaction([prisma.ocrDocument.update({ where: { id: doc.id }, data: docUpdate }), ...ops]);
    if (decision === 'POST') {
      try { await postDocumentToSoftone(doc.id); } catch (e) { status = 'FAILED'; error = `Ανάρτηση: ${(e as Error).message}`; }
    }

    // NOTIFY — once per document and rule, across all previous runs.
    const previous = await prisma.templateRun.findMany({ where: { documentId: doc.id }, select: { flags: true } });
    const alreadyNotified = previous.flatMap((r) => ((r.flags as { notified?: string[] } | null)?.notified ?? []));
    const notified = await sendRuleNotifications({
      docId: doc.id, fileName: doc.fileName, templateName: t.name, defaultEmails: t.notifyEmails, appUrl: APP_URL(),
      values: values as Record<string, { value: unknown; color: string }>,
      notifications: applied.matched.flatMap((m) => m.actions.filter((a) => a.type === 'NOTIFY').map((a) => ({ conditionId: m.id, subject: (a.params as { subject: string; emails?: string }).subject, emails: (a.params as { emails?: string }).emails }))),
      alreadyNotified,
    });

    const run = await prisma.templateRun.create({ data: { ...base, status, values: values as unknown as Prisma.InputJsonValue, matched: applied.matched as unknown as Prisma.InputJsonValue, flags: { ...flags, notified } as Prisma.InputJsonValue, mappingName: mapping?.name ?? '', model: ex.model, tokensUsed: ex.tokensUsed, durationMs: Date.now() - started, error } });
    await prisma.$transaction([
      prisma.ocrDocument.update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, status, run.id, flags) as unknown as Prisma.InputJsonValue } }),
      prisma.extractionTemplate.update({ where: { id: t.id }, data: { timesUsed: { increment: 1 } } }),
    ]);
    return { runId: run.id, status, flags, error };
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 2000);
    console.error('[templates] run failed', t.slug, doc.id, error);
    const run = await prisma.templateRun.create({ data: { ...base, status: 'FAILED', values: {}, matched: [], flags: null, mappingName: '', durationMs: Date.now() - started, error } });
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, 'FAILED', run.id, { review: [], blocked: [] }) as unknown as Prisma.InputJsonValue } }).catch(() => null);
    return { runId: run.id, status: 'FAILED', flags: { review: [], blocked: [] }, error };
  }
}

/** Convenience for the upload/reextract hooks: match by ΑΦΜ and run; never throws. */
export async function runMatchingTemplate(documentId: string, vat: unknown, trigger: RunTrigger): Promise<RunOutcome | null> {
  try {
    const templateId = await findTemplateForVat(vat);
    if (!templateId) return null;
    return await runTemplateOnDocument({ documentId, templateId, trigger });
  } catch (e) { console.error('[templates] runMatchingTemplate', (e as Error).message); return null; }
}
```
`values` typed as `Record<string, FieldValue>` — import the type. If `toConditionDto` returns `logic` typed `'AND' | 'OR'` already, no cast is needed.

- [ ] **Step 3:** tests green, tsc clean, commit `feat(templates): template runner with modes, mapping projection, posting and notifications`.

---

### Task 5: Hooks + run endpoints

**Files:**
- Modify: `app/api/admin/ocr/route.ts`, `app/api/admin/ocr/[id]/reextract/route.ts`
- Create: `app/api/admin/ocr/[id]/template-runs/route.ts`, `app/api/admin/ocr/[id]/template-runs/[runId]/route.ts`
- Modify: `components/templates/api.ts`

- [ ] **Step 1: Upload hook** — in `app/api/admin/ocr/route.ts` add `export const maxDuration = 300;`, import `runMatchingTemplate` from `@/lib/templates/run`, and after the duplicate check (before the thumbnail) add:
```ts
    // Extraction template linked to this issuer (spec §15.1). Best-effort; failures become a FAILED run.
    const templateRun = await runMatchingTemplate(doc.id, result.data?.vatNumber, 'upload');
```
and include `templateRun` in the JSON response. Same in `reextract/route.ts` (after its transaction, trigger `'reextract'`, `maxDuration = 300`).

- [ ] **Step 2: `template-runs/route.ts`**
```ts
// GET → runs of the document (newest first, with template summary). POST { templateId? } → run now (permission ocr.categorize).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { findTemplateForVat, runTemplateOnDocument } from '@/lib/templates/run';
import { toRunDto } from '@/lib/templates/run-dto';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'; export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const runs = await prisma.templateRun.findMany({ where: { documentId: id }, orderBy: { createdAt: 'desc' }, take: 20, include: { template: { include: { fields: true } } } });
  return NextResponse.json({ runs: runs.map(toRunDto) });
}

const Body = z.object({ templateId: z.string().min(1).optional() });
export async function POST(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { id: true, status: true, extractedData: true } });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.status !== 'COMPLETED') return NextResponse.json({ error: 'not_completed', message: 'Το έγγραφο δεν έχει ολοκληρωθεί' }, { status: 422 });
  const templateId = parsed.data.templateId ?? (await findTemplateForVat((doc.extractedData as { vatNumber?: unknown } | null)?.vatNumber));
  if (!templateId) return NextResponse.json({ error: 'no_template', message: 'Δεν βρέθηκε πρότυπο για το ΑΦΜ του εκδότη — επίλεξε ένα' }, { status: 422 });
  if (!(await prisma.extractionTemplate.findUnique({ where: { id: templateId }, select: { id: true } }))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const outcome = await runTemplateOnDocument({ documentId: id, templateId, trigger: 'manual' });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.run', resource: 'ocrDocument', resourceId: id, metadata: { templateId, status: outcome.status } });
  const run = await prisma.templateRun.findUnique({ where: { id: outcome.runId }, include: { template: { include: { fields: true } } } });
  return NextResponse.json({ run: run ? toRunDto(run) : null, outcome });
}
```
Create `lib/templates/run-dto.ts` (server-only):
```ts
import 'server-only';
import type { TemplateRun, ExtractionTemplate, TemplateField } from '@prisma/client';
import { toFieldDef } from './serialize';
import type { FieldValue } from './schema';
export function toRunDto(r: TemplateRun & { template: ExtractionTemplate & { fields: TemplateField[] } }) {
  return {
    id: r.id, status: r.status, trigger: r.trigger, error: r.error, createdAt: r.createdAt, templateVersion: r.templateVersion,
    values: (r.values as unknown as Record<string, FieldValue>) ?? {}, matched: (r.matched as { id: string; name: string }[]) ?? [],
    flags: (r.flags as { review?: string[]; blocked?: string[]; notified?: string[] } | null) ?? { review: [], blocked: [] },
    mappingName: r.mappingName, model: r.model, tokensUsed: r.tokensUsed, durationMs: r.durationMs,
    template: { id: r.template.id, name: r.template.name, slug: r.template.slug, mode: r.template.mode, status: r.template.status, version: r.template.version, fields: [...r.template.fields].sort((a, b) => a.order - b.order).map(toFieldDef) },
  };
}
export type RunDto = ReturnType<typeof toRunDto>;
```
- [ ] **Step 3: `template-runs/[runId]/route.ts`** — `GET` → the run's output JSON (`toRunOutput` over the run + document: `file = doc.fileName`; respond with `Content-Disposition: attachment; filename="<slug>-<docId8>.json"` when `?download=1`); `PATCH { values: Record<string, unknown> }` (permission `ocr.categorize`): for each key that exists in `run.values`, set `{ ...prev, raw: String(v), value: coerceValue(String(v), field.valueType), source: 'manual', confidence: 1 }` (field type from the template's fields; unknown keys → 400 `unknown_field`), update the run, return `toRunDto`. Audit `template.run.edit`.
- [ ] **Step 4: Client** — in `components/templates/api.ts` add `runs: { list(docId), run(docId, templateId?), patch(docId, runId, values), outputUrl(docId, runId, download) }` and ERROR_TEXT `no_template`, `not_completed`, `unknown_field`. Type `RunDto` imported as `import type { RunDto } from '@/lib/templates/run-dto'`.
- [ ] **Step 5:** tsc clean, `npm test` green, commit `feat(templates): run at upload/reextract, manual run and run endpoints`.

---

### Task 6: Excel / JSON exports

**Files:**
- Create: `lib/templates/excel.ts`, `lib/templates/__tests__/excel.test.ts`, `lib/templates/excel-server.ts`, `app/api/admin/ocr/[id]/template-excel/route.ts`, `app/api/admin/ocr/batches/[id]/template-excel/route.ts`, `app/api/admin/ocr/batches/[id]/template-json/route.ts`

- [ ] **Step 1: Failing tests** — `excel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSheets, sheetName } from '../excel';
const fv = (value: unknown) => ({ raw: null, value, confidence: 1, source: 'vision' as const, page: 0, bbox: null, color: '#000' });
const fields = [{ key: 'num', label: 'Αριθμός', kind: 'SINGLE' as const, columns: null }, { key: 'lines', label: 'Γραμμές', kind: 'TABLE' as const, columns: [{ key: 'eidos', label: 'Είδος' }, { key: 'poso', label: 'Ποσό' }] }];
describe('buildSheets', () => {
  it('one sheet per template, columns from the EXCEL mapping when present', () => {
    const s = buildSheets([{ templateSlug: 'a', templateName: 'A', file: 'f1.pdf', documentId: 'd1', fields, excelRows: [{ fieldKey: 'num', column: 'No', order: 0 }], values: { num: fv('9') } }]);
    expect(s).toEqual([{ name: 'A', columns: ['Αρχείο', 'No'], rows: [['f1.pdf', '9']] }]);
  });
  it('without a mapping: one column per SINGLE field, TABLE fields go to a lines sheet', () => {
    const s = buildSheets([{ templateSlug: 'a', templateName: 'A', file: 'f1.pdf', documentId: 'd1', fields, excelRows: null, values: { num: fv(9), lines: fv([{ eidos: 'x', poso: 1 }, { eidos: 'y', poso: 2 }]) } }]);
    expect(s[0]).toEqual({ name: 'A', columns: ['Αρχείο', 'Αριθμός'], rows: [['f1.pdf', 9]] });
    expect(s[1]).toEqual({ name: 'A — Γραμμές', columns: ['Αρχείο', 'Πεδίο', 'Είδος', 'Ποσό'], rows: [['f1.pdf', 'Γραμμές', 'x', 1], ['f1.pdf', 'Γραμμές', 'y', 2]] });
  });
  it('groups documents of the same template and keeps the order', () => {
    const one = (file: string) => ({ templateSlug: 'a', templateName: 'A', file, documentId: file, fields: [fields[0]], excelRows: null, values: { num: fv(file) } });
    expect(buildSheets([one('1'), { ...one('2'), templateSlug: 'b', templateName: 'B' }, one('3')]).map((s) => [s.name, s.rows.length])).toEqual([['A', 2], ['B', 1]]);
  });
});
describe('sheetName', () => {
  it('strips forbidden characters and caps at 31, deduping', () => {
    expect(sheetName('A/B:C*D?[E]', new Set())).toBe('A-B-C-D-E');
    expect(sheetName('x'.repeat(40), new Set(['x'.repeat(31)]))).toMatch(/^x{29}_2$/);
  });
});
```
- [ ] **Step 2: Implement `lib/templates/excel.ts`** (pure): `export type SheetInput = { templateSlug; templateName; file; documentId; fields: { key; label; kind; columns: { key; label }[] | null }[]; excelRows: MappingRowExcel[] | null; values: Record<string, FieldValue> }`, `export type Sheet = { name: string; columns: string[]; rows: (string | number)[][] }`, `sheetName(raw, used)` (replace `[\[\]:*?/\\]` with `-`, trim, slice 31, suffix `_2`… via a loop, add to `used`), `buildSheets(inputs)`: group by slug preserving first-seen order; per group: main sheet columns = `['Αρχείο', ...(excelRows ? projectToExcel(values, excelRows).columns : SINGLE field labels)]`, row = `[file, ...cells]` (use `projectToExcel` when mapped, else cell = value (number kept, arrays of strings joined ', ', objects/table → ''), null → ''); TABLE fields (from `fields`) → a second sheet `${name} — Γραμμές` with columns `['Αρχείο', 'Πεδίο', ...column labels]` and one row per table row (cells by column key), only when at least one table row exists.
- [ ] **Step 3: `excel-server.ts`**: `export async function sheetsToXlsx(sheets: Sheet[]): Promise<Buffer>` with exceljs (`new ExcelJS.Workbook()`, `addWorksheet(name)`, header row bold, `columns` widths = max(10, min(60, longest cell))), pattern from `app/api/admin/ai-usage/export/route.ts`.
- [ ] **Step 4: Routes** — helper in `lib/templates/excel-server.ts`: `runsToSheetInputs(runs: (TemplateRun & { template: ExtractionTemplate & { fields, mappings }, document: { fileName, id } })[])` picking the EXCEL mapping (`isDefault` first) and mapping rows/fields via `toFieldDef`/`toMappingDto`.
  - `GET /api/admin/ocr/[id]/template-excel?runId=` (permission `ocr.read`): latest run (or the given one) → xlsx, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="<slug>-<docId8>.xlsx"`. 404 when no run.
  - `GET /api/admin/ocr/batches/[id]/template-excel`: latest run per document in the batch (`findMany` runs `where: { document: { batchId } }`, orderBy createdAt desc, then keep the first per documentId) → xlsx `templates-<batchId8>.xlsx`. 404 when no runs.
  - `GET /api/admin/ocr/batches/[id]/template-json`: same selection → `[toRunOutput(...)]` array, `filename="templates-<batchId8>.json"` when `?download=1`.
- [ ] **Step 5:** tests green, tsc clean, commit `feat(templates): Excel and JSON exports per document and per folder`.

---

### Task 7: Flow canvas with orientation

**Files:**
- Create: `components/templates/flow-canvas.tsx`
- Modify: `components/templates/flow-panel.tsx`, `lib/templates/flow.ts` (if the layout constants need an orientation switch)

- [ ] **Step 1:** Move the node components and `nodeTypes` from `flow-panel.tsx` into `flow-canvas.tsx`, parameterised by an `OrientationContext` (`'vertical' | 'horizontal'`): handles use `Position.Top/Bottom` vertically and `Position.Left/Right` horizontally. Export `FlowCanvas({ template, run, orientation, onNodeClick? })` which builds nodes/edges with `buildFlow(toFlowTemplate(template), run)` and, when horizontal, swaps x/y of node positions (columns become rows: `position = { x: node.position.y * 2.2, y: node.position.x * 0.55 }` — tune so 5 stages fit ~1100px wide; keep the vertical layout byte-identical to today).
- [ ] **Step 2:** `flow-panel.tsx` becomes: designer context → `<FlowCanvas template={dto} orientation="vertical" onNodeClick={…goToStep…} />` — preserve today's behaviour (click a node → step), same wrapper markup.
- [ ] **Step 3:** `npm test` green (flow tests untouched), tsc clean; open a template in the browser is not possible for you — verify with `npx next build`. Commit `refactor(templates): flow canvas with orientation, panel as thin wrapper`.

---

### Task 8: Document page — run card with coloured regions

**Files:**
- Create: `components/templates/template-picker.tsx`, `components/templates/run-field-list.tsx`, `components/templates/run-result.tsx`
- Modify: `app/admin/ocr/[id]/page.tsx`, `components/templates/api.ts` (if helpers are missing)

- [ ] **Step 1: Server data** — in `app/admin/ocr/[id]/page.tsx` load in the same `Promise.all`: `runs` (`prisma.templateRun.findMany({ where: { documentId: id }, orderBy: { createdAt: 'desc' }, take: 20, include: { template: { include: { fields: true } } } })` → `toRunDto`), `templates` (`prisma.extractionTemplate.findMany({ orderBy: { name: 'asc' }, select: { id, name, slug, status, mode, vatNumber, department } })`), `canManage = hasPermission('ocr.categorize')`, `canPost = hasPermission('ocr.post')`. Render `<RunResult docId={doc.id} fileName={doc.fileName} issuerVat={data.vatNumber ?? null} initialRuns={runs} templates={templates} canManage canPost postStatus={doc.postStatus} />` between the `SoftoneChecksStrip` and `OcrResultView` (only when `doc.status === 'COMPLETED'`).
- [ ] **Step 2: `template-picker.tsx`** — `<select>` of templates: group «Για το ΑΦΜ εκδότη» (vatNumber === issuerVat) first, then «Όλα»; option label `${name} · ${STATUS_LABEL[status]}`; props `value`, `onChange`, `templates`, `issuerVat`, `disabled`. Default value: the latest run's template id, else the first ΑΦΜ match, else ''.
- [ ] **Step 3: `run-field-list.tsx`** — props `{ run: RunDto; focusKey; onFocus(key|null); editable; onEdit(key, value) }`. One row per template field (in field order): colour dot, label, `raw → value` (value formatted: numbers with `toLocaleString('el-GR')`, dates as-is, arrays «N γραμμές» with an expandable mini table of the TABLE rows), source pill (`text`→«κείμενο», `vision`→«μοντέλο», `manual`→«χειροκίνητο», `none`→«—»), page «σ.N». Row hover/click → `onFocus`. When `editable`, a pencil turns the value into an `<Input>` (Enter/blur → `onEdit`). Rows whose key is in `flags.review` messages get an amber left border.
- [ ] **Step 4: `run-result.tsx`** (client) — card «Πρότυπο» with:
  - Header: template name (link to `/admin/ocr/templates/<id>`) · slug mono · status pill (`RUN_STATUS_LABEL`, colours: EXTRACTED `#EAF4FC/#0078D4`, REVIEW `#FDF3E3/#B45309`, BLOCKED `#FDE8E8/#B91C1C`, POSTED `#E8F7F0/#047857`, FAILED `#F3F2F1/#5C5C5C`) · `TRIGGER_LABEL` · `createdAt` · model · tokens · ms; error line when `error`.
  - Toolbar: `TemplatePicker` + «Εκτέλεση» (or «Επανεκτέλεση» when a run for that template exists) → `templatesApi.runs.run(docId, templateId)` with a spinner and toast; «JSON» (`<a href={outputUrl(download)}>`), «Excel» (`/api/admin/ocr/${docId}/template-excel?runId=`), and for `status === 'REVIEW'` + `canPost` + `postStatus !== 'POSTED'`: «Έγκριση → ανάρτηση» → `POST /api/admin/ocr/${docId}/post-softone` → toast + `router.refresh()`.
  - Body (two columns ≥ lg): left `RegionMarker` (`pageImageUrl={(p) => `/api/admin/ocr/${docId}/page-image?page=${p}&scale=3`}`, `pageCount = max page in run values + 1`, `savedRegions` = values with bbox on the current page `{ bbox, color, label, active: key === focusKey }`, `isMarking={false}`, `onRegionComplete={() => {}}`) with page nav; right `RunFieldList`. Focusing a field switches to its page.
  - Below: flags (review amber list, blocked red list), matched rules chips («Κανόνες που ίσχυσαν: …»), and a collapsible «Ροή» section with `<FlowCanvas template={run.template as FlowTemplateSource} run={{ status, values, matchedIds: matched.map(m => m.id), mappingName }} orientation="horizontal" />` (height 260px). `run.template` needs `mappings`/`conditions` for the flow — extend `toRunDto` to include `mappings: toMappingDto[]` and `conditions: toConditionDto[]` from the template (add them to the include).
  - Older runs: small «Ιστορικό (N)» toggle listing previous runs (status, trigger, date) — click selects that run for display.
  - Empty state (no runs): the picker + «Εκτέλεση» and the text «Δεν έχει τρέξει πρότυπο σε αυτό το έγγραφο.» When `issuerVat` matches an ACTIVE template, hint «Βρέθηκε πρότυπο για το ΑΦΜ εκδότη».
  - Manual edit → `templatesApi.runs.patch` → replace the run in state, toast.
- [ ] **Step 5:** tsc clean, `npm test` green, `npx next build` OK. Commit `feat(templates): run card on the document page — coloured regions, values, flags, flow, exports`.

---

### Task 9: OCR list and folder page

**Files:**
- Modify: `app/admin/ocr/page.tsx`, `app/admin/ocr/ocr-table.tsx`, `app/admin/ocr/batches/[id]/page.tsx`, `app/admin/ocr/batches/[id]/batch-detail-client.tsx`

- [ ] **Step 1:** `page.tsx`: select `reviewFlags`; `OcrRow` gets `templateName: string | null; templateRunStatus: string | null; reviewCount: number; blockedCount: number` from `reviewFlags`. `ocr-table.tsx`: new column «Πρότυπο» (after «SoftOne» match column): template name (truncate) + status pill using the same colours as Task 8 (put the pill map in `components/templates/run-status-pill.tsx` and reuse it), with a small amber/red counter when review/blocked > 0; «—» when null. Column is sortable by `templateRunStatus`.
- [ ] **Step 2:** Batch page: select `reviewFlags` per doc → row gets `templateName`, `templateRunStatus`; client shows a «Πρότυπο» cell with the pill; header actions gain «Excel προτύπων» (`/api/admin/ocr/batches/${batchId}/template-excel`) and «JSON» (`…/template-json?download=1`), disabled (with title) when no row has a run.
- [ ] **Step 3:** tsc clean, commit `feat(templates): template run status in OCR list and folder page, folder exports`.

---

### Task 10: Wiki + changelog

**Files:**
- Create: `docs/wiki/ocr/template-runs.mdx`
- Modify: `docs/wiki/ocr/templates.mdx`, `docs/wiki/ocr/ocr-overview.mdx` (one sentence + link), `docs/manual/CHANGELOG.md`

- [ ] **Step 1:** `template-runs.mdx` frontmatter: `title: "Εκτέλεση προτύπων"`, `module: ocr`, `slug: template-runs`, `roles: [SUPER_ADMIN, ADMIN, EMPLOYEE]`, `order: 61`, `updatedAt: 2026-09-10`, `description: "Πώς εφαρμόζεται ένα πρότυπο σε έγγραφο: αυτόματα από το ΑΦΜ εκδότη ή χειροκίνητα, τι σημαίνει κάθε κατάσταση, JSON/Excel, έγκριση και ανάρτηση."`, `related: [templates, ocr-overview]`, `helpAnchors: [template-runs]`. Body: overview; `<Steps>` (upload → αν το ΑΦΜ ταιριάζει σε ενεργό πρότυπο τρέχει μόνο του → κάρτα «Πρότυπο» στο έγγραφο → έλεγχος τιμών με χρώματα, διόρθωση → JSON/Excel → για ημιαυτόματα «Έγκριση → ανάρτηση»); table of statuses (Εξήχθη / Προς έλεγχο / Μπλοκαρισμένο / Αναρτήθηκε / Απέτυχε) with meaning; `<Callout type="info">` about classic + extra keys in the JSON and the folder exports (array); `<Callout type="warning">` AUTO posts without review; `<Callout type="danger">` a failed run never blocks the document.
- [ ] **Step 2:** `templates.mdx`: replace the sentence about auto-application with a link to the new page; `ocr-overview.mdx`: one sentence. `npm run wiki:index`. CHANGELOG entry 2026-09-10 (top of the templates section).
- [ ] **Step 3:** commit `docs(templates): wiki for template runs, changelog`.

---

### Task 11: Migrate field rules → templates, remove the legacy code

**Files:**
- Create: `scripts/templates/migrate-field-rules.ts`, `lib/templates/slug.ts`, `lib/templates/__tests__/slug.test.ts`
- Delete: `app/admin/ocr/field-rules/` (dir), `app/api/admin/ocr/field-rules/` (dir), `app/api/admin/ocr/[id]/field-rules/route.ts`, `app/api/admin/ocr/[id]/save-template/route.ts`, `components/admin/supplier-field-rule-dialog.tsx`, `lib/ocr/field-rules.ts`, `lib/ocr/field-rules-db.ts`, `lib/ocr/templates-store.ts`, `lib/ocr/__tests__/field-rules.test.ts`, `lib/ocr/__tests__/templates-store.test.ts`, `docs/wiki/ocr/field-rules.mdx`
- Modify: `lib/ocr/extract.ts`, `lib/templates/schema.ts`, `app/admin/ocr/page.tsx`, `app/admin/ocr/ocr-table.tsx`, `app/admin/ocr/[id]/field-correction.tsx`, `app/admin/ocr/row-detail.tsx` (only if it links to field-rules), `docs/manual/CHANGELOG.md`, `public/wiki/index.json` (via `npm run wiki:index`)

- [ ] **Step 1: Slugifier** — create `lib/templates/slug.ts` with `slugifyFieldKey` (verbatim from `lib/ocr/field-rules.ts`, including `GREEK_MAP`), tests moved to `lib/templates/__tests__/slug.test.ts` (the `slugifyFieldKey` cases only). `lib/templates/schema.ts` imports from `./slug`. Grep for every other importer of `@/lib/ocr/field-rules` and fix.
- [ ] **Step 2: Migration script** — `scripts/templates/migrate-field-rules.ts` (`import 'dotenv/config'`, relative imports, run via the loader): reads all `supplierFieldRule` + `supplierTemplate` rows, writes `.local/backup/legacy-field-rules-<ISO>.json` (create dir), then per distinct `vatNumber` (across docTypes) creates ONE `ExtractionTemplate` `{ name: 'Μεταφερμένο: <supplierName ?? vat>', slug: uniqueKey(templateSlug(name), existing), vatNumber, supplierName, mode: 'MANUAL', status: 'DRAFT', department: 'Μεταφορά ειδικών πεδίων' }` and one `TemplateField` per rule: `key = uniqueKey(rule.key, keysInTemplate)`, `label`, `kind: rule.scope === 'line' ? 'TABLE' : 'SINGLE'`, `columns: TABLE ? [{ key: 'value', label: rule.label, valueType: rule.valueType === 'list' ? 'LIST' : 'TEXT' }] : null`, `valueType: rule.valueType === 'list' ? 'LIST' : 'TEXT'`, `aiHint: rule.description`, `region: isValidBbox(regionHint?.bbox) ? { page: regionHint.page ?? 0, bbox } : null`, `color: COLOR_PALETTE[i % 12]`, `required: false`, `order: i`. Skips a ΑΦΜ that already has a «Μεταφερμένο:» template (idempotent). `--dry` prints the plan only. Prints a summary table. Add `"templates:migrate-field-rules": "npx tsx --import ./scripts/templates/register.mjs scripts/templates/migrate-field-rules.ts"` to `package.json`. Run it with `--dry` only — the controller runs the real migration.
- [ ] **Step 3: Remove the legacy passes** — `lib/ocr/extract.ts`: delete `applySupplierTemplate`, `applyCustomFieldRules`, `runFieldPass`, `bumpRulesUsed`, `ruleToLite`, `LoadedFieldRule`, their imports; `extractDocument` becomes `const base = await extractDocumentRaw(input); if (base.data) normalizeAfmFields(base.data); return base;`. Delete the files listed above. `app/admin/ocr/page.tsx`: remove the «Ειδικά πεδία» link; `ocr-table.tsx`: remove the field-rules / save-template references (grep `field-rules|save-template|SupplierFieldRuleDialog`); `field-correction.tsx`: remove the `saveTemplate` function, the «Αποθήκευση ως πρότυπο» button and the `hints` state (the marquee still fills the value). `row-detail.tsx` `CustomFieldsBlock` stays (custom fields may still exist in older data). Delete `docs/wiki/ocr/field-rules.mdx`, fix any `related:` references to it in other wiki files, `npm run wiki:index`.
- [ ] **Step 4:** tsc clean, `npm test` green, `npx next build` OK. CHANGELOG line: «Τα «Ειδικά πεδία προμηθευτών» και τα παλιά πρότυπα προμηθευτή αντικαταστάθηκαν από τα πρότυπα εξαγωγής· οι υπάρχοντες κανόνες μεταφέρθηκαν σε πρότυπα «Μεταφερμένο: …» (DRAFT).» Commit `refactor(ocr): retire supplier field rules and legacy templates in favour of extraction templates`.

---

### Task 12: Drop the legacy tables (schema only — the controller deploys)

**Files:**
- Create: `prisma/migrations/20260910130000_drop_supplier_field_rules/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1:** SQL: `DROP TABLE IF EXISTS "SupplierFieldRule"; DROP TABLE IF EXISTS "SupplierTemplate";`. Remove both models from `prisma/schema.prisma` (and any relation fields pointing at them — grep). `npx prisma generate` (NOT deploy). `grep -rn "supplierFieldRule\|supplierTemplate" app lib components scripts` must return only the migration script (which is allowed to stay referencing the models through `prisma.$queryRaw`? No — the script must still compile: change it to read the legacy rows with `prisma.$queryRawUnsafe('SELECT * FROM "SupplierFieldRule"')` typed locally, so it works before the drop and fails clearly after).
- [ ] **Step 2:** tsc clean, `npm test` green. Commit `chore(prisma): drop SupplierFieldRule and SupplierTemplate`. Report that `migrate deploy` is still pending.

---

## Self-review

- **Spec coverage:** §3β steps 1–7 → T4/T5 (trigger, non-fatal, run stored, timesUsed); §3γ → T8; §3δ → T6; §4 (extras `$total/$itemsCount/$pageCount`) → T2 `extrasFrom` + T4; §6 (permissions, non-fatal, NOTIFY throttle) → T3/T4/T5; §7 → T11/T12; §14.1(5)+§14.8 (classic + extras, array per folder) → T2 `toRunOutput`, T6; §15.1 (ACTIVE by ΑΦΜ, manual any) → T4 `findTemplateForVat`, T5 picker; §15.4 (`trigger`, `error`, `reviewFlags`) → T1; §15.7 → T9; wiki → T10.
- **Types:** `RunFlags`, `ReviewFlags`, `RunDecision` (T2) used in T4; `toRunDto`/`RunDto` (T5) used in T8; `Sheet`/`SheetInput` (T6); `FlowCanvas` props (T7) used in T8; `RunTrigger` (T4) used in T5.
- **Placeholders:** none. T8 is described by structure rather than full JSX because it is UI composition over already-existing components (`RegionMarker`, `FlowCanvas`, `Input`, `Button`, `Dialog`), all with known props.
