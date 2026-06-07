# Spec — OCR Templates Φορολογικών Εντύπων & Αποθήκευση Οικονομικών Στοιχείων (②)

**Ημερομηνία:** 2026-06-07
**Κατάσταση:** Approved design → προς implementation plan
**Module:** `tax-templates` / `company-financials` (νέο)

---

## 0. Πλαίσιο & σκοπός

Η εφαρμογή διαχειρίζεται έργα ευρωπαϊκών προγραμμάτων (ΕΣΠΑ) για εταιρία συμβούλων. Η αξιολόγηση επιλεξιμότητας/βαθμολόγησης μιας επιχείρησης βασίζεται σε **υπολογιστικά κριτήρια** που τροφοδοτούνται από **πρωτογενείς οικονομικές τιμές** (π.χ. EBIT, Κύκλος Εργασιών, Τόκοι — κωδικοί εντύπου Ε3).

Το συνολικό αίτημα χωρίστηκε σε δύο συνδεδεμένα υποσυστήματα:

- **① Μηχανή Αξιολόγησης (Computed Evaluation Engine)** — υπολογιστικά κριτήρια: μεταβλητές → formula → πίνακας ζωνών → σταθμισμένη βαθμολογία. *(Ξεχωριστό spec, υλοποιείται ΔΕΥΤΕΡΟ.)*
- **② OCR Templates Φορολογικών Εντύπων + Αποθήκευση Οικονομικών** — *αυτό το spec, υλοποιείται ΠΡΩΤΟ.*

**Απόφαση σειράς:** χτίζουμε πρώτα το ② (θεμέλιο δεδομένων), μετά το ①.

**Το «συμβόλαιο-γέφυρα»:** ένα μητρώο οικονομικών τιμών ανά εταιρία, με κλειδί `fieldKey = "{templateCode}.{fieldKey}"` (π.χ. `E3.500`) και διάσταση έτους. Το ② **παράγει** αυτές τις τιμές· το ① (αργότερα) τις **καταναλώνει** μέσω AUTO μεταβλητών — χωρίς αλλαγή στη μηχανή.

### Αποφάσεις από brainstorming
- **Πηγή τιμών:** Hybrid (auto από OCR + χειροκίνητη διόρθωση), manual-first.
- **Ποιος ανεβάζει:** Εσωτερικά (ADMIN/EMPLOYEE) από το `/admin`. Όχι customer portal τώρα.
- **Ορισμός template:** Region marking (χειροκίνητα) + AI εξαγωγή.
- **Επαναχρησιμοποίηση:** templates & πεδία είναι **global**· οι τιμές είναι **company-scoped** (όχι per-program) → ένα ανέβασμα Ε3 εξυπηρετεί όλα τα προγράμματα όπου συμμετέχει η εταιρία.
- **UI/UX:** κρίσιμο. Reusable capture widget (μπαίνει και σε μελλοντικό project/task). Εγκεκριμένο OCR/invoice layout (persistent preview + review δίπλα-δίπλα). DG design system, theme-aware tokens.

### Όριο scope (εκτός αυτού του spec)
- Το **σύστημα project/φάσεων/tasks** (template tasks ανά πρόγραμμα, σελίδα project ανά εταιρία) είναι **μελλοντικό ξεχωριστό έργο**. Εδώ απλώς φτιάχνουμε το `<TaxFormCapture>` ώστε να ενσωματωθεί εκεί χωρίς αλλαγή (callback `onConfirmed`, props `companyId/programId/taskId?`).
- Η Μηχανή Αξιολόγησης ① είναι ξεχωριστό spec.
- Customer-facing upload portal.

---

## 1. Αρχιτεκτονική προσέγγιση

Επεκτείνουμε **καθαρά** την υπάρχουσα OCR υποδομή με νέο, αυτόνομο μοντέλο template:
- **ΟΧΙ** overloading του `SupplierFieldRule` (δεμένο σε ΑΦΜ προμηθευτή — θα μόλυνε το invoice feature).
- **ΟΧΙ** σκέτο JSON blob (χάνουμε query ανά έτος + το contract).

**Επαναχρησιμοποιούμε:** Gemini Vision pipeline, `rasterizePdf`/`enhanceForOcr`, `callVisionLLM`/`callGeminiPdfNative`, `parseJsonLoose`, `buildCustomFieldsPrompt`/`regionHintText`, `logAiUsage`, Bunny storage, `useMarquee` + region overlays, `OcrDocument` (έχει ήδη `category TAX`).

---

## 2. Μοντέλο δεδομένων (Prisma — προσθετικά)

Συμβάσεις: `id String @id @default(cuid())`, `createdAt/updatedAt`, `@db.Decimal(p,s)`, enums SCREAMING_SNAKE, `@@unique`/`@@index`.

### 2.1 Νέα enums
```prisma
enum TaxTemplateStatus { DRAFT READY }

enum FinancialValueType { CURRENCY NUMBER PERCENT INTEGER DATE BOOLEAN }

enum FinancialValueSource { OCR MANUAL }

enum FinancialYearMode { REFERENCE PRIOR_1 PRIOR_2 PRIOR_3 } // resolved σε απόλυτο έτος στο assessment/upload
```

### 2.2 `TaxFormTemplate` — επαναχρησιμοποιήσιμος ορισμός εντύπου
```prisma
model TaxFormTemplate {
  id              String   @id @default(cuid())
  code            String                       // "E3" | "E1" | "N" ...
  name            String                       // "Έντυπο Ε3 (2025)"
  year            Int?                          // 2025 (layout/version) — null = generic
  description     String?  @db.Text
  status          TaxTemplateStatus @default(DRAFT)
  // δείγμα για region marking
  sampleStorageKey String?                      // Bunny key
  samplePageCount  Int?
  sampleThumbUrl   String?
  createdById     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  fields          TaxFormTemplateField[]
  requiredBy      ProgramRequiredField[]
  documents       OcrDocument[]

  @@unique([code, year])
  @@index([status])
}
```

### 2.3 `TaxFormTemplateField` — ένα εξαγώμενο πεδίο
```prisma
model TaxFormTemplateField {
  id           String   @id @default(cuid())
  templateId   String
  template     TaxFormTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  fieldKey     String                          // "500" — σταθερό· δένει με contract ως "{code}.{fieldKey}"
  label        String                          // "Κύκλος Εργασιών (Πωλήσεις)"
  section      String?                          // "Πίνακας Ζ" (grouping)
  valueType    FinancialValueType @default(CURRENCY)
  regionHint   Json?                            // { page, bbox:[x,y,w,h] } normalized 0..1
  aiHint       String?  @db.Text                // οδηγία προς το vision model
  required     Boolean  @default(false)
  order        Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([templateId, fieldKey])
  @@index([templateId])
}
```

### 2.4 `CompanyFinancialValue` — η αποθηκευμένη τιμή (**το contract**)
```prisma
model CompanyFinancialValue {
  id               String   @id @default(cuid())
  companyId        String
  company          Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  fieldKey         String                        // "E3.500" (=templateCode.fieldKey)
  templateId       String?                       // provenance
  year             Int                           // φορολογικό έτος αναφοράς
  value            Decimal  @db.Decimal(18, 2)
  valueType        FinancialValueType
  source           FinancialValueSource @default(OCR)
  sourceDocumentId String?                       // OcrDocument id
  confidence       Float?
  verified         Boolean  @default(false)
  verifiedById     String?
  // διάρκεια/περίοδος (κατ' απαίτηση χρήστη)
  periodStart      DateTime?
  periodEnd        DateTime?
  validUntil       DateTime?                     // πότε «λήγει» / θέλει επανυποβολή
  note             String?  @db.Text
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([companyId, fieldKey, year])
  @@index([companyId])
  @@index([fieldKey, year])
}
```

### 2.5 `ProgramRequiredField` — «τα πεδία που χρειαζόμαστε ανά πρόγραμμα»
```prisma
model ProgramRequiredField {
  id           String   @id @default(cuid())
  programId    String
  program      Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  templateId   String
  template     TaxFormTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  fieldKey     String                            // ποιο πεδίο του template
  yearsBack    Int      @default(1)              // 1 = έτος αναφοράς· 3 = τριετία (Β5)
  mandatory    Boolean  @default(true)
  order        Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([programId, templateId, fieldKey])
  @@index([programId])
}
```

### 2.6 Επεκτάσεις σε υπάρχοντα μοντέλα
```prisma
// OcrDocument: + σύνδεση με εταιρία/template/έτος
model OcrDocument {
  // ... υπάρχοντα ...
  companyId     String?
  company       Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)
  taxTemplateId String?
  taxTemplate   TaxFormTemplate? @relation(fields: [taxTemplateId], references: [id], onDelete: SetNull)
  fiscalYear    Int?
  // category TAX υπάρχει ήδη στο enum OcrCategory
  @@index([companyId])
}

// Company
model Company {
  // ... υπάρχοντα ...
  financialValues CompanyFinancialValue[]
  ocrDocuments    OcrDocument[]
}

// Program
model Program {
  // ... υπάρχοντα ...
  requiredFields  ProgramRequiredField[]
}
```

---

## 3. Ροή λειτουργίας

### Α. Δημιουργία template *(admin, μία φορά ανά έντυπο/έτος)*
1. `/admin/tax-templates` → «Νέο» → `code`, `name`, `year`.
2. Ανέβασμα **δείγματος** (PDF/εικόνα) → Bunny (`sampleStorageKey`), rasterization για preview.
3. `<TaxTemplateRegionEditor>`: πλοήγηση σελίδων, σχεδίαση περιοχής ανά πεδίο, ορισμός `fieldKey + label + valueType + aiHint` → `TaxFormTemplateField` rows.
4. Mark `READY`.

### Β. Σύνδεση με πρόγραμμα *(admin)*
Program editor → καρτέλα **«Οικονομικά πεδία»**: επιλογή template(s) + πεδίων + `yearsBack` + `mandatory` → `ProgramRequiredField`. Επαναχρησιμοποιήσιμο σε πολλά προγράμματα.

### Γ. Ανέβασμα & εξαγωγή ανά εταιρία *(admin/employee)*
Καρτέλα εταιρίας «Οικονομικά» → `<TaxFormCapture>`:
1. Επιλογή template + έτους, drop file.
2. → Bunny → `OcrDocument(category=TAX, companyId, taxTemplateId, fiscalYear, status=PROCESSING)`.
3. `extractTaxForm(buffer, mimeType, fields)` → `{ fieldKey: rawValue }`.
4. Parsing ανά `valueType` με `lib/greek-format.ts`.

### Δ. Έλεγχος & επιβεβαίωση *(το hybrid σκέλος)*
Split view: αριστερά persistent preview με highlight περιοχών· δεξιά πίνακας `πεδίο | τιμή (editable) | confidence`. Click σε πεδίο → highlight της `regionHint` στο preview. Διόρθωση → **Επιβεβαίωση** → upsert `CompanyFinancialValue` (`source=OCR` ή `MANUAL` αν άλλαξε, `verified=true`, `sourceDocumentId`). `onConfirmed(values)` callback.

### Ε. Προβολή / επαναχρήση
Καρτέλα εταιρίας «Οικονομικά» → `<CompanyFinancialsMatrix>`: μήτρα `πεδίο × έτος` με badges (source/verified/validity), inline manual edit οποτεδήποτε.

---

## 4. AI extraction + parsing

### 4.1 `lib/ocr/tax-extract.ts` → `extractTaxForm(buffer, mimeType, fields)`
Ξαναχρησιμοποιεί αυτούσια από `lib/ocr/extract.ts` & `lib/ocr/field-rules.ts`:
- `resolveCfg()` → AI config.
- PDF: `callGeminiPdfNative()` (fast path αν Gemini endpoint) ή `rasterizePdf()` (multi-page) → `enhanceForOcr()` → `callVisionLLM()` ανά σελίδα → merge.
- Εικόνα: `enhanceForOcr()` → `callVisionLLM()`.
- Prompt: μετατροπή `TaxFormTemplateField[]` → `FieldRuleLite[]` (`key=fieldKey`, `label`, `description=aiHint`, `regionHint`) → `buildCustomFieldsPrompt()`. (Οι περιοχές γίνονται human-readable με `regionHintText()`.)
- Output: `parseJsonLoose()` → `{ fieldKey: value|null }`.
- Token usage: `logAiUsage({ scope:'TAX_FORM', refType:'CompanyFinancialValue', model, totalTokens, durationMs })` (νέο scope).

### 4.2 `lib/greek-format.ts` (pure, unit-tested)
- `parseGreekNumber('1.556.540,27') → 1556540.27` (αφαίρεση τελειών χιλιάδων, κόμμα→τελεία).
- `parseGreekCurrency('400.000,00 €') → 400000`.
- `parseGreekPercentage('17,9%') → 17.9`.
- `parseGreekDate('31/12/2024') → Date`.
- `coerceFinancialValue(raw, valueType)` → `Decimal|null` (dispatch ανά `valueType`).

> Σημ.: το υπάρχον `asNum` (lib/programs/coerce.ts) **σπάει** στα dot-thousands → νέος parser απαραίτητος.

---

## 5. UI/UX components & σελίδες

Στο implementation: **`dg-design-system` skill** (DG brand + Fluent 2 tokens, theme-aware — όχι hardcoded χρώματα), εγκεκριμένο OCR/invoice layout (12/11px, persistent preview + side review).

### 5.1 Reusable μονάδες
1. **`<RegionMarker>`** (`components/ui/region-marker.tsx`) — εξαγωγή από `supplier-field-rule-dialog` + `useMarquee`. Props: `imageUrl`, `savedRegions[]`, `onRegionComplete(box)`, `isMarking`, page navigation (`currentPage`, `?page=N`, controls). Δύο overlays (live sisyphus / persisted emerald). **Pluggable image source.** Το `supplier-field-rule-dialog` migrate-άρεται να το χρησιμοποιεί (καθαρό win, χωρίς regression).
2. **`<TaxTemplateRegionEditor>`** — wrapper του `<RegionMarker>` για πολλαπλά πεδία + φόρμα `fieldKey/label/valueType/aiHint`.
3. **`<TaxFormCapture>`** — embeddable widget (upload → OCR → split review → confirm). Props: `companyId`, `programId?`, `taskId?`, `templateId?`, `fiscalYear?`, `onConfirmed(values)`. Χρήση: company tab, standalone admin, *(μέλλον)* project task.
4. **`<CompanyFinancialsMatrix>`** — μήτρα `πεδίο × έτος`, badges, inline edit.

### 5.2 Σελίδες / endpoints
- `/admin/tax-templates` (list) + `/admin/tax-templates/[id]` (editor).
- `/api/admin/tax-templates` (CRUD) + `/api/admin/tax-templates/[id]/fields` + `/api/admin/tax-templates/[id]/page-image` (rasterize sample).
- Program editor → καρτέλα «Οικονομικά πεδία» + `/api/admin/programs/[id]/required-fields`.
- Company → καρτέλα «Οικονομικά» + `/api/admin/companies/[id]/financials` (upload/extract/confirm/list).
- Κοινό `lib/ocr/rasterize.ts` (pdf-to-img + sharp) ώστε να χρησιμοποιείται και από OcrDocument page-image και από template sample.

### 5.3 UX αρχές
- Click σε πεδίο → highlight περιοχής στο preview (αμφίδρομο).
- Badges: 🟢 verified / 🟡 OCR-unconfirmed / ✋ manual · confidence inline.
- Καθαρά empty/loading/error states, keyboard-friendly.
- Roles: **ADMIN/EMPLOYEE** (υπάρχον admin guard).

---

## 6. Testing (vitest, pure unit — χωρίς DB)
- `lib/__tests__/greek-format.test.ts` — όλοι οι parsers + edge cases (αρνητικά, κενά, ποσοστά, ISO ημερομηνίες).
- template → `FieldRuleLite` mapping + prompt builder.
- value coercion ανά `valueType`.
- year-resolution (`FinancialYearMode` + `yearsBack` → απόλυτο έτος).
- financial-value upsert/merge (pure helper, χωρίς Prisma).

Run: `npm run test`.

---

## 7. Migration (προσοχή: shared prod/dev DB)
- Χειρόγραφο `prisma/migrations/<timestamp>_tax_form_templates/migration.sql`:
  - `CREATE TABLE` για TaxFormTemplate, TaxFormTemplateField, CompanyFinancialValue, ProgramRequiredField (+ indexes/unique).
  - `ALTER TABLE "OcrDocument" ADD COLUMN companyId/taxTemplateId/fiscalYear` (+ indexes + FKs στο τέλος).
  - νέα enums.
- `prisma generate` → `prisma db push` σε **dev** → `prisma migrate resolve` για status.
- **Ποτέ auto-migrate.** Έγκριση χρήστη πριν εφαρμοστεί οτιδήποτε στη βάση (μοιραζόμενη prod+dev).

---

## 8. Wiki (υποχρεωτικό ανά CLAUDE.md)
Για κάθε νέα admin σελίδα: `npm run wiki:new`, content στα Ελληνικά (Steps + Callouts), `helpAnchor` στο `<PageHeader>`, screenshots frontmatter.
- `tax-templates/overview` (δημιουργία template + region marking)
- `programs/oikonomika-pedia` (σύνδεση πεδίων ανά πρόγραμμα)
- `companies/oikonomika` (upload Ε3 + έλεγχος τιμών)
Module registry entry στο `lib/wiki/modules-meta.ts` αν χρειάζεται.

---

## 9. Σύνδεση με ① (μελλοντικό)
Όταν χτιστεί η Μηχανή Αξιολόγησης ①, μια **AUTO μεταβλητή** υπολογιστικού κριτηρίου θα δηλώνει: «τράβα `E3.500` για `FinancialYearMode` (REFERENCE/PRIOR_1…)». Resolver: `(company, fieldKey, resolvedYear) → CompanyFinancialValue.value`. Καμία αλλαγή στο ② τότε.

---

## 10. Deliverables checklist
- [ ] Prisma models + enums + extensions (§2)
- [ ] Χειρόγραφη migration SQL (§7) — **με έγκριση πριν την εφαρμογή**
- [ ] `lib/greek-format.ts` + tests
- [ ] `lib/ocr/tax-extract.ts` (`extractTaxForm`)
- [ ] `lib/ocr/rasterize.ts` (shared)
- [ ] `<RegionMarker>` primitive + refactor `supplier-field-rule-dialog`
- [ ] `<TaxTemplateRegionEditor>`, `<TaxFormCapture>`, `<CompanyFinancialsMatrix>`
- [ ] Σελίδες/API: tax-templates, program required-fields, company financials
- [ ] Wiki entries + helpAnchors
- [ ] Unit tests πράσινα (`npm run test`)
