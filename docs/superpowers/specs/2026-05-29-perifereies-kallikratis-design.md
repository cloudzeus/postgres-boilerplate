# Περιφέρειες (Καλλικράτης) — Μητρώο Αναφοράς & Αντιστοίχιση Εταιριών

**Date:** 2026-05-29
**Status:** Approved design (pending spec review)

## Σκοπός

Νέα οντότητα αναφοράς «Περιφέρειες» στα μητρώα, με τη δενδροειδή δομή του Καλλικράτη
(Περιφέρεια → Περιφερειακή Ενότητα/Νομός → Δήμος). Το UI/UX αντιγράφει το υπάρχον module ΚΑΔ.
Κάθε διεύθυνση εταιρίας/πελάτη/προμηθευτή (έδρα + υποκαταστήματα) μπορεί να αντιστοιχιστεί
σε κόμβο Δήμου, και ο εντοπισμός γίνεται **αυτόματα** κατά την εισαγωγή/ενημέρωση.

Πηγή δεδομένων: `public/periferies-2026-05-28.json` — 14 Περιφέρειες (level 3, περιλαμβάνει
Άγιο Όρος), 75 Περιφερειακές Ενότητες (level 4), 326 Δήμοι (level 5). Κάθε κόμβος:
`code`, `nameEL`, `nameEN`, `level`, `parentCode`, `latitude`, `longitude`, `children`.

## Αποφάσεις (επιβεβαιωμένες)

- **Auto-match:** Υβριδικό — πρώτα ταίριασμα ονόματος, μετά geocoding fallback.
- **Scope:** Έδρα εταιρίας (`Company`) + Υποκαταστήματα (`CompanyBranch`).
- **Storage:** Ένα FK στον κόμβο-Δήμο (level 5)· Π.Ε. + Περιφέρεια προκύπτουν από το δέντρο.
- **Legacy:** Τα υπάρχοντα `Prefecture`/`Municipality` (GEMI Open Data) μένουν **άθικτα** — δεν τα σπάμε.
- **id / dates από το JSON:** Απορρίπτονται. Δημιουργούμε δικά μας (`code` ως PK, δικά μας `createdAt`/`updatedAt`).
- Επιπλέον entry point: **actions dropdown** κάθε εταιρίας στη λίστα.

## Data Model (Prisma)

### Νέο model `Region` (self-referential, ίδιο pattern με `KadCode`)

```prisma
model Region {
  code        String   @id            // Καλλικράτης: "111", "11102", "1110202"
  nameEL      String
  nameEN      String?
  level       Int                      // 3=Περιφέρεια, 4=Περιφ. Ενότητα/Νομός, 5=Δήμος
  parentCode  String?
  parent      Region?  @relation("RegionHierarchy", fields: [parentCode], references: [code], onDelete: SetNull)
  children    Region[] @relation("RegionHierarchy")
  path        String?                  // "111>11102>1110202"
  latitude    Float?
  longitude   Float?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  companies       Company[]       @relation("CompanyRegion")
  companyBranches CompanyBranch[] @relation("BranchRegion")

  @@index([parentCode])
  @@index([level])
  @@index([nameEL])
}
```

### Πεδία στο `Company` (legacy fields αμετάβλητα)

```prisma
regionCode  String?
regionRef   Region? @relation("CompanyRegion", fields: [regionCode], references: [code])
// @@index([regionCode])
```

### Πεδία στο `CompanyBranch`

```prisma
regionCode  String?
regionRef   Region? @relation("BranchRegion", fields: [regionCode], references: [code])
// @@index([regionCode])
```

`regionCode` δείχνει συνήθως σε κόμβο level 5 (Δήμος). Επιτρέπεται και ανώτερο επίπεδο
(όταν ο εντοπισμός φτάνει μόνο μέχρι Π.Ε.). Η ιεραρχία προς τα πάνω προκύπτει από `parent`/`path`.

Migration: `prisma migrate dev --name add_region_kallikratis`.

## Seed — `prisma/seeds/regions.ts`

Mirrors `prisma/seeds/kad2026.ts`:
1. Διαβάζει `public/periferies-2026-05-28.json`.
2. Recursive flatten· **αγνοεί** `id`/`createdAt`/`updatedAt` από το JSON.
3. Υπολογίζει `path` (αλυσίδα `code` χωρισμένη με `>`).
4. Ταξινόμηση κατά `level` (parents πρώτα, για το FK).
5. Batch-upsert σε chunks (π.χ. 100) στο `Region`.

Νέο npm script: `"seed:regions": "tsx prisma/seeds/regions.ts"`.

## Matching library — `lib/regions/match.ts`

```ts
matchRegion(input: {
  city?: string; district?: string; address?: string; zip?: string; country?: string;
  municipalityId?: string;   // ΓΕΜΗ → Municipality.descr (υψηλό signal)
  prefectureId?: string;     // ΓΕΜΗ → Prefecture.descr (νομός)
  latitude?: number; longitude?: number;
}): Promise<{ regionCode: string; breadcrumb: RegionBreadcrumb; confidence: 'gemi' | 'name' | 'geo' } | null>
```

Αξιοποιούμε τα πλούσια δεδομένα **ΓΕΜΗ/ΑΑΔΕ** πριν το free-text. `coreName` αφαιρεί διοικητικά
προθέματα (`ΔΗΜΟΣ`, `Δ.`, `ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ`, `ΝΟΜΟΣ`, `ΠΕΡΙΦΕΡΕΙΑ`) ώστε να ταιριάζουν
οι επίσημες ονομασίες με το `nameEL` του Καλλικράτη. Σειρά:

1. **ΓΕΜΗ Δήμος** — αν `municipalityId`, resolve `Municipality.descr` και name-match στους
   level-5 κόμβους. → `confidence: 'gemi'` (το πιο αξιόπιστο· ΑΑΔΕ city τροφοδοτεί ήδη το `city`).
2. **ΓΕΜΗ Νομός/Π.Ε.** — αν `prefectureId`, resolve `Prefecture.descr` και name-match στους
   level-4 κόμβους (επιστρέφει την Π.Ε.· ο Δήμος μένει `—`). → `confidence: 'gemi'`.
3. **Free-text name match** — `district` (πρώτα), μετά `city`, στους level-5 κόμβους
   (normalize: uppercase, αφαίρεση τόνων, contains/stem). → `confidence: 'name'`.
4. **Geo fallback** — `latitude`/`longitude` της εταιρίας ή geocode της διεύθυνσης, πλησιέστερος
   level-5 κόμβος με haversine (cap 50km). → `confidence: 'geo'`.
5. Αλλιώς `null`.

Τα `municipalityId`/`prefectureId` περνιούνται από τη φόρμα, το actions-dropdown και το auto-fill
στα `POST`/`PATCH` εταιρίας (υπάρχουν ήδη στο payload). Τα υποκαταστήματα δεν έχουν ΓΕΜΗ ids →
χρησιμοποιούν μόνο name/geo.

Helper `deriveHierarchy(code)`: ανεβαίνει το δέντρο → `{ municipality, regionalUnit, region }`
(τύπος `RegionBreadcrumb`). Decoder helper `lib/regions/decoder.ts` αντίστοιχο του `lib/kad/decoder.ts`.

## API Routes (mirror `/api/kad/*`)

- `GET /api/regions/children?parent=<code>` — lazy-load tree· χωρίς `parent` επιστρέφει level-3 roots.
  Κάθε node: `code, nameEL, level, childCount`.
- `POST /api/regions/decode` — `{ code }` → `{ ...node, breadcrumb, children }` για τη σελίδα browser.
- `POST /api/regions/match` — `{ address, city, district, zip, latitude, longitude }` →
  `{ regionCode, breadcrumb, confidence } | null`. Χρήση από icon button, actions dropdown, auto-fill.

Όλα με permission checks κατά το pattern των υπαρχόντων routes.

## UI (ίδιο look με ΚΑΔ)

### Σελίδα browser `/admin/regions/page.tsx`
**Ίδια δομή με τη σελίδα ΚΑΔ** (`/admin/kad-codes/page.tsx`). Server component φέρνει level-3 roots, renders:
- `components/regions/region-tree.tsx` — clone του `kad-tree.tsx`· lazy-load μέσω `/api/regions/children`·
  color-code ανά level (Περιφέρεια / Π.Ε.-Νομός / Δήμος).
- `components/regions/region-decoder.tsx` — αναζήτηση/ανάλυση κόμβου (αντίστοιχο `kad-decoder.tsx`).
- `<PageHeader title="Μητρώο Περιφερειών" helpAnchor="perifereies" />`.

### Sidebar link (`components/admin/sidebar.tsx`)
Νέο item στο group **«Δεδομένα»**, αμέσως μετά το «Μητρώο ΚΑΔ» (γραμμή 49):
```tsx
{ href: '/admin/regions', label: 'Μητρώο Περιφερειών', icon: FiMapPin, permissions: ['metadata.read'] },
```
Επαναχρησιμοποιούμε το `metadata.read` (bucket «Μητρώα αναφοράς») για να μην χρειαστεί νέα RBAC
seed· εναλλακτικά μπορεί να προστεθεί dedicated `regions.read` permission αν προτιμηθεί.
Το ίδιο permission gate εφαρμόζεται στις API routes και στη σελίδα.

### Picker `components/regions/region-picker.tsx`
Modal tree picker που επιστρέφει επιλεγμένο κόμβο (το ΚΑΔ δεν είχε picker — το προσθέτουμε).
Χρησιμοποιεί το ίδιο tree component σε dialog· επιστρέφει `regionCode`.

### Φόρμα εταιρίας (`companies-view.tsx`)
- **Contact tab** + **κάθε Branch**: πεδίο «Περιφέρεια/Νομός/Δήμος (Καλλικράτης)» που δείχνει
  το **πλήρες** breadcrumb `Περιφέρεια › Περιφερειακή Ενότητα/Νομός › Δήμος`, με **MapPin icon button**:
  - «Εντοπισμός» → καλεί `/api/regions/match` με τα τρέχοντα πεδία διεύθυνσης.
  - «Επιλογή» → ανοίγει `region-picker` για χειροκίνητη επιλογή/override.
- Στο save στέλνεται `regionCode` (έδρα) + `regionCode` ανά branch.

### Λίστα εταιριών (`companies-view.tsx`)
- **Actions dropdown** (γραμμές 309–333): νέο `DropdownMenuItem` «Εντοπισμός Περιφέρειας/Νομού/Δήμου»
  που τρέχει auto-detect και ανοίγει τον picker για επιβεβαίωση/override. Το αποτέλεσμα συμπληρώνει
  **και τα τρία επίπεδα** (Περιφέρεια, Περιφερειακή Ενότητα/Νομός, Δήμος).
- (Προαιρετικά) εμφάνιση breadcrumb «πού ανήκει» (Περιφέρεια › Π.Ε./Νομός › Δήμος) στη γραμμή/expand.

### Auto-fill κατά την εισαγωγή/ενημέρωση (authoritative)
Server-side στα `POST` & `PATCH /api/admin/companies`:
- Αν `regionCode` κενό αλλά υπάρχει διεύθυνση/πόλη → κλήση `matchRegion()` και αποθήκευση.
- Ίδιο για κάθε branch με κενό `regionCode`.
Έτσι ο «αυτόματος έλεγχος» γίνεται πάντα, ανεξάρτητα από το client.

## Wiki (ΥΠΟΧΡΕΩΤΙΚΟ — CLAUDE.md)

1. `npm run wiki:new -- mitroa/perifereies --roles "ADMIN,EMPLOYEE" --title "Περιφέρειες (Καλλικράτης)"`
   (αν το module `mitroa` δεν υπάρχει στο `lib/wiki/modules-meta.ts`, προσθήκη εγγραφής).
2. Περιεχόμενο στα Ελληνικά: επισκόπηση, `<Steps>` για τον εντοπισμό/αντιστοίχιση,
   `<Callout>` για το auto-fill behavior. Frontmatter `roles`, `description`, `helpAnchors: [perifereies]`.
3. `helpAnchor="perifereies"` στο `<PageHeader>` της `/admin/regions`.
4. Screenshot route `/admin/regions` στο frontmatter.

## Testing

- **Seed:** μετά το `seed:regions`, counts = 14 (L3) / 75 (L4) / 326 (L5)· spot-check ότι
  `id`/dates του JSON ΔΕΝ αποθηκεύτηκαν (νέα `createdAt`).
- **matchRegion:** unit tests — name match («Δοξάτο» → ΔΗΜΟΣ ΔΟΞΑΤΟΥ), accent/genitive variants,
  geo fallback με lat/long, κανένα match → null.
- **deriveHierarchy:** Δήμος → σωστά Π.Ε. + Περιφέρεια.
- **API:** `children` (roots & ανά parent), `decode`, `match` happy/empty paths.
- **Integration:** δημιουργία εταιρίας με διεύθυνση χωρίς `regionCode` → auto-fill· branch auto-fill·
  actions-dropdown εντοπισμός.

## Εκτός scope (YAGNI)

- Αντιστοίχιση σε `CompanyContact` (μπορεί αργότερα).
- Denormalized region/Π.Ε./Δήμος columns.
- Αντικατάσταση των legacy GEMI Prefecture/Municipality.
- CRUD/editing των region κόμβων από το UI (read-only browser· τα δεδομένα έρχονται από seed).
