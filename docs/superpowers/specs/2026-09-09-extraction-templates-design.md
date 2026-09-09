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

## 13. Σημειώσεις από review (2026-09-10)
- **Διαγραφή προτύπου με ιστορικό:** το DELETE αρνείται (409) όταν υπάρχουν `TemplateRun` ή `TemplateJob`. Το πρότυπο μπορεί να γίνει DRAFT/ανενεργό αντί να διαγραφεί, ώστε να μη χαθεί audit/κόστος. (plan 3)
- **Ακύρωση job:** τα items που είναι ακόμη QUEUED μένουν QUEUED· ο worker ελέγχει `job.status` πριν πάρει item και σταματά σε CANCELLED. Η λίστα δείχνει «ακυρώθηκε (Ν εκκρεμή)». (plan 4)

---

## 14. Αναθεώρηση 2026-09-09 (βράδυ): ανεξάρτητα πρότυπα, auto-slug, ανίχνευση πεδίων, JSON

Αφορμή: ο χρήστης θέλει πρότυπα και για **ειδικά έγγραφα εκτός SoftOne** (π.χ. έντυπο service συνεργείου με χιλιόμετρα, φόρμα εκκαθάρισης εξόδων), συχνά **κακοτραβηγμένες φωτογραφίες**. Ροή: «χαρτογραφούμε το έντυπο και τα πεδία, ανεβάζουμε φωτογραφίες για εκπαίδευση, μετά ξέρει τι ψάχνει σε κάθε αρχείο· βγαίνει ένα **JSON με key/values** για κάθε χρήση». Και: «**πρώτα** δημιουργούμε το πρότυπο και **μετά, αν θέλουμε**, το συσχετίζουμε με προμηθευτή ή τμήμα». Όπως στο damask: μαρκάρουμε περιοχή → αναγνωρίζει το **όνομα του πεδίου** και παράγει **slug**· και το **έντυπο** έχει δικό του **slug**.

Δείγμα πελάτη: `~/Downloads/SKM_C25826071716430.pdf` (31 σελίδες, 26 εκδότες). Ο λογιστής έχει **κυκλώσει** σε κάθε έντυπο τι θέλει να βρίσκουμε (αριθμός, ημερομηνία, ΑΦΜ, σύνολα) και έχει γράψει **χειρόγραφα το λογιστικό άρθρο** (π.χ. `60.64.00.000.010`) και επιμερισμούς. Δεν μπαίνει στο repo (δεδομένα πελάτη).

### 14.1 Αποφάσεις

1. **Το πρότυπο είναι ανεξάρτητο.** Δημιουργείται μόνο με **όνομα**. Το **slug** παράγεται αυτόματα (`slugKey(name)`, μοναδικό — αν υπάρχει, `_2`, `_3`…), φαίνεται στον διάλογο και μπορεί να διορθωθεί από τον χρήστη. Αλλάζει μόνο όσο το πρότυπο **δεν έχει εκτελέσεις** (`runs = 0`) — το slug είναι το κλειδί του JSON εξόδου.
2. **Συσχέτιση προαιρετική**, στο βήμα «Στοιχεία»: **προμηθευτής SoftOne** (`traderTrdr`, `vatNumber`, `supplierName`, με καθαρισμό) και **τμήμα/κατηγορία** (`department`, ελεύθερο κείμενο, π.χ. «Συνεργείο», «Λογιστήριο»). Το ΑΦΜ είναι προαιρετικό (9 ψηφία όταν δίνεται). Πρότυπο **με** ΑΦΜ εφαρμόζεται αυτόματα στο upload όταν ταιριάζει το ΑΦΜ εκδότη (plan 3)· πρότυπο **χωρίς** ΑΦΜ εκτελείται μόνο επιλεγμένο (χειροκίνητα ή σε job).
3. **Ο «τύπος εγγράφου» (Τιμολόγιο/Απόδειξη) καταργείται** από το μοντέλο και το UI. Μοναδικότητα: `slug`.
4. **Προεπιλεγμένη λειτουργία `MANUAL`** («μόνο εξαγωγή → JSON»). Η ενεργοποίηση απαιτεί δείγμα και ≥1 πεδίο με περιοχή. Mapping απαιτείται **μόνο** για `SEMI_AUTO`/`AUTO` (που αναρτούν στο SoftOne). Το βήμα «Mapping» σημαίνεται «προαιρετικό».
5. **Έξοδος JSON** (ίδιο σχήμα παντού — δοκιμή, runs plan 3, jobs plan 4):
   ```json
   { "template": "<slug>", "version": 3, "extractedAt": "2026-09-09T18:00:00.000Z",
     "values": { "arithmos_paraστatikou": "309", "imerominia": "2026-06-30", "lines": [ { "eidos": "…", "poso": 185 } ] } }
   ```
   `values[key]` = η **coerced** τιμή (`FieldValue.value`). Στον designer: κουμπί **«Δοκιμή προτύπου»** διαβάζει όλα τα πεδία με περιοχή από το δείγμα και δείχνει το JSON (αντιγραφή/λήψη).
6. **Νέο πεδίο από περιοχή** (damask): ο χρήστης πατά «Πεδίο από περιοχή» και σύρει πλαίσιο **χωρίς** να έχει φτιάξει πεδίο. Το μοντέλο διαβάζει το crop και επιστρέφει `{ label, value, kind, valueType, columns? }`. Δημιουργείται πεδίο (unsaved) με `label`, `key = slugKey(label)` (μοναδικό), `valueType` (από το μοντέλο, με έλεγχο `guessValueType(value)`), επόμενο χρώμα, η περιοχή, και η τιμή εμφανίζεται ως αποτέλεσμα δοκιμής. Αν το μοντέλο δεν βρει ετικέτα: «Πεδίο N». Αν είναι επικεφαλίδα/πίνακας: `kind TABLE` με στήλες (label → key).
7. **Ανίχνευση σημειώσεων** (νέο, από το δείγμα του πελάτη): κουμπί «Ανίχνευση σημειώσεων» στέλνει **όλη τη σελίδα** στο μοντέλο και ζητά τις **κυκλωμένες/σημειωμένες** περιοχές ως `{ label, value, bbox }` (bbox normalized 0–1). Προτείνονται πεδία (unsaved, με περιοχές και χρώματα) που ο χρήστης κρατά ή σβήνει πριν αποθηκεύσει. Χειρόγραφος **λογιστικός κωδικός** (μοτίβο `\d{2}(\.\d{2,3})+`) προτείνεται ως πεδίο «Λογιστικό άρθρο (χειρόγραφο)» / key `gl_account_handwritten`. Δεν ζωγραφίζει τίποτα μόνο του στη βάση — μόνο πρόταση.
8. **Χωρίς αυτόματη αντιστοίχιση σε SoftOne** για γενικά έγγραφα (εκτός scope· μένουν στο MANUAL). Το «τμήμα» είναι ετικέτα οργάνωσης, όχι λογική.

### 14.2 Μοντέλο (migration `20260910110000_template_standalone`)

```prisma
model ExtractionTemplate {
  id           String   @id @default(cuid())
  name         String
  slug         String   @unique           // auto από name, κλειδί JSON εξόδου
  department   String?                    // τμήμα/κατηγορία (ελεύθερο)
  vatNumber    String?                    // ΑΦΜ προμηθευτή — προαιρετικό
  traderTrdr   Int?
  supplierName String?
  mode         TemplateMode   @default(MANUAL)
  // … υπόλοιπα ως έχουν, ΧΩΡΙΣ docType
  @@index([vatNumber, status])
}
```
SQL: `ADD COLUMN slug`, backfill `lower(regexp_replace(name,'[^a-zA-Z0-9]+','_','g')) || '_' || left(id,6)` (λατινικό μόνο — τα ελληνικά ονόματα των λίγων δοκιμαστικών γραμμών παίρνουν `_<id>`), `SET NOT NULL`, unique index· `DROP` unique `(vatNumber, docType, name)` και index `(vatNumber, docType, status)`· `DROP COLUMN "docType"`; `ALTER vatNumber DROP NOT NULL`; `ADD department`; `ALTER mode SET DEFAULT 'MANUAL'`; `CREATE INDEX (vatNumber, status)`. Το enum `OcrDocType` μένει (το χρησιμοποιεί το `OcrDocument`).
Bunny key δείγματος: `templates/<id>/sample-<nanoid>.<ext>` (χωρίς ΑΦΜ).

### 14.3 API

| Endpoint | Αλλαγή |
|---|---|
| `POST /api/admin/ocr/templates` | body `{ name, slug?, department?, vatNumber?, traderTrdr?, supplierName? }`. Χωρίς `slug` → `slugKey(name)` + μοναδικοποίηση. Με `slug` που υπάρχει → 409 `duplicate_slug`. |
| `GET /api/admin/ocr/templates` | επιστρέφει `slug`, `department`; χωρίς `docType`. |
| `PATCH …/[id]` | δέχεται `slug` (μόνο αν `runs = 0`, αλλιώς 409 `slug_locked`), `department`, `vatNumber` (null ή 9 ψηφία), `traderTrdr`, `supplierName`. `status: ACTIVE` → απαιτεί δείγμα + πεδίο με περιοχή· mapping μόνο αν `mode ≠ MANUAL`. |
| `POST …/[id]/detect-field` | body `{ region }` → `{ label, key, kind, valueType, value, columns, model, tokensUsed, durationMs }`. Χρειάζεται δείγμα. |
| `POST …/[id]/detect-marks` | body `{ page }` → `{ marks: [{ label, key, valueType, value, bbox }], model, tokensUsed, durationMs }`. Έως 20 σημειώσεις, bbox έγκυρα (`isValidBbox`), keys μοναδικά μεταξύ τους **και** ως προς τα υπάρχοντα πεδία του προτύπου. |
| `POST …/[id]/test` | body `{}` → `{ template, version, extractedAt, values, fields: { key: FieldValue }, model, tokensUsed, durationMs, errors }`. Διαβάζει όλα τα αποθηκευμένα πεδία με περιοχή. |

Όλα με `requirePermission('ocr.categorize')`, `UsageRef { refType: 'ExtractionTemplate', refId }`.

### 14.4 lib

- `lib/templates/schema.ts`: `uniqueKey(base, taken: Iterable<string>)` (→ `base`, `base_2`, …), `templateSlug(name) = slugKey(name)`.
- `lib/templates/guess.ts` (ISOMORPHIC, tests): `guessValueType(raw: string): TemplateValueType` — ημερομηνία (`dd/mm/yyyy`, `dd.mm.yyyy`, `yyyy-mm-dd`) → `DATE`; ποσό με `€`/`EUR`/δεκαδικά `,dd` → `CURRENCY`; μόνο ψηφία/διαχωριστικά → `NUMBER`; αλλιώς `TEXT`. `isGlAccount(raw)` για το μοτίβο `\d{2}(\.\d{2,3}){2,}`.
- `lib/templates/output.ts` (ISOMORPHIC, tests): `toOutputJson({ slug, version }, values: Record<string, FieldValue>, at = new Date())`.
- `lib/templates/detect.ts` (SERVER): `detectFieldFromCrop(crop, ref)` και `detectMarksOnPage(pageBuf, ref)` πάνω στο `callVision` του `vision.ts` (εξάγεται ως `callVisionJson`)· καθαροί parsers `parseDetectField(content)` / `parseMarks(content)` σε `lib/templates/detect-parse.ts` (ISOMORPHIC, tests) με ανοχή σε markdown fences, `box_2d` [ymin,xmin,ymax,xmax] 0–1000 **ή** `bbox` [x,y,w,h] 0–1.

### 14.5 UI (DG design system)

- **Διάλογος «Νέο πρότυπο»**: Όνομα, slug (live, επεξεργάσιμο, mono), Τμήμα/κατηγορία (προαιρετικό). Τίποτα άλλο. Μετά τη δημιουργία → designer βήμα «Δείγμα».
- **Βήμα 1 «Στοιχεία»** (αντικαθιστά «Προμηθευτής»): Όνομα, slug (κλειδωμένο όταν υπάρχουν runs, με εξήγηση), Τμήμα, **Προμηθευτής SoftOne** (αναζήτηση όπως στον παλιό διάλογο, με «Καθαρισμός»), ΑΦΜ (προαιρετικό). Readiness βήματος: όνομα.
- **Stepper**: Στοιχεία · Δείγμα · Περιοχές & πεδία · Mapping (προαιρετικό) · Conditions & λειτουργία. Readiness mapping: `mode === 'MANUAL' || mappings.length > 0`.
- **Περιοχές & πεδία**: κουμπιά «Πεδίο», **«Πεδίο από περιοχή»** (marking mode `NEW`, badge «Σύρε πλαίσιο — θα αναγνωριστεί το πεδίο»), **«Ανίχνευση σημειώσεων»** (spinner· προτεινόμενα πεδία μπαίνουν στη λίστα με ένδειξη «πρόταση» μέχρι την αποθήκευση), **«Δοκιμή προτύπου»** (dialog: JSON pretty, «Αντιγραφή», «Λήψη .json», ανά πεδίο η τιμή με το χρώμα του).
- **Λίστα**: τίτλος «Πρότυπα εξαγωγής», sidebar «Πρότυπα εξαγωγής». Στήλες: Πρότυπο (όνομα + slug mono), Τμήμα, Προμηθευτής (όνομα + ΑΦΜ ή «—»), Λειτουργία, Κατάσταση, Πεδία, Χρήσεις, Ενημ. Αναζήτηση σε όνομα/slug/τμήμα/προμηθευτή.
- **Wiki** `docs/wiki/ocr/templates.mdx` ξαναγράφεται με τη νέα ροή· CHANGELOG.

### 14.6 Σπορά προτύπων από PDF πελάτη (script, εκτός build)

`scripts/templates/seed-from-pdf.ts` (`npx tsx`, με το shim `server-only`): είσοδος **PDF** + **manifest JSON** `[{ name, pages: [1-based], rotate?: 90|180|270, department?, vatNumber?, supplierName?, extraPages?: [[…]] }]`. Για κάθε εγγραφή: κόβει τις σελίδες με `pdf-lib` (και περιστρέφει), δημιουργεί πρότυπο (slug αυτόματο), ανεβάζει το δείγμα στο Bunny (ίδιος κώδικας με το sample route → εξάγεται σε `lib/templates/sample.ts: storeSample(templateId, buffer)`), τρέχει `detectMarksOnPage` σε κάθε σελίδα και αποθηκεύει τα προτεινόμενα πεδία (με χρώματα από την παλέτα, ≤12). `extraPages` → επιπλέον `TemplateSample` (plan 4· προς το παρόν αποθηκεύονται μόνο ως αρχεία στο Bunny `templates/<id>/samples/`). Το manifest για το συγκεκριμένο PDF μένει **εκτός repo** (`.local/`, gitignored). Μετά τη σπορά ο χρήστης διορθώνει περιοχές στον designer.

### 14.7 Αναγνώριση εντύπου μετά την εκπαίδευση (σημείωση για plan 3/4)

«Πρώτα εκπαιδεύουμε και μετά, όταν δούμε τιμολόγιο ή όποιο άλλο έντυπο, ξέρουμε τι να κάνουμε.» Κάθε έντυπο έχει διαφορετικό format και, πέρα από τα βασικά, θέλουμε **δικά του** πεδία (kWh, m³, πινακίδες, βάρος, χειρόγραφο άρθρο…). Άρα η αναγνώριση του σωστού προτύπου για ένα εισερχόμενο αρχείο γίνεται σε δύο επίπεδα:
1. **ΑΦΜ εκδότη** (όταν υπάρχει και ταιριάζει σε πρότυπο με `vatNumber`) — ντετερμινιστικό.
2. **Ομοιότητα με τα δείγματα εκπαίδευσης** (`TemplateSample`, plan 4): κάθε δείγμα αποθηκεύει «αποτύπωμα» (επωνυμία εκδότη, χαρακτηριστικές λέξεις της πρώτης σελίδας από text layer ή vision, λόγος διαστάσεων). Για νέο αρχείο υπολογίζεται το ίδιο αποτύπωμα και επιλέγεται το πρότυπο με τη μεγαλύτερη ομοιότητα πάνω από κατώφλι· αν υπάρχουν ≥2 κοντινά, το μοντέλο ρωτιέται «ποιο από αυτά;» με τις μικρογραφίες. Χωρίς ταύτιση → «Άγνωστο έντυπο», ο χρήστης επιλέγει πρότυπο (και το αρχείο γίνεται νέο δείγμα εκπαίδευσης).
Έξοδος πάντα το JSON του §14.1(5), αποθηκευμένο στο `TemplateRun`.

### 14.8 Πώς καταχωρεί ο πελάτης (από «ΔΕΙΓΜΑ ΕΓΓΡΑΦΩΝ ΕΜΠΟΡΙΚΟΥ.docx», 10 οθόνες SoftOne)

Οθόνη **«Ειδικές συναλλαγές» → προβολή «Δαπάνες Προμηθευτών (Int)»** (screenshots στο `.local/customer/softone-posting/`, εκτός repo). Τα κυκλωμένα/χειρόγραφα στοιχεία του §14 καταλήγουν σε:

| Στο έντυπο (κύκλος / χειρόγραφο) | Πεδίο SoftOne πελάτη |
|---|---|
| Αρ. παραστατικού, ημερομηνία | Κεφαλίδα: «Παραστατικό» (π.χ. `INV.239124`, `ΤΠΥ 276708`, `ΤΙΜ Α32-000085237`), «Φορ/κός αριθμός», «Ημερ/νία» |
| Εκδότης | «Προμηθευτής» (`53-xxxxx`), και επιλογή **Σειράς/Τύπου**: `1001 1Τ0ΤΙΜ` Τιμολόγιο Δαπανών ΚΕ.Π.Υ.Ο (εσωτερικού), `1017 1Τ0ΥΠΕ` Υπηρεσίες Ε.Ε. (myDATA 14.3), `1018 1Τ0ΥΠΤ` Υπηρεσίες Τρίτες Χώρες (myDATA 14.4) |
| Χειρόγραφο άρθρο (`64.00.03.000.000`, `62.00.00.000.006`…) | Γραμμή: «Λογ/σμός» + «Κωδικός» είδους δαπάνης (`6231_ΥΠ`, `6001_ΥΠ`, `25231`, `585011_6`, `6000_24`, `639823`, `5409`) |
| Χειρόγραφοι επιμερισμοί (`Pudralac 3.298,53 / Megamid 508,12`, `Ακρυλικές / Procol / UPD 200`…) | **Μία γραμμή ανά προϊόν**: «Αξία» + «Άμεσα Εξοδ.Πωλη» (PUDRALAC, MEGAMID, ΑΛΚΥΔΙΚΕΣ, PROCOL, UPD 200, MEGARPUR, ΕΜΠΟΡΕΥΜΑΤΑ…) |
| Κυκλωμένη ποσότητα (kg, kWh, m³: `11.373`, `9.560`, `437.775,64`) | Γραμμή: «Ποσότ. Πετρελ./Μαζ» (tab πετρ/μαζούτ) και στην «Αιτιολογία» (`ΜΑΖΟΥΤ [11.373 KG] ΠΑΡΑΓΩΓΗ`, `ΗΡΩΝ:ΚΑΤΑΝΑΛΩΣΗ 05.2026 (437.775,64kW) [787859056]`) |
| Πινακίδες (Ayvens/Leaseplan) | Μία γραμμή ανά όχημα: «Κωδ.Μεταφ.Μέσου» (`XHB 7134 (1)`), «Κατηγορία Εξόδου» (`LEASING IX`), και όλες οι πινακίδες στην «Αιτιολογία» |
| Χειρόγραφος αριθμός πρακτορείου (`260861`, `260799`) | Πρόθεμα «Αιτιολογίας»: `ΠΡΑΚΤ.IN.260861 - <εκδότης>` |
| Α/Α λογαριασμού ΔΕΚΟ (`001022361426`) | «Παραστατικό» |
| Φύση συναλλαγής | Flags: Double Taxation, Vies, Πρόβλεψη, <300, Δ.απαλλαγής (26: Άρθρο 14 §5ια), Καθ.Φ.Π.Α. (Κανονικό / Απαλλάσσεται) |

Συνέπειες για τη σχεδίαση:
- **Κλασικά vs έξτρα:** τα κλασικά (αριθμός, ημερομηνία, ΑΦΜ, σύνολα, ΦΠΑ) τα βγάζει η υπάρχουσα OCR ροή τιμολογίων. Στο πρότυπο μαρκάρουμε **μόνο τα έξτρα**· αν το έντυπο δεν είναι τιμολόγιο, μόνο έξτρα υπάρχουν. Στο JSON του run (plan 3) το `values` έχει πρώτα τα κλασικά με τα κλειδιά του `INVOICE_SCHEMA` (όταν υπάρχουν) και μετά τα έξτρα του προτύπου· σύγκρουση κλειδιού → νικά το πρότυπο.
- **Πολλά έγγραφα → array:** σε job (§12) το αποτέλεσμα είναι `[ OutputJson, … ]`, ένα αντικείμενο ανά αρχείο, με `file` (όνομα) και `documentId` δίπλα στο `template`.
- **Αυτόματη σάρωση με διόρθωση μετά** (ερώτηση χρήστη — ναι): η «Αυτόματη σάρωση» **βρίσκει και μαρκάρει** κάθε ζεύγος ετικέτα→τιμή της σελίδας (`all`, προεπιλογή) και ο χρήστης μετά **διορθώνει, διαγράφει ή προσθέτει** πριν αποθηκεύσει. Δεύτερος τρόπος `marks` (μόνο κυκλωμένα/χειρόγραφα) για δείγματα που έχει σημειώσει ο λογιστής — αυτόν χρησιμοποιεί και η σπορά §14.6.
- **Layer καταχώρησης (επόμενο spec):** χρειάζεται mapping από κλειδιά JSON σε πεδία του custom object «Δαπάνες Προμηθευτών», επιλογή Σειράς/Τύπου από τη χώρα εκδότη (GR / ΕΕ / τρίτη χώρα), επιμερισμός σε γραμμές ανά προϊόν/όχημα, και εκμάθηση από τα ιστορικά ζεύγη «έντυπο → καταχώρηση» (τα χειρόγραφα του λογιστή είναι το ground truth).

---

## 15. Plan 3 — ροή εκτέλεσης (αποφάσεις 2026-09-10)

Συμπληρώνει το §3β/3γ/3δ με τις αλλαγές του §14.

1. **Ποιο πρότυπο τρέχει.** Στο upload (και στο reextract): μετά το βασικό OCR, αν το ΑΦΜ εκδότη ταιριάζει σε **ACTIVE** πρότυπο με `vatNumber`, τρέχει αυτό (αν είναι πολλά: το πιο πρόσφατα ενημερωμένο). Χωρίς ταύτιση → τίποτα (η αναγνώριση από ομοιότητα είναι plan 4, §14.7). Χειροκίνητα, από τη σελίδα εγγράφου: ο χρήστης επιλέγει **οποιοδήποτε** πρότυπο (ACTIVE ή DRAFT) και το τρέχει· η επανεκτέλεση ξανατρέχει το τελευταίο.
2. **Η εκτέλεση είναι μη-θανατηφόρα**: κάθε αποτυχία γίνεται run `FAILED` με `error`, το έγγραφο μένει COMPLETED. Η εκτέλεση στο upload γίνεται **μέσα** στο request (όπως το βασικό OCR), με `maxDuration 300`.
3. **Σειρά μέσα στο run:** `extractTemplateFields` → `applyRules` (conditions) → SET_FIELD σε fieldKey → έλεγχος `required` (κενό → flag review, και block σε AUTO) → projection: αν mode ≠ MANUAL και υπάρχει INVOICE mapping (το default ή αυτό του SWITCH_MAPPING), `projectToInvoice` → `extractedData` + `OcrInvoiceItem` (όταν αλλάζουν τα items) → SET_FIELD σε invoiceKey → status: MANUAL `EXTRACTED`, SEMI_AUTO `REVIEW`, AUTO `BLOCKED` αν flags.blocked, αλλιώς ανάρτηση μέσω της κοινής `postDocumentToSoftone` (σήμερα stub που σημαίνει POSTED) → `POSTED`/`FAILED`. NOTIFY: email μέσω Mailgun σε `params.emails` ή `template.notifyEmails`, **μία φορά ανά έγγραφο και κανόνα** (ελέγχονται τα προηγούμενα runs του εγγράφου).
4. **Τι αποθηκεύεται:** `TemplateRun` (+ νέες στήλες `trigger` `upload|manual|reextract`, `error`), `OcrDocument.reviewFlags` (`{ review: string[], blocked: string[], templateSlug, runStatus }` για τη λίστα), `timesUsed++`. Το JSON εξόδου **δεν** αποθηκεύεται ξεχωριστά — παράγεται από `toRunOutput(run, doc)`: κλασικά κλειδιά του `INVOICE_SCHEMA` που υπάρχουν στο `extractedData` + οι τιμές του προτύπου (νικά το πρότυπο), μαζί με `file` και `documentId`.
5. **Προβολή στο έγγραφο** (`/admin/ocr/[id]`): κάρτα «Πρότυπο» πάνω από τα κλασικά αποτελέσματα: επιλογή/εκτέλεση προτύπου, τελευταίο run με status/χρόνο/κόστος, σελίδα με τις περιοχές **στο χρώμα κάθε πεδίου**, λίστα πεδίων (χρώμα · ετικέτα · raw → τιμή · πηγή · σελίδα) με hover ⇄ highlight, επεξεργασία τιμής (source `manual`), flags και κανόνες που ταίριαξαν, διάγραμμα ροής (οριζόντιο) με live status, κουμπιά JSON / Excel / Επανεκτέλεση, και «Έγκριση → ανάρτηση» για SEMI_AUTO (υπάρχον post-softone, δικαίωμα `ocr.post`).
6. **Excel/JSON:** ανά έγγραφο `GET …/template-excel` (στήλες από EXCEL mapping, αλλιώς μία ανά πεδίο· TABLE → sheet «Γραμμές»)· ανά φάκελο `GET /api/admin/ocr/batches/[id]/template-excel` (ένα sheet ανά πρότυπο, μία γραμμή ανά έγγραφο με run) και `…/template-json` (array από OutputJson, §14.8).
7. **Λίστα OCR:** στήλη «Πρότυπο» (όνομα + status τελευταίου run, χρωματιστό pill) από `reviewFlags`.
8. **Καθαρισμός (§7):** script `scripts/templates/migrate-field-rules.ts` μεταφέρει τα `SupplierFieldRule` σε DRAFT/MANUAL πρότυπα (ένα ανά ΑΦΜ, «Μεταφερμένο: <επωνυμία>», πεδία χωρίς περιοχή με `aiHint` = description, `regionHint` → region) και γράφει backup JSON στο `.local/`. Μετά: αφαίρεση των legacy passes από το `extractDocument`, των σελίδων/API «Ειδικά πεδία», του «Αποθήκευση ως πρότυπο», των `lib/ocr/{field-rules,field-rules-db,templates-store}.ts` (ο slugifier μεταφέρεται στο `lib/templates/slug.ts`), και migration που διαγράφει τους πίνακες `SupplierFieldRule`/`SupplierTemplate`.
