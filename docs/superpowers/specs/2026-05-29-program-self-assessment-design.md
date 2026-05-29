# Αυτοαξιολόγηση Προγραμμάτων & Αξιολόγηση Εταιριών — Design Spec

**Ημερομηνία:** 2026-05-29
**Status:** Draft → προς έγκριση
**Πρόγραμμα δοκιμής:** `cmpo0byg200009id4dhuh43iw`

## 1. Πρόβλημα / Στόχος

Πολλές ΕΣΠΑ προσκλήσεις περιέχουν κριτήριο τύπου:

> «Η αίτηση πρέπει να συγκεντρώνει βαθμολογία ≥75 στην αυτοαξιολόγηση βάσει των κριτηρίων του Παραρτήματος ΙΙΙ.»

Σήμερα τα κριτήρια αποθηκεύονται ως απλά text blocks (`ProgramCriterion`) — read-only, χωρίς δυνατότητα υπολογισμού. Θέλουμε:

1. Όταν το DeepSeek (που ήδη κάνει την ανάλυση του PDF) **εντοπίσει** τέτοιο κριτήριο, να **δημιουργεί αυτόματα** ένα διαδραστικό **ερωτηματολόγιο αυτοαξιολόγησης** με βάρη/μόρια και κατώφλι.
2. Ο ορισμός του ερωτηματολογίου να είναι **επεξεργάσιμος** από τον admin (επέμβαση στο auto-generated).
3. Ο admin να **αξιολογεί εταιρίες** για ένα πρόγραμμα: αυτόματος έλεγχος βασικών (αντικειμενικών) κριτηρίων από τα καταχωρημένα στοιχεία της εταιρίας + συμπλήρωση του ερωτηματολογίου (αν υπάρχει) → σκορ + PASS/FAIL.
4. **Πολλές εταιρίες ανά πρόγραμμα.** Ο ορισμός του ερωτηματολογίου ανήκει στο **πρόγραμμα**· τα αποτελέσματα ανήκουν στην **εταιρία**.

## 2. Αποφάσεις (locked)

| Θέμα | Απόφαση |
|---|---|
| Τύπος | Διαδραστικό ερωτηματολόγιο με **αυτόματο σκορ** |
| Πηγή περιεχομένου | **Υβριδικό**: πρώτα ο πίνακας Παραρτήματος από το PDF, fallback στα `ProgramCriterion` |
| Trigger δημιουργίας | **Auto** κατά την ανάλυση (αν εντοπιστεί) **+ κουμπί manual re-generate** |
| Κοινό | Admin/Employee στο `/admin` (για λογαριασμό πελάτη) |
| Scoring model | **Ευέλικτο**: υποστηρίζει `WEIGHTED` (συντελεστές βαρύτητας) **και** `POINTS_SUM` |
| Αποθήκευση | **Πολλαπλές** αξιολογήσεις (μη-unique ανά program×company → ιστορικό· UI δείχνει τελευταία) |
| Αρχιτεκτονική | **Προσέγγιση C** — relational & editable ορισμός, relational απαντήσεις, denormalized score/passed |
| Ορισμός ερωτηματολογίου | Ανήκει στο **Program** (φτιάχνεται/εκδίδεται από τη σελίδα προγράμματος) |
| Αποτελέσματα | Ανήκουν στην **Company** (ορατά στην καρτέλα εταιρίας) |
| Entry point αξιολόγησης | Action **«Αξιολόγηση»** στο actions-dropdown της εταιρίας |
| Γέννηση ερωτηματολογίου | **Ξεχωριστή 2η κλήση DeepSeek** (όχι inline στο extraction) |
| RBAC | Reuse `programs.read` / `programs.update` (χωρίς νέα permissions προς το παρόν) |

## 3. Αρχιτεκτονική — Συνιστώσες

```
Extraction (υπάρχον)            Generation (νέο)              Evaluation (νέο)
─────────────────────          ──────────────────            ───────────────────
lib/programs/extract.ts        lib/programs/                  lib/programs/
  + selfAssessment flag          questionnaire.ts              eligibility.ts        (βασικά κριτήρια)
                                 (2η κλήση DeepSeek)           assessment-autofill.ts (αντικειμενικά → απαντήσεις)
                                                               assessment-score.ts    (WEIGHTED/POINTS_SUM)
```

### 3.1 Ανίχνευση (στο υπάρχον extraction)

Προσθήκη ενός μικρού πεδίου στο `PROGRAM_SYSTEM_PROMPT` output schema (στο [lib/programs/templates.ts](lib/programs/templates.ts)). Η κύρια ανάλυση σηματοδοτεί **μόνο αν** υπάρχει αυτοαξιολόγηση — όχι τις ερωτήσεις (αποφυγή υπέρβασης του 8192-token output budget):

```jsonc
"selfAssessment": {
  "required": true|false,
  "threshold": number|null,     // π.χ. 75
  "maxScore": number|null,      // π.χ. 100
  "scoringModel": "WEIGHTED"|"POINTS_SUM"|null,
  "sourceNote": "string|null"   // π.χ. "Παράρτημα III"
}
```

Αυτό αποθηκεύεται στο υπάρχον `Program.extractedData` (JSON) και χρησιμοποιείται ως σκανδάλη.

### 3.2 Δημιουργία ερωτηματολογίου — `lib/programs/questionnaire.ts`

`generateQuestionnaire(programId): Promise<QuestionnaireDraft>`

- **Δεύτερη, αποκλειστική** κλήση DeepSeek με focused prompt πάνω στο πλήρες κείμενο των αρχείων του προγράμματος (κατεβάζονται από Bunny όπως στο [reextract route](app/api/admin/programs/[id]/reextract/route.ts)).
- Μπορεί να τρέξει `deepseek-reasoner` (πιο ικανό για πίνακες μοριοδότησης).
- Hybrid πηγή: πρώτα ψάχνει τον πραγματικό πίνακα Παραρτήματος· αν δεν βρει, παράγει ερωτήσεις από τα `ProgramCriterion`.
- Logging κόστους μέσω `logAiUsage` (νέο operation `program.questionnaire`).

**Output schema (ανά ερώτηση):**

```jsonc
{
  "scoringModel": "WEIGHTED"|"POINTS_SUM",
  "threshold": 75,
  "maxScore": 100,
  "sourceNote": "Παράρτημα III",
  "questions": [
    {
      "code": "Q1",
      "text": "…",
      "criterionRef": "Παράρτημα III §2",
      "answerType": "BOOLEAN"|"SINGLE_CHOICE"|"NUMERIC"|"SCALE",
      "weight": number|null,          // για WEIGHTED
      "maxPoints": number|null,       // για POINTS_SUM
      "options": [ { "label": "…", "points": number } ],  // SINGLE_CHOICE/SCALE
      "companyField": "legalForm"|"operationalYears"|"employeeCount"|"region"|"kad"|null,
      "helpText": "string|null"
    }
  ]
}
```

Το `companyField` διακρίνει **αντικειμενικές** ερωτήσεις (auto-fill από στοιχεία εταιρίας) από **υποκειμενικές** (manual). Άγνωστο/null ⇒ manual.

### 3.3 Έλεγχος βασικών κριτηρίων — `lib/programs/eligibility.ts`

`evaluateEligibility(company, program): EligibilityResult`

Αυτόματος, αντικειμενικός έλεγχος των 5 structured πεδίων:

| Κριτήριο | Πηγή εταιρίας | vs Πρόγραμμα | Σημείωση |
|---|---|---|---|
| ΚΑΔ | `CompanyActivity[]` (PRIMARY/SECONDARY) | `kadRule` + `kads[]` (potential/excluded) | Λογική ανά `kadRule` |
| Νομική μορφή | `Company.legalForm` | `eligibleLegalForms[]` | Κενό πρόγραμμα ⇒ N/A |
| Προσωπικό | `Company.employeeCount` | `minEmployeesFte` | **Κατά προσέγγιση** (count ≈ ΕΜΕ) — flag |
| Έτη λειτουργίας | υπολ. από `Company.foundingDate` | `minOperationalYears` | |
| Περιφέρεια | `Company.regionCode` | `regions[]` (+ ποσοστό) | |

Επιστρέφει `{ criteria: [{ key, label, required, actual, pass, note }], eligible: boolean }`. Κριτήρια χωρίς απαίτηση στο πρόγραμμα → `pass: true, note: "δεν απαιτείται"`.

### 3.4 Auto-fill — `lib/programs/assessment-autofill.ts`

`autofillAnswers(company, questionnaire): DraftAnswer[]`

Για κάθε ερώτηση με `companyField`, διαβάζει την τιμή από την εταιρία, μαπάρει σε απάντηση + `pointsAwarded`, `source: AUTO`. Mappings ίδια με τον πίνακα §3.3. Ό,τι δεν αντιστοιχίζεται μένει κενό (`source: MANUAL`).

### 3.5 Scoring — `lib/programs/assessment-score.ts`

`computeScore(questionnaire, answers): { score, maxScore, passed }`

- **POINTS_SUM**: `score = Σ pointsAwarded`; `passed = score ≥ threshold`.
- **WEIGHTED**: ανά ερώτηση normalized βαθμός 0..1 × `weight`, άθροισμα / Σweight × `maxScore`; `passed = score ≥ threshold`.

Καθαρή συνάρτηση (pure) — χρησιμοποιείται και live στο UI και στο PATCH save.

## 4. Data model (Prisma)

Νέα μοντέλα στο `prisma/schema.prisma`. Ακολουθούν τα υπάρχοντα conventions (cuid id, `onDelete: Cascade`, indexes).

```prisma
enum QuestionnaireScoringModel { WEIGHTED  POINTS_SUM }
enum QuestionnaireStatus       { DRAFT  READY }
enum QuestionAnswerType        { BOOLEAN  SINGLE_CHOICE  NUMERIC  SCALE }
enum AssessmentStatus          { DRAFT  COMPLETED }
enum AssessmentVerdict         { ELIGIBLE  NOT_ELIGIBLE  NEEDS_REVIEW }
enum AnswerSource             { AUTO  MANUAL }

model ProgramQuestionnaire {
  id             String   @id @default(cuid())
  programId      String   @unique
  program        Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  title          String?
  description    String?  @db.Text
  scoringModel   QuestionnaireScoringModel @default(WEIGHTED)
  threshold      Decimal? @db.Decimal(8, 2)
  maxScore       Decimal? @db.Decimal(8, 2)
  sourceNote     String?
  status         QuestionnaireStatus @default(DRAFT)
  generatedModel String?
  generatedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  questions      ProgramQuestion[]
  assessments    CompanyAssessment[]
}

model ProgramQuestion {
  id              String   @id @default(cuid())
  questionnaireId String
  questionnaire   ProgramQuestionnaire @relation(fields: [questionnaireId], references: [id], onDelete: Cascade)
  code            String?
  text            String   @db.Text
  criterionRef    String?
  helpText        String?  @db.Text
  answerType      QuestionAnswerType @default(SINGLE_CHOICE)
  weight          Decimal? @db.Decimal(8, 2)
  maxPoints       Decimal? @db.Decimal(8, 2)
  companyField    String?                 // mapping key για auto-fill (null ⇒ manual)
  order           Int      @default(0)
  options         ProgramQuestionOption[]
  answers         AssessmentAnswer[]      // back-relation (required by Prisma)
  @@index([questionnaireId])
}

model ProgramQuestionOption {
  id          String  @id @default(cuid())
  questionId  String
  question    ProgramQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)
  label       String
  points      Decimal @db.Decimal(8, 2) @default(0)
  order       Int     @default(0)
  @@index([questionId])
}

model CompanyAssessment {
  id                  String   @id @default(cuid())
  companyId           String
  company             Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  programId           String
  program             Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  questionnaireId     String?
  questionnaire       ProgramQuestionnaire? @relation(fields: [questionnaireId], references: [id], onDelete: SetNull)
  // Βασικά κριτήρια (derived snapshot)
  eligible            Boolean?
  eligibilityResult   Json?
  // Ερωτηματολόγιο (null αν το πρόγραμμα δεν έχει)
  questionnaireScore  Decimal? @db.Decimal(8, 2)
  questionnaireMax    Decimal? @db.Decimal(8, 2)
  questionnairePassed Boolean?
  // Συνολικό
  overallVerdict      AssessmentVerdict @default(NEEDS_REVIEW)
  status              AssessmentStatus  @default(DRAFT)
  notes               String?  @db.Text
  createdById         String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  answers             AssessmentAnswer[]
  @@index([companyId])
  @@index([programId])
  @@index([programId, eligible])
}

model AssessmentAnswer {
  id               String  @id @default(cuid())
  assessmentId     String
  assessment       CompanyAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)
  questionId       String
  question         ProgramQuestion   @relation(fields: [questionId], references: [id], onDelete: Cascade)
  valueBool        Boolean?
  valueNumber      Decimal? @db.Decimal(14, 4)
  valueText        String?  @db.Text
  selectedOptionId String?
  pointsAwarded    Decimal? @db.Decimal(8, 2)
  source           AnswerSource @default(MANUAL)
  @@index([assessmentId])
  @@index([questionId])
}
```

Προσθήκη relations στα υπάρχοντα μοντέλα: `Program.questionnaire ProgramQuestionnaire?`, `Program.assessments CompanyAssessment[]`, `Company.assessments CompanyAssessment[]`.

## 5. API routes

**Ορισμός ερωτηματολογίου (program side):**
- `POST /api/admin/programs/[id]/questionnaire/generate` — (ανα)δημιουργία μέσω DeepSeek· full-replace των questions/options.
- `PATCH /api/admin/programs/[id]/questionnaire` — αποθήκευση edited ορισμού (full-replace pattern, όπως τα criteria στο [PATCH route](app/api/admin/programs/[id]/route.ts)).
- Ο ορισμός περιλαμβάνεται στο υπάρχον `GET /api/admin/programs/[id]`.

**Αξιολογήσεις (company side):**
- `POST /api/admin/companies/[id]/assessments` — body `{ programId }`· τρέχει `evaluateEligibility` + `autofillAnswers`, δημιουργεί `CompanyAssessment` (DRAFT) και επιστρέφει το draft (eligibility breakdown + προ-συμπληρωμένες απαντήσεις).
- `PATCH /api/admin/companies/[id]/assessments/[assessmentId]` — αποθήκευση απαντήσεων, recompute score + verdict.
- `GET /api/admin/companies/[id]/assessments` — λίστα αξιολογήσεων εταιρίας.
- `GET /api/admin/programs/[id]/assessments` — read-only λίστα εταιριών που αξιολογήθηκαν για το πρόγραμμα (πολλές εταιρίες ανά πρόγραμμα).

## 6. UI

### 6.1 Program editor — tab «Αυτοαξιολόγηση»
Στο [editor.tsx](app/admin/programs/[id]/editor.tsx), νέο tab:
- Εμφανίζει & **επεξεργάζεται** scoring model / threshold / maxScore / ερωτήσεις / options / βάρη.
- Κουμπί **«🪄 Δημιουργία/Αναδημιουργία με AI»** → καλεί το generate endpoint.
- Save μέσω full-replace PATCH.
- Επιπλέον: read-only λίστα «Αξιολογημένες εταιρίες» (από `GET …/[id]/assessments`).

### 6.2 Company actions — action «Αξιολόγηση»
Στο [companies-view.tsx](app/admin/companies/companies-view.tsx):
- Νέο `DropdownMenuItem` «Αξιολόγηση» (μετά το «Προσθήκη επαφής»), `onClick={() => setAssessing(c)}`.
- Νέο `AssessmentDialog` (pattern ContactDialog): props `companyId`, `companyName`.
- **Βήματα στο dialog:**
  1. Program picker (PUBLISHED προγράμματα).
  2. Πίνακας **βασικών κριτηρίων** με PASS/FAIL ανά γραμμή (από `POST …/assessments`).
  3. Αν υπάρχει ερωτηματολόγιο: φόρμα με προ-συμπληρωμένα αντικειμενικά (badge «από στοιχεία εταιρίας») + manual πεδία· **live σκορ + PASS/FAIL vs threshold**.
  4. Save → `router.refresh()`.
- Καρτέλα εταιρίας: section/λίστα προηγούμενων αξιολογήσεων.

## 7. Trigger ροή

- **Auto:** στο create/extract flow (`POST /api/admin/programs`) και στο reextract, μετά την εξαγωγή, αν `extractedData.selfAssessment.required === true` → `generateQuestionnaire(programId)` (best-effort, σφάλμα δεν ρίχνει το extraction).
- **Manual:** κουμπί στο tab → generate endpoint.

## 8. Wiki (υποχρεωτικό — CLAUDE.md)

1. `npm run wiki:new -- programs/self-assessment --roles "SUPER_ADMIN,ADMIN,EMPLOYEE" --title "Αυτοαξιολόγηση & Αξιολόγηση Εταιριών"`
2. Content (Ελληνικά): Επισκόπηση, `<Steps>` για (α) δημιουργία/επεξεργασία ερωτηματολογίου από το πρόγραμμα, (β) αξιολόγηση εταιρίας από το dropdown· `<Callout>` για το «κατά προσέγγιση» ΕΜΕ και για το destructive regenerate (αντικαθιστά υπάρχον ορισμό).
3. `helpAnchor="self-assessment"` στα `<PageHeader>` (program editor + companies view, ή νέα assessment view).
4. Screenshots frontmatter + `npm run wiki:screenshots`.

## 9. Δοκιμή (acceptance)

Με πρόγραμμα `cmpo0byg200009id4dhuh43iw`:
1. Regenerate ερωτηματολόγιο από το tab → επαληθεύεται ότι παρήχθησαν ερωτήσεις με βάρη/options.
2. Επεξεργασία μιας ερώτησης + save → persist.
3. Από εταιρία (με ΚΑΔ/νομική μορφή/foundingDate) → «Αξιολόγηση» → pick το πρόγραμμα.
4. Επαλήθευση: βασικά κριτήρια PASS/FAIL σωστά· αντικειμενικές ερωτήσεις προ-συμπληρωμένες.
5. Συμπλήρωση υποκειμενικών → live σκορ ≥/<75 → σωστό PASS/FAIL → save.
6. Η αξιολόγηση εμφανίζεται στην καρτέλα εταιρίας **και** στη λίστα του προγράμματος.

## 10. Out of scope (YAGNI — μελλοντικά)

- **Bulk auto-scoring όλων των εταιριών** (matching engine) — η υποδομή (denormalized `eligible`/`passed`, `programId` index) το προετοιμάζει, αλλά δεν υλοποιείται τώρα.
- Customer-facing συμπλήρωση (CUSTOMER/COLLABORATOR self-service).
- Export/PDF της αξιολόγησης.
- Νέα RBAC permissions (reuse υπαρχόντων).

## 11. Ανοιχτά ρίσκα

- **Ποιότητα εξαγωγής πίνακα Παραρτήματος:** οι πίνακες μοριοδότησης σπάνε σε pdfjs όπως οι ΚΑΔ· ίσως χρειαστεί positional harvesting αργότερα. MVP: βασιζόμαστε στο DeepSeek + fallback στα criteria.
- **ΕΜΕ vs employeeCount:** approximation· σημαίνεται στο UI/wiki.
- **Token budget** της 2ης κλήσης σε πολύ μεγάλα PDF — ίδιο cap 360k chars.
