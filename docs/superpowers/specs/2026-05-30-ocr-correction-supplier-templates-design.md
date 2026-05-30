# OCR Correction + Supplier Templates — Design

**Date:** 2026-05-30
**Status:** Approved (design) — pending implementation plan
**Area:** `/admin/ocr` (receipts/αποδείξεις & invoices/τιμολόγια OCR pipeline)

## Problem

The OCR pipeline extracts fields from receipts and invoices (images + PDFs) using
DeepSeek (digital PDF text) and Gemini vision (scanned PDF / images). Two accuracy
problems remain:

1. **No correction / ground-truth loop.** The user cannot fix what the model got
   wrong. Requesting a "rescan with Gemini Pro" rarely helps because:
   - The retry-keep logic ([`extract.ts`](../../../lib/ocr/extract.ts) lines ~435, ~532)
     keeps the new result **only if it has fewer _empty_ required fields**
     (`countMissingRequired` counts only `null`/empty —
     [`templates.ts`](../../../lib/ocr/templates.ts) line ~97). A field that is
     **present but wrong** (wrong ΑΦΜ, swapped issuer/recipient, wrong total) never
     reduces the missing-count, so the Pro retry runs but its result is **discarded**.
   - The retry uses the **same prompt** with no per-supplier or spatial guidance, so
     it often repeats the same mistake.

2. **Every scan starts from zero.** Suppliers rarely change the look-and-feel of
   their documents, yet nothing is remembered between scans of the same supplier.

## Goals

- Let the user **mark a region with the mouse** on the document (image **and** PDF)
  and associate it with a field — for both correction and capturing supplier layout.
- **Remember a supplier's document as a sample** (few-shot) so the next scan of the
  same supplier (matched by issuer ΑΦΜ) is more accurate.
- Fix the accuracy regressions that make "rescan with Pro" ineffective.
- Keep it **fast and cheap**: small focused calls, refined pass only when needed.

## Non-Goals

- Coordinate/zonal deterministic OCR (store exact bounding boxes and crop each field
  on every future doc). Rejected: brittle to layout shift / resolution; complex
  registration. We store positions only as **hints**, not as the extraction mechanism.
- Auto-creating templates without explicit user action.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Template strategy | **Few-shot guidance** to the model (works for DeepSeek text + Gemini vision) |
| Main pain to solve | **Both** wrong-values and missing-fields |
| Template creation trigger | **Explicit "Save as template" button** |
| When the template re-scan fires | **Only if pass 1 did not find all required fields** for the doc type |
| Supplier identity | **Issuer ΑΦΜ** |
| Own-company ΑΦΜ (for issuer/recipient disambiguation) | Resolved **via service** (SoftOne company info / cached), not a manual setting |

## Approach

**Approach A — Correction-first + lightweight few-shot templates.** An interactive
correction layer over the existing result view; an explicit "save as template" that
stores a per-supplier few-shot example; a template-aware refined pass that only runs
when the first pass is incomplete; plus cheap deterministic validations.

Alternatives considered: **B (zonal/coordinate OCR)** — rejected as brittle/complex;
**C (verification-pass only, no manual marking)** — rejected because the user explicitly
wants manual region control. A incorporates C's deterministic checks.

---

## Component 1 — Data Model

New Prisma model in [`prisma/schema.prisma`](../../../prisma/schema.prisma):

```prisma
model SupplierTemplate {
  id           String      @id @default(cuid())
  vatNumber    String                 // issuer ΑΦΜ — match key
  docType      OcrDocType             // INVOICE | RECEIPT (template per type)
  supplierName String?
  example      Json                   // corrected extractedData → few-shot example
  fieldHints   Json?                  // { vatNumber: { page, bbox:[x,y,w,h], note } } normalized bbox
  sampleDocId  String?                // the source OcrDocument
  thumbUrl     String?                // visual reference
  timesUsed    Int      @default(0)
  createdById  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([vatNumber, docType])      // one template per supplier per type; button upserts
  @@index([vatNumber])
}
```

User corrections persist to the existing `OcrDocument.extractedData` / `OcrInvoiceItem`
rows — no separate model needed for corrections.

Migration follows the project workflow (see memory `prisma-migrate-workflow`):
`db push` is unreliable here — generate the migration via the manual path and
`prisma migrate resolve`.

---

## Component 2 — Deterministic Validation (`lib/ocr/validate.ts`, new)

Pure functions, no AI, no I/O:

- `isValidAfm(afm: string): boolean` — Greek ΑΦΜ check-digit (mod-11) validation.
- `checkTotals(data): { ok: boolean; issues: string[] }` — for invoices,
  `|subtotal + vatAmount − totalAmount| ≤ 0.02`.
- `fixSwappedParties(data, ownAfm): data` — if the extracted **issuer** ΑΦΜ equals our
  **own** ΑΦΜ, the issuer/recipient are swapped → swap the two parties' field groups.
- `qualityScore(data, docType): number` — `countMissingRequired + (# failed checks)`.
  **Lower is better.** Replaces bare `countMissingRequired` in the retry-keep decision.

### Own-ΑΦΜ resolution (`resolveOwnAfm()`, new helper)

Resolve our own company ΑΦΜ from the existing SoftOne company-info service (the
configured `S1_COMPANY`), cached for the day like the S1 session, with a settings
fallback (`company.ownVat`) if the service is unreachable. Used only by
`fixSwappedParties`.

---

## Component 3 — Pipeline Changes ([`lib/ocr/extract.ts`](../../../lib/ocr/extract.ts), [`lib/ocr/templates.ts`](../../../lib/ocr/templates.ts))

1. **Fix retry-keep:** replace the `countMissingRequired` comparison with `qualityScore`
   in the image path (~L435), Gemini-native path (~L532), and rasterized path (~L573).
   Now a present-but-wrong field can lose to a better pass.

2. **Apply deterministic post-processing** after each parse: run `fixSwappedParties`
   and record `checkTotals`/`isValidAfm` results into `qualityScore`.

3. **Template-aware refined pass** (the user's flow):
   ```
   pass1 = extract(...)                       // unchanged: DeepSeek text OR Gemini vision
   if countMissingRequired(pass1) == 0 → done // all required found → stop, no extra cost
   else:
     afm = issuer ΑΦΜ from pass1
     tpl = SupplierTemplate(afm, docType)
     if tpl:
       pass2 = extract(..., fewShot = tpl.example + tpl.fieldHints)  // same path, enriched prompt
       result = merge(pass1, pass2)           // take from pass2 only fields missing/invalid in pass1
       tpl.timesUsed++
     else:
       result = existing pro-retry fallback   // unchanged behavior when no template
   ```
   Cost note: the second pass runs **only** when pass 1 is incomplete; the template
   lookup adds extra model cost only for known suppliers.

4. **`buildSystemPrompt(docType, lang, example?, fieldHints?)`** in `templates.ts`:
   when an example is supplied, append a reference block:
   > *"Reference: a previously verified document from the same issuer (ΑΦΜ X) had this
   > structure. Use it to locate and disambiguate fields. Do NOT copy values — read the
   > actual document."* + `example` JSON + `fieldHints`.

   Works identically for the DeepSeek text path and the Gemini vision path.

---

## Component 4 — Correction UI (`app/admin/ocr/[id]/field-correction.tsx`, new)

Interactive client component that replaces/augments the read-only
[`result-view.tsx`](../../../app/admin/ocr/[id]/result-view.tsx).

- **Document render:**
  - Image → `<img>` in a positioned container with an overlay layer for marquee boxes.
  - PDF → rendered with **pdfjs in the browser** to a `<canvas>` per page. For digital
    PDFs we also build the **text layer** (text item positions).
- **Field list (right):** every field is an always-editable input plus a "🎯 mark" button.
- **Marquee flow:** click a field's 🎯 → crosshair → drag a box on the document →
  - **digital PDF** → intersect the box with text-layer items → join text → **fill the
    field instantly, no AI**.
  - **image / scanned PDF** → send normalized bbox `(0..1)` + page index to
    `POST /read-region` → server crops the original (sharp; for scanned PDFs rasterize
    that page at a fixed DPI) → small Gemini call "read this field" → value → fill.
- Each field's captured bbox is retained to build `fieldHints` when saving a template.
- **"Save corrections"** → `PATCH /api/admin/ocr/[id]` with corrected `extractedData`
  (and rebuilt `OcrInvoiceItem` rows).
- **"Save as template"** → `POST /api/admin/ocr/[id]/save-template` (upsert). Shows a
  warning Callout if validations still fail, but allows the save (user override).

Coordinates are always **normalized (0..1)** + a page index, so they are
resolution-independent between client render and server crop.

---

## Component 5 — API Endpoints

All gated with `requirePermission(...)` following existing OCR routes.

- `POST /api/admin/ocr/[id]/read-region` — body `{ field, page, bbox:[x,y,w,h] }` (normalized)
  → `{ value }`. Crops the original and runs a small focused vision call (Gemini Flash).
  Logs `AiUsage` with `scope: 'OCR_VISION'`, `operation: 'ocr.region'`.
  Permission: `ocr.correct` (new) or reuse `ocr.categorize`.
- `PATCH /api/admin/ocr/[id]` — **extend** the existing handler (today only
  category/notes) to also persist corrected `extractedData` and replace `OcrInvoiceItem`
  rows. Permission: `ocr.categorize` (or new `ocr.correct`).
- `POST /api/admin/ocr/[id]/save-template` — upsert `SupplierTemplate` from the current
  corrected values + captured `fieldHints` + thumbnail. Permission: `ocr.correct`.
- `GET` / `DELETE /api/admin/ocr/templates` — list and delete templates. Optional
  management page `/admin/ocr/templates`.

---

## Error Handling & Edge Cases

- **No ΑΦΜ in pass 1** → cannot match a template → fall back to the existing pro-retry.
- **Template drift** (supplier changed layout) → mitigated by the "read, don't copy"
  instruction; a fresh correction + re-save updates the template (upsert).
- **Multi-page PDFs** → bbox carries a page index; merge logic unchanged.
- **Own-ΑΦΜ service unreachable** → `fixSwappedParties` falls back to the
  `company.ownVat` setting; if also absent, the swap check is skipped (no crash).
- **Save-as-template while invalid** → warn, but allow (explicit user action).
- **read-region on a region with no text** (digital PDF) → fall back to the crop+vision
  path automatically.

---

## Testing (TDD)

Unit (pure functions, no network):
- `isValidAfm` — known valid and invalid ΑΦΜ (including check-digit edge).
- `checkTotals` — within/over tolerance.
- `fixSwappedParties` — swaps when issuer == ownAfm, leaves alone otherwise.
- `qualityScore` — orders results correctly (present-but-wrong worse than correct).
- digital-PDF **marquee→text** mapping — given text items + a bbox, returns the right join.
- `buildSystemPrompt` — includes the example + reference instruction when given.

Logic (mocked LLM):
- Template lookup + `merge(pass1, pass2)` takes only the fields missing/invalid in pass1.
- Pipeline stops after pass 1 when all required fields are present (no second call).

---

## Wiki (mandatory — project `CLAUDE.md`)

This adds UI. Per the project wiki convention:

- `npm run wiki:new -- ocr/correction --roles "ADMIN,EMPLOYEE" --title "Διόρθωση & Πρότυπα OCR"`
- Write Greek content in `docs/wiki/ocr/correction.mdx` (Επισκόπηση, `<Steps>` for the
  marquee workflow, `<Callout type="warning">` for "save as template overwrites").
- Add `helpAnchor` to the correction view's `<PageHeader>`.
- Add a screenshot route for `/admin/ocr/...` in the frontmatter.
- Ensure an `ocr` module entry exists in
  [`lib/wiki/modules-meta.ts`](../../../lib/wiki/modules-meta.ts); add it if missing.

---

## Implementation Phases (build order)

1. **Cheap wins, no UI:** `lib/ocr/validate.ts` + `resolveOwnAfm()` + fix retry-keep to
   use `qualityScore` + deterministic post-processing in `extract.ts`. Tests first.
2. **Templates backend:** `SupplierTemplate` model + migration + few-shot prompt +
   template-aware second pass + `save-template` API.
3. **Correction UI:** `field-correction.tsx` (canvas render, marquee, digital text-layer
   mapping) + `read-region` API + extend `PATCH` to persist corrections.
4. **Management + docs:** `/admin/ocr/templates` page + wiki entry + screenshots.

Each phase is independently shippable; phase 1 alone improves "rescan" accuracy.
