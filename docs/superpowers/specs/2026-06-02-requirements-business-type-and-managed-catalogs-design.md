# Design: Δικαιολογητικά ανά Τύπο Επιχείρησης + Managed Catalogs (Κατηγορίες, Φάσεις)

**Ημερομηνία:** 2026-06-02
**Κατάσταση:** Draft → προς user review → writing-plans
**Σχετικό προηγούμενο spec:** [`2026-06-01-program-documents-phases-design.md`](./2026-06-01-program-documents-phases-design.md)
(αυτό το spec **αναιρεί** το «Shared phase templates» που εκεί ήταν εκτός scope/YAGNI.)

## Σκοπός

Όταν προσθέτουμε δικαιολογητικά σε ένα Ευρωπαϊκό Πρόγραμμα, θέλουμε να ορίζουμε **σε ποιους
τύπους επιχείρησης** (νομική μορφή: ΑΕ, ΕΠΕ, ΙΚΕ, ΟΕ, ΕΕ, Ατομική…) ισχύει το κάθε δικαιολογητικό
(π.χ. «ΕΜΕ 2025» μόνο για ΕΠΕ/ΑΕ). Έτσι, όταν μια εταιρία εντάσσεται σε πρόγραμμα, ανάλογα με τον
**δικό της** τύπο ζητούνται αυτόματα τα κατάλληλα δικαιολογητικά.

Παράλληλα, μετατρέπουμε δύο σημερινά free-text πεδία σε **διαχειριζόμενες λίστες (managed catalogs)
με creatable combo boxes**:
1. **Κατηγορία δικαιολογητικού** (`DocumentType.category`) → κατάλογος + combo box, με tab διαχείρισης
   μέσα στο modal των τύπων δικαιολογητικών.
2. **Όνομα φάσης** (`ProgramPhase.name`) → κατάλογος προτύπων φάσεων + creatable combo box στην
   προσθήκη φάσης.

## Αποφάσεις (από brainstorming)

- Scope εφαρμογής: **ανά τύπο επιχείρησης**, όχι ανά μεμονωμένη εταιρία.
- Χαρτογράφηση εταιρία→τύπος: **mapping στο `LegalType` (ΓΕΜΗ) + χειροκίνητο override** στη φόρμα
  εταιρίας. Cached `businessTypeId` στο `Company`.
- Δικαιολογητικό **χωρίς** επιλεγμένους τύπους ⇒ **ζητείται από κανέναν** (όχι «όλοι»). Για καθολικά
  δικαιολογητικά υπάρχει ρητό flag `appliesToAll`.
- Combo boxes (κατηγορίες & φάσεις): **creatable** — επιλογή από λίστα ή πληκτρολόγηση νέας τιμής που
  προστίθεται αυτόματα στον κατάλογο.
- Scope v1: **ρύθμιση (configuration) + αυτόματη παραγωγή** — η λίστα απαιτούμενων δικαιολογητικών
  ανά εταιρία **δεν αποθηκεύεται/συντηρείται χωριστά**· **προκύπτει αυτόματα** ως συνάρτηση
  `company.businessType × program requirements`. Όταν εντάσσεται η εταιρία, η εφαρμογή διαβάζει τη
  νομική της μορφή + το πρόγραμμα και γνωρίζει αμέσως τι χρειάζεται.

## Υπάρχον context (codebase)

- `model CompanyType` ([prisma/schema.prisma:218](../../../prisma/schema.prisma)) **υπάρχει ήδη** αλλά
  σημαίνει σχέση Πελάτης/Προμηθευτής/Συνεργάτης (TRDR), **όχι** νομική μορφή. **Δεν το αγγίζουμε** και
  **δεν** χρησιμοποιούμε αυτό το όνομα. Ο νέος κατάλογος νομικών μορφών ονομάζεται **`BusinessType`**.
- Νομική μορφή εταιρίας σήμερα: `Company.legalForm` (free-text «Α.Ε.»), `Company.legalTypeId` →
  `LegalType` (ΓΕΜΗ lookup, ~πεπερασμένος), `Company.aadeFirmKind` (ΑΑΔΕ firm_flag). Υπάρχει επίσης
  `ProgramEligibleLegalForm` (per-program free-text — μένει ως έχει για eligibility).
- `PhaseDocumentRequirement` ([prisma/schema.prisma](../../../prisma/schema.prisma)) = junction
  (phase ↔ documentType) με `mandatory`, `notes`. Εδώ προσθέτουμε το scoping.
- `DocumentType.category` = `String?` (free text). `DocumentType` έχει `@@unique([name])`.
- `ProgramPhase.name` = `String` ελεύθερο ανά πρόγραμμα.
- Σύνδεση εταιρία↔πρόγραμμα = `CompanyAssessment` (companyId, programId, verdict, status…).
- UI: `app/admin/programs/[id]/phases-tab.tsx` (φάσεις & requirements),
  `app/admin/document-types/document-types-client.tsx` (CRUD modal τύπων).
- API: `app/api/admin/programs/[id]/phases/...` (phases + requirements),
  `app/api/admin/document-types/...`. `requirePermission('programs.update' | 'metadata.manage')`.
- Prisma migrate: το `migrate dev` είναι σπασμένο — workflow `db push` + manual SQL migration +
  `migrate resolve` (βλ. memory `prisma-migrate-workflow`). DB είναι **Postgres**.
- Combo box: υπάρχει shadcn/ui (`Command`/`Popover`) — creatable combobox με αυτό το pattern.

---

## 1. Data model (Prisma)

### 1.1 `BusinessType` — κατάλογος νομικών μορφών (νέο)

```prisma
model BusinessType {
  id        String   @id @default(cuid())
  name      String   @unique           // «Ανώνυμη Εταιρεία», «ΙΚΕ», «Ατομική Επιχείρηση»…
  code      String?  @unique           // σύντομος κωδικός: «ΑΕ», «ΙΚΕ», «ΟΕ» (προαιρετικό)
  order     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  legalTypes   LegalType[]                  // ΓΕΜΗ legalTypes που χαρτογραφούνται εδώ
  companies    Company[]                    // companies με cached businessTypeId
  requirements RequirementBusinessType[]

  @@index([active])
  @@index([order])
}
```

### 1.2 Χαρτογράφηση εταιρία → BusinessType

```prisma
// LegalType (ΓΕΜΗ) παίρνει mapping προς BusinessType:
model LegalType {
  id             Int      @id
  descr          String
  descrEn        String?
  lastUpdated    DateTime?
  businessTypeId String?                       // ← νέο: χαρτογράφηση στον managed κατάλογο
  businessType   BusinessType? @relation(fields: [businessTypeId], references: [id], onDelete: SetNull)
  companies      Company[]

  @@index([businessTypeId])
}

// Company: cached resolved type + manual override
model Company {
  // … υπάρχοντα πεδία …
  businessTypeId       String?               // ← cached resolved τύπος (matching reads ΜΟΝΟ αυτό)
  businessType         BusinessType? @relation(fields: [businessTypeId], references: [id], onDelete: SetNull)
  businessTypeOverride Boolean @default(false) // true = ορίστηκε χειροκίνητα, μη auto-overwrite

  @@index([businessTypeId])
}
```

**Resolution rule** (`lib/companies/business-type.ts`, pure):
- Αν `businessTypeOverride === true` → κράτα το υπάρχον `businessTypeId` (δεν το πειράζει το sync).
- Αλλιώς `businessTypeId = company.legalTypeRef?.businessTypeId ?? null`.
- `null` ⇒ «μη χαρτογραφημένη» — surface warning στο consuming view.
- Καλείται (α) μετά από ΓΕΜΗ/ΑΑΔΕ/SoftOne sync, (β) μετά από αλλαγή mapping ενός `LegalType`
  (bulk re-resolve όσων companies δεν έχουν override), (γ) όταν ο admin ορίσει override.

### 1.3 `RequirementBusinessType` — scoping requirement ↔ τύπος (νέο junction)

```prisma
model RequirementBusinessType {
  id             String   @id @default(cuid())
  requirementId  String
  requirement    PhaseDocumentRequirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  businessTypeId String
  businessType   BusinessType @relation(fields: [businessTypeId], references: [id], onDelete: Cascade)

  @@unique([requirementId, businessTypeId])
  @@index([requirementId])
  @@index([businessTypeId])
}

model PhaseDocumentRequirement {
  // … υπάρχοντα: phaseId, documentTypeId, mandatory, notes …
  appliesToAll  Boolean @default(false)        // ← true = όλοι οι τύποι (αγνοεί το join)
  businessTypes RequirementBusinessType[]
}
```

**Matching rule** (`lib/documents/requirement-scope.ts`, pure):
`requirementApplies(req, companyBusinessTypeId)` →
- `req.appliesToAll === true` → `true`
- αλλιώς `companyBusinessTypeId != null && req.businessTypes.some(t => t.businessTypeId === companyBusinessTypeId)`
- κενό join + `appliesToAll=false` ⇒ `false` (ζητείται από κανέναν — κατά την απόφαση).

### 1.4 `DocumentCategory` — κατάλογος κατηγοριών (νέο) + αλλαγή `DocumentType`

```prisma
model DocumentCategory {
  id        String   @id @default(cuid())
  name      String   @unique
  order     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  documentTypes DocumentType[]

  @@index([active])
}

model DocumentType {
  // … υπάρχοντα …
  category    String?            // ⚠ deprecated — διατηρείται προσωρινά για migration, μετά drop
  categoryId  String?            // ← νέο FK
  categoryRef DocumentCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@index([categoryId])
}
```

**Migration δεδομένων:** για κάθε distinct μη-κενό `DocumentType.category` → δημιούργησε
`DocumentCategory` (idempotent) και set `categoryId`. Σε δεύτερη φάση (αφού επιβεβαιωθεί) drop το
`category` text column.

### 1.5 `PhaseTemplate` — κατάλογος ονομάτων φάσεων (νέο) + link στο `ProgramPhase`

```prisma
model PhaseTemplate {
  id        String   @id @default(cuid())
  name      String   @unique           // «Υποβολή», «Ένταξη», «Υλοποίηση», «Ολοκλήρωση»
  order     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  phases ProgramPhase[]
}

model ProgramPhase {
  // … υπάρχοντα: programId, name, order …
  phaseTemplateId String?           // ← optional link (αναφορά στο πρότυπο)
  phaseTemplate   PhaseTemplate? @relation(fields: [phaseTemplateId], references: [id], onDelete: SetNull)
}
```

`ProgramPhase.name` **παραμένει** (denormalized copy) ώστε rename/reorder ανά πρόγραμμα να δουλεύει
ανεξάρτητα. Το creatable combo box: επιλογή υπάρχοντος προτύπου → set `phaseTemplateId` + `name`·
νέα τιμή → δημιουργεί `PhaseTemplate` και μετά συνδέει.

---

## 2. API routes

| Route | Methods | Permission |
|-------|---------|-----------|
| `/api/admin/business-types` | GET, POST | metadata.read / metadata.manage |
| `/api/admin/business-types/[id]` | PATCH, DELETE | metadata.manage |
| `/api/admin/legal-types` (list + mapping) | GET | metadata.read |
| `/api/admin/legal-types/[id]` (set businessTypeId) | PATCH | metadata.manage |
| `/api/admin/document-categories` | GET, POST | metadata.read / metadata.manage |
| `/api/admin/document-categories/[id]` | PATCH, DELETE | metadata.manage |
| `/api/admin/phase-templates` | GET, POST | metadata.read / metadata.manage |
| `/api/admin/phase-templates/[id]` | PATCH, DELETE | metadata.manage |
| `/api/admin/programs/[id]/phases/[phaseId]/requirements/[reqId]/business-types` | PUT (set λίστα + appliesToAll) | programs.update |
| `/api/admin/companies/[id]/required-documents?programId=` | GET (φιλτραρισμένο checklist) | companies.read |

**Σημειώσεις:**
- Η ενημέρωση scope ενός requirement γίνεται με ένα **PUT** που δέχεται
  `{ appliesToAll: boolean, businessTypeIds: string[] }` και κάνει set ολόκληρη τη λίστα (delete+create
  σε transaction) → idempotent, απλό state από το UI.
- Creatable POST σε `document-categories` / `phase-templates`: αν υπάρχει ίδιο `name` → 200 με το
  υπάρχον (όχι 409) ώστε το creatable combo να μην σκάει.
- DELETE σε `business-types` / `document-categories` / `phase-templates`: αν χρησιμοποιείται
  (companies/legalTypes/requirements/documentTypes/phases) → 409 με μήνυμα «απενεργοποίησέ το»
  (`active=false`) αντί διαγραφής — pattern ίδιο με `document-types` DELETE.

---

## 3. UI

### 3.1 `/admin/business-types` (νέο sidebar item «Τύποι Επιχείρησης»)
CRUD πίνακας (name, code, order, active) + **tab/section «Αντιστοίχιση ΓΕΜΗ»**: λίστα `LegalType`
με combo box ανά γραμμή για να διαλέξεις `BusinessType`. `<PageHeader helpAnchor="business-types" />`.
Permission view `metadata.read`, CRUD `metadata.manage`.

### 3.2 Φόρμα εταιρίας → πεδίο «Τύπος επιχείρησης»
Combo box (από `BusinessType`) με ένδειξη της auto-resolved τιμής. Επιλογή χειροκίνητα → set
`businessTypeOverride=true`. Κουμπί «Επαναφορά σε αυτόματο» → `override=false` + re-resolve.
(Σημ.: αν δεν υπάρχει σήμερα edit form εταιρίας με αυτό το πεδίο, προστίθεται minimal section· η
ακριβής τοποθεσία επιβεβαιώνεται στο plan.)

### 3.3 `document-types-client.tsx` (modal) — δύο αλλαγές
- **Πεδίο «Κατηγορία»** γίνεται **creatable combo box** (από `DocumentCategory`).
- **Νέο tab «Κατηγορίες»** μέσα στο ίδιο modal/σελίδα: CRUD λίστα κατηγοριών (name, order, active).

### 3.4 `phases-tab.tsx` — δύο αλλαγές
- **Προσθήκη φάσης**: από text input → **creatable combo box** (από `PhaseTemplate`).
- **Ανά requirement**: νέο control «Ισχύει για» = multi-select `BusinessType` **ή** checkbox «Όλοι οι
  τύποι» (`appliesToAll`). Όταν κενό & όχι «Όλοι» → visual warning «δεν θα ζητηθεί από καμία εταιρία».
- Διαχείριση καταλόγου προτύπων φάσεων: link προς `/admin/phase-templates` (ή μικρό «διαχείριση»
  popover) — επιβεβαίωση στο plan· default = ξεχωριστή σελίδα για συνέπεια με business-types.

### 3.5 Αυτόματη παραγωγή απαιτούμενων δικαιολογητικών (όχι ξεχωριστή οθόνη/entity)
Δεν φτιάχνουμε χωριστό maintained checklist. Όταν μια εταιρία είναι ενταγμένη σε πρόγραμμα
(`CompanyAssessment`), η λίστα απαιτούμενων δικαιολογητικών **υπολογίζεται on-demand** ως:
`filterRequirements(programRequirements, company.businessTypeId)` (βλ. §1.3, §4) — ομαδοποιημένα ανά
φάση, με ένδειξη υποχρεωτικό/προαιρετικό. Εμφανίζεται στην υπάρχουσα ροή εταιρίας-σε-πρόγραμμα
(`CompanyAssessment` detail). Αν `company.businessTypeId == null` → banner «η εταιρία δεν έχει
χαρτογραφημένο τύπο — όρισέ τον» + link στη φόρμα εταιρίας. (Η ακριβής σελίδα/route όπου εμφανίζεται
επιβεβαιώνεται στο plan με βάση το πού ζει σήμερα η σχέση εταιρία↔πρόγραμμα.)

---

## 4. Μονάδες / interfaces (isolation, testable)

- `lib/companies/business-type.ts` — `resolveBusinessTypeId(company): string | null` (pure)·
  `reResolveForLegalType(legalTypeId)` (bulk, skip overrides).
- `lib/documents/requirement-scope.ts` — `requirementApplies(req, companyBusinessTypeId): boolean`
  (pure)· `filterRequirements(requirements, companyBusinessTypeId)`.
- `lib/documents/document-categories.ts` — normalize/validate input (όπως το υπάρχον
  `document-types.ts`).
- `lib/programs/phase-templates.ts` — normalize/validate + `findOrCreateByName(name)` (creatable).

---

## 5. Permissions, seeding, wiki

- **Permissions:** reuse `metadata.read` / `metadata.manage` (business-types, categories,
  phase-templates, legal-type mapping), `programs.update` (requirement scope), `companies.read`
  (consuming view), `companies.update` (business type override στη φόρμα εταιρίας). **Δεν** χρειάζεται
  νέο permission.
- **Seeding:** seed default `BusinessType` (ΑΕ, ΕΠΕ, ΙΚΕ, ΟΕ, ΕΕ, Ατομική, ΚοινΣΕπ, Συνεταιρισμός)
  + best-effort αρχικό mapping `LegalType.descr` → `BusinessType` (όπου ταιριάζει προφανώς).
- **Wiki** (υποχρεωτικό CLAUDE.md) — scaffold + content Ελληνικά + helpAnchors:
  - `companies/business-types` (νέα) — κατάλογος + αντιστοίχιση ΓΕΜΗ.
  - Update `documents/document-types` — managed κατηγορίες + combo box.
  - Update `programs/phases` (ή το αντίστοιχο) — phase templates + scoping requirements ανά τύπο.
  - `companies/required-documents` (νέα) — consuming checklist.
  Αν λείπει module → πρόσθεσε στο [`lib/wiki/modules-meta.ts`](../../../lib/wiki/modules-meta.ts).
  Πρόσθεσε `helpAnchor` στα αντίστοιχα `<PageHeader>`.

---

## 6. Testing

- Unit (vitest):
  - `requirementApplies`: appliesToAll=true → πάντα· κενό join → false· match/no-match τύπου· null
    company type → false.
  - `resolveBusinessTypeId`: override κρατιέται· χωρίς override ακολουθεί legalType mapping· null όταν
    δεν υπάρχει mapping.
  - `findOrCreateByName` (phase templates / categories): idempotent σε διπλό name (case/trim).
- Integration: PUT requirement business-types set (delete+create transaction)· DELETE business-type σε
  χρήση → 409· creatable POST διπλό name → 200 υπάρχον.

## Εκτός scope (YAGNI)

- Γενικό `BusinessTypeAlias` table για ΑΑΔΕ/SoftOne free-text (επιλέχθηκε LegalType+override).
- Scoping ανά μέγεθος/κλάδο/άλλα κριτήρια (μόνο νομική μορφή τώρα).
- Αυτόματη πρόταση mapping με fuzzy matching (μόνο best-effort seed + χειροκίνητο).
- Versioning/ιστορικό αλλαγών στο mapping.

---

## Σειρά υλοποίησης (προτεινόμενες φάσεις για το plan)

1. **Catalogs + migrations**: `BusinessType`, `DocumentCategory`, `PhaseTemplate` models + CRUD API +
   data migration κατηγοριών + seed business types.
2. **Mapping**: `LegalType.businessTypeId` + `Company.businessTypeId/override` + resolution lib +
   `/admin/business-types` αντιστοίχιση + πεδίο στη φόρμα εταιρίας.
3. **Requirement scoping**: `RequirementBusinessType` + `appliesToAll` + PUT API + UI στο phases-tab +
   creatable combos (κατηγορίες & φάσεις).
4. **Αυτόματη παραγωγή**: on-demand φιλτραρισμένη λίστα required-documents (derived, όχι stored) +
   warnings στη ροή εταιρίας-σε-πρόγραμμα.
5. **Wiki** entries + helpAnchors (σε κάθε φάση που αλλάζει UI).
