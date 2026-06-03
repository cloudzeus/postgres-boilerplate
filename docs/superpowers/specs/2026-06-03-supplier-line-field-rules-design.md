# Supplier line-level & list field rules — design

**Date:** 2026-06-03
**Status:** Approved (design), pending implementation plan
**Extends:** `2026-06-03-supplier-custom-field-rules-design.md` (the document-level custom field rules already shipped)

## Problem

The shipped "Supplier Custom Field Rules" feature extracts **document-level** custom
fields. We also need **per-line** custom fields — most importantly **serial numbers**
on hardware invoices, where a single line carries an **array of serials**. The user
must be able to define such a field once (from the row actions dropdown) and have the
app auto-extract it per line on every future upload from that supplier.

## Decisions (from brainstorming)

- **Line-rule targeting:** a line-scoped rule applies to **all lines** (extract the
  value per line where present; `null` elsewhere). No per-product-code restriction.
- **Value type:** chosen **per rule** — `text` (single value) or `list` (array, e.g.
  serials). Applies to both document- and line-scoped rules.
- **Storage:** JSON only — no new `OcrInvoiceItem` column. (Posting serials to SoftOne
  is a separate future spec — YAGNI now.)
- **Combined supplier (both document + line rules):** run **two separate targeted
  passes** (simpler/more reliable than one combined pass).
- **Line↔value mapping:** index-aligned — the model is given the enumerated lines and
  returns values per line index.

## Architecture (delta over the shipped feature)

### 1. Data model — two columns on `SupplierFieldRule`

```prisma
scope      String  @default("document")   // "document" | "line"
valueType  String  @default("text")        // "text" | "list"
```

Migration via db push + manual migration + resolve (this project's workflow; `migrate
dev` is broken). Both columns are additive with defaults, so existing rows become
`document`/`text` — safe on the shared prod+dev DB.

### 2. Stored values

- **Document rules** (unchanged location): `extractedData.customFields[key]`.
  - `text` → string|null; `list` → `string[]` (was always scalar before; now a `list`
    rule stores an array).
- **Line rules**: `extractedData.items[i].customFields[key]` per line.
  - `text` → string|null; `list` → `string[]` (serials); `null`/absent where not found.

Display labels resolve from the rule at render time (key humanized as fallback), same
as the shipped feature.

### 3. Extraction — `lib/ocr/field-rules.ts` + `lib/ocr/extract.ts`

`findActiveFieldRules` returns all active rules (both scopes). In
`applyCustomFieldRules` (extract.ts), split rules by `scope`:

- **Document pass** (existing): for `scope==='document'` rules, build the current
  document prompt, parse `{ key: value }`, merge into `data.customFields`. `mergeCustomFields`
  is updated to take the full rules (with `valueType`) and coerce each value via
  `coerceFieldValue(raw, rule.valueType)` before storing (a `list` rule → string array,
  `text` → string|null). This stays pure (returns a new `data`).
- **Line pass** (new): for `scope==='line'` rules, only if `Array.isArray(data.items)
  && data.items.length > 0`. Build a prompt that includes the enumerated lines
  (`index`, `code`, `name`) and the line-rule fields, asking for:
  ```json
  { "lines": [ { "index": 0, "<key>": <value|null>, ... }, ... ] }
  ```
  For each returned line entry, write `data.items[entry.index].customFields[key] =
  normalized value` (only for valid in-range indices). `list` rules → string array;
  `text` rules → string|null.

Both passes are **best-effort** (never throw), use the **default vision model**, and
run after `normalizeAfmFields`. Each pass that runs increments `timesUsed` for the
rules it used. If a supplier has both scopes, both passes run (two model calls).

New helpers in `field-rules.ts`:
- `buildLineFieldsPrompt(rules, lines)` — focused per-line prompt (lines enumerated).
- `mergeLineCustomFields(data, parsedLines, rules)` — **pure**; returns a new `data`
  with per-line `customFields` merged by index, ignoring out-of-range indices and
  unknown keys, coercing per `valueType`.
- `coerceFieldValue(raw, valueType)` — `list` → `string[]` (split a delimited string
  or accept an array; drop empties; `[]` → null), `text` → trimmed string | null.
- `buildCustomFieldsPrompt` updated to note which fields are lists (so the model
  returns arrays for them).

`FieldRuleLite` gains `scope` and `valueType`.

### 4. Dialog — `components/admin/supplier-field-rule-dialog.tsx`

Add two controls:
- **Εμβέλεια** (scope): `Έγγραφο` (document) | `Γραμμή` (line). Default document.
- **Τύπος τιμής** (valueType): `Μία τιμή` (text) | `Λίστα` (list). Default text.

The 🎯 region marker stays available only for **document** scope + image mime (it is
meaningless for per-line extraction). POST body gains `scope` and `valueType`. The
"found value" preview shows the document value for document rules; for line rules it
shows a short summary (e.g. "βρέθηκε σε N γραμμές").

### 5. API

- `POST /api/admin/ocr/[id]/field-rules` body extends to `{ label, description?,
  regionHint?, scope?: 'document'|'line', valueType?: 'text'|'list' }`. The created
  rule stores both. Immediate apply: re-runs `extractDocument` (which now runs both
  passes) and returns a `value` summary:
  - document → the value at `customFields[key]`.
  - line → `{ matchedLines: number }` (count of lines where the value is non-null).
- `upsertFieldRule` extends to persist `scope` + `valueType`.
- `PATCH /api/admin/ocr/field-rules/[ruleId]` may additionally update `valueType` and
  `scope`? **No** — `scope` and `valueType` are **immutable** after creation (changing
  them would orphan already-stored values of a different shape). PATCH continues to
  update only `label`, `description`, `regionHint`, `isActive`. (Documented as a
  deliberate constraint, like `key` immutability.)
- `GET` list returns the new fields for the management page.

### 6. Display

- **`row-detail.tsx` — Γραμμές tab:** for each line, render a small read-only line under
  the row (or an extra cell) listing that line's custom fields: `«<label>: v1, v2…»`
  (arrays joined by comma; empty → omitted). Source: `data.items[i].customFields`.
  NOTE: the editable line state (`toLineItems`) does not carry customFields, so the
  display reads `customFields` directly from `data.items[i]` (read-only), keyed by line
  index alongside the rendered rows.
- **`result-view.tsx` — invoice items table:** add a per-line custom-fields display
  (e.g. a sub-row under each item) sourced from `data.items[i].customFields`.
- Document-level "Ειδικά πεδία" block: unchanged.

### 7. Management page + wiki

- List page columns gain **Εμβέλεια** (Έγγραφο/Γραμμή) and **Τύπος** (Μία τιμή/Λίστα).
- `field-rules-client.tsx` `FieldRuleRow` gains `scope` + `valueType` (read-only in the
  table; not editable inline, matching the immutability rule).
- Wiki `docs/wiki/ocr/field-rules.mdx`: add a section on per-line fields & serials
  (define with Εμβέλεια=Γραμμή, Τύπος=Λίστα; values shown per line).

## Edge cases & rules

- Line pass only runs when the document has `items`. Receipts usually have none → no
  line pass, no cost.
- Out-of-range or non-numeric `index` entries from the model are ignored.
- `list` coercion: model may return a comma/newline/space-separated string or a JSON
  array; `coerceFieldValue` handles both, trims, drops empties, returns `null` for an
  empty result.
- `scope`/`valueType` immutable post-creation (re-create the rule to change shape).
- Deleting a rule leaves already-stored per-line/document values in `extractedData`
  (harmless).
- General_text excluded (no lines, no supplier) — unchanged.

## Testing

- Unit (`field-rules.test.ts`, extend): `coerceFieldValue` (string→array split, array
  passthrough, empty→null, text trim); `mergeLineCustomFields` (index alignment,
  out-of-range ignored, unknown keys ignored, pure/no-mutation, valueType coercion);
  `buildLineFieldsPrompt` (contains line indices + field keys + "lines" shape).
- Network passes remain best-effort and are not unit-tested beyond merge logic
  (consistent with existing OCR tests).

## Out of scope (YAGNI)

- Per-product-code targeting / pattern filters.
- Posting serials (or any custom field) to SoftOne.
- Editing `scope`/`valueType` of an existing rule.
- A dedicated queryable serials table/column.
