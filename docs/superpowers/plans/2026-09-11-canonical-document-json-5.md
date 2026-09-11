# Canonical Document JSON (plan 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every OCR run (base OCR + optional template) produces ONE canonical `document` JSON (spec §17.1); the base OCR prompt extracts it whole, templates fill/correct it by path, and SoftOne posting + Excel export read only that JSON.

**Architecture:** A new isomorphic module `lib/ocr/canonical.ts` owns the zod schema (`version: 3`), path helpers, and the two bridges `fromLegacy` / `toLegacy` between the canonical document and today's flat `extractedData` + `OcrInvoiceItem` rows. The canonical document is persisted in a new `OcrDocument.document` JSON column and per run in `TemplateRun.output`; `extractedData` keeps being written as a derived projection so every existing consumer (list, row-detail, queues, doc-type classifier, softone-match) keeps working unchanged. Template mappings target canonical paths (`totals.payable`, `lines.net`, `custom.<key>`); legacy `invoiceKey`s are migrated. Posting builds a pure PURDOC payload from the document, gated by a setting (default off) and with a dry-run preview.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (hand-written SQL migrations, `npx prisma migrate deploy` only — NEVER `migrate dev`/`reset`/`db push`, live customer DB), zod 4, vitest 4 (`lib/**/*.test.ts`, prisma mocked via `vi.hoisted` + `vi.mock('@/lib/db')`), exceljs, DG design system (Greek UI). SoftOne via `lib/softone.ts` (`softoneCall`, `softoneGetTable`, cp1253, two-step auth; `success:true ≠ persisted` → read back).

**Ground rules for every task:** work in the worktree `.claude/worktrees/canonical` (branch `feat/canonical-document`); never `git stash`; stage by path; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never write to SoftOne (no `setData`) from tests/scripts/smoke; never call paid LLM APIs from scripts; `.env` values come from the user (never invent).

---

## Current state (read before starting)

- Prompt shape: `lib/ocr/templates.ts` `TEMPLATE_SCHEMAS.invoice.jsonStructure` — flat keys `companyName, vatNumber, companyAddress, companyDoy, companyProfession, companyPhone, companyEmail, customerName, customerVatNumber, customerAddress, customerDoy, customerProfession, documentTypeLabel, invoiceNumber, aadeMark, date, time, itemsCount, subtotal, vatAmount, totalAmount, bankAccounts[{bank,iban}], items[{code,name,quantity,price,discount,vatRate,total}]`. `receipt` docType uses the invoice schema (`buildSystemPrompt` line ~134). `general_text`: `title, fullText, summary, keywords[]`. `REQUIRED_FIELDS` drives the retry/upgrade logic.
- `lib/ocr/extract.ts`: `extractDocumentRaw` (image → vision; pdf auto/digital/scanned; hybrid `mergeHybrid`; multi-page `mergePages` with a hardcoded header key list), `normalizeAfmFields`, no zod on the LLM output. `ExtractResult = { data, rawText, model, tokensUsed, durationMs, passes?, retried? }`.
- Writers of `extractedData` + item rows: `app/api/admin/ocr/route.ts` (upload), `app/api/admin/ocr/[id]/reextract/route.ts`, `app/api/admin/ocr/[id]/route.ts` (PATCH `{extractedData, items, softoneSeries…}`), `lib/templates/run.ts` `applyProjectionToDocument` (+ `carryForward` of SoftOne match columns on item rows).
- Templates: `lib/templates/schema.ts` `INVOICE_SCHEMA` (18 header + 7 `items.*` keys, `customFields.<slug>`), `mapping.ts` `projectToInvoice`, `run-logic.ts` `setInvoicePath`, `CROSS_CHECK_KEYS`, `baseOcrSnapshot`, `itemsToRows`; `output.ts` `toRunOutput` (values only, recomputed per request, nothing persisted); `excel.ts` `buildSheets(SheetInput[])` reads ONLY `TemplateRun.values`; `excel-server.ts` `runsToSheetInputs`/`latestPerDocument`/`sheetsToXlsx`.
- Posting: `lib/ocr/post-softone.ts` is a STUB (marks POSTED with a fake `OCR-xxxx` ref; reads only `status, category`). `softone-match.ts` reads `vatNumber, invoiceNumber, date` and writes `softoneMtrl/softoneExpn/...` on `OcrInvoiceItem`. Settings: `lib/settings.ts` (`SETTING_CATALOG`, `getSetting`, `setSetting`). VAT ids: model `VatCategory` (SoftOne VAT table mirror; see `components/admin/expenses-table-client.tsx` / item-panel for how it is used).
- SoftOne PURDOC (cached schema, object `PURDOC` → table FINDOC): header required `COMPANY, FINDOC, TRNDATE, SERIES, TRDR, VATSTS(def 1), TRDRRATE(def 1), VATAMNT, EXPN, NETAMNT`; also `FINCODE, COMMENTS, PAYMENT, MYDATAMARK, MYDATAUID, MYDATAQRURL, SUMAMNT`. Lines: `ITELINES` (items, dbname MTRLINES: `LINENUM, MTRL, QTY1, PRICE, DISC1PRC, VAT, NETLINEVAL, VATAMNT, COMMENTS`), `SRVLINES` (services, same shape), `EXPANAL` (expenses: `LINENUM, EXPN, VAT, EXPVAL`), `VATANAL` (`LINENUM, VAT, VATVAL`, computed by SoftOne — do not send).
- Prisma: `OcrDocument` (has `extractedData Json?`, `issuerAfm`, `softoneTrdr`, `softoneSeries`, `seriesSource`, `postStatus/postedAt/postedRef/postError`, `itemsTotal/itemsMatched`), `OcrInvoiceItem` (`rowIndex, code, name, quantity, price, discount, vatRate, total, softoneMtrl, softoneExpn, softoneIsService, softoneMatchedBy, softoneCode, softoneName`), `TemplateRun` (`values, matched, flags`, no output column), `TemplateMapping.rows Json` (`INVOICE: [{fieldKey, invoiceKey}]`, `EXCEL: [{fieldKey, column, order}]`). Last migration: `20260911110000_issuer_afm`.
- UI consumers of `extractedData` (must keep working untouched): `app/admin/ocr/page.tsx`, `pending/page.tsx`, `ocr-table.tsx`, `row-detail.tsx` (FIELD_SPECS + `buildExtractedData`), `result-modal.tsx`, `[id]/result-view.tsx` (bankAccounts), `[id]/field-correction.tsx`, `[id]/page.tsx`; API `checks`, `correlate`, `create-supplier`, `template-runs` routes; `lib/ocr/doc-type.ts`, `queues.ts`, `softone-match.ts`.
- Tests: 44 files / 631 passing at master `fe09362`. Prisma mock pattern: `lib/ocr/__tests__/softone-match.test.ts:6-15`.

## File structure

| File | Responsibility |
|---|---|
| `lib/ocr/canonical.ts` (new, isomorphic, pure) | zod schema `DocumentSchema` v3 + types; `emptyDocument`, `isCanonical`, `coerceDocument`, `fromLegacy`, `toLegacy`, `getPath`, `setPath`, `normalizeDocument`, `reconcileDocument`, `DOCUMENT_PATHS` registry (path → label/valueType/isLine), `LEGACY_KEY_TO_PATH` |
| `lib/ocr/extract-merge.ts` (new, pure) | `mergeDocuments(pages)` (multi-page), `mergeHybridDocuments(digital, vision)` on canonical documents; `missingRequired(document, docType)` |
| `lib/ocr/document.ts` (new, server) | `loadDocumentJson(id)`, `saveDocumentJson(id, document, opts)` — the ONLY writer of `document`/`extractedData`/item rows/`issuerAfm` |
| `lib/ocr/purdoc-payload.ts` (new, pure) | `buildPurdocPayload(document, ctx)` + `postingBlockers(...)` |
| `lib/ocr/post-softone.ts` | real posting behind setting `softone.postingEnabled`, read-back, dry-run |
| `lib/ocr/templates.ts` | canonical prompt; `REQUIRED_PATHS` |
| `lib/ocr/extract.ts` | pipeline returns `{ document, data }` |
| `lib/templates/schema.ts` | `DOCUMENT_SCHEMA` (from `DOCUMENT_PATHS`), `documentKeyInfo` (accepts legacy keys) |
| `lib/templates/mapping.ts` | `projectToDocument` |
| `lib/templates/run-logic.ts` | `setDocumentPath`, cross-check on paths, `itemsToRows(document.lines)` |
| `lib/templates/run.ts` | runs on the canonical document, persists `TemplateRun.output` |
| `lib/templates/output.ts` | `toRunOutput` v3 `{…, document}` |
| `lib/templates/excel.ts`, `excel-server.ts` | sheets from the document |
| `prisma/migrations/20260912100000_canonical_document/migration.sql` | `OcrDocument.document`, `TemplateRun.output` |
| `scripts/backfill-canonical.ts` | fills `document` for existing rows; rewrites mapping `invoiceKey`s |
| `app/api/admin/ocr/[id]/document/route.ts` (new) | `GET` canonical JSON (download) |
| `app/api/admin/ocr/[id]/post-softone/route.ts` | `GET ?dryRun=1` preview, `POST` real |
| `app/admin/ocr/[id]/document-json.tsx` (new) | «JSON εγγράφου» card + «Προεπισκόπηση καταχώρισης» |
| `docs/wiki/ocr/document-json.mdx` (new) | wiki |

---

### Task 0: Worktree

- [ ] **Step 1:** From the main repo:
```bash
git -C /Volumes/EXTERNALSSD/postgres-boilerplate worktree add .claude/worktrees/canonical -b feat/canonical-document
cp /Volumes/EXTERNALSSD/postgres-boilerplate/.env /Volumes/EXTERNALSSD/postgres-boilerplate/.claude/worktrees/canonical/.env
cd /Volumes/EXTERNALSSD/postgres-boilerplate/.claude/worktrees/canonical && npm install && npx prisma generate && npx vitest run 2>&1 | tail -4
```
Expected: 44 files passing.

---

### Task 1: Canonical schema module

**Files:** Create `lib/ocr/canonical.ts`, `lib/ocr/__tests__/canonical.test.ts`.

- [ ] **Step 1: Write failing tests** (`lib/ocr/__tests__/canonical.test.ts`) covering:
  - `DocumentSchema.parse(emptyDocument('invoice'))` succeeds; `version` is 3 only on the envelope (not inside `document`).
  - `fromLegacy(flat, items)` maps every legacy key: `companyName→issuer.name`, `vatNumber→issuer.vat`, `companyAddress→issuer.address`, `companyDoy→issuer.doy`, `companyProfession→issuer.profession`, `companyPhone→issuer.phone`, `companyEmail→issuer.email`, `customerName→recipient.name`, `customerVatNumber→recipient.vat`, `customerAddress/Doy/Profession→recipient.*`, `documentTypeLabel→type.label`, `invoiceNumber→type.number`, `aadeMark→digital.mark`, `date→date`, `time→custom.time`, `itemsCount→custom.itemsCount`, `subtotal→totals.net`, `vatAmount→totals.vatAmount`, `totalAmount→totals.total` (and `totals.payable = total` when payable missing), `bankAccounts→payment.ibans`, `items[]→lines[]` (`price→unitPrice`, `total→net`, `vatAmount = round(net*rate/100)`, `total = net + vatAmount`), `customFields→custom`, legacy `storeName→issuer.name`, `phone/email→issuer.*`; general_text `title/summary/keywords/fullText→custom.*`, `kind:'general'`, `notes = summary`. Kind: `invoice` when recipient present, `receipt` when not, `general` for general_text (parameter `docType`).
  - `toLegacy(document)` is the inverse for every key above (round-trip `toLegacy(fromLegacy(x))` ⊇ x for the invoice keys; `items[]` regenerated from `lines[]`), and it emits `customFields` from `custom` and `bankAccounts` from `payment.ibans`.
  - `getPath(doc, 'totals.total')`, `getPath(doc, 'lines.net')` (returns array of line values), `setPath(doc, 'handwritten.glAccount', '64.00')` creates intermediate objects; `setPath(doc, 'custom.foo', 1)`; `setPath` on a `lines.*` path throws.
  - `normalizeDocument`: AFM via `normalizeAfm` (issuer.vat/recipient.vat), dates `DD/MM/YYYY`→`YYYY-MM-DD`, numeric strings `"1.234,56"`→1234.56, `vatRate` `"24%"`→24, currency default `EUR`, trims strings, `null` for `""`.
  - `reconcileDocument` (uses `lib/ocr/invoice-math.ts`): fills `totals.net/vatAmount/total` from lines when null, computes `vatBreakdown` from lines when empty, sets `totals.payable = total - withholding + fees` when null, never overwrites a printed non-null total; returns `{ document, checks: { linesVsNet: boolean|null, vatOk, totalOk } }`.
  - `coerceDocument(raw, docType)`: canonical-shaped input (`kind` + `issuer`/`lines`) → validated document (unknown keys stripped, bad types coerced or nulled, never throws); flat legacy-shaped input → `fromLegacy`; garbage → `emptyDocument`.
  - `DOCUMENT_PATHS` contains every header path listed in the schema below with Greek labels and `valueType`, plus `lines.*` entries with `isLine: true`; `LEGACY_KEY_TO_PATH` covers all 25 `INVOICE_SCHEMA` keys + `customFields.<k>` → `custom.<k>`.

- [ ] **Step 2: Run** `npx vitest run lib/ocr/__tests__/canonical.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/ocr/canonical.ts`** (no `server-only`, no prisma). Schema (zod 4, all fields `.nullable().optional()` except where noted, numbers via a `num` preprocessor that accepts numeric strings):
```ts
export const DOCUMENT_VERSION = 3 as const;
export type DocumentKind = 'invoice' | 'receipt' | 'general';
const Party = z.object({ name, vat, doy, profession, address, city, zip, country, phone, email, gemi, code }); // all nullable strings
const Line = z.object({ code, name, unit, quantity, unitPrice, discount, net, vatRate, vatAmount, total, custom: z.record(z.string(), z.unknown()).default({}) });
const Totals = z.object({ net, discount, vatAmount, withholding, fees, total, payable });
const VatRow = z.object({ rate, net, vat });
const Digital = z.object({ mark, uid, authCode, provider, qr: z.boolean().nullable() });
const Payment = z.object({ method, terms, ibans: z.array(z.object({ bank, iban })).default([]) });
const References = z.object({ orderNo, deliveryNote, contract, shipment, plates: z.array(z.string()).default([]), period: z.object({ from, to }).nullable(), quantities: z.array(z.object({ label, value, unit })).default([]) });
const Handwritten = z.object({ glAccount, reference, allocations: z.array(z.object({ label, amount })).default([]) });
export const DocumentSchema = z.object({
  kind: z.enum(['invoice','receipt','general']),
  type: z.object({ label, series, number, myDataType }),
  date, dueDate, currency: z.string().default('EUR'),
  issuer: Party, recipient: Party,
  lines: z.array(Line).default([]), totals: Totals, vatBreakdown: z.array(VatRow).default([]),
  digital: Digital, payment: Payment, references: References, notes, handwritten: Handwritten,
  custom: z.record(z.string(), z.unknown()).default({}),
});
export type DocumentJson = z.infer<typeof DocumentSchema>;
export type DocumentEnvelope = { template: string | null; version: 3; extractedAt: string; file: string; documentId: string; document: DocumentJson };
```
`DOCUMENT_PATHS: { path, label, valueType: 'TEXT'|'NUMBER'|'CURRENCY'|'DATE'|'LIST', isLine }[]` — header paths: `type.label «Τύπος παραστατικού»`, `type.series`, `type.number «Αριθμός παραστατικού»`, `type.myDataType`, `date «Ημερομηνία»`, `dueDate`, `currency`, `issuer.name «Επωνυμία εκδότη»`, `issuer.vat «ΑΦΜ εκδότη»`, `issuer.doy`, `issuer.profession`, `issuer.address`, `issuer.city`, `issuer.zip`, `issuer.country`, `issuer.phone`, `issuer.email`, `issuer.gemi`, `recipient.name … recipient.code`, `totals.net «Καθαρή αξία»`, `totals.discount`, `totals.vatAmount «ΦΠΑ»`, `totals.withholding «Παρακράτηση»`, `totals.fees «Επιβαρύνσεις»`, `totals.total «Γενικό σύνολο»`, `totals.payable «Πληρωτέο»`, `digital.mark «ΜΑΡΚ ΑΑΔΕ»`, `digital.uid`, `digital.authCode`, `digital.provider`, `payment.method`, `payment.terms`, `references.orderNo`, `references.deliveryNote`, `references.contract`, `references.shipment`, `references.period.from`, `references.period.to`, `notes`, `handwritten.glAccount «Χειρόγραφο: λογαριασμός»`, `handwritten.reference`; line paths `lines.code, lines.name, lines.unit, lines.quantity, lines.unitPrice «Γραμμή: τιμή μονάδας», lines.discount, lines.net «Γραμμή: καθαρή αξία», lines.vatRate, lines.vatAmount, lines.total`. `custom.<key>` accepted dynamically by `documentKeyInfo` (Task 6).

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** `feat(ocr): canonical document schema, legacy bridges, path helpers`.

---

### Task 2: Persistence — migration, `lib/ocr/document.ts`, backfill script

**Files:** Create `prisma/migrations/20260912100000_canonical_document/migration.sql`, `lib/ocr/document.ts`, `lib/ocr/__tests__/document.test.ts`, `scripts/backfill-canonical.ts`. Modify `prisma/schema.prisma`.

- [ ] **Step 1: Migration SQL**
```sql
ALTER TABLE "OcrDocument" ADD COLUMN "document" JSONB;
ALTER TABLE "TemplateRun" ADD COLUMN "output" JSONB;
```
Schema: `OcrDocument.document Json?` (comment: canonical §17.1), `TemplateRun.output Json?`. Apply: `npx prisma migrate deploy && npx prisma generate`.

- [ ] **Step 2: Tests for `lib/ocr/document.ts`** (prisma mocked): `loadDocumentJson(id)` returns `doc.document` when present, else `fromLegacy(extractedData, items)`; `saveDocumentJson(id, document, { replaceItems: true })` writes in ONE `$transaction`: `document`, `extractedData = toLegacy(document)`, `issuerAfm = normalizeAfm(document.issuer.vat)`, deletes + recreates `OcrInvoiceItem` rows from `document.lines` (`itemsToRows` semantics: `price = unitPrice`, `total = net`) **carrying forward** `softoneMtrl/softoneExpn/softoneCode/softoneName/softoneIsService/softoneMatchedBy` by `rowIndex` when the line's `code`+`name` is unchanged (move `carryForward` from `lib/templates/run.ts` here and re-export); `replaceItems: false` leaves rows alone. Also `mergeLegacyPatch(existingDocument, extractedData, items)` → document with legacy keys overlaid (used by the PATCH route so a legacy client cannot wipe `digital/payment/handwritten/...`).

- [ ] **Step 3: Implement**, tests green. **Step 4: Backfill script** `scripts/backfill-canonical.ts` (run with `npx tsx --import ./scripts/templates/register.mjs scripts/backfill-canonical.ts`, `import 'dotenv/config'`): for every `OcrDocument` with `document IS NULL AND extractedData IS NOT NULL` → `document = fromLegacy(extractedData, items, docType)` in batches of 200 (log counts, `--dry-run` flag prints only); for every `TemplateMapping` with `target = 'INVOICE'` rewrite each row's `invoiceKey` through `LEGACY_KEY_TO_PATH` (idempotent: already-canonical keys untouched). Do NOT run it against the live DB in this task — Task 10 runs it after review.

- [ ] **Step 5: Commit** `feat(ocr): persist canonical document; document.ts writer; backfill script`.

---

### Task 3: Prompt + extraction pipeline

**Files:** Modify `lib/ocr/templates.ts`, `lib/ocr/extract.ts`; create `lib/ocr/extract-merge.ts`, `lib/ocr/__tests__/extract-merge.test.ts`; update `lib/ocr/__tests__/templates.test.ts`.

- [ ] **Step 1: Tests** for `extract-merge.ts`: `mergeDocuments([p1,p2])` — header scalars: first non-null wins EXCEPT `totals.*` and `vatBreakdown` where the LAST page that has them wins (totals print on the last page), `lines` concatenated in page order deduped by `code|name.slice(0,40)`, `payment.ibans` unioned by iban, `custom` shallow-merged; `mergeHybridDocuments(digital, vision)` — digital wins, vision fills nulls, lines: keep digital lines unless empty; `missingRequired(document, docType)` counts `REQUIRED_PATHS[docType]` (`invoice: issuer.name, issuer.vat, type.number, date, totals.net, totals.vatAmount, totals.total`; `receipt: issuer.name, issuer.vat, type.number, date, totals.total`; `general: custom.title`).
- [ ] **Step 2: Prompt** — `TEMPLATE_SCHEMAS.invoice.jsonStructure` becomes the canonical `document` (one JSON object, keys exactly as in `DocumentSchema`, with inline comments: `kind` (`invoice` when a recipient block exists, else `receipt`), `type.label` verbatim printed type, `type.series`/`type.number` split from «ΤΠΥ 17» → `"ΤΠΥ"`, `"17"`, `type.myDataType` if printed (e.g. 1.1, 2.1), `issuer`/`recipient` full blocks (vat with country prefix for foreign issuers), `lines` with `unitPrice`, `net` (before VAT), `vatRate`, `vatAmount`, `total` (net+VAT), `totals` incl. `withholding` (παρακράτηση), `fees` (επιβαρύνσεις/τέλη), `payable` (πληρωτέο), `vatBreakdown` per rate, `digital` (ΜΑΡΚ, UID, authentication code, provider name, `qr` true if a QR is printed), `payment` (method/terms/ibans), `references` (orderNo, deliveryNote, contract, shipment, plates, period, quantities like consumption kWh), `notes`, `handwritten` (any handwritten GL account / reference / allocations), `custom` `{}`). Keep the existing strong instructions (receipt rule, type verbatim, bank details, issuer phone/email). `general_text` prompt unchanged but wrapped by `coerceDocument` (→ `kind: 'general'`, `custom.{title, fullText, summary, keywords}`, `notes = summary`). `REQUIRED_FIELDS` → `REQUIRED_PATHS` (paths above); `countMissingRequired` → `missingRequired`. Add tests in `templates.test.ts` that the invoice prompt mentions `"lines"`, `"totals"`, `"digital"`, `"handwritten"` and no longer `"companyName"`.
- [ ] **Step 3: `extract.ts`** — after `parseJsonLoose`: `document = reconcileDocument(normalizeDocument(coerceDocument(raw, docType))).document`; `ExtractResult` gains `document: DocumentJson` and keeps `data = toLegacy(document)` for compatibility. Replace `mergePages`/`mergeHybrid` with the canonical versions; retry/upgrade decisions use `missingRequired(document, docType)`. `fixSwappedParties` operates on the document (swap `issuer`/`recipient` when `issuer.vat === ownAfm`); keep `qualityScore` working by feeding it `toLegacy(document)`. Ensure the fallback model path (`model-fallback.ts`) and Gemini native PDF path go through the same coercion.
- [ ] **Step 4:** `npx vitest run lib/ocr` green; `npx tsc --noEmit` clean. **Commit** `feat(ocr): base OCR extracts the canonical document; page/hybrid merges on the document`.

---

### Task 4: Routes write through `saveDocumentJson`

**Files:** Modify `app/api/admin/ocr/route.ts`, `app/api/admin/ocr/[id]/reextract/route.ts`, `app/api/admin/ocr/[id]/route.ts`; create `app/api/admin/ocr/[id]/document/route.ts`; tests in `lib/ocr/__tests__/queue-routes.test.ts` style (new file `lib/ocr/__tests__/document-routes.test.ts`).

- [ ] Upload + reextract: replace the inline `extractedData`/items/`issuerAfm` writes with `saveDocumentJson(doc.id, result.document, { replaceItems: true })` (keep status/model/tokens/rawText/thumbnail/classification/template-run hooks exactly as they are, in the same order).
- [ ] PATCH `[id]`: accept EITHER `document` (validated with `DocumentSchema`, then `normalizeDocument`) OR the legacy `{extractedData, items}`; legacy → `mergeLegacyPatch(await loadDocumentJson(id), extractedData, items)`. Both end in `saveDocumentJson(id, document, { replaceItems: true })`. The series/category/docType branches stay as they are (they were fixed in `fe09362`).
- [ ] `GET /api/admin/ocr/[id]/document` → `{ template, version: 3, extractedAt, file, documentId, document }` (envelope; `template` = slug of the latest non-FAILED run or null); `?download=1` sets `Content-Disposition: attachment; filename="<originalName>.json"`. Permission: same as reading a document.
- [ ] Tests: upload path calls `saveDocumentJson` with the pipeline document; PATCH with `document` validates (422 on schema error) and saves; PATCH legacy merges without wiping `digital.mark`; GET returns the envelope with `version: 3`.
- [ ] **Commit** `feat(ocr): all document writes go through saveDocumentJson; GET document JSON`.

---

### Task 5: Templates map to canonical paths

**Files:** Modify `lib/templates/schema.ts`, `mapping.ts`, `run-logic.ts`, `run.ts`, `output.ts`, `run-dto.ts`/`run-view.ts` if they touch `values` shapes, `app/api/admin/templates/[id]/mappings/**` validation (search for `invoiceKeyInfo`), `components/templates/mapping-step.tsx`; tests `lib/templates/__tests__/{schema,mapping,run-logic,run,output}.test.ts`.

- [ ] `schema.ts`: `DOCUMENT_SCHEMA = DOCUMENT_PATHS` (re-export type `DocumentKeyInfo = { key: path, label, valueType, isLine }`); `documentKeyInfo(key)` accepts canonical paths, `custom.<slug>` (TEXT), and legacy keys via `LEGACY_KEY_TO_PATH` (returns the info of the mapped path with `key` = canonical path). Keep `INVOICE_SCHEMA`/`invoiceKeyInfo` as deprecated aliases for one release (they now return canonical entries) so nothing else breaks.
- [ ] `mapping.ts`: `projectToDocument(values, rows: MappingRowInvoice[], existing: DocumentJson, fields: FieldDef[]) → DocumentJson`: header rows `setPath` (null/blank skipped, as today); `lines.*` rows rebuild `lines[]` from the first TABLE field (`custom` per line keeps unmapped table columns); **every SINGLE template field not present in any row goes to `custom[fieldKey]`** (spec: path OR custom — nothing is lost); `customFields.x` legacy rows → `custom.x`. Keep `projectToInvoice` as a thin wrapper `toLegacy(projectToDocument(values, rows, fromLegacy(existing)))` for the transition (delete if no caller remains).
- [ ] `run-logic.ts`: `setDocumentPath(document, path, value)`; `CROSS_CHECK_PATHS = { 'totals.total', 'totals.net', 'totals.vatAmount', 'type.number', 'date' }` with `baseOcrSnapshot(document)` storing those paths (flags shape unchanged: `flags.baseOcr` keys become paths); `itemsToRows(lines)` from `lines[]` (or delete in favour of `document.ts`). `crossCheckKeys` maps legacy invoiceKeys through `LEGACY_KEY_TO_PATH`.
- [ ] `run.ts`: load `document = await loadDocumentJson(doc.id)`; project; SET_FIELD rules → `setDocumentPath`; `saveDocumentJson(doc.id, projected, { replaceItems: tableMapped })`; persist `TemplateRun.output = toRunOutput({...}).` `rereadField`/`finalizeRunEdit` update the document via the same path and rewrite `output`.
- [ ] `output.ts`: `toRunOutput(input: { slug, version, file, documentId, createdAt, document }) → DocumentEnvelope` (`version: 3`). Routes `template-runs/[runId]` and `batches/[id]/template-json` return `run.output ?? toRunOutput(...)` (fallback for runs made before this plan).
- [ ] `mapping-step.tsx`: option labels from `DOCUMENT_SCHEMA`, grouped (Τύπος & ημερομηνία / Εκδότης / Παραλήπτης / Σύνολα / Γραμμές / Ψηφιακή σήμανση / Πληρωμή / Αναφορές / Χειρόγραφα / Custom) — a `<select>` with `<optgroup>` or the existing combobox with headers; legacy saved keys render as their canonical equivalent.
- [ ] Tests updated/added for each; `npx vitest run lib/templates` green; **Commit** `feat(templates): mappings target canonical document paths; runs persist the document envelope`.

---

### Task 6: Excel from the canonical document

**Files:** Modify `lib/templates/excel.ts`, `excel-server.ts`, `app/api/admin/ocr/[id]/template-excel/route.ts`, `app/api/admin/ocr/batches/[id]/template-excel/route.ts`; tests `lib/templates/__tests__/{excel,excel-server}.test.ts`.

- [ ] `SheetInput` gains `document: DocumentJson`. `buildSheets`: main sheet columns = `['Αρχείο', 'Τύπος', 'Σειρά', 'Αριθμός', 'Ημερομηνία', 'Εκδότης', 'ΑΦΜ εκδότη', 'Παραλήπτης', 'Καθαρή αξία', 'Έκπτωση', 'ΦΠΑ', 'Παρακράτηση', 'Επιβαρύνσεις', 'Σύνολο', 'Πληρωτέο', 'ΜΑΡΚ']` followed by the EXCEL-mapping columns (values resolved from template `values` as today) or, without a mapping, one column per SINGLE field, then one column per `custom.*` key present in the group. Lines sheet «… — Γραμμές»: `['Αρχείο', 'Α/Α', 'Κωδικός', 'Περιγραφή', 'Μονάδα', 'Ποσότητα', 'Τιμή μονάδας', 'Έκπτωση', 'Καθαρή αξία', 'ΦΠΑ %', 'ΦΠΑ', 'Σύνολο', ...custom line keys]` from `document.lines`. Third sheet «… — ΦΠΑ»: `['Αρχείο', 'Συντελεστής', 'Καθαρή αξία', 'ΦΠΑ']` from `vatBreakdown`. Numbers stay numbers (no `String()`), dates as ISO strings.
- [ ] `excel-server.ts`: `runsToSheetInputs` passes `document` (from `run.output?.document ?? loadDocumentJson`) — select `document` on the run's document relation; documents WITHOUT any run can be exported too: `documentsToSheetInputs(docs)` with `templateSlug: '_document'`, `templateName: 'Έγγραφα'`, `excelRows: null`, `fields: []`.
- [ ] `template-excel` route: when the document has no run, export the document alone (was 404). Batch route unchanged in API, includes template-less documents as the «Έγγραφα» sheet.
- [ ] Tests; **Commit** `feat(excel): sheets read the canonical document (header, lines, VAT)`.

---

### Task 7: SoftOne posting from the canonical document

**Files:** Create `lib/ocr/purdoc-payload.ts`, `lib/ocr/__tests__/purdoc-payload.test.ts`, `lib/ocr/__tests__/post-softone.test.ts`; modify `lib/ocr/post-softone.ts`, `lib/settings.ts`, `lib/softone.ts` (add `softoneGetData(object, key)` if absent), `app/api/admin/ocr/[id]/post-softone/route.ts`, `lib/templates/run.ts` (AUTO post path unchanged in shape).

- [ ] **Settings:** add to `SETTING_CATALOG` `{ key: 'softone.postingEnabled', label: 'Καταχώριση παραστατικών στο SoftOne', type: 'boolean', default: false, category: 'softone' (or the existing SoftOne category), description: 'Όσο είναι κλειστό, η καταχώριση κάνει μόνο προεπισκόπηση (dry-run).' }`.
- [ ] **Pure builder** `buildPurdocPayload(document, ctx)`, `ctx = { series: number; trdr: number; company?: number; lines: { rowIndex, mtrl?: number|null, expn?: number|null, isService?: boolean|null }[]; vatIdByRate: Record<number, number>; comments?: string }` →
```ts
{ OBJECT: 'PURDOC', KEY: '', DATA: {
  PURDOC: [{ SERIES, TRNDATE: 'YYYY-MM-DD', TRDR, FINCODE: document.type.number, COMMENTS, MYDATAMARK: document.digital.mark ?? undefined, MYDATAUID: document.digital.uid ?? undefined }],
  ITELINES: [{ LINENUM: 9000001+i, MTRL, QTY1, PRICE, DISC1PRC, VAT, COMMENTS: name }],   // lines with mtrl && !isService
  SRVLINES: [{ ... }],                                                                  // lines with mtrl && isService
  EXPANAL:  [{ LINENUM: 9000001+i, EXPN, VAT, EXPVAL: net }],                            // lines with expn
} }
```
Omit empty arrays. `postingBlockers(document, doc, ctx)` returns codes: `no_trader` (no `softoneTrdr`), `no_series` (no `softoneSeries`/`seriesSource`), `no_date`, `no_number`, `unmatched_lines` (any line without mtrl/expn), `no_vat_category` (a line `vatRate` with no id), `totals_mismatch` (lines net sum vs `totals.net` beyond 0.05 → blocker, not warning), `not_completed`, `no_category` (keep). Tests: full invoice → exact payload; expense-only invoice → only `EXPANAL`; blockers each triggered.
- [ ] **`postDocumentToSoftone(id, opts)`**: load doc (`status, category, softoneTrdr, softoneSeries, seriesSource, postStatus`), `document = loadDocumentJson`, item rows (mtrl/expn/isService), `VatCategory` rows → `vatIdByRate`; compute blockers → throw `PostError(code)` (extend the `code` union + `POST_ERROR_TEXT` Greek texts); build payload; **if `opts.dryRun` → return `{ payload, blockers: [] }` without touching SoftOne or the row**; if `await getSetting<boolean>('softone.postingEnabled') !== true` → throw `PostError('posting_disabled')` (`postStatus` untouched — the fake `OCR-xxxx` stub is REMOVED); else `softoneCall({ service: 'setData', ...payload })` → on `success` read back `getData PURDOC key=<id>` and verify `FINCODE`/`TRDR`; write `postStatus: POSTED, postedAt, postedRef: String(findoc), postError: null`; on failure `postStatus: FAILED, postError`. `syncTemplateRun` behaviour unchanged.
- [ ] Route: `GET /api/admin/ocr/[id]/post-softone?dryRun=1` → `{ payload, blockers, enabled }` (blockers as `{ code, message }[]`, never 500 for blockers); `POST` unchanged contract, new error codes mapped to 422 with Greek messages; when `posting_disabled` → 409 with message «Η καταχώριση είναι απενεργοποιημένη (Ρυθμίσεις → SoftOne)».
- [ ] `run.ts` AUTO path: `posting_disabled` becomes a `blocked` flag «καταχώριση απενεργοποιημένη» (run status BLOCKED, not FAILED).
- [ ] Tests with mocked `@/lib/softone` + `@/lib/settings`: dry-run never calls `softoneCall`; disabled → no call, no status change; enabled → setData + getData + POSTED; setData ok but read-back mismatch → FAILED with message.
- [ ] **Commit** `feat(softone): PURDOC payload from the canonical document; gated posting with read-back and dry-run`.

---

### Task 8: UI — document JSON card and posting preview

**Files:** Create `app/admin/ocr/[id]/document-json.tsx`; modify `app/admin/ocr/[id]/page.tsx` (+ `result-view.tsx` if the card slots there), `lib/openapi.ts`.

- [ ] Card «JSON εγγράφου» on `/admin/ocr/[id]` (client component, DG design system, `FiCode` icon): summary chips (kind, `type.label`, `type.series type.number`, date, issuer, totals.total, ΜΑΡΚ present/absent, lines count), collapsible pretty-printed JSON (`<pre>` with `overflow-x-auto`, max-height + scroll), buttons «Αντιγραφή» (clipboard, toast) and «Λήψη» (`/api/admin/ocr/[id]/document?download=1`). Loads via `GET /api/admin/ocr/[id]/document`; loading skeleton, error state with retry.
- [ ] Section «Καταχώριση στο SoftOne» inside the same card or next to the existing post button: fetch `?dryRun=1`; show blockers as a list with icon + Greek text; when none, show a compact table of the payload lines (κωδικός/είδος-έξοδο/ποσότητα/τιμή/ΦΠΑ) and header (σειρά, ημερομηνία, προμηθευτής, αριθμός); a «Προβολή payload» toggle with the raw JSON; the existing «Καταχώριση» button is disabled while blockers exist or `enabled === false` (tooltip «Απενεργοποιημένη στις Ρυθμίσεις»).
- [ ] `lib/openapi.ts`: replace the stale `OcrExtractedInvoice` schema with the canonical `document` (generate the JSON schema from `DocumentSchema` with zod's `toJSONSchema` if available in zod 4, else hand-write it).
- [ ] Verify in the browser (dev server from the worktree, `.claude/launch.json` config `dev-wt` with `--prefix` to the worktree; stop the master `dev` first): document page shows the card, dry-run shows blockers for a document without series/trader. Screenshot in the report.
- [ ] **Commit** `feat(ocr): document JSON card and SoftOne posting preview`.

---

### Task 9: Wiki, CHANGELOG, memory

- [ ] `npm run wiki:new -- ocr/document-json --roles "ADMIN,EMPLOYEE" --title "JSON εγγράφου"` → write Greek content: what the canonical JSON is, the sections (issuer/recipient/lines/totals/vatBreakdown/digital/payment/references/handwritten/custom), how templates fill paths, how Excel and SoftOne read it, dry-run vs real posting and the setting, `<Callout type="warning">` that posting is off by default. `helpAnchors: [document-json]`; add `helpAnchor="document-json"` where the card lives if a `PageHeader` exists on the doc page. Update `docs/wiki/ocr/template-runs.mdx` (mapping targets are now document paths; output JSON v3) and `ocr-overview` links. `npm run wiki:index`.
- [ ] CHANGELOG top section «2026-09-12 — Κανονικό JSON εγγράφου (plan 5)».
- [ ] **Commit** `docs: canonical document JSON wiki + changelog`.

---

### Task 10: Final review, backfill, smoke

- [ ] Full `npx vitest run`, `npx tsc --noEmit`, `npx next build`.
- [ ] Final code review subagent (read-only) over the branch diff vs master: spec §17.1 coverage, compatibility surface (every `extractedData` consumer still gets the keys it reads), no real SoftOne write path reachable without the setting, migration ↔ schema match.
- [ ] Run `scripts/backfill-canonical.ts --dry-run`, then for real (it only fills nulls and rewrites mapping keys; idempotent).
- [ ] Browser smoke on the worktree server: re-extract the Kapaline test document `cmtv73bzp0000std41ex2c627` (costs one Gemini call — acceptable), confirm `document` populated (JSON card), template run output v3, Excel download opens with 3 sheets, dry-run posting preview shows blockers/payload. Never enable `softone.postingEnabled`.
- [ ] Report to the controller; merge only when the user asks.
