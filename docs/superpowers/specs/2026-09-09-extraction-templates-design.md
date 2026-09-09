# Πρότυπα Εξαγωγής Προμηθευτή (Extraction Templates) · Design Spec

**Ημερομηνία:** 2026-09-09
**Κατάσταση:** Εγκεκριμένο design (brainstorming) → έτοιμο για implementation plan
**Reference:** `cloudzeus/damask` (`src/lib/tax/*`, `src/components/tax/*`, spec `2026-07-22-tax-form-templates-design.md`) — που ήταν port του παλιού `tax-templates` αυτού του repo. Εδώ το εργαλείο είναι **προμηθευτο-κεντρικό** και δένει με το υπάρχον OCR pipeline.

---

## 0. Πλαίσιο & κλειδωμένες αποφάσεις

Ο χρήστης επιλέγει **προμηθευτή**, ανεβάζει **εικόνα ή PDF** δείγματος, **σχεδιάζει περιοχές** με πληροφορία, ονομάζει το **πρότυπο** και τα **πεδία** προς εξαγωγή, κάνει **mapping** των πεδίων στα πεδία **παραστατικού** ή σε **στήλες Excel**, ορίζει **ένα ή περισσότερα conditions** πάνω στα εξαγόμενα πεδία, και βλέπει όλη τη ροή ως **διάγραμμα React Flow**.

Αποφάσεις (2026-09-09):
1. **Mapping target:** το σχήμα τιμολογίου της εφαρμογής (`extractedData` του `OcrDocument`: `invoiceNumber`, `issueDate`, `vatNumber`, σύνολα, `items[]`, `customFields`) **και** Excel (στήλες που ονομάζει ο χρήστης). Όχι απευθείας πεδία SoftOne — η ανάρτηση στο SoftOne μένει στο υπάρχον `post-softone`.
2. **Conditions:** ενέργειες όταν ισχύει ένας κανόνας: **set field**, **flag for review / block posting**, **switch mapping**, **notify**. Πολλοί κανόνες ανά πρότυπο, με σειρά.
3. **Λειτουργία (mode) ανά πρότυπο:** **auto** (εξαγωγή → mapping → conditions → ανάρτηση SoftOne χωρίς ανθρώπινη επέμβαση, εκτός αν κανόνας μπλοκάρει), **semi-auto** (εξαγωγή → mapping → conditions → «προς έλεγχο», ανάρτηση από χρήστη), **manual** (μόνο εξαγωγή, ο χρήστης κάνει τα υπόλοιπα).
4. **Trigger:** αυτόματα στο upload, όταν το ΑΦΜ εκδότη του σαρωμένου εγγράφου ταιριάζει με ενεργό πρότυπο του προμηθευτή (και τύπο εγγράφου). Επιπλέον χειροκίνητο «Εκτέλεση προτύπου» από τη λίστα OCR για re-processing / δοκιμή.
5. **React Flow:** **παραγόμενο, ζωντανό διάγραμμα** της ρύθμισης (όχι ελεύθερος node editor). Κλικ σε κόμβο → ανοίγει η αντίστοιχη φόρμα.
6. **Χρωματική κωδικοποίηση:** κάθε πεδίο έχει **δικό του χρώμα**. Το ίδιο χρώμα χρησιμοποιείται για την περιοχή του πάνω στην εικόνα/PDF, για την τιμή του στη λίστα αποτελεσμάτων και για τον κόμβο του στο διάγραμμα — τόσο στον designer όσο και στην προβολή αποτελέσματος κάθε εγγράφου.
7. **Ένα concept:** τα `SupplierFieldRule` (ειδικά πεδία) και `SupplierTemplate` (παραδείγματα προμηθευτή) **απορροφώνται** από το νέο πρότυπο. Migration script μεταφέρει τα υπάρχοντα field rules σε πεδία προτύπου (kind SINGLE/LINE, region από `regionHint`, `description` → `aiHint`). Οι παλιές σελίδες `/admin/ocr/field-rules` και `/admin/ocr/templates` αντικαθίστανται.

---

## 1. Μοντέλο δεδομένων

```prisma
enum TemplateMode      { AUTO SEMI_AUTO MANUAL }
enum TemplateStatus    { DRAFT ACTIVE }
enum TemplateFieldKind { SINGLE TABLE }
enum TemplateValueType { TEXT NUMBER CURRENCY DATE LIST }
enum MappingTarget     { INVOICE EXCEL }
enum ConditionAction   { SET_FIELD FLAG_REVIEW BLOCK_POSTING SWITCH_MAPPING NOTIFY }
enum TemplateRunStatus { EXTRACTED REVIEW BLOCKED POSTED FAILED }

model ExtractionTemplate {
  id             String          @id @default(cuid())
  name           String
  vatNumber      String                       // ΑΦΜ προμηθευτή (9 ψηφία, normalized)
  traderTrdr     Int?                         // → SoftoneTrader.trdr (προαιρετικό link)
  supplierName   String?                      // denormalized για λίστες
  docType        OcrDocType     @default(INVOICE)
  mode           TemplateMode   @default(SEMI_AUTO)
  status         TemplateStatus @default(DRAFT)
  version        Int            @default(1)
  sampleStorageKey String?                    // Bunny (private) — δείγμα εικόνας/PDF
  sampleMimeType String?
  samplePageCount Int?
  sampleThumbUrl String?
  notifyEmails   String?                      // ";"-separated, για NOTIFY
  timesUsed      Int            @default(0)
  createdById    String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  fields         TemplateField[]
  mappings       TemplateMapping[]
  conditions     TemplateCondition[]
  runs           TemplateRun[]

  @@unique([vatNumber, docType, name])
  @@index([vatNumber, docType, status])
}

model TemplateField {
  id          String            @id @default(cuid())
  templateId  String
  template    ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  key         String                          // slug (auto από label), σταθερό
  label       String
  kind        TemplateFieldKind @default(SINGLE)
  valueType   TemplateValueType @default(TEXT)
  color       String                          // hex, μοναδικό μέσα στο πρότυπο (παλέτα 12 χρωμάτων)
  region      Json?                           // { page:number, bbox:[x,y,w,h] } normalized 0-1
  columns     Json?                           // TABLE → [{ key, label, valueType }]
  aiHint      String?         @db.Text        // οδηγία στο μοντέλο
  required    Boolean         @default(false)
  order       Int             @default(0)
  @@unique([templateId, key])
  @@index([templateId])
}

model TemplateMapping {
  id          String        @id @default(cuid())
  templateId  String
  template    ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  name        String        @default("default")   // >1 mappings ανά πρότυπο (για SWITCH_MAPPING)
  target      MappingTarget
  isDefault   Boolean       @default(true)
  rows        Json          // INVOICE: [{ fieldKey, invoiceKey }] — invoiceKey από INVOICE_SCHEMA (π.χ. "invoiceNumber", "items.quantity", "customFields.orderNo")
                            // EXCEL:   [{ fieldKey, column, order }]
  @@unique([templateId, name])
}

model TemplateCondition {
  id          String   @id @default(cuid())
  templateId  String
  template    ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  name        String
  order       Int      @default(0)
  isActive    Boolean  @default(true)
  logic       String   @default("AND")        // "AND" | "OR" για τις ρήτρες
  clauses     Json     // [{ fieldKey, op, value }] · op: eq, neq, gt, gte, lt, lte, contains, notContains, empty, notEmpty, regex, in
  actions     Json     // [{ type: ConditionAction, params }] · SET_FIELD {fieldKey|invoiceKey, value} · FLAG_REVIEW {reason} · BLOCK_POSTING {reason} · SWITCH_MAPPING {mappingName} · NOTIFY {emails?, subject}
  @@index([templateId, order])
}

model TemplateRun {
  id           String   @id @default(cuid())
  templateId   String
  template     ExtractionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  templateVersion Int
  documentId   String
  document     OcrDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  status       TemplateRunStatus
  values       Json     // { fieldKey: { raw, value, confidence, source: 'text'|'vision'|'manual', page, bbox, color } }
  matched      Json     // [{ conditionId, name, actions:[…] }]
  flags        Json?    // { review?: string[], blocked?: string[] }
  mappingName  String
  model        String?
  tokensUsed   Int?
  durationMs   Int?
  createdAt    DateTime @default(now())
  @@index([documentId])
  @@index([templateId, createdAt])
}
```
`OcrDocument` παίρνει `templateRuns TemplateRun[]` και `reviewFlags Json?` (γρήγορη ανάγνωση στη λίστα). `SupplierFieldRule`/`SupplierTemplate` διαγράφονται μετά το migration script (ξεχωριστό βήμα στο plan, με backup).

Χρωματική παλέτα (σταθερή, 12 χρώματα προσβάσιμα σε λευκό): Sisyphus #0078D4, #047857, #C2410C, #6D28D9, #BE185D, #0F766E, #B45309, #1D4ED8, #7C2D12, #4D7C0F, #9F1239, #334155. Ανάθεση: πρώτο ελεύθερο χρώμα ανά πρότυπο· ο χρήστης μπορεί να αλλάξει.

---

## 2. Δομή αρχείων

```
lib/templates/
  schema.ts            ISOMORPHIC: types (Bbox, Region, FieldDef, MappingRow, Clause, Action), INVOICE_SCHEMA (λίστα invoiceKeys με label/valueType/isLine), COLOR_PALETTE, nextColor(), slugKey()
  coerce.ts            PURE: coerceValue(raw, valueType) — ελληνικά ποσά/ημερομηνίες/λίστες (επαναχρησιμοποιεί lib/greek-format.ts)
  conditions.ts        PURE: evaluate(clauses, logic, values) → boolean · applyActions(actions, ctx) → { setFields, flags, mappingName, notifications }
  mapping.ts           PURE: projectToInvoice(values, rows) → partial extractedData (deep merge, items columns) · projectToExcel(values, rows) → { columns, row }
  flow.ts              PURE: buildFlow(template, run?) → { nodes, edges } για React Flow (χρώματα πεδίων, true/false edges, live status από run)
  extract.ts           SERVER: extractTemplateFields(doc buffer, template) → values. Digital PDF → textInBox (lib/ocr/region-text) πρώτα· scanned/εικόνα → cropRegionToImage (lib/ocr/rasterize) → vision μέσω lib/ocr/model-fallback + logAiUsage. TABLE → scan-table prompt με columns.
  run.ts               SERVER: runTemplateOnDocument(docId, template, {trigger}) → TemplateRun: extract → coerce → conditions → mapping → write extractedData/customFields/flags → mode handling (AUTO: κλήση post-softone εκτός αν blocked/required missing) → NOTIFY (lib/mailgun)
  migrate-field-rules.ts SERVER (one-off script): SupplierFieldRule → ExtractionTemplate/TemplateField ανά (ΑΦΜ, docType)
app/api/admin/ocr/templates/
  route.ts                    GET λίστα, POST create
  [id]/route.ts               GET full, PATCH meta (name/mode/status/notifyEmails), DELETE
  [id]/sample/route.ts        POST upload δείγματος (Bunny private) → pageCount/thumb
  [id]/page-image/route.ts    GET rasterized σελίδα δείγματος (webp) — όπως το υπάρχον ocr/[id]/page-image
  [id]/fields/route.ts        PUT bulk upsert πεδίων (με χρώματα/regions)
  [id]/test-field/route.ts    POST { fieldKey } → crop+read → { raw, value, source, model }
  [id]/mappings/route.ts      PUT bulk
  [id]/conditions/route.ts    PUT bulk
  [id]/run/route.ts           POST { documentId } → χειροκίνητη εκτέλεση
app/api/admin/ocr/[id]/template-run/route.ts   GET τελευταίο run εγγράφου (τιμές+χρώματα) · POST re-run
app/api/admin/ocr/[id]/excel/route.ts          GET Excel του εγγράφου από το mapping (exceljs)
app/api/admin/ocr/batches/[id]/excel/route.ts  GET Excel φακέλου (μία γραμμή/έγγραφο)
app/admin/ocr/templates/
  page.tsx                    λίστα (DataTable): όνομα, προμηθευτής, τύπος, mode badge, status, πεδία, χρήσεις
  [id]/page.tsx               designer (server: load template → <TemplateDesigner/>)
components/templates/
  template-designer.tsx       wrapper: stepper (Προμηθευτής · Δείγμα · Περιοχές & Πεδία · Mapping · Conditions & Mode) + δεξιά <FlowPanel/>
  supplier-step.tsx           combobox αναζήτησης SoftoneTrader (sodtype 12/16) + ΑΦΜ, docType
  sample-step.tsx             upload εικόνας/PDF, thumb, σελίδες
  regions-step.tsx            RegionMarker (υπάρχον components/ui/region-marker) + λίστα πεδίων με χρωματιστά chips, φόρμα πεδίου, «Δοκιμή πεδίου» (δείχνει τιμή + crop)
  mapping-step.tsx            grid fieldKey → invoiceKey (select από INVOICE_SCHEMA) / στήλες Excel (όνομα, σειρά)· πολλαπλά mappings
  conditions-step.tsx         λίστα κανόνων: ρήτρες (field/op/value), AND/OR, ενέργειες· mode + notifyEmails
  flow-panel.tsx              React Flow (@xyflow/react) read-only με custom nodes (sample, field[color], condition, mapping, output)· κλικ → onFocusNode
  run-result.tsx              προβολή αποτελέσματος εγγράφου: σελίδα με χρωματιστές περιοχές (RegionMarker savedRegions με color) + λίστα «πεδίο → τιμή» με swatch, flags, matched conditions, κουμπιά «Επανεκτέλεση», «Excel», «Έγκριση/Ανάρτηση» (semi-auto)
```

Ενσωμάτωση στις υπάρχουσες σελίδες:
- `app/admin/ocr/[id]/page.tsx`: νέο block «Πρότυπο προμηθευτή» → `<RunResult/>` όταν υπάρχει run.
- `app/admin/ocr/ocr-table.tsx`: στήλη/σήμα mode+status του run (χρωματιστό badge), row action «Εκτέλεση προτύπου».
- `app/api/admin/ocr/route.ts` (upload): μετά το `extractDocument` και το supplier match → `runTemplateOnDocument` αν βρεθεί ACTIVE πρότυπο για (ΑΦΜ, docType). Αποτυχία προτύπου = non-fatal (το έγγραφο μένει COMPLETED, run FAILED).
- Sidebar «Δεδομένα»: «Πρότυπα προμηθευτών» → `/admin/ocr/templates` (αντικαθιστά «Ειδικά πεδία»).

---

## 3. Ροές

### 3α. Σχεδίαση προτύπου
1. `/admin/ocr/templates` → «Νέο πρότυπο»: επιλογή προμηθευτή (combobox, από SoftoneTrader) → ΑΦΜ/όνομα προσυμπληρώνονται, τύπος εγγράφου, όνομα → DRAFT.
2. Δείγμα: upload εικόνας/PDF → Bunny → pageCount/thumb.
3. Περιοχές & πεδία: ο χρήστης σχεδιάζει ορθογώνιο στη σελίδα → φόρμα πεδίου (label → auto key, kind, valueType, aiHint, required, χρώμα προεπιλεγμένο από παλέτα). Για TABLE ορίζει στήλες. Κάθε αποθηκευμένη περιοχή ζωγραφίζεται με το χρώμα του πεδίου, με ετικέτα. «Δοκιμή πεδίου» → crop → ανάγνωση → εμφάνιση raw + coerced τιμής + crop thumbnail με το ίδιο χρώμα.
4. Mapping: για κάθε πεδίο επιλογή invoiceKey (ή στήλης Excel). Πεδία TABLE χαρτογραφούν στήλες → `items.*`. Δυνατότητα δεύτερου mapping (π.χ. «πιστωτικό»).
5. Conditions & mode: κανόνες με ρήτρες/ενέργειες, mode AUTO/SEMI/MANUAL, emails ειδοποίησης. Ενεργοποίηση (ACTIVE) όταν υπάρχει ≥1 πεδίο με περιοχή και mapping.
6. Το FlowPanel ενημερώνεται σε κάθε αποθήκευση: Δείγμα → [Πεδία (χρωματιστά)] → [Conditions] → [Mapping(s)] → Έξοδος (Παραστατικό / Excel / SoftOne ανάλογα με mode).

### 3β. Εκτέλεση στο upload
1. `extractDocument` (υπάρχον) → ΑΦΜ εκδότη.
2. Εύρεση ACTIVE προτύπου (ΑΦΜ, docType). Αν κανένα → τέλος (τίποτα δεν αλλάζει).
3. `runTemplateOnDocument`: ανά πεδίο → τιμή (text layer ή crop+vision) → coerce → `values` με χρώμα/περιοχή.
4. Conditions με σειρά· ενέργειες συσσωρεύονται (SET_FIELD γράφει σε values ή invoiceKey, FLAG_REVIEW/BLOCK_POSTING σε flags, SWITCH_MAPPING επιλέγει mapping, NOTIFY στέλνει email με σύνοψη + link).
5. Mapping → deep merge στο `extractedData` (χωρίς να σβήνει ό,τι δεν χαρτογραφείται)· TABLE → αντικαθιστά/συμπληρώνει `items[]` και τα `OcrInvoiceItem`.
6. Mode: MANUAL → run EXTRACTED, τέλος. SEMI_AUTO → run REVIEW, έγγραφο σε «Προς έλεγχο» με flags. AUTO → αν flags.blocked ή required λείπουν → BLOCKED (+review), αλλιώς κλήση της υπάρχουσας λογικής `post-softone` → POSTED (ή FAILED με λόγο).
7. Κάθε run αποθηκεύεται (audit, κόστος, διάρκεια). `timesUsed++`.

### 3γ. Προβολή αποτελέσματος (κάθε έγγραφο)
- Σελίδα εγγράφου: εικόνα/PDF με τις περιοχές σε **διαφορετικό χρώμα ανά πεδίο**, δίπλα λίστα «χρώμα · πεδίο · τιμή (raw → coerced) · πηγή». Hover σε τιμή → highlight περιοχής και αντίστροφα. Flags και ποιοι κανόνες ταίριαξαν. Ενέργειες: επεξεργασία τιμής (source manual), Επανεκτέλεση, Excel, Έγκριση → ανάρτηση (semi-auto).

### 3δ. Excel
- Ανά έγγραφο: μία γραμμή με τις στήλες του EXCEL mapping. Ανά φάκελο (batch): μία γραμμή ανά έγγραφο, μόνο έγγραφα με run. Με exceljs (υπάρχει). TABLE πεδία → sheet «Γραμμές».

---

## 4. Conditions — σημασιολογία
- Ρήτρα: `{ fieldKey, op, value }`. Σύγκριση με βάση το valueType του πεδίου (NUMBER/CURRENCY αριθμητικά, DATE ημερολογιακά, TEXT case-insensitive, LIST → contains/in). Πεδίο χωρίς τιμή → `empty` true, όλα τα άλλα false.
- Κανόνας: `logic` AND/OR πάνω στις ρήτρες. Κανόνες αξιολογούνται με σειρά· όλοι όσοι ισχύουν εφαρμόζουν ενέργειες (όχι first-match), εκτός SWITCH_MAPPING όπου νικά ο τελευταίος.
- `SET_FIELD` μπορεί να αναφέρεται σε fieldKey (πριν το mapping) ή invoiceKey (μετά).
- Ειδικές μεταβλητές διαθέσιμες στις ρήτρες: `$total` (σύνολο τιμολογίου από το βασικό OCR), `$itemsCount`, `$pageCount`.

---

## 5. UI (DG design system)
- Designer: αριστερά stepper (5 βήματα, κατακόρυφος στο desktop), κέντρο η φόρμα του βήματος, δεξιά sticky FlowPanel (πλάτος 360px, πτυσσόμενο). Καμβάς περιοχών σε κάρτα λευκή πάνω σε neutral-8 canvas· περιοχές με 2px περίγραμμα στο χρώμα πεδίου και 12% γέμισμα· ετικέτα με το label.
- Λίστα πεδίων: chip χρώματος + label + key + kind badge + «Δοκιμή» + drag reorder (dnd-kit υπάρχει).
- Flow nodes: κάρτα 8px radius, shadow-fluent-2· field node με αριστερή χρωματιστή μπάρα· condition node ρόμβος-στυλ με true (πράσινη) / false (γκρι) ακμές· output node με εικονίδιο SoftOne/Excel· live status badges από το τελευταίο run.
- Όλα Ελληνικά, fluid type tokens, touch targets ≥44px στα mobile βήματα.

---

## 6. Ασφάλεια, κόστος, αποτυχίες
- Permissions: `ocr.categorize` για διαχείριση προτύπων και χειροκίνητη εκτέλεση· `ocr.post` απαιτείται για AUTO mode (το πρότυπο δεν μπορεί να γίνει ACTIVE με AUTO από χρήστη χωρίς `ocr.post`).
- Δείγματα σε private Bunny· page-image μόνο μέσω authenticated route.
- Κόστος: κάθε vision κλήση περνά από `logAiUsage` (scope OCR_VISION, refType template/run). Digital PDFs αποφεύγουν το μοντέλο.
- Αποτυχία προτύπου ποτέ δεν σπάει το βασικό OCR (try/catch → run FAILED, έγγραφο COMPLETED, σήμα στη λίστα).
- NOTIFY: Mailgun, throttling 1 email/έγγραφο/κανόνα.

---

## 7. Migration & συμβατότητα
- Script `scripts/migrate-field-rules.ts`: για κάθε (vatNumber, docType) με ενεργά `SupplierFieldRule` → ExtractionTemplate «Μεταφερμένο από ειδικά πεδία» (DRAFT, MANUAL) με TemplateField ανά rule (scope line → TABLE με μία στήλη). `SupplierTemplate.example` δεν μεταφέρεται (ήταν few-shot παράδειγμα)· αναφέρεται στο changelog.
- Μετά την επαλήθευση: migration που διαγράφει `SupplierFieldRule`/`SupplierTemplate` και τον κώδικα `lib/ocr/field-rules.ts`, `templates-store.ts`, τις σελίδες τους και τα API τους. Το `extractDocument` παύει να καλεί field rules / template pass.

---

## 8. Testing (TDD, vitest)
- Pure: `coerceValue` (ελληνικά ποσά «1.234,56», ημερομηνίες dd/mm/yyyy, λίστες), `conditions.evaluate`/`applyActions` (ops, AND/OR, σειρά, SWITCH_MAPPING last-wins, empty semantics), `mapping.projectToInvoice` (deep merge, items columns, customFields) / `projectToExcel`, `flow.buildFlow` (nodes/edges/χρώματα/live status), `nextColor`, `slugKey`.
- Server με mocks: `extractTemplateFields` (text-layer path vs vision path, TABLE), `runTemplateOnDocument` (modes, blocked, non-fatal), migration script (fixture rules → templates).
- Χειροκίνητο e2e checklist στο wiki: σχεδίαση → δοκιμή πεδίου → ενεργοποίηση → upload τιμολογίου προμηθευτή → αποτέλεσμα με χρώματα → Excel → ανάρτηση.

---

## 9. Εκτός scope (v1)
- Ελεύθερος node editor στο React Flow (μόνο παραγόμενο διάγραμμα).
- Πρότυπα για πελάτες/έσοδα (μόνο προμηθευτές, αγορές).
- Αυτόματη μάθηση περιοχών από διορθώσεις.
- Πολυσέλιδα TABLE που εκτείνονται σε >1 σελίδα.

---

## 10. Definition of Done
- Models + migration· migration script για τα field rules· παλιές σελίδες/API αντικατεστημένα.
- Designer με 5 βήματα, χρωματιστές περιοχές, «Δοκιμή πεδίου», mapping (παραστατικό + Excel), conditions με 4 τύπους ενεργειών, mode AUTO/SEMI/MANUAL, React Flow διάγραμμα που ενημερώνεται ζωντανά.
- Εκτέλεση στο upload + χειροκίνητη· προβολή αποτελέσματος με χρώματα ανά πεδίο· Excel ανά έγγραφο/φάκελο· AUTO ανάρτηση μέσω υπάρχοντος post-softone με σεβασμό σε block/required.
- Wiki (Ελληνικά, helpAnchor), tests πράσινα, `tsc` clean, DG design system.

---

## 11. Εκπαίδευση με πολλά δείγματα (training) — προσθήκη 2026-09-09

Ο χρήστης ανεβάζει **πολλά δείγματα** του ίδιου προμηθευτή μέχρι το πρότυπο να διαβάζει **με βεβαιότητα**.

- Μοντέλο `TemplateSample`: ένα δείγμα ανά αρχείο (Bunny private), `expected` JSON (τιμές που επιβεβαίωσε ο χρήστης ανά fieldKey), `lastResult` JSON (τελευταία αυτόματη ανάγνωση ανά fieldKey: raw/value/source/match), `status` PENDING | READ | VERIFIED, `pageCount`.
- Το «κύριο δείγμα» (`ExtractionTemplate.sampleStorageKey`) είναι αυτό πάνω στο οποίο σχεδιάζονται οι περιοχές. Τα υπόλοιπα δείγματα χρησιμεύουν για **δοκιμή/επιβεβαίωση**.
- Ροή: «Εκπαίδευση» tab στον designer → drop πολλών αρχείων → κάθε δείγμα διαβάζεται με τις τρέχουσες περιοχές → πίνακας «δείγμα × πεδίο» με τις τιμές (χρωματισμένες ανά πεδίο) → ο χρήστης διορθώνει/επιβεβαιώνει (γίνεται `expected`) → **βαθμός βεβαιότητας ανά πεδίο** = ποσοστό δειγμάτων όπου η αυτόματη τιμή == expected (normalized), και συνολικός βαθμός προτύπου. Το πρότυπο μπορεί να γίνει ACTIVE μόνο αν ο συνολικός βαθμός ≥ 90% σε ≥ 3 επιβεβαιωμένα δείγματα (ρυθμιζόμενο, `template.minTrainingScore`).
- Όταν μια περιοχή ή hint αλλάζει, «Επανάληψη ανάγνωσης» ξανατρέχει όλα τα δείγματα και ενημερώνει τους βαθμούς. Το διάγραμμα δείχνει τον βαθμό σε κάθε κόμβο πεδίου.

## 12. Εργασίες μαζικής σάρωσης (jobs) — προσθήκη 2026-09-09

Από τη λίστα προτύπων (row action «Σάρωση αρχείων») ή από τη σελίδα του προτύπου: ο χρήστης **επιλέγει πρότυπο**, κάνει **drag & drop πολλών αρχείων** (εικόνες/PDF). Τα αρχεία ανεβαίνουν στο Bunny και η εφαρμογή τα σαρώνει **ένα-ένα**.

- Μοντέλο `TemplateJob`: `id` (το «id εργασίας» που βλέπει ο χρήστης), `templateId`, `templateVersion`, `status` QUEUED | RUNNING | DONE | FAILED | CANCELLED, `total`, `done`, `failed`, `createdById`, `startedAt`, `finishedAt`.
- Μοντέλο `TemplateJobItem`: `jobId`, `order`, `fileName`, `storageKey`, `mimeType`, `size`, `status` QUEUED | RUNNING | DONE | FAILED, `values` JSON (ανά fieldKey, όπως TemplateRun.values, με χρώματα), `matched`/`flags`, `model`, `tokensUsed`, `durationMs`, `error`, προαιρετικά `documentId` (αν το αρχείο μπήκε και στο OCR ως OcrDocument — v1: **όχι**, τα jobs είναι ανεξάρτητα από τη λίστα OCR).
- Επεξεργασία: worker loop μέσα στον ίδιο server (`lib/templates/jobs.ts::processJob`), σειριακά ανά job, ένα job τη φορά ανά instance (claim με `UPDATE … WHERE status='QUEUED' … LIMIT 1`), επανεκκίνηση: items RUNNING > 10 λεπτά επιστρέφουν σε QUEUED. Κάθε item: download → `extractTemplateFields` → conditions → αποθήκευση.
- UI: σελίδα `/admin/ocr/templates/jobs` (λίστα εργασιών: id, πρότυπο, πρόοδος done/total, κατάσταση, ημερομηνία) και `/admin/ocr/templates/jobs/[id]` (πρόοδος ζωντανά με polling 2s, πίνακας αρχείων × πεδία με χρωματιστές τιμές, κλικ σε γραμμή → προβολή σελίδας με περιοχές, Excel εξαγωγή όλου του job, ακύρωση).
- Τα αποτελέσματα μένουν αποθηκευμένα (audit) και εξάγονται σε Excel μέσω του EXCEL mapping του προτύπου (ή, αν δεν υπάρχει, μία στήλη ανά πεδίο).
