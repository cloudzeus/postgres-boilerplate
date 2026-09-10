# Extraction Templates — Plan 3b: Interactive regions (move/resize) and per-field re-read

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user move and resize a field's region directly on the canvas (designer and document run card), and re-read **only that field** from the document with the adjusted region — optionally saving the adjusted region back to the template.

**Architecture:** Spec §16 of `docs/superpowers/specs/2026-09-09-extraction-templates-design.md` (read §16, §15.5, §3γ). Pure geometry in `lib/templates/geometry.ts` (vitest). `components/ui/region-marker.tsx` gains an `editable` mode (drag to move, 8 handles to resize, arrow-key nudge) emitting `onRegionChange(index, bbox)`. Server: `lib/templates/run.ts` gains `rereadField()` reusing `extractTemplateFields` for one field with a region override, and the flag/projection recomputation already used by the PATCH route is extracted into a shared helper. Route `POST /api/admin/ocr/[id]/template-runs/[runId]/reread`. UI: run card (`components/templates/run-result.tsx`, `run-field-list.tsx`) and designer regions step (`components/templates/regions-step.tsx`).

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, zod 4, vitest 4, DG design system, react-icons/fi, sonner. Conventions as in plan 3 (type-check `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"`, `npm test`, Greek UI, inline hex only for data colours, commit per task, no prisma write commands — no migration is needed).

---

## File structure

| File | Responsibility |
|---|---|
| `lib/templates/geometry.ts` | pure: `moveBbox`, `resizeBbox(handle, dx, dy)`, `clampBbox`, `nudgeBbox`, `MIN_SIZE` |
| `components/ui/region-marker.tsx` | `editable` regions with move/resize/nudge; `onRegionChange`; `onRegionSelect` |
| `lib/templates/run-flags.ts` | pure: `recomputeFieldFlags(flags, fields, values, extracted)` extracted from the PATCH route logic (required + OCR cross-check for the keys concerned) |
| `lib/templates/run.ts` | `rereadField({ documentId, runId, fieldKey, region? })` and shared `finalizeRunEdit()` (values → flags → projection → reviewFlags) used by PATCH and reread |
| `app/api/admin/ocr/[id]/template-runs/[runId]/reread/route.ts` | POST |
| `app/api/admin/ocr/[id]/template-runs/[runId]/route.ts` | PATCH uses `finalizeRunEdit` |
| `components/templates/api.ts` | `runs.reread(docId, runId, fieldKey, region?)`, ERROR_TEXT |
| `components/templates/run-result.tsx`, `run-field-list.tsx` | editable canvas, «Επανάγνωση» per field, «Αποθήκευση περιοχής στο πρότυπο» |
| `components/templates/regions-step.tsx` | editable canvas for draft regions |
| `docs/wiki/ocr/template-runs.mdx`, `docs/wiki/ocr/templates.mdx`, `docs/manual/CHANGELOG.md` | docs |

---

### Task 1: Pure geometry

**Files:** Create `lib/templates/geometry.ts`, `lib/templates/__tests__/geometry.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { MIN_SIZE, clampBbox, moveBbox, resizeBbox, nudgeBbox, type Handle } from '../geometry';

describe('clampBbox', () => {
  it('keeps the box inside the page and above the minimum size', () => {
    expect(clampBbox([-0.1, 0.2, 0.5, 0.3])).toEqual([0, 0.2, 0.5, 0.3]);
    expect(clampBbox([0.8, 0.9, 0.5, 0.3])).toEqual([0.5, 0.7, 0.5, 0.3]);
    expect(clampBbox([0.5, 0.5, 0.001, 0.001])).toEqual([0.5, 0.5, MIN_SIZE, MIN_SIZE]);
  });
});
describe('moveBbox', () => {
  it('translates and clamps', () => {
    expect(moveBbox([0.1, 0.1, 0.2, 0.2], 0.05, -0.2)).toEqual([0.15, 0, 0.2, 0.2]);
  });
});
describe('resizeBbox', () => {
  const b: [number, number, number, number] = [0.2, 0.2, 0.4, 0.4];
  it.each<[Handle, number, number, number[]]>([
    ['se', 0.1, 0.1, [0.2, 0.2, 0.5, 0.5]],
    ['nw', 0.1, 0.1, [0.3, 0.3, 0.3, 0.3]],
    ['e', 0.1, 0.5, [0.2, 0.2, 0.5, 0.4]],
    ['n', 0, -0.1, [0.2, 0.1, 0.4, 0.5]],
    ['w', -0.3, 0, [0, 0.2, 0.6, 0.4]],
  ])('%s handle', (h, dx, dy, expected) => { expect(resizeBbox(b, h, dx, dy).map((n) => +n.toFixed(3))).toEqual(expected); });
  it('never shrinks below MIN_SIZE (handle stops)', () => {
    const r = resizeBbox(b, 'se', -0.39, -0.39);
    expect(r[2]).toBeCloseTo(MIN_SIZE); expect(r[3]).toBeCloseTo(MIN_SIZE); expect(r[0]).toBe(0.2);
  });
});
describe('nudgeBbox', () => {
  it('moves by one step, or resizes with shift', () => {
    expect(nudgeBbox([0.2, 0.2, 0.4, 0.4], 'ArrowRight', false)).toEqual([0.205, 0.2, 0.4, 0.4]);
    expect(nudgeBbox([0.2, 0.2, 0.4, 0.4], 'ArrowDown', true)).toEqual([0.2, 0.2, 0.4, 0.405]);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/templates/geometry.ts — PURE bbox editing math for the region canvas (spec §16). bbox = [x, y, w, h] normalized 0–1.
import type { Bbox } from './schema';
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const MIN_SIZE = 0.01;
export const NUDGE = 0.005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export function clampBbox(b: Bbox): Bbox {
  let [x, y, w, h] = b;
  w = Math.min(1, Math.max(MIN_SIZE, w)); h = Math.min(1, Math.max(MIN_SIZE, h));
  x = Math.min(1 - w, Math.max(0, x)); y = Math.min(1 - h, Math.max(0, y));
  return [r3(x), r3(y), r3(w), r3(h)];
}
export function moveBbox(b: Bbox, dx: number, dy: number): Bbox { return clampBbox([b[0] + dx, b[1] + dy, b[2], b[3]]); }
/** Drag a handle by (dx, dy). Opposite edges stay put; the box never inverts or drops below MIN_SIZE. */
export function resizeBbox(b: Bbox, handle: Handle, dx: number, dy: number): Bbox {
  let [x, y, w, h] = b; const x2 = x + w, y2 = y + h;
  let nx = x, ny = y, nx2 = x2, ny2 = y2;
  if (handle.includes('e')) nx2 = Math.max(x + MIN_SIZE, Math.min(1, x2 + dx));
  if (handle.includes('w')) nx = Math.min(x2 - MIN_SIZE, Math.max(0, x + dx));
  if (handle.includes('s')) ny2 = Math.max(y + MIN_SIZE, Math.min(1, y2 + dy));
  if (handle.includes('n')) ny = Math.min(y2 - MIN_SIZE, Math.max(0, y + dy));
  return clampBbox([nx, ny, nx2 - nx, ny2 - ny]);
}
export function nudgeBbox(b: Bbox, key: string, shift: boolean): Bbox {
  const d = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[key as 'ArrowLeft'];
  if (!d) return b;
  return shift ? resizeBbox(b, 'se', d[0], d[1]) : moveBbox(b, d[0], d[1]);
}
```
- [ ] **Step 3:** tests green, commit `feat(templates): pure bbox geometry for interactive regions`.

---

### Task 2: `RegionMarker` editable mode

**Files:** Modify `components/ui/region-marker.tsx`

- [ ] **Step 1:** New props: `editable?: boolean` (default false), `selectedIndex?: number | null`, `onRegionSelect?: (index: number | null) => void`, `onRegionChange?: (index: number, bbox: Bbox) => void` (fires on pointer-up and on every keyboard nudge; during drag fire `onRegionPreview?.(index, bbox)` or keep a local `dragging` state that renders the live box — choose the local-state approach so parents only get committed boxes).
- [ ] **Step 2:** Behaviour when `editable && !isMarking`: each saved region gets `cursor-move`, `tabIndex=0`, `role="button"`, `aria-label={`Περιοχή ${label}`}`; pointer-down on the box starts a move (capture pointer, convert `movementX/Y` or delta from the start into normalized units using the container's `getBoundingClientRect()`), pointer-down on one of 8 handles (`absolute size-2.5 rounded-sm bg-white border-2` in the region colour, positioned at corners/edges, `cursor-nwse-resize` etc.) starts a resize via `resizeBbox`; on pointer-up call `onRegionChange(i, clampBbox(box))`. Click without drag → `onRegionSelect(i)`. Keyboard: arrows nudge (`nudgeBbox`, shift = resize), `Escape` deselects. Only the `selectedIndex` region shows handles; others show only on hover. `touch-action: none` on the container while editable. Labels unchanged. Hover callbacks (`onRegionHover`) keep working.
- [ ] **Step 3:** Non-editable rendering must be byte-identical to today (regression check by reading the diff). `npm test`, tsc, `npx next build`. Commit `feat(ui): RegionMarker editable mode — move, resize, keyboard nudge`.

---

### Task 3: `rereadField` + shared run edit finalisation + route

**Files:** Create `lib/templates/run-flags.ts` (+ test), `app/api/admin/ocr/[id]/template-runs/[runId]/reread/route.ts`; Modify `lib/templates/run.ts` (+ test), `app/api/admin/ocr/[id]/template-runs/[runId]/route.ts`, `components/templates/api.ts`

- [ ] **Step 1: `run-flags.ts`** — move the PATCH route's flag recomputation into a pure `recomputeFieldFlags({ flags, fields, values, extracted, mode })` that: drops stale «Λείπει υποχρεωτικό πεδίο «…»» / «Ασυμφωνία «…»» messages and their `fields[key]` entries for the keys concerned, re-adds them from `requiredMissing` + `crossCheckOcr` (both in `run-logic.ts`), keeps rule-produced messages and `notified`. Tests: a corrected required field clears its flag; a mismatching total re-adds the cross-check flag; unrelated rule flags survive.
- [ ] **Step 2: `run.ts`** — `finalizeRunEdit({ doc, run, template, values })`: recompute flags via `recomputeFieldFlags`, re-project via `pickMapping`/`projectToInvoice`/`applyProjectionToDocument` when mode ≠ MANUAL (identical to today's PATCH), update the run (`values`, `flags`) and, when this is the latest run, `OcrDocument.reviewFlags`; returns the updated run row with `RUN_INCLUDE`. PATCH route becomes: validate → apply values → `finalizeRunEdit`. Then `rereadField({ documentId, runId, fieldKey, region? })`: load doc + run + template; 409 `not_latest` semantics as the PATCH; find the field; `region` = override ?? `run.values[key]` page/bbox ?? field.region (422 `no_region` if none); download the file; `extractTemplateFields(buffer, mime, [{ ...field, region }], { ref: { refType: 'OcrDocument', refId } })`; set `values[key]` = the new `FieldValue` (page/bbox = region used); `finalizeRunEdit`; return `{ run, value }`. Tests with mocks (as in `run.test.ts`): reread replaces only that key, uses the override region, keeps other values, recomputes flags.
- [ ] **Step 3: Route** `POST …/reread` body `{ fieldKey: z.string().min(1), region: RegionSchema.optional() }`, `requirePermission('ocr.categorize')`, `maxDuration = 120`, audit `template.run.reread` (metadata: fieldKey, overridden: boolean). Errors: `not_found`, `not_latest` 409, `unknown_field` 400, `no_region` 422, `read_failed` 502. Client: `templatesApi.runs.reread(docId, runId, fieldKey, region?)` → `{ run: RunDto; value: FieldValue }`.
- [ ] **Step 4:** tests green, tsc, commit `feat(templates): per-field re-read with region override`.

---

### Task 4: Run card — editable regions, «Επανάγνωση», save region to template

**Files:** Modify `components/templates/run-result.tsx`, `components/templates/run-field-list.tsx`, `components/templates/api.ts` (template field region update helper), `app/api/admin/ocr/templates/[id]/fields/route.ts` (only if a partial region update needs a new PATCH — prefer reusing `PUT fields` with the full list from the run's `template.fields`)

- [ ] **Step 1:** Canvas is `editable={canManage}` with `selectedIndex` bound to `focusKey`; `onRegionChange(i, bbox)` stores a per-field pending region in state `pending: Record<string, Region>` (page = current page) and marks the row «Νέα περιοχή — Επανάγνωση;». Region rendering uses `pending[key] ?? value.bbox`.
- [ ] **Step 2:** Each field row gets an icon button «Επανάγνωση» (`FiRefreshCw`, aria-label «Επανάγνωση «label»») visible when `canManage`; click → `templatesApi.runs.reread(docId, run.id, key, pending[key])` with a per-row spinner; on success replace the run in state, clear `pending[key]`, toast «Διαβάστηκε: <value>»; errors via `errorMessage`. Rows with `source === 'none'` or empty value show the button more prominently (secondary variant, text «Επανάγνωση») — this is the "rescan only what failed" affordance.
- [ ] **Step 3:** When a pending region exists for a field, show next to it «Αποθήκευση στο πρότυπο» (`canManage`): PUTs the template's fields (`templatesApi.putFields(templateId, fieldsWithUpdatedRegion)` — fields come from `run.template.fields`) after `window.confirm('Η περιοχή θα ενημερωθεί στο πρότυπο «<name>» για όλα τα επόμενα έγγραφα. Συνέχεια;')`; toast; note the template version bump does not change the run.
- [ ] **Step 4:** Flow node click (`onNodeClick` type `field`) → `setFocusKey(key)` + scroll the row into view (`ref` per row, `scrollIntoView({ block: 'nearest' })`).
- [ ] **Step 5:** tsc, `npm test`, `npx next build`. Commit `feat(templates): run card — move/resize regions, per-field re-read, save region to template`.

---

### Task 5: Designer regions step — editable draft regions; docs

**Files:** Modify `components/templates/regions-step.tsx`, `docs/wiki/ocr/templates.mdx`, `docs/wiki/ocr/template-runs.mdx`, `docs/manual/CHANGELOG.md`

- [ ] **Step 1:** `RegionMarker editable={canManage && marking == null}` with `selectedIndex` derived from `focusKey` (index in the `saved` array for the current page), `onRegionSelect` → `setFocusKey`, `onRegionChange(i, bbox)` → `update(key, { ...field, region: { page, bbox } })` (draft becomes dirty; existing save flow persists). The «Δοκιμή» (test-field) button already reads only that field — mention in the wiki that after moving a box you test just that field.
- [ ] **Step 2:** Wiki: `templates.mdx` step 3 adds «Μπορείς να σύρεις ή να αλλάξεις μέγεθος σε μια περιοχή πάνω στο δείγμα (βέλη για μικρομετακίνηση, Shift+βέλη για μέγεθος) και να δοκιμάσεις μόνο αυτό το πεδίο»; `template-runs.mdx` adds a step «Διόρθωση περιοχής και επανάγνωση» describing move/resize on the document, «Επανάγνωση» per field (only that field is re-read, cost = one read), and «Αποθήκευση στο πρότυπο». `npm run wiki:index`. CHANGELOG entry.
- [ ] **Step 3:** tsc, `npm test`, `npx next build`. Commit `feat(templates): designer — move/resize draft regions; docs`.

---

## Self-review
- Spec §16: 1 → T1/T2; 2 → T5; 3 → T4; 4 → T3; 5 → T4 Step 4; 6 → no migration (values keep page/bbox).
- Types: `Handle`, `clampBbox`… (T1) used by T2; `onRegionChange`/`onRegionSelect`/`selectedIndex`/`editable` (T2) used by T4/T5; `rereadField`/`finalizeRunEdit` (T3) used by the route and PATCH; `templatesApi.runs.reread` (T3) used by T4.
- Placeholders: none.
