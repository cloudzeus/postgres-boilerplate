# OCR Matching — Dropdown ενεργειών + Δημιουργία ειδών/υπηρεσιών/προμηθευτών

**Ημερομηνία:** 2026-06-01
**Σελίδα:** `/admin/ocr/matching`
**Κατάσταση:** Εγκεκριμένο design (μέσω Q&A), προς υλοποίηση

## 1. Στόχος

Στη σελίδα αντιστοιχίσεων, η ενέργεια κάθε γραμμής μετατρέπεται από μονό κουμπί
«Αντιστοίχιση» σε **dropdown menu** με δύο δυνατότητες:

1. **Αντιστοίχιση σε υπάρχον** — η σημερινή αναζήτηση στον τοπικό SoftOne mirror.
2. **Δημιουργία νέου** στο SoftOne:
   - Για **Προϊόντα/Υπηρεσίες**: νέο MTRL, με δυνατότητα **αντιγραφής όλης της
     ταξινόμησης** από συναφές είδος/υπηρεσία, ή κενή φόρμα.
   - Για **Προμηθευτές**: νέο TRDR (SODTYPE=12) με **άντληση στοιχείων από ΑΑΔΕ**
     (το ΑΦΜ της γραμμής), με επιβεβαίωση πριν την εγγραφή.

Σε κάθε επιτυχή δημιουργία, το νέο record αντιστοιχίζεται αυτόματα στη γραμμή και
η γραμμή φεύγει από τη λίστα (resolved).

## 2. Αποφάσεις (από Q&A)

| Θέμα | Απόφαση |
|------|---------|
| Τι αντιγράφεται από συναφές είδος | **Όλη η ταξινόμηση**: ΦΠΑ, Μονάδα, Ομάδα, Κατηγορία, Κατασκευαστής, Μάρκα. Κωδικός/Περιγραφή/Τιμή ΔΕΝ αντιγράφονται. |
| Κωδικός νέου είδους | **Προσυμπληρωμένος** (από κωδικό γραμμής OCR), **επεξεργάσιμος**. |
| Δομή «Δημιουργία νέου» (είδη) | **Ένα modal, δύο modes**: toggle «Αντιγραφή από συναφές» / «Κενή φόρμα». |
| Ροή προμηθευτή | **Επιβεβαίωση πριν εγγραφή** — dialog με τα πεδία ΑΑΔΕ + κουμπί «Δημιουργία στο SoftOne». |
| Δ.Ο.Υ. (ΑΑΔΕ → SoftOne) | **Αντιστοίχιση με lookup**: άντληση κωδικών Δ.Ο.Υ. από SoftOne και match περιγραφής → κωδικό. |

## 3. Υπάρχουσα υποδομή (επαναχρησιμοποιείται)

- [`app/admin/ocr/matching/matching-client.tsx`](../../../app/admin/ocr/matching/matching-client.tsx) — οι πίνακες `LineTable`/`SupplierTable`.
- [`components/admin/softone-match-picker.tsx`](../../../components/admin/softone-match-picker.tsx) — αναζήτηση + επιλογή (4 callers, δεν αλλάζει το public API).
- [`components/admin/create-softone-item-modal.tsx`](../../../components/admin/create-softone-item-modal.tsx) — πλήρης φόρμα είδους· **σήμερα κάνει μόνο copy JSON**.
- [`app/api/admin/ocr/create-item/route.ts`](../../../app/api/admin/ocr/create-item/route.ts) — **ήδη** δημιουργεί στο SoftOne + mirror + link γραμμής.
- [`app/api/admin/softone/item-meta/route.ts`](../../../app/api/admin/softone/item-meta/route.ts) — combo options από `SoftoneLookup`.
- [`app/api/admin/aade-lookup/route.ts`](../../../app/api/admin/aade-lookup/route.ts) — άντληση ΑΑΔΕ (`vat.wwa.gr/afm2info`) → mapped fields.
- [`app/api/admin/ocr/[id]/match-supplier/route.ts`](../../../app/api/admin/ocr/[id]/match-supplier) — link προμηθευτή σε παραστατικό.
- `lib/softone.ts` — `softoneCreateItem`, `softoneGetTable`, `softoneCall`, `softoneFindByAfm`.

**Κρίσιμος περιορισμός:** ο τοπικός `SoftoneItem` mirror **δεν** αποθηκεύει ταξινόμηση
(VAT/μονάδα/ομάδα/κατηγορία/κατασκευαστή/μάρκα). Άρα η «αντιγραφή από συναφές»
απαιτεί **live ανάγνωση** του πλήρους MTRL από το SoftOne.

## 4. Αρχιτεκτονική αλλαγών

### 4.1 Refactor: `SoftoneSearchPanel` (μη breaking)
Εξαγωγή του εσωτερικού UI (input + λίστα αποτελεσμάτων + debounce fetch) του
`SoftoneMatchPicker` σε νέο component `SoftoneSearchPanel`. Το `SoftoneMatchPicker`
το τυλίγει σε Popover (ίδιο public API — οι 4 callers ανέπαφοι). Το νέο dialog
αναζήτησης και το modal «αντιγραφή από συναφές» το επαναχρησιμοποιούν.

Props: `{ type: 'items'|'suppliers'; service?: '0'|'1'; onPick: (r) => void; autoFocus? }`.

### 4.2 Per-row dropdown — `MatchRowActions` (νέο, μέσα στο matching-client)
Αντικαθιστά το γυμνό `<SoftoneMatchPicker>` σε κάθε κελί ενέργειας. Κρατά τοπικό
state `{ searchOpen, createOpen }` και αποδίδει:

- `DropdownMenu` (από `components/ui/dropdown-menu.tsx`) με trigger κουμπί
  «Αντιστοίχιση ▾».
- **Items/Services** menu:
  - «🔍 Αντιστοίχιση σε υπάρχον» → `searchOpen=true` (Dialog με `SoftoneSearchPanel type="items" service=...`).
  - «➕ Δημιουργία νέου {είδους|υπηρεσίας}» → `createOpen=true` (`CreateSoftoneItemModal`, `defaultService` από το tab).
- **Suppliers** menu:
  - «🔍 Αντιστοίχιση σε υπάρχον» → Dialog με `SoftoneSearchPanel type="suppliers"`.
  - «➕ Δημιουργία προμηθευτή από ΑΑΔΕ» → `createOpen=true` (`CreateSupplierFromAadeDialog`, με το `afm` της γραμμής).

Ο τύπος (51/52) προκύπτει από το tab: Προϊόντα→`defaultService=false`, Υπηρεσίες→`defaultService=true`.

### 4.3 `CreateSoftoneItemModal` — δύο modes + πραγματική εισαγωγή
Αλλαγές στο υπάρχον modal:

1. **Toggle mode** πάνω από τη φόρμα: «◉ Αντιγραφή από συναφές» / «○ Κενή φόρμα».
2. **Mode «Αντιγραφή»**: `SoftoneSearchPanel type="items"` (περιορισμένο σε ίδιο τύπο
   μέσω `service`). Στην επιλογή πηγής → `GET /api/admin/softone/item-detail?mtrl=<id>`
   → prefill των combos **VAT, unit, group, category, manufacturer, brand**.
   Ο κωδικός/περιγραφή μένουν από τη γραμμή OCR· τιμή **δεν** προσυμπληρώνεται.
3. **Πρωτεύον κουμπί «Δημιουργία στο SoftOne»** → `POST /api/admin/ocr/create-item`
   με `{ code, name, isService, vat, unit, price?, group?, category?, manufacturer?, brand?, lineId }`.
   Σε επιτυχία: κλήση νέου prop `onCreated({ mtrl, code, name })` → το modal κλείνει
   και η γραμμή σημειώνεται resolved στο matching-client + toast.
4. Το «Αντιγραφή αντικειμένου» (JSON) μένει ως **δευτερεύον** κουμπί.

### 4.4 Νέο: `CreateSupplierFromAadeDialog`
Dialog που:
1. Με το άνοιγμα → `POST /api/admin/aade-lookup { afm }` → εμφάνιση mapped πεδίων
   (όνομα, ΑΦΜ, Δ.Ο.Υ. περιγραφή, επάγγελμα/ΚΑΔ, διεύθυνση, Τ.Κ., πόλη, νομική μορφή).
2. Παράλληλα κάνει το DOY matching (βλ. 4.6) και δείχνει «Δ.Ο.Υ.: <περιγραφή> → κωδ. <code|—>».
3. Κουμπί **«Δημιουργία στο SoftOne»** → `POST /api/admin/ocr/create-supplier`
   με `{ afm, name, doyCode?, profession?, address?, zip?, city?, docId }`.
4. Σε επιτυχία: `onCreated({ trdr, code, name })` → γραμμή resolved + toast.

Edge cases: ΑΦΜ κενό/μη έγκυρο → μήνυμα· ΑΑΔΕ not_found (404) → μήνυμα, κουμπί
disabled· ΑΑΔΕ unreachable (502) → μήνυμα + retry.

### 4.5 Νέο endpoint: `GET /api/admin/softone/item-detail`
- Auth: `requireAnyPermission('ocr.read','ocr.categorize','metadata.read')`.
- `mtrl` query param (έλεγχος ότι είναι αριθμός).
- `softoneGetTable('MTRL', ['MTRL','VAT','MTRUNIT1','MTRGROUP','MTRCATEGORY','MTRMANFCTR','MTRMARK','SODTYPE','PRICER'], 'MTRL=<id>')`.
- Επιστρέφει `{ vat, unit, group, category, manufacturer, brand, isService }` (string ids).
- Σφάλμα SoftOne → 502 `{ error:'softone_error', message }`.

### 4.6 Νέο: DOY lookup + νέα lib `softoneCreateSupplier`
**DOY lookup** (`lib/softone.ts`) — *επιβεβαιωμένο από cached schema*: το πεδίο είναι
`TRDR.IRSDATA` (caption «Δ.Ο.Υ.»), FK προς object/πίνακα **`IRSDATA`**.
- `softoneFetchTaxOffices(): Promise<{ code: string; name: string }[]>` —
  `softoneGetTable('IRSDATA', ['IRSDATA','NAME'])`.
- `matchTaxOffice(description, offices): string | null` — normalize (uppercase, αφαίρεση
  τόνων/σημείων/«Δ.Ο.Υ.») + contains match περιγραφής ΑΑΔΕ → SoftOne κωδικό.
- Fallback: αν δεν βρεθεί match, δημιουργία χωρίς Δ.Ο.Υ. (το πεδίο μένει κενό).

**`softoneCreateSupplier(input)`** (`lib/softone.ts`), αναλογικό του `softoneCreateItem`
— *επιβεβαιωμένο*: OBJECT=**`SUPPLIER`** (βάζει αυτόματα SODTYPE=12· τα required πεδία
έχουν defaults μέσω schema, δεν χρειάζονται explicit).
- Πεδία: `CODE` (κενό → auto-numbering SoftOne· editable input στο dialog ως fallback),
  `NAME`, `AFM`, `ISACTIVE=1`, και (όπου υπάρχουν) `IRSDATA`(DOY code), `JOBTYPETRD`,
  `ADDRESS`, `ZIP`, `CITY`.
- Επιστρέφει `{ trdr, code }`.

### 4.7 Νέο endpoint: `POST /api/admin/ocr/create-supplier`
- Auth: `requirePermission('ocr.categorize')`.
- Body: `{ afm, name, doyCode?, profession?, address?, zip?, city?, docId? }`.
- Validation: `afm`, `name` υποχρεωτικά.
- `softoneCreateSupplier(...)` → `prisma.softoneSupplier.upsert` (mirror) →
  αν `docId`: `prisma.ocrDocument.update` link (softoneTrdr/code/name/matchedBy='manual').
- Audit log (`ocr.supplier.create_softone`).
- Σφάλμα SoftOne → 502.

## 5. Ροή δεδομένων (σύνοψη)

```
[Προϊόν/Υπηρεσία] Δημιουργία νέου
  → CreateSoftoneItemModal
     ├─ (mode αντιγραφή) SoftoneSearchPanel → GET item-detail → prefill combos
     └─ Δημιουργία → POST create-item → softoneCreateItem → mirror+link → onCreated → resolved

[Προμηθευτής] Δημιουργία από ΑΑΔΕ
  → CreateSupplierFromAadeDialog
     ├─ POST aade-lookup (afm) → mapped fields
     ├─ softoneFetchTaxOffices + matchTaxOffice → doyCode
     └─ Δημιουργία → POST create-supplier → softoneCreateSupplier → mirror+link → onCreated → resolved
```

## 6. Wiki (υποχρεωτικό — CLAUDE.md)

- Νέα σελίδα `docs/wiki/ocr/matching.mdx` (Ελληνικά): επισκόπηση, `<Steps>` για τις
  δύο ροές δημιουργίας, `<Callout type="warning">` ότι γράφει σε **παραγωγικό SoftOne**.
- Frontmatter `roles`, `description`, `helpAnchors: [matching, αντιστοιχιση, δημιουργια-ειδους, δημιουργια-προμηθευτη]`.
- `helpAnchor="matching"` στο `<PageHeader>` της σελίδας matching.
- Αν χρειαστεί module entry στο `lib/wiki/modules-meta.ts` (το module `ocr` υπάρχει ήδη).
- `npm run wiki:index` στο τέλος.

## 7. Εκτός scope (YAGNI)

- Δημιουργία **πελάτη** (μόνο προμηθευτές εδώ).
- Επεξεργασία/διαγραφή υπάρχοντος SoftOne record.
- Bulk δημιουργία.
- Αντιγραφή τιμής/κωδικού/περιγραφής από συναφές είδος.
- Επέκταση του `SoftoneItem` mirror με πεδία ταξινόμησης (χρησιμοποιούμε live fetch).

## 8. Ρίσκα / προς επιβεβαίωση στο implementation

1. **SoftOne object προμηθευτή** (`SUPPLIER` vs `CUSTOMER`+SODTYPE) — έλεγχος μέσω softone skill / S1 docs.
2. **Master πίνακας Δ.Ο.Υ.** + πεδίο TRDR — έλεγχος· αλλιώς fallback χωρίς Δ.Ο.Υ.
3. Δικαιώματα RBAC: επαναχρησιμοποίηση `ocr.categorize` για supplier create.
4. Νesting Popover σε DropdownMenu → αποφεύγεται με ξεχωριστά Dialogs ανοιγόμενα από menu items.
