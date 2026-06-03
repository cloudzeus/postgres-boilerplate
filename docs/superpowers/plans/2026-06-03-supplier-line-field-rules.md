# Supplier Line-Level & List Field Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend supplier custom field rules with a per-line scope and a list value type, so a user can define e.g. "Serials" once and have the app auto-extract an array of serials per invoice line on every future upload from that supplier.

**Architecture:** Add `scope` ("document"|"line") and `valueType` ("text"|"list") columns to the existing `SupplierFieldRule`. Extraction runs up to two best-effort targeted passes after the ΑΦΜ is resolved: the existing document pass, plus a new line pass that feeds the model the enumerated invoice lines and merges per-line values (index-aligned) into `extractedData.items[i].customFields`. UI gets scope/value-type controls, per-line display, and two new list columns.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + Postgres, vitest, Tailwind, existing `lib/ocr/*` helpers.

**Spec:** `docs/superpowers/specs/2026-06-03-supplier-line-field-rules-design.md`
**Builds on shipped feature:** `docs/superpowers/specs/2026-06-03-supplier-custom-field-rules-design.md`

---

## Current state (already shipped — do not re-create)
- `lib/ocr/field-rules.ts` exports: `FieldRuleLite`, `slugifyFieldKey`, `buildCustomFieldsPrompt`, `mergeCustomFields` (pure), `findActiveFieldRules`, `upsertFieldRule`, and a private `docTypeToEnum`.
- `lib/ocr/extract.ts` has a private `applyCustomFieldRules(input, base)` called last in `extractDocument`, plus private helpers `resolveCfg`, `callGeminiPdfNative`, `callVisionLLM`, `callTextLLM`, `enhanceForOcr`, `parseJsonLoose`.
- `app/api/admin/ocr/[id]/field-rules/route.ts` (POST), `app/api/admin/ocr/field-rules/route.ts` (GET), `app/api/admin/ocr/field-rules/[ruleId]/route.ts` (PATCH/DELETE).
- `components/admin/supplier-field-rule-dialog.tsx` (props: open, onOpenChange, docId, mimeType, supplierName).
- `app/admin/ocr/field-rules/field-rules-client.tsx` (`FieldRuleRow` type + table).
- `CustomFieldsBlock` in `row-detail.tsx` and `result-view.tsx`.

## File Structure (this plan)
- Modify `prisma/schema.prisma` — add 2 columns to `SupplierFieldRule`.
- Modify `lib/ocr/field-rules.ts` — `coerceFieldValue`, list-aware `mergeCustomFields`, `buildLineFieldsPrompt`, `mergeLineCustomFields`, extend `FieldRuleLite` + `upsertFieldRule`.
- Modify `lib/ocr/__tests__/field-rules.test.ts` — tests for the new helpers.
- Modify `lib/ocr/extract.ts` — split `applyCustomFieldRules` into document + line passes.
- Modify `app/api/admin/ocr/[id]/field-rules/route.ts` — accept scope/valueType, value summary.
- Modify `components/admin/supplier-field-rule-dialog.tsx` — scope + valueType controls.
- Modify `app/admin/ocr/row-detail.tsx` + `app/admin/ocr/[id]/result-view.tsx` — per-line display.
- Modify `app/admin/ocr/field-rules/field-rules-client.tsx` + `app/admin/ocr/field-rules/page.tsx` — list columns.
- Modify `docs/wiki/ocr/field-rules.mdx` — per-line/serials section.

---

## Task 1: Add `scope` + `valueType` columns

**Files:** Modify `prisma/schema.prisma` (the `SupplierFieldRule` model).

- [ ] **Step 1: Add the two fields**

In `model SupplierFieldRule`, add after the `regionHint Json?` line:
```prisma
  scope        String     @default("document")  // "document" | "line"
  valueType    String     @default("text")       // "text" | "list"
```

- [ ] **Step 2: Push + regenerate**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync" + "Generated Prisma Client". (Additive columns with defaults — safe on the shared DB. If db push warns about data loss on any table, STOP and report BLOCKED.)

- [ ] **Step 3: Manual migration record + resolve**

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_field_rule_scope_value_type
```
Write to `migration.sql` in that folder:
```sql
ALTER TABLE "SupplierFieldRule" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'document';
ALTER TABLE "SupplierFieldRule" ADD COLUMN "valueType" TEXT NOT NULL DEFAULT 'text';
```
Then:
```bash
npx prisma migrate resolve --applied $(ls -dt prisma/migrations/*_field_rule_scope_value_type | head -1 | xargs basename)
```
Expected: "marked as applied" (if it reports drift because there's no baseline, that's acceptable — the columns exist via db push; note it and continue).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(ocr): SupplierFieldRule scope + valueType columns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: field-rules helpers — coercion, list-aware merge, line prompt/merge

**Files:** Modify `lib/ocr/field-rules.ts`; Modify `lib/ocr/__tests__/field-rules.test.ts`.

- [ ] **Step 1: Write the failing tests** — append to `lib/ocr/__tests__/field-rules.test.ts`:

```ts
import { coerceFieldValue, mergeLineCustomFields, buildLineFieldsPrompt } from '../field-rules';

describe('coerceFieldValue', () => {
  it('text: trims and maps empty to null', () => {
    expect(coerceFieldValue('  PO-1 ', 'text')).toBe('PO-1');
    expect(coerceFieldValue('', 'text')).toBeNull();
    expect(coerceFieldValue(null, 'text')).toBeNull();
  });
  it('list: splits a delimited string into a trimmed array', () => {
    expect(coerceFieldValue('SN1, SN2;SN3\nSN4', 'list')).toEqual(['SN1', 'SN2', 'SN3', 'SN4']);
  });
  it('list: accepts an array and drops empties', () => {
    expect(coerceFieldValue(['A', '', ' B '], 'list')).toEqual(['A', 'B']);
  });
  it('list: empty result becomes null', () => {
    expect(coerceFieldValue('', 'list')).toBeNull();
    expect(coerceFieldValue([], 'list')).toBeNull();
    expect(coerceFieldValue(null, 'list')).toBeNull();
  });
});

describe('mergeCustomFields with valueType', () => {
  it('coerces a list-typed document field to an array', () => {
    const out = mergeCustomFields({} as any, { serials: 'SN1, SN2' }, [{ key: 'serials', valueType: 'list' }] as any);
    expect(out.customFields).toEqual({ serials: ['SN1', 'SN2'] });
  });
});

describe('mergeLineCustomFields', () => {
  const rules = [{ key: 'serials', valueType: 'list' }] as any;
  it('merges per-line values by index, coercing lists', () => {
    const data: any = { items: [{ name: 'A' }, { name: 'B' }] };
    const out = mergeLineCustomFields(data, [
      { index: 0, serials: 'SN1, SN2' },
      { index: 1, serials: null },
    ], rules);
    expect(out.items[0].customFields).toEqual({ serials: ['SN1', 'SN2'] });
    expect(out.items[1].customFields).toEqual({ serials: null });
  });
  it('ignores out-of-range and non-integer indices', () => {
    const data: any = { items: [{ name: 'A' }] };
    const out = mergeLineCustomFields(data, [{ index: 5, serials: 'X' }, { index: 'x' as any, serials: 'Y' }], rules);
    expect(out.items[0].customFields).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const data: any = { items: [{ name: 'A' }] };
    const out = mergeLineCustomFields(data, [{ index: 0, serials: 'S' }], rules);
    expect(data.items[0].customFields).toBeUndefined();
    expect(out).not.toBe(data);
  });
  it('returns data unchanged when items or parsedLines missing', () => {
    const data: any = { vatNumber: '1' };
    expect(mergeLineCustomFields(data, null, rules)).toBe(data);
  });
});

describe('buildLineFieldsPrompt', () => {
  it('includes line indices, field keys and the lines shape', () => {
    const p = buildLineFieldsPrompt(
      [{ key: 'serials', label: 'Serials', valueType: 'list' } as any],
      [{ index: 0, code: 'HW1', name: 'Router' }],
    );
    expect(p).toContain('"serials"');
    expect(p).toContain('Router');
    expect(p).toContain('"lines"');
    expect(p).toContain('"index"');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run lib/ocr/__tests__/field-rules.test.ts`
Expected: FAIL — `coerceFieldValue`, `mergeLineCustomFields`, `buildLineFieldsPrompt` not exported.

- [ ] **Step 3: Update `FieldRuleLite` + add `coerceFieldValue`**

In `lib/ocr/field-rules.ts`, change the `FieldRuleLite` type to:
```ts
export type FieldRuleLite = {
  key: string;
  label: string;
  description?: string | null;
  regionHint?: unknown;
  scope?: 'document' | 'line';
  valueType?: 'text' | 'list';
};
```

Add this exported function (near the top, after `FieldRuleLite`):
```ts
/** Coerce a raw model value to the rule's declared value type. */
export function coerceFieldValue(raw: unknown, valueType: 'text' | 'list'): string | string[] | null {
  if (valueType === 'list') {
    let arr: string[];
    if (Array.isArray(raw)) arr = raw.map((x) => String(x ?? '').trim());
    else if (raw == null || raw === '') arr = [];
    else arr = String(raw).split(/[,;\n]+/).map((s) => s.trim());
    arr = arr.filter(Boolean);
    return arr.length ? arr : null;
  }
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}
```

- [ ] **Step 4: Make `mergeCustomFields` list-aware**

Replace the existing `mergeCustomFields` with:
```ts
/** Merge a parsed document-pass result into data.customFields (pure). */
export function mergeCustomFields<T extends Record<string, any>>(
  data: T, parsed: Record<string, unknown> | null | undefined,
  rules: { key: string; valueType?: 'text' | 'list' }[],
): T {
  const cf: Record<string, unknown> = { ...((data as any).customFields ?? {}) };
  for (const r of rules) {
    cf[r.key] = coerceFieldValue(parsed?.[r.key], r.valueType ?? 'text');
  }
  return { ...data, customFields: cf } as T;
}
```

- [ ] **Step 5: Add `buildLineFieldsPrompt` + `mergeLineCustomFields`**

Add after `buildCustomFieldsPrompt`:
```ts
/** Focused prompt for the per-line targeted pass (lines enumerated by index). */
export function buildLineFieldsPrompt(
  rules: FieldRuleLite[],
  lines: { index: number; code: string | null; name: string }[],
): string {
  const fields = rules.map((r) => ({
    key: r.key, label: r.label, description: r.description ?? null, type: r.valueType ?? 'text',
  }));
  const shape = `{ "lines": [ { "index": 0${rules
    .map((r) => `, "${r.key}": ${r.valueType === 'list' ? '["…"]' : '"…"'}`)
    .join('')} } ] }`;
  return [
    'You are a precise per-line field extractor for a Greek invoice.',
    'For EACH line listed below, extract the requested fields from the document.',
    'Fields with type "list" (e.g. serial numbers) MUST be a JSON array of strings; "text" a string. Use null when a line has no value.',
    '',
    'Requested fields:',
    JSON.stringify(fields, null, 2),
    '',
    'The document lines (match strictly by index):',
    JSON.stringify(lines, null, 2),
    '',
    'Respond with raw JSON of EXACTLY this shape (no markdown fences):',
    shape,
  ].join('\n');
}

/** Merge per-line parsed values into data.items[i].customFields (pure, index-aligned). */
export function mergeLineCustomFields<T extends Record<string, any>>(
  data: T,
  parsedLines: Array<Record<string, unknown>> | null | undefined,
  rules: { key: string; valueType?: 'text' | 'list' }[],
): T {
  const items = (data as any).items;
  if (!Array.isArray(items) || !Array.isArray(parsedLines)) return data;
  const next = items.map((it: any) => ({ ...it }));
  for (const entry of parsedLines) {
    const idx = Number((entry as any)?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= next.length) continue;
    const cf: Record<string, unknown> = { ...(next[idx].customFields ?? {}) };
    for (const r of rules) cf[r.key] = coerceFieldValue((entry as any)[r.key], r.valueType ?? 'text');
    next[idx] = { ...next[idx], customFields: cf };
  }
  return { ...data, items: next } as T;
}
```

- [ ] **Step 6: Persist `scope` + `valueType` in `upsertFieldRule`**

Change `upsertFieldRule`'s `args` type to add `scope` + `valueType`, and set them in the `create` branch only (immutable on update). Replace the function with:
```ts
export async function upsertFieldRule(args: {
  vatNumber: string; docType: DocType; key: string; label: string;
  description?: string | null; regionHint?: unknown; supplierName?: string | null;
  createdById?: string | null; scope?: 'document' | 'line'; valueType?: 'text' | 'list';
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
      scope: args.scope ?? 'document', valueType: args.valueType ?? 'text',
    },
    update: {
      label: args.label, description: args.description ?? null,
      regionHint: (args.regionHint ?? null) as any, supplierName: args.supplierName ?? null,
      isActive: true,
    },
  });
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run lib/ocr/__tests__/field-rules.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: all field-rules tests pass (existing + new); tsc clean.

- [ ] **Step 8: Commit**

```bash
git add lib/ocr/field-rules.ts lib/ocr/__tests__/field-rules.test.ts
git commit -m "feat(ocr): list coercion + per-line prompt/merge helpers for field rules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Two-pass extraction (document + line)

**Files:** Modify `lib/ocr/extract.ts`.

- [ ] **Step 1: Update imports**

Change the field-rules import line to:
```ts
import {
  findActiveFieldRules, buildCustomFieldsPrompt, mergeCustomFields,
  buildLineFieldsPrompt, mergeLineCustomFields, type FieldRuleLite,
} from '@/lib/ocr/field-rules';
```

- [ ] **Step 2: Add module-private helpers** (place just above `applyCustomFieldRules`):
```ts
type LoadedFieldRule = { id: string; key: string; label: string; description: string | null; regionHint: unknown; scope: string; valueType: string };

function ruleToLite(r: LoadedFieldRule): FieldRuleLite {
  return {
    key: r.key, label: r.label, description: r.description, regionHint: r.regionHint,
    scope: (r.scope as 'document' | 'line') ?? 'document',
    valueType: (r.valueType as 'text' | 'list') ?? 'text',
  };
}

/** Run one targeted field pass with the given system prompt; returns parsed JSON or null. */
async function runFieldPass(
  cfg: DeepSeekCfg, input: ExtractInput, base: ExtractResult, system: string,
): Promise<any | null> {
  if (input.mimeType === 'application/pdf' && cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
    const out = await callGeminiPdfNative(cfg, system, input.buffer);
    return parseJsonLoose(out.content);
  }
  if (input.mimeType.startsWith('image/')) {
    const enhanced = await enhanceForOcr(input.buffer);
    const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType);
    return parseJsonLoose(out.content);
  }
  if (base.rawText) {
    const out = await callTextLLM(cfg, system,
      `Here is the digital text payload extracted from the document:\n\n${base.rawText}`);
    return parseJsonLoose(out.content);
  }
  return null;
}

async function bumpRulesUsed(rules: { id: string }[]): Promise<void> {
  const { prisma } = await import('@/lib/db');
  await prisma.supplierFieldRule.updateMany({
    where: { id: { in: rules.map((r) => r.id) } },
    data: { timesUsed: { increment: 1 } },
  }).catch(() => null);
}
```

- [ ] **Step 3: Replace `applyCustomFieldRules`** with the two-pass version:
```ts
/**
 * After the ΑΦΜ is resolved, extract this supplier's active custom fields.
 * Runs up to two best-effort passes (never throws): a document pass for
 * scope="document" rules → data.customFields, and a line pass for scope="line"
 * rules → data.items[i].customFields (only when the doc has line items).
 * Uses the default vision model.
 */
async function applyCustomFieldRules(input: ExtractInput, base: ExtractResult): Promise<ExtractResult> {
  try {
    if (!base.data) return base;
    const all = await findActiveFieldRules(String(base.data.vatNumber ?? ''), input.docType) as unknown as LoadedFieldRule[];
    if (all.length === 0) return base;

    const docRules = all.filter((r) => (r.scope ?? 'document') === 'document');
    const lineRules = all.filter((r) => r.scope === 'line');

    const cfg = await resolveCfg();
    let out = base;

    if (docRules.length > 0) {
      const parsed = await runFieldPass(cfg, input, out, buildCustomFieldsPrompt(docRules.map(ruleToLite)));
      if (parsed) {
        out = { ...out, data: mergeCustomFields(out.data, parsed, docRules.map(ruleToLite)) };
        await bumpRulesUsed(docRules);
      }
    }

    if (lineRules.length > 0 && Array.isArray(out.data.items) && out.data.items.length > 0) {
      const lines = out.data.items.map((it: any, i: number) => ({
        index: i, code: it?.code ?? null, name: String(it?.name ?? ''),
      }));
      const parsed = await runFieldPass(cfg, input, out, buildLineFieldsPrompt(lineRules.map(ruleToLite), lines));
      const parsedLines = Array.isArray(parsed?.lines) ? parsed.lines : null;
      if (parsedLines) {
        out = { ...out, data: mergeLineCustomFields(out.data, parsedLines, lineRules.map(ruleToLite)) };
        await bumpRulesUsed(lineRules);
      }
    }

    return out;
  } catch {
    return base; // best-effort
  }
}
```
(`extractDocument` already calls `applyCustomFieldRules` last — no change there.)

- [ ] **Step 4: Typecheck + run OCR tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run lib/ocr`
Expected: tsc clean; all OCR tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/extract.ts
git commit -m "feat(ocr): per-line custom-field extraction pass (document + line)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: POST route — accept scope/valueType + value summary

**Files:** Modify `app/api/admin/ocr/[id]/field-rules/route.ts`.

- [ ] **Step 1: Extend the zod `Body`** — add to the object:
```ts
  scope: z.enum(['document', 'line']).optional(),
  valueType: z.enum(['text', 'list']).optional(),
```

- [ ] **Step 2: Pass scope/valueType to `upsertFieldRule`** — change the `upsertFieldRule({...})` call to include:
```ts
    scope: body.scope ?? 'document',
    valueType: body.valueType ?? 'text',
```
(add these two lines inside the existing args object).

- [ ] **Step 3: Compute a scope-aware value summary** — replace the immediate-apply block's value assignment. Find:
```ts
    value = (result.data?.customFields ?? {})[key] ?? null;
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { extractedData: result.data } });
```
Replace with:
```ts
    if ((body.scope ?? 'document') === 'line') {
      const items = Array.isArray(result.data?.items) ? result.data.items : [];
      const matchedLines = items.filter((it: any) => {
        const v = it?.customFields?.[key];
        return v != null && (!Array.isArray(v) || v.length > 0);
      }).length;
      value = { matchedLines };
    } else {
      value = (result.data?.customFields ?? {})[key] ?? null;
    }
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { extractedData: result.data } });
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.
```bash
git add "app/api/admin/ocr/[id]/field-rules/route.ts"
git commit -m "feat(ocr): field-rules POST accepts scope/valueType + line value summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Dialog — scope + value-type controls

**Files:** Modify `components/admin/supplier-field-rule-dialog.tsx`.

- [ ] **Step 1: Add state** — after the existing `const [description, setDescription] = …` add:
```tsx
  const [scope, setScope] = React.useState<'document' | 'line'>('document');
  const [valueType, setValueType] = React.useState<'text' | 'list'>('text');
```
And in the reset `useEffect` (the `if (open) { … }` block) add: `setScope('document'); setValueType('text');`.

- [ ] **Step 2: Send scope/valueType in the POST body** — in `submit()`, change the body to:
```tsx
        body: JSON.stringify({
          label: label.trim(),
          description: description.trim() || undefined,
          regionHint: scope === 'document' ? (region ?? undefined) : undefined,
          scope, valueType,
        }),
```

- [ ] **Step 3: Show a scope-aware found summary** — replace the `setFoundValue(...)` line in `submit()` with:
```tsx
      if (scope === 'line') {
        const n = json?.value?.matchedLines ?? 0;
        setFoundValue(`βρέθηκε σε ${n} γραμμές`);
      } else {
        setFoundValue(json.value != null ? String(json.value) : '—');
      }
```

- [ ] **Step 4: Add the two selectors** — in the left column, just before the 🎯 button, insert:
```tsx
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted-foreground">Εμβέλεια</span>
                <select value={scope} onChange={(e) => setScope(e.target.value as 'document' | 'line')}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
                  <option value="document">Έγγραφο</option>
                  <option value="line">Γραμμή</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted-foreground">Τύπος τιμής</span>
                <select value={valueType} onChange={(e) => setValueType(e.target.value as 'text' | 'list')}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
                  <option value="text">Μία τιμή</option>
                  <option value="list">Λίστα (π.χ. serials)</option>
                </select>
              </label>
            </div>
```

- [ ] **Step 5: Gate the 🎯 marker to document scope** — change the marker button wrapper so it only renders for `scope === 'document'`. Wrap the existing 🎯 `<button>` with:
```tsx
            {scope === 'document' && (
              /* existing 🎯 button stays here unchanged */
            )}
```
(Keep the button's existing JSX inside the conditional.)

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.
```bash
git add components/admin/supplier-field-rule-dialog.tsx
git commit -m "feat(ocr): dialog scope + value-type controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Per-line display of custom fields

**Files:** Modify `app/admin/ocr/row-detail.tsx`; Modify `app/admin/ocr/[id]/result-view.tsx`.

- [ ] **Step 1: Shared renderer (row-detail.tsx)** — add near the other small components:
```tsx
function lineCustomFieldsText(cf: Record<string, unknown> | undefined): { label: string; text: string }[] {
  if (!cf) return [];
  const human = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return Object.entries(cf)
    .map(([k, v]) => ({ label: human(k), text: Array.isArray(v) ? v.join(', ') : v == null || v === '' ? '' : String(v) }))
    .filter((e) => e.text !== '');
}
```

- [ ] **Step 2: Render per line in the Γραμμές tab (row-detail.tsx)** — in the items `<tbody>`, each item maps over `items` with index `i`. After the existing `<tr>` for a row, conditionally render an extra info row. Locate the line `}) : items.map((it, i) => {` and the closing `</tr>\n  ); })}`. Change the returned markup so each item renders a fragment:
```tsx
            ) : items.map((it, i) => {
              const la = analyzeLine(it);
              const dTitle = la.discountKind === 'percent' ? 'Έκπτωση επί τοις %' : la.discountKind === 'amount' ? 'Έκπτωση ως ποσό' : undefined;
              const lineCf = lineCustomFieldsText((data.items?.[i]?.customFields) as Record<string, unknown> | undefined);
              return (
              <React.Fragment key={i}>
                <tr className={cn('hover:bg-sisyphus-500/5', !la.consistent ? 'bg-amber-500/5' : 'odd:bg-muted/20')}>
                  {/* ...existing cells unchanged... */}
                </tr>
                {lineCf.length > 0 && (
                  <tr className="bg-sisyphus-500/5">
                    <td colSpan={ro ? 7 : 8} className="px-3 py-1.5 text-[11px] text-muted-foreground">
                      {lineCf.map((e) => (
                        <span key={e.label} className="mr-3"><strong className="text-foreground">{e.label}:</strong> {e.text}</span>
                      ))}
                    </td>
                  </tr>
                )}
              </React.Fragment>
              ); })}
```
Keep the EXISTING cell markup (`<td>` cells for code/name/quantity/price/discount/vatRate/total and the actions cell) inside the first `<tr>` exactly as it is now — only wrap each row in `<React.Fragment>` and append the conditional info `<tr>`. The previous `key={i}` moves to the Fragment.

- [ ] **Step 3: result-view.tsx — add the same helper** (copy `lineCustomFieldsText` into result-view.tsx near its helpers).

- [ ] **Step 4: result-view.tsx — render per item** — the INVOICE branch maps `doc.items.map((it) => (...))`. Change to include the index and append an info row:
```tsx
              ) : doc.items.map((it, idx) => {
                const lineCf = lineCustomFieldsText(((data.items?.[idx] ?? {}).customFields) as Record<string, unknown> | undefined);
                return (
                <>
                  <tr key={it.id} className="hover:bg-muted/30">
                    {/* ...existing cells unchanged... */}
                  </tr>
                  {lineCf.length > 0 && (
                    <tr key={`${it.id}-cf`} className="bg-muted/20">
                      <td colSpan={6} className="px-3 py-1.5 text-[11px] text-muted-foreground">
                        {lineCf.map((e) => (
                          <span key={e.label} className="mr-3"><strong className="text-foreground">{e.label}:</strong> {e.text}</span>
                        ))}
                      </td>
                    </tr>
                  )}
                </>
                ); })}
```
Keep the existing 6 `<td>` cells inside the first `<tr>` unchanged.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.
```bash
git add app/admin/ocr/row-detail.tsx "app/admin/ocr/[id]/result-view.tsx"
git commit -m "feat(ocr): display per-line custom fields (serials) in line views

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: List page — Εμβέλεια + Τύπος columns

**Files:** Modify `app/admin/ocr/field-rules/page.tsx`; Modify `app/admin/ocr/field-rules/field-rules-client.tsx`.

- [ ] **Step 1: page.tsx — include the fields in the row mapping** — in the `rows: FieldRuleRow[] = rules.map(...)` mapping, add:
```tsx
    scope: r.scope, valueType: r.valueType,
```

- [ ] **Step 2: field-rules-client.tsx — extend the type + labels** — change `FieldRuleRow` to add:
```tsx
  scope: string; valueType: string;
```
Add label maps near `DOC_LABEL`:
```tsx
const SCOPE_LABEL: Record<string, string> = { document: 'Έγγραφο', line: 'Γραμμή' };
const VALUE_LABEL: Record<string, string> = { text: 'Μία τιμή', list: 'Λίστα' };
```

- [ ] **Step 3: field-rules-client.tsx — add the two columns** — in `<thead>`, after the `Τύπος` header (`<th>Τύπος</th>`), the existing column is doc type; add two new headers after it:
```tsx
            <th className="px-3 py-2">Εμβέλεια</th>
            <th className="px-3 py-2">Τιμή</th>
```
And in `<tbody>`, after the `<td>{DOC_LABEL[r.docType]}</td>` cell, add:
```tsx
              <td className="px-3 py-2">{SCOPE_LABEL[r.scope] ?? r.scope}</td>
              <td className="px-3 py-2">{VALUE_LABEL[r.valueType] ?? r.valueType}</td>
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.
```bash
git add app/admin/ocr/field-rules/page.tsx app/admin/ocr/field-rules/field-rules-client.tsx
git commit -m "feat(ocr): scope + value-type columns on field-rules list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wiki — per-line & serials section

**Files:** Modify `docs/wiki/ocr/field-rules.mdx`.

- [ ] **Step 1: Add a section** after the "Δημιουργία κανόνα" section:
```mdx
## Πεδία ανά γραμμή & λίστες (π.χ. serials)

Στο dialog δημιουργίας ορίζεις δύο επιλογές:

<Steps>
  <li><strong>Εμβέλεια</strong>: «Έγγραφο» (μία τιμή για όλο το παραστατικό) ή «Γραμμή» (μία τιμή ανά γραμμή).</li>
  <li><strong>Τύπος τιμής</strong>: «Μία τιμή» ή «Λίστα» — για <strong>serials hardware</strong> διάλεξε «Γραμμή» + «Λίστα», ώστε να αποθηκεύεται ένα array serials ανά γραμμή.</li>
</Steps>

<Callout type="info">
  Οι τιμές ανά γραμμή εμφανίζονται κάτω από κάθε γραμμή στην καρτέλα «Γραμμές». Κάθε επόμενο upload από τον ίδιο προμηθευτή θα τα ξαναβρίσκει και θα τα αποθηκεύει αυτόματα.
</Callout>

<Callout type="warning">
  Η «Εμβέλεια» και ο «Τύπος τιμής» δεν αλλάζουν μετά τη δημιουργία (θα άλλαζε το σχήμα των ήδη αποθηκευμένων τιμών). Για αλλαγή, δημιούργησε νέο κανόνα.
</Callout>
```

- [ ] **Step 2: Rebuild the index**

Run: `npm run wiki:index`
Expected: writes `public/wiki/index.json`.

- [ ] **Step 3: Commit**

```bash
git add docs/wiki/ocr/field-rules.mdx public/wiki/index.json
git commit -m "docs(wiki): per-line & list field rules (serials)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npx tsc --noEmit -p tsconfig.json` → clean.
- [ ] `npx vitest run lib/ocr` → all pass (incl. new coercion/line-merge tests).
- [ ] Manual smoke: define a "Serials" rule (Εμβέλεια=Γραμμή, Τύπος=Λίστα) on a hardware invoice → "βρέθηκε σε N γραμμές" → serials show per line → re-upload same supplier → serials auto-extracted per line → list page shows Εμβέλεια=Γραμμή / Τιμή=Λίστα.
- [ ] Push: `git push origin master`.

---

## Self-review notes (addressed)

- **Spec coverage:** model columns (T1); coerce/list-merge/line-prompt/line-merge + upsert (T2); two-pass extraction (T3); POST scope/valueType + line summary (T4); dialog controls + region gating (T5); per-line display in both views (T6); list columns (T7); wiki (T8). All spec sections mapped.
- **Backward compat:** `mergeCustomFields` now coerces via `valueType ?? 'text'`; existing tests pass `[{key}]` → text coercion preserves prior expected outputs (`'PO-1'`→`'PO-1'`, `''`→`null`).
- **Immutability:** `scope`/`valueType` set only in `upsertFieldRule.create`; PATCH untouched (still only label/description/regionHint/isActive) — matches the spec's immutability rule.
- **Type consistency:** `coerceFieldValue(raw, 'text'|'list')`, `mergeCustomFields(data, parsed, {key,valueType}[])`, `mergeLineCustomFields(data, parsedLines, {key,valueType}[])`, `buildLineFieldsPrompt(rules, {index,code,name}[])`, `FieldRuleLite` with `scope`/`valueType` — consistent across T2→T3→T4. `value` for line scope is `{ matchedLines }` in both T4 (route) and T5 (dialog reads `json.value.matchedLines`).
- **Executor caution:** T6 edits weave into existing JSX (items tables) — keep all existing cells; only wrap rows in a Fragment and append the conditional info row. Verify the exact `colSpan` values against the current tables (`ro ? 7 : 8` in row-detail; `6` in result-view) before committing.
