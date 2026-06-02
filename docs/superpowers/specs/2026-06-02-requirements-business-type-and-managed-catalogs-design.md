# Design: Δικαιολογητικά ανά Τύπο Επιχείρησης + Managed Catalogs (Κατηγορίες, Φάσεις)

**Ημερομηνία:** 2026-06-02
**Κατάσταση:** Draft → προς user review → writing-plans
**Σχετικό προηγούμενο spec:** [`2026-06-01-program-documents-phases-design.md`](./2026-06-01-program-documents-phases-design.md)
(αυτό το spec **αναιρεί** το «Shared phase templates» που εκεί ήταν εκτός scope/YAGNI.)

## Σκοπός

Όταν προσθέτουμε δικαιολογητικά σε ένα Ευρωπαϊκό Πρόγραμμα, θέλουμε να ορίζουμε **σε ποιες νομικές
μορφές** (ΑΕ, ΕΠΕ, ΙΚΕ, ΟΕ, ΕΕ, Ατομική…) ισχύει το κάθε δικαιολογητικό (π.χ. «ΕΜΕ 2025» μόνο για
ΕΠΕ/ΑΕ). Οι **διαθέσιμες προς επιλογή μορφές περιορίζονται σε αυτές που συμμετέχουν στο συγκεκριμένο
πρόγραμμα** — αυτές που βρίσκει ήδη το **scan** του οδηγού (`ProgramEligibleLegalForm`). Έτσι, όταν
μια εταιρία εντάσσεται σε πρόγραμμα, η εφαρμογή διαβάζει τη νομική της μορφή + το πρόγραμμα και
**αυτόματα** γνωρίζει τι δικαιολογητικά χρειάζονται.

Παράλληλα, μετατρέπουμε δύο σημερινά free-text πεδία σε **διαχειριζόμενες λίστες (managed catalogs)
με creatable combo boxes**:
1. **Κατηγορία δικαιολογητικού** (`DocumentType.category`) → κατάλογος + combo box, με tab διαχείρισης
   μέσα στο modal των τύπων δικαιολογητικών.
2. **Όνομα φάσης** (`ProgramPhase.name`) → κατάλογος προτύπων φάσεων + creatable combo box στην
   προσθήκη φάσης.

## Αποφάσεις (από brainstorming)

- Scope εφαρμογής: **ανά νομική μορφή**, όχι ανά μεμονωμένη εταιρία. **Πολλαπλές** μορφές ανά
  δικαιολογητικό (many-to-many).
- Πηγή διαθέσιμων μορφών ανά πρόγραμμα: το **scan** (`ProgramEligibleLegalForm`) — οι επιλογές στο
  requirement περιορίζονται σε αυτές.
- Χαρτογράφηση εταιρία/πρόγραμμα → κανονική μορφή: **reuse του υπάρχοντος `canonicalLegalForm()`**
  ([lib/programs/eligibility.ts:41](../../../lib/programs/eligibility.ts)). **Χωρίς** χειροκίνητο ΓΕΜΗ
  mapping.
- Καθολικός κατάλογος: **`BusinessType` = thin seeded lookup** (`code` = canonical key, π.χ. «ΑΕ»·
  `name` = ελληνικό label). Σταθερό FK target για links + εμφάνιση.
- Δικαιολογητικό **χωρίς** επιλεγμένες μορφές ⇒ **ζητείται από κανέναν**. Για καθολικά υπάρχει ρητό
  flag `appliesToAll`.
- Combo boxes (κατηγορίες & φάσεις): **creatable**.
- Scope v1: **ρύθμιση + αυτόματη παραγωγή** — η λίστα απαιτούμενων δικαιολογητικών ανά εταιρία
  **δεν αποθηκεύεται**· προκύπτει on-demand ως συνάρτηση `company canonical form × program requirements`.

## Υπάρχον context (codebase)

- `model CompanyType` ([prisma/schema.prisma:218](../../../prisma/schema.prisma)) **υπάρχει ήδη** αλλά
  σημαίνει σχέση Πελάτης/Προμηθευτής/Συνεργάτης (TRDR), **όχι** νομική μορφή. **Δεν το αγγίζουμε** και
  ο νέος κατάλογος ονομάζεται **`BusinessType`**.
- **Scan / extraction**: `lib/programs/extract.ts` (DeepSeek) γεμίζει `extractedData` και, μέσω
  `app/api/admin/programs/route.ts` + `.../[id]/reextract/route.ts`, το `eligibleLegalForms: string[]`
  → δημιουργεί `ProgramEligibleLegalForm` (free-text `name`, mixed format· βλ. πρόμπτ
  [lib/programs/templates.ts:40](../../../lib/programs/templates.ts)). Tab «Νομικές μορφές» στον
  `editor.tsx` (ListEditor name+notes) επιτρέπει χειροκίνητη επεξεργασία.
  ⚠ Σημαντικό: τα `ProgramEligibleLegalForm` rows **ξαναδημιουργούνται** σε re-extract / manual save
  (deleteMany+createMany) → **δεν** κάνουμε FK εκεί· τα requirements δένουν στο σταθερό `BusinessType`.
- **`canonicalLegalForm(s)`** ([lib/programs/eligibility.ts:41](../../../lib/programs/eligibility.ts))
  ήδη κανονικοποιεί κάθε free-text σε σταθερό κλειδί (`ΑΕ, ΕΠΕ, ΙΚΕ, ΟΕ, ΕΕ, ΑΤΟΜΙΚΗ, ΣΥΝΕΤΑΙΡΙΣΜΟΣ,
  ΚΟΙΝΣΕΠ, ΚΟΙΣΠΕ, ΑΜΚΕ`, αλλιώς το stripped raw). Χρησιμοποιείται ήδη στο eligibility matching.
  **Το επαναχρησιμοποιούμε** και για το matching εδώ — και στην εταιρία και στο πρόγραμμα.
- Νομική μορφή εταιρίας: `Company.legalForm` (free-text), fallback `Company.legalTypeRef?.descr` (ΓΕΜΗ).
- `PhaseDocumentRequirement` = junction (phase ↔ documentType) με `mandatory`, `notes`.
- `DocumentType.category` = `String?` (free text)· `@@unique([name])`. `ProgramPhase.name` = ελεύθερο.
- Σύνδεση εταιρία↔πρόγραμμα = `CompanyAssessment`.
- UI/API: `app/admin/programs/[id]/phases-tab.tsx`, `app/admin/document-types/document-types-client.tsx`,
  `app/api/admin/programs/[id]/phases/...`, `app/api/admin/document-types/...`.
  `requirePermission('programs.update' | 'metadata.manage')`.
- Prisma: Postgres· `migrate dev` σπασμένο → `db push` + manual SQL + `migrate resolve`.
- Combo box: shadcn `Command`/`Popover` (creatable pattern).

---

## 1. Data model (Prisma)

### 1.1 `BusinessType` — thin seeded lookup νομικών μορφών (νέο)

```prisma
model BusinessType {
  id        String   @id @default(cuid())
  code      String   @unique           // canonical key από canonicalLegalForm(): «ΑΕ», «ΕΠΕ», «ΙΚΕ»…
  name      String                     // ελληνικό label: «Ανώνυμη Εταιρεία», «Ι.Κ.Ε.»…
  order     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  companies    Company[]
  requirements RequirementBusinessType[]

  @@index([active])
  @@index([order])
}
```

Seed από το γνωστό canonical set (βλ. §5). Σχεδόν στατικό — admin το πειράζει σπάνια (label/order/
active). **Δεν** υπάρχει ΓΕΜΗ mapping table.

### 1.2 Χαρτογράφηση εταιρία → BusinessType (μέσω canonicalLegalForm)

```prisma
model Company {
  // … υπάρχοντα πεδία …
  businessTypeId       String?               // cached resolved τύπος (matching reads αυτό)
  businessType         BusinessType? @relation(fields: [businessTypeId], references: [id], onDelete: SetNull)
  businessTypeOverride Boolean @default(false) // true = χειροκίνητο, δεν το πειράζει το auto-resolve

  @@index([businessTypeId])
}
```

**Resolution** (`lib/companies/business-type.ts`, pure, reuse `canonicalLegalForm`):
- Αν `businessTypeOverride === true` → κράτα το υπάρχον `businessTypeId`.
- Αλλιώς: `key = canonicalLegalForm(company.legalForm ?? company.legalTypeRef?.descr ?? '')` →
  βρες `BusinessType` με `code === key` → set `businessTypeId` (ή `null` αν δεν υπάρχει αντιστοιχία).
- Καλείται μετά από ΓΕΜΗ/ΑΑΔΕ/SoftOne sync, μετά από αλλαγή `legalForm`, και on-demand bulk.
- `null` ⇒ «μη αναγνωρισμένη μορφή» — surface warning στην παραγωγή απαιτούμενων δικαιολογητικών.

(Δεν προσθέτουμε `businessTypeId` στο `LegalType` — η κανονικοποίηση καλύπτει τη χαρτογράφηση.)

### 1.3 `RequirementBusinessType` — scoping requirement ↔ μορφή (νέο junction)

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
  appliesToAll  Boolean @default(false)        // true = όλες οι μορφές (αγνοεί το join)
  businessTypes RequirementBusinessType[]
}
```

**Matching** (`lib/documents/requirement-scope.ts`, pure):
`requirementApplies(req, companyBusinessTypeId)` →
- `req.appliesToAll === true` → `true`
- αλλιώς `companyBusinessTypeId != null && req.businessTypes.some(t => t.businessTypeId === companyBusinessTypeId)`
- κενό join + `appliesToAll=false` ⇒ `false` (ζητείται από κανέναν).

**Διαθέσιμες επιλογές ανά πρόγραμμα** (`lib/programs/eligible-business-types.ts`, pure):
`eligibleBusinessTypes(program)` = distinct `BusinessType` που προκύπτουν από
`program.legalForms.map(lf => canonicalLegalForm(lf.name))` → match σε `BusinessType.code`. Το UI του
requirement προσφέρει **μόνο αυτές**. Αν δεν υπάρχουν εξαγμένες μορφές → πέφτει σε όλο τον ενεργό
`BusinessType` κατάλογο (με ένδειξη «το πρόγραμμα δεν έχει δηλωμένες μορφές»).

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
  category    String?            // ⚠ deprecated — διατηρείται για migration, μετά drop
  categoryId  String?            // ← νέο FK
  categoryRef DocumentCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@index([categoryId])
}
```

**Migration δεδομένων:** για κάθε distinct μη-κενό `DocumentType.category` → `DocumentCategory`
(idempotent) + set `categoryId`. Σε δεύτερη φάση drop το `category` text column.

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
  phaseTemplateId String?
  phaseTemplate   PhaseTemplate? @relation(fields: [phaseTemplateId], references: [id], onDelete: SetNull)
}
```

`ProgramPhase.name` **παραμένει** (denormalized copy). Creatable combo: υπάρχον πρότυπο → set
`phaseTemplateId` + `name`· νέα τιμή → δημιουργεί `PhaseTemplate` και συνδέει.

---

## 2. API routes

| Route | Methods | Permission |
|-------|---------|-----------|
| `/api/admin/business-types` | GET, POST | metadata.read / metadata.manage |
| `/api/admin/business-types/[id]` | PATCH, DELETE | metadata.manage |
| `/api/admin/document-categories` | GET, POST | metadata.read / metadata.manage |
| `/api/admin/document-categories/[id]` | PATCH, DELETE | metadata.manage |
| `/api/admin/phase-templates` | GET, POST | metadata.read / metadata.manage |
| `/api/admin/phase-templates/[id]` | PATCH, DELETE | metadata.manage |
| `/api/admin/programs/[id]/eligible-business-types` | GET (derived options για το UI) | programs.read |
| `/api/admin/programs/[id]/phases/[phaseId]/requirements/[reqId]/business-types` | PUT (set λίστα + appliesToAll) | programs.update |
| `/api/admin/companies/[id]/required-documents?programId=` | GET (on-demand φιλτραρισμένο) | companies.read |

**Σημειώσεις:**
- PUT requirement business-types: `{ appliesToAll: boolean, businessTypeIds: string[] }` → set όλη τη
  λίστα (delete+create σε transaction). Server validate ότι τα ids είναι έγκυρα `BusinessType`·
  **προαιρετικό warning** (όχι block) αν κάποιο δεν ανήκει στις eligible του προγράμματος.
- Creatable POST (`document-categories` / `phase-templates`): διπλό `name` → 200 με υπάρχον (όχι 409).
- DELETE σε lookups: αν χρησιμοποιείται → 409 «απενεργοποίησέ το» (`active=false`), pattern όπως το
  `document-types` DELETE.
- Δεν χρειάζονται routes για ΓΕΜΗ mapping (καταργήθηκε).

---

## 3. UI

### 3.1 `/admin/business-types` (νέο sidebar item «Νομικές Μορφές»)
Minimal CRUD πίνακας (code, name, order, active) — κυρίως seeded, σπάνια αλλαγή. **Χωρίς** οθόνη
αντιστοίχισης ΓΕΜΗ. `<PageHeader helpAnchor="business-types" />`. View `metadata.read`, CRUD
`metadata.manage`.

### 3.2 Φόρμα εταιρίας → πεδίο «Νομική μορφή (τύπος)»
Δείχνει την auto-resolved μορφή (από `canonicalLegalForm`). Combo box (από `BusinessType`) για
χειροκίνητο override → `businessTypeOverride=true`. Κουμπί «Επαναφορά σε αυτόματο» → `override=false`
+ re-resolve. (Αν δεν υπάρχει σήμερα edit form εταιρίας, προστίθεται minimal section· ακριβής τοποθεσία
επιβεβαιώνεται στο plan.)

### 3.3 `document-types-client.tsx` (modal) — δύο αλλαγές
- Πεδίο «Κατηγορία» → **creatable combo box** (από `DocumentCategory`).
- Νέο **tab «Κατηγορίες»** στο ίδιο modal/σελίδα: CRUD κατηγοριών (name, order, active).

### 3.4 `phases-tab.tsx` — δύο αλλαγές
- Προσθήκη φάσης: από text input → **creatable combo box** (από `PhaseTemplate`).
- Ανά requirement: νέο control «Ισχύει για» = multi-select νομικών μορφών **περιορισμένο στις eligible
  του προγράμματος** (από `/eligible-business-types`) **ή** checkbox «Όλες οι μορφές» (`appliesToAll`).
  - Κενό & όχι «Όλες» → warning «δεν θα ζητηθεί από καμία εταιρία».
  - Αν επιλεγμένη μορφή δεν είναι πια eligible (μετά από re-extract) → ένδειξη «εκτός προγράμματος».
- Διαχείριση καταλόγου προτύπων φάσεων: link προς `/admin/phase-templates`.

### 3.5 Αυτόματη παραγωγή απαιτούμενων δικαιολογητικών (όχι ξεχωριστή οθόνη/entity)
Όταν μια εταιρία είναι ενταγμένη σε πρόγραμμα (`CompanyAssessment`), η λίστα **υπολογίζεται on-demand**:
`filterRequirements(programRequirements, company.businessTypeId)` (§1.3) — ομαδοποιημένα ανά φάση, με
υποχρεωτικό/προαιρετικό. Εμφανίζεται στην υπάρχουσα ροή εταιρίας-σε-πρόγραμμα. Αν
`company.businessTypeId == null` → banner «η εταιρία δεν έχει αναγνωρισμένη νομική μορφή — όρισέ τη» +
link. (Ακριβής σελίδα/route επιβεβαιώνεται στο plan.)

---

## 4. Μονάδες / interfaces (isolation, testable)

- `lib/companies/business-type.ts` — `resolveBusinessTypeId(company, catalog): string | null` (pure,
  reuse `canonicalLegalForm`)· `reResolveAll()` bulk (skip overrides).
- `lib/programs/eligible-business-types.ts` — `eligibleBusinessTypes(program, catalog)` (pure, reuse
  `canonicalLegalForm`).
- `lib/documents/requirement-scope.ts` — `requirementApplies(req, companyBusinessTypeId)` /
  `filterRequirements(...)` (pure).
- `lib/documents/document-categories.ts` + `lib/programs/phase-templates.ts` — normalize/validate +
  `findOrCreateByName(name)` (creatable, idempotent).

---

## 5. Permissions, seeding, wiki

- **Permissions:** reuse `metadata.read`/`metadata.manage`, `programs.read`/`programs.update`,
  `companies.read`/`companies.update`. **Δεν** χρειάζεται νέο permission.
- **Seeding `BusinessType`** (code → name), ευθυγραμμισμένο με `canonicalLegalForm` outputs:
  `ΑΕ`→«Ανώνυμη Εταιρεία», `ΕΠΕ`→«Ε.Π.Ε.», `ΙΚΕ`→«Ιδιωτική Κεφαλαιουχική (Ι.Κ.Ε.)»,
  `ΟΕ`→«Ομόρρυθμη (Ο.Ε.)», `ΕΕ`→«Ετερόρρυθμη (Ε.Ε.)», `ΑΤΟΜΙΚΗ`→«Ατομική Επιχείρηση»,
  `ΣΥΝΕΤΑΙΡΙΣΜΟΣ`, `ΚΟΙΝΣΕΠ`, `ΚΟΙΣΠΕ`, `ΑΜΚΕ`. (Το seed ζει στο `prisma/seed*` ή σε migration.)
- **Wiki** (υποχρεωτικό CLAUDE.md) — scaffold + content Ελληνικά + helpAnchors:
  - `companies/business-types` (νέα) — τι είναι, σχέση με canonicalLegalForm & scan.
  - Update `documents/document-types` — managed κατηγορίες + combo box.
  - Update `programs/phases` — phase templates + scoping requirements ανά μορφή (από scan).
  - `companies/required-documents` (νέα) — αυτόματη παραγωγή checklist.
  Αν λείπει module → πρόσθεσε στο [`lib/wiki/modules-meta.ts`](../../../lib/wiki/modules-meta.ts).
  `helpAnchor` στα αντίστοιχα `<PageHeader>`.

---

## 6. Testing

- Unit (vitest):
  - `requirementApplies`: appliesToAll=true → πάντα· κενό join → false· match/no-match· null company.
  - `resolveBusinessTypeId`: override κρατιέται· χωρίς override ακολουθεί `canonicalLegalForm`· null όταν
    κανένα code δεν ταιριάζει.
  - `eligibleBusinessTypes`: free-text scan μορφές («Ι.Κ.Ε.», «Ανώνυμη Εταιρεία») → σωστά
    `BusinessType` codes· dedupe· κενές μορφές → fallback.
  - `findOrCreateByName` (categories / phase templates): idempotent σε διπλό name (case/trim).
- Integration: PUT requirement business-types (transaction)· DELETE business-type σε χρήση → 409·
  creatable POST διπλό name → 200· `GET required-documents` φιλτράρει σωστά ανά μορφή εταιρίας.

## Εκτός scope (YAGNI)

- Χειροκίνητο ΓΕΜΗ/LegalType→BusinessType mapping (αντικαταστάθηκε από `canonicalLegalForm`).
- `BusinessTypeAlias` table για ΑΑΔΕ/SoftOne free-text.
- Scoping ανά μέγεθος/κλάδο/άλλα κριτήρια (μόνο νομική μορφή).
- Versioning/ιστορικό αλλαγών.

---

## Σειρά υλοποίησης (προτεινόμενες φάσεις για το plan)

1. **Catalogs + migrations**: `BusinessType` (+seed), `DocumentCategory`, `PhaseTemplate` models + CRUD
   API + data migration κατηγοριών.
2. **Company resolution**: `Company.businessTypeId/override` + `lib/companies/business-type.ts`
   (canonicalLegalForm) + re-resolve στο sync + πεδίο στη φόρμα εταιρίας.
3. **Requirement scoping**: `RequirementBusinessType` + `appliesToAll` + `eligible-business-types`
   endpoint + PUT API + UI στο phases-tab (multi-select περιορισμένο στις μορφές του scan) + creatable
   combos (κατηγορίες & φάσεις).
4. **Αυτόματη παραγωγή**: on-demand φιλτραρισμένη λίστα required-documents (derived) + warnings στη ροή
   εταιρίας-σε-πρόγραμμα.
5. **Wiki** entries + helpAnchors (σε κάθε φάση που αλλάζει UI).
