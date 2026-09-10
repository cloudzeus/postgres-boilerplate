## 2026-09-10 — Εκτέλεση προτύπων στα έγγραφα

- Στο **ανέβασμα** και στην **επανεξαγωγή**, αν το ΑΦΜ του εκδότη ταιριάζει σε **ενεργό** πρότυπο, αυτό τρέχει αυτόματα (πολλά ταιριάσματα → το πιο πρόσφατα ενημερωμένο). Η επανεξαγωγή ξανακάνει την αντιστοίχιση με το ΑΦΜ. Αποτυχία προτύπου **ποτέ** δεν μπλοκάρει το έγγραφο.
- Νέα κάρτα **«Πρότυπο»** στη σελίδα εγγράφου: επιλογή/«Εκτέλεση» ή «Επανεκτέλεση» οποιουδήποτε προτύπου, σελίδα με τις περιοχές στο χρώμα κάθε πεδίου, λίστα «χρώμα · ετικέτα · τιμή · πηγή · σελίδα» με hover ⇄ highlight, διόρθωση τιμής, σήματα και κανόνες που ταίριαξαν, πτυσσόμενα «Ροή» και «Ιστορικό».
- Χειροκίνητες διορθώσεις τιμών **ξαναπερνούν** στο παραστατικό για τα μη-χειροκίνητα πρότυπα.
- Έξοδοι: **«JSON»** και **«Excel»** ανά έγγραφο, **«Excel προτύπων»** (φύλλο ανά πρότυπο + φύλλο «Γραμμές») και **«JSON»** (πίνακας) ανά φάκελο. Το JSON περιέχει πρώτα τα κλασικά κλειδιά τιμολογίου και μετά τα έξτρα πεδία του προτύπου.
- **«Έγκριση → ανάρτηση»** για ημιαυτόματα πρότυπα (δικαίωμα ανάρτησης OCR)· τα αυτόματα αναρτούν μόνα τους εκτός αν λείπει υποχρεωτικό πεδίο ή ενεργοποιηθεί κανόνας «Μπλόκαρε ανάρτηση».
- Νέα στήλη **«Πρότυπο»** στη λίστα OCR με κατάσταση τελευταίας εκτέλεσης (Εξήχθη / Προς έλεγχο / Μπλοκαρισμένο / Αναρτήθηκε / Απέτυχε).
- Ειδοποιήσεις email κανόνων μέσω Mailgun, μία φορά ανά έγγραφο και κανόνα. Ο σύνδεσμος προς το έγγραφο απαιτεί ορισμένο **`APP_URL`** στο περιβάλλον της εγκατάστασης.
- Τα «Ειδικά πεδία προμηθευτών» και τα παλιά πρότυπα προμηθευτή αντικαταστάθηκαν από τα πρότυπα εξαγωγής· οι υπάρχοντες κανόνες μεταφέρθηκαν σε πρότυπα «Μεταφερμένο: …» (DRAFT).

## 2026-09-10 — Ανεξάρτητα πρότυπα εξαγωγής

- Το πρότυπο δεν εξαρτάται πια από προμηθευτή: δημιουργείται με **όνομα** και αυτόματο **slug** (επεξεργάσιμο μέχρι την πρώτη εκτέλεση), με προαιρετικό **τμήμα/κατηγορία**. Ο προμηθευτής SoftOne και το ΑΦΜ γίνονται προαιρετική σύνδεση στο βήμα «Στοιχεία». Ο τύπος εγγράφου καταργήθηκε.
- Νέο πεδίο **«Από περιοχή»**: μαρκάρεις πλαίσιο στο δείγμα και το μοντέλο διαβάζει ετικέτα, τιμή και τύπο και ονομάζει μόνο του το πεδίο.
- Νέα **«Αυτόματη σάρωση»** σελίδας με δύο τρόπους: «Όλα τα πεδία» για καθαρά δείγματα και «Μόνο σημειωμένα» για δείγματα με κυκλωμένα/χειρόγραφα του λογιστή (μαζί με το χειρόγραφο λογιστικό άρθρο). Τα αποτελέσματα μπαίνουν ως «πρόταση» μέχρι την αποθήκευση.
- **Έξοδος JSON** `{ template, version, extractedAt, values }` ανά εκτέλεση και διάλογος **«Δοκιμή προτύπου»** (pretty JSON, αντιγραφή, λήψη .json, τιμή ανά πεδίο με το χρώμα του).
- Η **χειροκίνητη λειτουργία (MANUAL)** είναι πλέον η προεπιλογή και δεν απαιτεί mapping — το βήμα Mapping είναι προαιρετικό.
- Λίστα και sidebar μετονομάστηκαν σε «Πρότυπα εξαγωγής», με στήλες slug / τμήμα / προμηθευτή και αναζήτηση σε όλα.
- Script `scripts/templates/seed-from-pdf.ts` (`npm run templates:seed`): κόβει σαρωμένο PDF πελάτη σε επιμέρους έντυπα από manifest, δημιουργεί πρότυπο ανά έντυπο και προτείνει πεδία από τις σημειώσεις.

## 2026-09-10 — Designer προτύπων προμηθευτών

- Νέα σελίδα `/admin/ocr/templates` (αντικαθιστά τα παλιά «Πρότυπα Προμηθευτών (OCR)») με δημιουργία προτύπου από αναζήτηση προμηθευτή SoftOne.
- Designer 5 βημάτων: προμηθευτής, δείγμα, περιοχές & πεδία (χρώμα ανά πεδίο, ζωντανή δοκιμή ανάγνωσης), mapping (παραστατικό / Excel), conditions & λειτουργία.
- Διάγραμμα ροής (React Flow) που παράγεται από τη ρύθμιση και ενημερώνεται σε κάθε αποθήκευση.
- Σύνδεσμος στο sidebar και σελίδα wiki.

## 2026-09-10 — Πρότυπα εξαγωγής προμηθευτή (θεμέλια)

- Νέα μοντέλα `ExtractionTemplate`, `TemplateField`, `TemplateMapping`, `TemplateCondition`, `TemplateRun`, `TemplateSample`, `TemplateJob`, `TemplateJobItem`.
- Καθαρή λογική σε `lib/templates/*`: σχήμα/παλέτα χρωμάτων, coercion ελληνικών ποσών και ημερομηνιών, conditions, mapping, διάγραμμα ροής.
- Μηχανή εξαγωγής: text layer για ψηφιακά PDF (σωστή γεωμετρία και σε περιστραμμένες σελίδες), crop + vision για σαρωμένα, πίνακες, fallback μοντέλων.
- API `/api/admin/ocr/templates/**` (CRUD, δείγμα, εικόνα σελίδας, πεδία, mappings, conditions, δοκιμή πεδίου).
- Το `read-region` του OCR χρησιμοποιεί πλέον τον κοινό vision reader και τον κοινό rasteriser.
- UI designer, ενσωμάτωση στο pipeline, εκπαίδευση και jobs ακολουθούν (plans 2–4).

# DGSMART ERP — Changelog

Living documentation. Each significant change appends a new entry.

## 2026-05-25 — Phase 1: Foundation + RBAC

### Design system
- Fluent 2 + DG Red tokens (`tailwind.config.ts`, `app/globals.css`)
- Density 9/10: 13px base font, 8px row height for dense tables, depth-shadow elevation
- Motion: 180/220/250ms, Fluent easing curves
- Light/dark theme via `.dark` class on `<html>`

### Data model (BREAKING)
- `User.role` enum → `User.roleId` FK to new `Role` model
- New tables: `Role`, `Permission`, `RolePermission`
- All ordered models have `order Int` for drag-drop reorder
- Migration: **wipes existing DB** — run `npx prisma migrate reset && npm run seed:db`

### RBAC
- 17 canonical permissions in `lib/permissions.ts`
- 6 system roles seeded with sensible defaults (`scripts/seed.js`)
- `lib/rbac.ts` server helpers: `requireUser()`, `requirePermission()`, `hasPermission()`
- SUPER_ADMIN bypasses all permission checks

### UI primitives (`components/ui/`)
- `button`, `card`, `input`, `label`, `badge`, `checkbox`, `separator`, `tooltip`
- `dropdown-menu` (with submenu + checkbox items)
- `dialog`
- `data-table` — TanStack-powered: search, sort, paginate, **column resize via drag**, column visibility, **row expand**, row selection
- `sortable-list` — `@dnd-kit`-powered drag-drop reorder

### Auth (redesigned)
- New split-screen `app/auth/layout.tsx` (brand panel + form)
- Pages: `signin` (password + OTP modes), `register`, `lost-password`, `verify-otp`
- All use react-icons (Feather + brand glyphs)

### Admin shell
- `app/admin/layout.tsx` — RBAC-gated via `requireUser()`
- `components/admin/sidebar.tsx` — collapsible (52px ↔ 240px), mobile drawer, permission-filtered nav, tooltips when collapsed
- `components/admin/topbar.tsx` — breadcrumb, search, theme toggle, notifications, user menu

### Pages
- `/admin` — dashboard overview with stat cards
- `/admin/users` — DataTable: search, sort, paginate, column resize, expand row, row actions (edit / change role / activate / delete)
- `/admin/roles` — SortableList: drag to reorder, system-role lock badge, "Δικαιώματα" dialog for granular grants
- `/admin/permissions` — SortableList grouped by resource

### API
- `PATCH/DELETE /api/admin/users/:id` (RBAC-gated)
- `PATCH /api/admin/users/:id/role`
- `POST/GET /api/admin/roles` · `PATCH/DELETE /api/admin/roles/:id`
- `POST /api/admin/roles/reorder`
- `PUT /api/admin/roles/:id/permissions`
- `POST /api/admin/permissions/reorder`
- All routes validate input with `zod`

### Mobile app
- `mobile-app/README.md` documents the API contract for the future Expo app

## Coming next (Phase 2)
- BunnyCDN S3 media manager (auto-WebP + SVG passthrough with WebP companion)
- Super admin Settings (API keys, integrations, company details)
- Sync queue / pull-buffer for third-party systems with progress UI
- Audit log of all user actions
- DeepSeek translation helper (everywhere a text field needs i18n)
