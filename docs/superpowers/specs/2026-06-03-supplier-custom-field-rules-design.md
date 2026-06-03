# Supplier custom field rules — design

**Date:** 2026-06-03
**Status:** Approved (design), pending implementation plan

## Problem

For some suppliers we need to extract an extra field from their documents that
isn't part of the standard OCR schema (e.g. «Αριθμός Παραγγελίας», «Κωδικός
Σύμβασης»). The user wants to:

1. From the actions dropdown of a scanned document, define a **new field** to
   look for on documents from that supplier.
2. Have the app **automatically extract that field on every future upload** from
   the same supplier.
3. See a **page listing all these special rules** with full management.

This builds alongside the existing per-supplier `SupplierTemplate` (few-shot
re-extraction of the *standard* fields). Custom field rules are a separate,
dedicated concept — they teach the extractor about *extra* fields, not about the
standard schema.

## Decisions (from brainstorming)

- **Field definition:** name (label) + description/instruction are mandatory; an
  optional region marking (🎯) captures a location hint.
- **Scope:** per supplier **ΑΦΜ + docType** (INVOICE | RECEIPT). GENERAL_TEXT is
  excluded (no supplier concept).
- **On rule creation:** the rule is saved AND immediately applied to the current
  document so the user sees the found value right away.
- **List page management:** view + edit + delete + enable/disable (toggle).
- **Model:** a dedicated `SupplierFieldRule` table (chosen over piggybacking on
  `SupplierTemplate.fieldHints`).
- **2nd-pass model:** use the **default vision model** (cheap), not the upgraded
  one — it's a small targeted ask.
- **Menu item label:** «Νέο ειδικό πεδίο…».

## The chicken-and-egg constraint

The issuer ΑΦΜ is discovered *by* extraction, so we can't know which rules apply
before extracting. The codebase already solves this with a **second targeted
pass** (`applySupplierTemplate`): extract normally → resolve ΑΦΜ → run a focused
pass. Custom field rules reuse this pattern: after the ΑΦΜ is known and
normalized, run one extra pass that asks *only* for the active custom fields.

## Architecture

### 1. Data model (Prisma)

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

- **`key`** is derived from `label` (slug: lowercased, ASCII-transliterated,
  non-alphanumerics → `_`; fall back to a short stable hash if empty). It's the
  storage key in `extractedData.customFields` and the uniqueness discriminator.
  Re-adding the same label upserts the same key.
- Migration via the project's workflow (db push + manual migration + resolve —
  see `.planning` / the prisma-migrate note; `migrate dev` is broken here).

### 2. Stored values

Custom field values live in the existing `extractedData` JSON (no migration for
this part) under:

```jsonc
"customFields": { "arithmos_paraggelias": "PO-2026-114", "kodikos_symvasis": null }
```

Stored as `{ [key]: value }` only. The display label is resolved from the rule
at render time, so renaming a rule's label reflects immediately and a deleted
rule still shows its stored value (fallback label = the key).

### 3. Extraction integration — `lib/ocr/field-rules.ts`

- `slugifyFieldKey(label): string` — deterministic key derivation.
- `findActiveFieldRules(afm: string, docType: DocType)` — active rules for the
  normalized ΑΦΜ + docType (empty for general_text / invalid ΑΦΜ).
- `buildCustomFieldsPrompt(rules)` — a focused system prompt: "Extract ONLY the
  following fields from the document. Respond with raw JSON `{<key>: value|null}`.
  Use null if not present. Fields: [{key, label, description, regionHint}]".
- `applyCustomFieldRules(input, data)` — given resolved data with a valid issuer
  ΑΦΜ: fetch active rules; if none, return data unchanged. Otherwise run ONE
  targeted pass via the existing callers (`callGeminiPdfNative` for PDF+Gemini,
  `callVisionLLM` for images, `callTextLLM` when only rawText is available),
  parse JSON, write `data.customFields[key] = value` for each rule, and
  `increment timesUsed`. **Best-effort: never throws** (logs + returns data on
  any error). Uses the **default vision model**. Logged via `logAiUsage` with
  scope `OCR_CUSTOM_FIELDS`.

Wire into `extractDocument` (lib/ocr/extract.ts) AFTER `applySupplierTemplate`
and `normalizeAfmFields`, using the normalized `vatNumber`. The pass is skipped
entirely (zero extra cost) when the supplier has no active rules.

### 4. API routes

- `POST /api/admin/ocr/[id]/field-rules` (perm `ocr.categorize`) — create from
  the current doc. Body `{ label: string, description?: string, regionHint?:
  {page,bbox} }`. Validates: doc exists, docType ≠ GENERAL_TEXT, issuer ΑΦΜ is a
  valid normalized 9-digit number. Derives `key`, upserts the rule
  (unique vatNumber+docType+key), then **runs `applyCustomFieldRules` on this
  doc**, persists the updated `extractedData.customFields`, returns
  `{ rule, value }`.
- `GET /api/admin/ocr/field-rules` (perm `ocr.read`) — list all rules
  (id, vatNumber, supplierName, docType, label, description, isActive,
  timesUsed, createdAt) ordered by supplierName then docType then label.
- `PATCH /api/admin/ocr/field-rules/[ruleId]` (perm `ocr.categorize`) — update
  `label`, `description`, `regionHint`, `isActive`. The `key` is **immutable**
  (set at creation) so already-stored values stay linked — see Edge cases.
- `DELETE /api/admin/ocr/field-rules/[ruleId]` (perm `ocr.categorize`).

### 5. UI

- **Dropdown action** (`app/admin/ocr/ocr-table.tsx`): add «Νέο ειδικό πεδίο…»,
  shown only for INVOICE/RECEIPT rows with a valid issuer ΑΦΜ. Opens
  `SupplierFieldRuleDialog`.
- **`SupplierFieldRuleDialog`** (new component): inputs *Όνομα πεδίου* (label),
  *Οδηγία* (description); optional 🎯 *Μαρκάρισμα περιοχής* reusing the existing
  region-marking flow (the `read-region` endpoint / the field-correction marker)
  on the document preview to capture `regionHint`. On submit → POST → show the
  returned found value inline + toast + `router.refresh()`.
- **Display block** «Ειδικά πεδία» (read-only key/value) in `row-detail.tsx`
  (expand) and `app/admin/ocr/[id]/result-view.tsx`, rendered from
  `extractedData.customFields` joined to the rules' labels (fetched per doc by
  issuer ΑΦΜ + docType, or labels passed down).
- **List page** `/admin/ocr/field-rules`: table columns [Προμηθευτής
  (supplierName + ΑΦΜ), Τύπος, Πεδίο (label), Οδηγία, Χρήσεις, Ενεργό (toggle),
  ⋯ (Επεξεργασία / Διαγραφή)]. `<PageHeader helpAnchor="ocr-field-rules">`. A
  link to this page from the OCR page.

### 6. Wiki (mandatory per CLAUDE.md)

- `npm run wiki:new -- ocr/field-rules --roles "SUPER_ADMIN,ADMIN,EMPLOYEE"
  --title "Ειδικά πεδία προμηθευτών"`, then write Greek content (Steps +
  Callouts) covering: defining a rule from the dropdown, automatic application to
  future uploads, and managing rules on the list page.
- Add `helpAnchor="ocr-field-rules"` to the list page `<PageHeader>` and the
  matching `helpAnchors:` frontmatter.
- Screenshot route `/admin/ocr/field-rules`.

## Edge cases & rules

- **GENERAL_TEXT** documents: action hidden; POST returns 422.
- **Invalid/missing issuer ΑΦΜ**: action disabled; POST returns 422.
- **Key collision on edit:** changing a `label` keeps the original `key` (so
  already-stored values under that key remain linked). Key is set once at
  creation; editing label only changes the display label, not the storage key.
- **Deleted rule:** previously extracted values stay in `extractedData`
  (harmless); the display falls back to showing the key as the label.
- **No active rules for a supplier:** the extra extraction pass is skipped — no
  added latency or AI cost.
- **Re-extract of an existing doc** (`/reextract`) runs the full
  `extractDocument`, so custom fields are refreshed there too.

## Testing

- Unit: `slugifyFieldKey` (Greek labels → ascii slug, collisions, empty → hash);
  `buildCustomFieldsPrompt` (contains each field key + description); merge of
  parsed values into `data.customFields` (null handling, unknown keys ignored).
- The targeted-pass network calls follow the existing best-effort pattern and
  are not unit-tested beyond the merge logic (consistent with current OCR tests).

## Out of scope (YAGNI)

- A generic rules engine / conditional logic.
- Custom fields for GENERAL_TEXT.
- Mapping custom fields to SoftOne posting fields (future, separate spec).
- Cross-supplier/global field rules.
