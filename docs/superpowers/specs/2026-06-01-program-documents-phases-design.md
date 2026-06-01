# Design: Διαχείριση Δικαιολογητικών, Φάσεων Προγραμμάτων, Ειδοποιήσεων & Secure Upload Links

**Ημερομηνία:** 2026-06-01
**Κατάσταση:** Approved design → προς writing-plans

## Σκοπός

Διαχείριση δικαιολογητικών (supporting documents) για εταιρίες που εντάσσονται σε Ευρωπαϊκά
Προγράμματα. Καλύπτει:

1. Global κατάλογο **τύπων δικαιολογητικών** (επαναχρησιμοποιήσιμοι, π.χ. «Καταστατικό»).
2. **Φάσεις** ανά πρόγραμμα (ελεύθερες) και συσχέτιση τύπων↔φάσης με υποχρεωτικότητα.
3. **Βιβλιοθήκη δικαιολογητικών** ανά εταιρία (instances με ιστορικό + ημερομηνία λήξης).
4. **Οθόνη συμμόρφωσης** (checklist) ανά εταιρία × πρόγραμμα × φάση.
5. **Ειδοποιήσεις λήξης** (in-app + email) με ρυθμίσεις & cron.
6. **Secure upload link** — tokenized public wizard για εξωτερικό λήπτη (π.χ. λογιστή).

## Αποφάσεις (από brainstorming)

- Τύποι δικαιολογητικών: **ενιαίος global κατάλογος**.
- Instances ανά τύπο/εταιρία: **ιστορικό (πολλά)** — ενεργό = πιο πρόσφατο μη-ληγμένο.
- Φάσεις: **ελεύθερες ανά πρόγραμμα**, χωρίς δικές τους ημερομηνίες (μένουν στο υπάρχον
  `ProgramDeadline`).
- Επιλογή δικαιολογητικών: **ανά πρόγραμμα ΚΑΙ ανά φάση**, με flag υποχρεωτικότητας.
- Scope v1: **πλήρες**, με checklist συμμόρφωσης.
- Καρτέλα εταιρίας: **νέα σελίδα `/admin/companies/[id]` με tabs** (δεν υπάρχει σήμερα).
- Ειδοποιήσεις: **in-app + email**· ρυθμίσεις: lead-time ημέρες, παραλήπτες, on/off ανά τύπο,
  συχνότητα digest.
- Upload link: scope = **συγκεκριμένοι τύποι (επιλογή admin)**· delivery = **copy + email**·
  διάρκεια = **επαναχρησιμοποιήσιμο έως τη λήξη**.

## Υπάρχον context (codebase)

- `Program` έχει ήδη `ProgramDeadline` (μόνο dates), `ProgramFile` (PDF οδηγού), `ProgramKad` κλπ.
- Σελίδα προγράμματος `/admin/programs/[id]` με `editor.tsx` + tabs (π.χ. questionnaire-tab).
- `CompanyDocument` υπάρχει αλλά είναι **GEMI-specific** — **δεν το αγγίζουμε**· νέο model για τα
  δικαιολογητικά.
- Καρτέλα εταιρίας = πίνακας + dialogs (`companies-view.tsx`, `CompanyTypesDialog`,
  `AssessmentDialog`). Δεν υπάρχει `/admin/companies/[id]`.
- File upload pattern: `lib/bunny.ts` → `bunnyUploadPrivate({key, body, contentType})`,
  `bunnyDownload`, `bunnyDelete`. storageKey scheme `programs/YYYY/MM/<slug>-<stem><ext>`,
  `publicUrl = "bunny:<key>"`. MIME allowlist (pdf/jpeg/png/webp), 50MB cap.
- Cron pattern: `app/api/cron/backup/route.ts` — Bearer secret από
  `getSetting('backups.cronSecret')` ή `process.env.CRON_SECRET`. (Δεν υπάρχει `vercel.json` crons —
  εξωτερικός scheduler.)
- Email: `lib/mailgun.ts` → `sendTransactionalEmail(to, subject, html)`.
- Settings: `lib/settings.ts` → `getSetting<T>(key)` / set.
- Sidebar: `components/admin/sidebar.tsx` με `badgeKey` σύστημα (`Badges`).
- Permissions: `requirePermission('x.y')`. Ρόλοι: `SUPER_ADMIN, ADMIN, EMPLOYEE, COLLABORATOR,
  SUPPLIER, CUSTOMER`.

---

## 1. Data model (Prisma)

### 1.1 DocumentType — global κατάλογος

```prisma
model DocumentType {
  id            String   @id @default(cuid())
  name          String   @unique                 // «Καταστατικό», «Φορολογική ενημερότητα»
  description   String?
  category      String?                           // ομαδοποίηση (προαιρετικά)
  requiresExpiry Boolean @default(true)           // αν true → ημ/νία λήξης υποχρεωτική στη φόρμα
  notifyExpiry  Boolean  @default(true)           // on/off ειδοποιήσεων λήξης ανά τύπο
  active        Boolean  @default(true)
  order         Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  requirements      PhaseDocumentRequirement[]
  supportingDocs    SupportingDocument[]
  uploadLinkTypes   UploadLinkType[]

  @@index([active])
}
```

Σημείωση λήξης: το `expiresAt` ζει στο instance· το `requiresExpiry` (default true) κάνει το πεδίο
υποχρεωτικό στη φόρμα. Για μόνιμα έγγραφα (π.χ. Καταστατικό) βάζεις `requiresExpiry=false`.

### 1.2 ProgramPhase — φάσεις ανά πρόγραμμα

```prisma
model ProgramPhase {
  id        String   @id @default(cuid())
  programId String
  program   Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  name      String                                 // «Υποβολή», «Ένταξη», «Υλοποίηση», «Ολοκλήρωση»
  order     Int      @default(0)
  createdAt DateTime @default(now())

  requirements PhaseDocumentRequirement[]

  @@index([programId])
}
```
(`Program` παίρνει `phases ProgramPhase[]`.)

### 1.3 PhaseDocumentRequirement — junction τύπος↔φάση

```prisma
model PhaseDocumentRequirement {
  id             String       @id @default(cuid())
  phaseId        String
  phase          ProgramPhase @relation(fields: [phaseId], references: [id], onDelete: Cascade)
  documentTypeId String
  documentType   DocumentType @relation(fields: [documentTypeId], references: [id], onDelete: Cascade)
  mandatory      Boolean      @default(true)
  notes          String?

  @@unique([phaseId, documentTypeId])
  @@index([phaseId])
  @@index([documentTypeId])
}
```

### 1.4 SupportingDocument — instances ανά εταιρία (ιστορικό)

```prisma
enum SupportingDocSource {
  INTERNAL        // ανέβηκε από admin/employee
  EXTERNAL_LINK   // ανέβηκε μέσω secure upload link
}

model SupportingDocument {
  id             String              @id @default(cuid())
  companyId      String
  company        Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  documentTypeId String
  documentType   DocumentType        @relation(fields: [documentTypeId], references: [id], onDelete: Restrict)
  // File (Bunny private)
  fileName       String
  storageKey     String              @unique
  publicUrl      String?                                   // "bunny:<key>"
  mimeType       String
  size           Int
  // Dates
  issuedAt       DateTime?
  expiresAt      DateTime?
  notes          String?
  // Provenance
  source         SupportingDocSource @default(INTERNAL)
  uploadLinkId   String?
  uploadLink     UploadLink?         @relation(fields: [uploadLinkId], references: [id], onDelete: SetNull)
  uploadedById   String?
  createdAt      DateTime            @default(now())

  @@index([companyId, documentTypeId])
  @@index([expiresAt])
}
```
(`Company` παίρνει `supportingDocs SupportingDocument[]`.)

### 1.5 Notifications

```prisma
enum NotificationType {
  DOC_EXPIRING
  DOC_EXPIRED
}

model Notification {
  id                   String           @id @default(cuid())
  type                 NotificationType
  severity             String           @default("warning")  // info | warning | danger
  companyId            String?
  supportingDocumentId String?
  title                String
  body                 String?
  dedupeKey            String           @unique               // "<docId>:<thresholdDays>" → no spam
  createdAt            DateTime         @default(now())

  reads NotificationRead[]

  @@index([createdAt])
  @@index([type])
}

model NotificationRead {
  id             String       @id @default(cuid())
  notificationId String
  notification   Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  userId         String
  readAt         DateTime     @default(now())

  @@unique([notificationId, userId])
  @@index([userId])
}
```

### 1.6 Upload links

```prisma
model UploadLink {
  id            String   @id @default(cuid())
  token         String   @unique                  // long random (nanoid 32)
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  createdById   String?
  label         String?
  message       String?                            // μήνυμα προς λήπτη (εμφανίζεται στο wizard)
  recipientEmail String?
  expiresAt     DateTime
  revokedAt     DateTime?
  lastUsedAt    DateTime?
  createdAt     DateTime @default(now())

  types          UploadLinkType[]
  supportingDocs SupportingDocument[]

  @@index([companyId])
  @@index([token])
}

model UploadLinkType {
  id             String       @id @default(cuid())
  uploadLinkId   String
  uploadLink     UploadLink   @relation(fields: [uploadLinkId], references: [id], onDelete: Cascade)
  documentTypeId String
  documentType   DocumentType @relation(fields: [documentTypeId], references: [id], onDelete: Cascade)

  @@unique([uploadLinkId, documentTypeId])
}
```

---

## 2. Σελίδες & UI

### 2.1 `/admin/document-types` (νέο sidebar item «Τύποι Δικαιολογητικών»)
CRUD πίνακας (pattern `reference-data`): name, category, requiresExpiry, notifyExpiry, active, order.
Permission: `metadata.read` (view) / `metadata.write` (CRUD) — reference data.
`<PageHeader helpAnchor="document-types" />`.

### 2.2 `/admin/programs/[id]` → νέο tab «Φάσεις & Δικαιολογητικά»
- CRUD φάσεων: add / rename / reorder (order) / delete.
- Μέσα σε κάθε φάση: multi-select τύπων από κατάλογο + toggle «Υποχρεωτικό» (mandatory) ανά τύπο.
- Permission: `programs.read` / `programs.update`.
- Client tab component όπως `questionnaire-tab.tsx`.

### 2.3 `/admin/companies/[id]` (ΝΕΑ σελίδα detail με tabs)
Minimal header (όνομα/ΑΦΜ εταιρίας) + tabs:
- **«Δικαιολογητικά»** — βιβλιοθήκη: upload (Bunny private), λίστα ομαδοποιημένη ανά τύπο, badge
  λήξης (✓ έγκυρο / ⚠ λήγει <30 ημ. / ✗ ληγμένο), ιστορικό παλιότερων ανά τύπο, download, delete.
  + Κουμπί «Δημιουργία link upload» (βλ. §2.6).
- **«Συμμόρφωση»** — επιλογή προγράμματος → ανά φάση τα απαιτούμενα δικαιολογητικά με status
  **OK / ΛΗΓΜΕΝΟ / ΛΕΙΠΕΙ** (matching ανά documentType, ενεργό = πιο πρόσφατο μη-ληγμένο).
  Υποχρεωτικά που λείπουν = blocking (κόκκινο).
- Permission: `companies.read` / `companies.update`.
- Link στη σελίδα από `companies-view.tsx` (row → detail).

### 2.4 `/admin/notifications` (νέο sidebar item, `badgeKey: 'unreadNotifications'`)
In-app κέντρο: λίστα ειδοποιήσεων (λήγει/ληγμένο) με link στην εταιρία, «mark read» / «read all».
Permission: νέο minimal `notifications.read`.

### 2.5 Ρυθμίσεις (section στο `/admin/settings` → `settings-form.tsx`)
- `docNotifications.enabled` (bool)
- `docNotifications.leadDays` (number[], default `[30,15,7]`)
- `docNotifications.recipientRoles` (RoleKey[]) + `docNotifications.recipientEmails` (string[])
- `docNotifications.digestFrequency` (`daily | weekly | off`)
- `docNotifications.cronSecret` (όπως backups) — ή reuse `CRON_SECRET`.
- Permission: `system.settings`.

### 2.6 Secure Upload Link — admin component + public wizard
**Admin** (στο «Δικαιολογητικά» tab): dialog «Δημιουργία link upload» → multi-select τύπων +
ημ/νία λήξης + optional recipient email/μήνυμα → εμφανίζει URL με **copy** + **«Αποστολή email»**.
Λίστα ενεργών/ληγμένων links με status (πόσα ανέβηκαν) + **revoke**.

**Public** `/upload/[token]` (εκτός `/admin`, χωρίς login):
- Server component validate (exists / μη-revoked / `expiresAt > now`) → αλλιώς error page.
- **Wizard** (dg-design-system): intro (εταιρία + ποια ζητούνται + λήξη link) → ένα step ανά
  τύπο (drag-drop upload + ημ/νία έκδοσης/λήξης αν `requiresExpiry`, με skip) → review → submit.
- Επαναχρησιμοποιήσιμο μέχρι τη λήξη (επιστροφή δείχνει τι ανέβηκε ήδη).

---

## 3. API routes (Next.js route handlers)

| Route | Methods | Permission |
|-------|---------|-----------|
| `/api/admin/document-types` | GET, POST | metadata.read / metadata.write |
| `/api/admin/document-types/[id]` | PATCH, DELETE | metadata.write |
| `/api/admin/programs/[id]/phases` | GET, POST | programs.read / programs.update |
| `/api/admin/programs/[id]/phases/[phaseId]` | PATCH, DELETE | programs.update |
| `/api/admin/programs/[id]/phases/[phaseId]/requirements` | POST, PATCH, DELETE | programs.update |
| `/api/admin/companies/[id]/documents` | GET, POST (upload) | companies.read / companies.update |
| `/api/admin/companies/[id]/documents/[docId]` | PATCH, DELETE | companies.update |
| `/api/admin/companies/[id]/documents/[docId]/file` | GET (download) | companies.read |
| `/api/admin/companies/[id]/compliance?programId=` | GET (computed checklist) | companies.read |
| `/api/admin/companies/[id]/upload-links` | GET, POST | companies.update |
| `/api/admin/companies/[id]/upload-links/[linkId]` | PATCH (revoke), DELETE | companies.update |
| `/api/admin/companies/[id]/upload-links/[linkId]/email` | POST (send) | companies.update |
| `/api/admin/notifications` | GET, POST (mark read / read all) | notifications.read |
| `/api/upload/[token]` | GET (meta), POST (upload) | **public** (token-validated) |
| `/api/cron/doc-expiry` | POST/GET | Bearer secret |

Όλα τα upload routes: MIME allowlist (pdf/jpeg/png/webp), 50MB cap, sanitize filename, Bunny private,
storageKey `company-docs/<companyId>/YYYY/MM/<slug>-<stem><ext>`.

---

## 4. Cron: ειδοποιήσεις λήξης

`app/api/cron/doc-expiry/route.ts` (Bearer secret pattern):
1. Αν `docNotifications.enabled=false` → skip.
2. Βρες τα **ενεργά** SupportingDocuments (πιο πρόσφατο ανά company+type) με `expiresAt` που περνά
   κάποιο κατώφλι από `leadDays` (ή ήδη ληγμένο), για τύπους με `notifyExpiry=true`.
3. Για κάθε crossing με `dedupeKey="<docId>:<threshold>"` που δεν υπάρχει → δημιούργησε
   `Notification` (DOC_EXPIRING/DOC_EXPIRED). Unique constraint → no spam.
4. Ανά `digestFrequency` (daily/weekly) → συγκεντρωτικό HTML email (Mailgun) στους παραλήπτες:
   union(emails χρηστών με ρόλο στο `recipientRoles`) + `recipientEmails`.
5. `logAudit` στο τέλος.
Σημ.: προσθήκη `vercel.json` cron entry· αλλιώς εξωτερικός scheduler (όπως το backup σήμερα).

---

## 5. Permissions, seeding, wiki

- Νέο permission: `notifications.read`. Reuse: `metadata.*` (document-types), `programs.*` (phases),
  `companies.*` (company docs + upload links), `system.settings` (notification settings).
  Πρόσθεσε `notifications.read` στο permission seed + στους ADMIN/EMPLOYEE ρόλους.
- Sidebar: νέα items «Τύποι Δικαιολογητικών», «Ειδοποιήσεις» (με badge). Το badge feed προσθέτει
  `unreadNotifications` στο `Badges`.
- **Wiki** (υποχρεωτικό από CLAUDE.md) — scaffold + content (Ελληνικά) + helpAnchors:
  - `documents/document-types`
  - `programs/phases`
  - `companies/supporting-documents`
  - `companies/program-compliance`
  - `companies/upload-links`
  - `notifications/document-expiry`
  Αν λείπουν modules (`documents`, `notifications`) → πρόσθεσε στο `lib/wiki/modules-meta.ts`.

---

## 6. Μονάδες / interfaces (isolation)

- `lib/documents/compliance.ts` — pure: `computeCompliance(companyId, programId)` →
  φάσεις × requirements × status. Testable χωρίς UI.
- `lib/documents/expiry.ts` — pure: `classifyExpiry(expiresAt, leadDays)` → `valid|expiring|expired`,
  `findActiveDoc(docs)` (πιο πρόσφατο μη-ληγμένο). Μοιράζεται από checklist + cron + badges.
- `lib/upload-links.ts` — token gen, validate(token) → `{ valid, link, reason }`.
- `lib/notifications.ts` — `createIfAbsent(dedupeKey, …)`, `unreadCountForUser(userId)`.

---

## Testing

- Unit (vitest): `classifyExpiry` (boundaries: ληγμένο/σήμερα/εντός lead/εκτός), `findActiveDoc`
  (πολλά instances, ληγμένα), `computeCompliance` (mandatory missing → blocking· expired → ΛΗΓΜΕΝΟ),
  upload-link `validate` (expired/revoked/valid), cron dedupe (δεν ξαναστέλνει).
- Integration: upload route MIME/size rejects· public token route 410 σε ληγμένο.

## Εκτός scope (YAGNI)

Shared phase templates, ανά-φάση ημερομηνίες, push notifications, πλήρης company overview tab,
versioning/diff αρχείων, antivirus scan.
