# PLAN — In-App Wiki / Οδηγός Χρήστη

## Στόχος
Ενσωματωμένος οδηγός χρήστη της εφαρμογής με περιεχόμενο σε **Ελληνικά**, role-based πρόσβαση (ΟΛΟΙ οι ρόλοι: SUPER_ADMIN, ADMIN, EMPLOYEE, COLLABORATOR, SUPPLIER, CUSTOMER), screenshots αυτόματα παραγόμενα με Playwright, και workflow που συντηρείται **κατά τη διάρκεια** της ανάπτυξης κάθε feature.

## Αρχιτεκτονική

### 1. Storage
- `docs/wiki/<module>/<page>.mdx` — περιεχόμενο
- `public/wiki/screenshots/<module>/<page>/*.png` — screenshots (auto-generated)
- Frontmatter schema:
  ```yaml
  ---
  title: "Διαχείριση Προγραμμάτων ΕΣΠΑ"
  module: programs
  slug: programs-overview
  roles: [ADMIN, EMPLOYEE, COLLABORATOR]   # ποιοι βλέπουν
  order: 10
  updatedAt: 2026-05-28
  screenshots:
    - file: list.png
      caption: "Λίστα προγραμμάτων με φίλτρα"
    - file: edit.png
      caption: "Φόρμα επεξεργασίας"
  related: [programs-import, programs-kad]
  ---
  ```

### 2. App routes
- `/wiki` — landing/index (κάτω από `app/(app)/wiki/`, ΟΧΙ κάτω από `/admin` ώστε να είναι προσβάσιμο σε CUSTOMER/SUPPLIER)
- `/wiki/[module]` — λίστα σελίδων του module
- `/wiki/[module]/[slug]` — αναλυτική σελίδα
- `/wiki/search?q=` — search results
- Όλα **server components**, διαβάζουν MDX στο build/runtime, φιλτράρουν με βάση `session.user.roleKey`.

### 3. Role gating
- Helper `lib/wiki/access.ts`: `canAccessWikiPage(roleKey, pageRoles): boolean`
- SUPER_ADMIN βλέπει τα πάντα.
- Αν μια σελίδα έχει `roles: [SUPER_ADMIN]` → κρύβεται από όλους τους άλλους.
- 404 σε μη επιτρεπτές σελίδες (όχι 403 — διαρροή πληροφορίας).

### 4. MDX loader
- `lib/wiki/loader.ts`: `loadAllPages()`, `loadPage(module, slug)`, `getModuleTree()`.
- Use `@next/mdx` + `gray-matter` + `next-mdx-remote/rsc`.
- Cache με React `cache()` ανά request.
- Custom MDX components: `<Screenshot src caption>`, `<Callout type>`, `<Steps>`, `<RoleBadge>`.

### 5. UI
- Layout `/wiki/layout.tsx`: sidebar (modules tree), top search, breadcrumbs.
- Search: client-side με Fuse.js πάνω σε pre-built JSON index (`public/wiki/index.json` που χτίζεται με script).
- Theme: ίδιο shadcn/ui look με το υπόλοιπο app.

### 6. Entry points
- **Admin sidebar:** νέο item "Οδηγός Χρήστη" → `/wiki` (visible σε όλους τους /admin ρόλους).
- **User menu (top-right):** "Βοήθεια / Οδηγός" σε όλα τα layouts (admin + public dashboards).
- **Contextual help icon:** component `<HelpIcon wikiSlug="programs-overview" />` που τοποθετείται σε κάθε PageHeader. Click → άνοιγμα σε νέο tab ή side-drawer (drawer = TBD, default new tab).

### 7. Screenshot automation
- `scripts/wiki/screenshot.ts` — Playwright script.
- Reads `docs/wiki/**/*.mdx`, βρίσκει frontmatter `screenshots[].route` + optional `actions` (login as role, click, fill).
- Logs in με seed users (ένας per role: `super@dev`, `admin@dev`, ..., `customer@dev`) — credentials από `.env.test`.
- Παράγει png σε `public/wiki/screenshots/<module>/<page>/<file>`.
- `npm run wiki:screenshots` (full) και `npm run wiki:screenshots -- --module programs` (incremental).
- CI step (αργότερα): re-run screenshots σε PR αν αλλάξει UI.

### 8. CLI scaffolder
- `scripts/wiki/new.ts`: `npm run wiki:new -- programs/import` → δημιουργεί skeleton MDX με όλα τα frontmatter fields + placeholder content + φάκελο screenshots.

### 9. Dev workflow / Convention
- Update CLAUDE.md / CONTRIBUTING: **κάθε νέο feature απαιτεί** wiki entry + screenshots.
- Husky pre-commit hook (optional): warning αν `app/admin/<module>/**` αλλάζει χωρίς αντίστοιχο `docs/wiki/<module>/**`.

## Tasks

### Phase 1 — Foundation
1. Install deps: `next-mdx-remote`, `gray-matter`, `fuse.js`, `@playwright/test` (αν δεν υπάρχει).
2. Create `lib/wiki/types.ts` (frontmatter Zod schema), `lib/wiki/loader.ts`, `lib/wiki/access.ts`.
3. Create custom MDX components in `components/wiki/`.
4. Create `app/(app)/wiki/layout.tsx`, `page.tsx`, `[module]/page.tsx`, `[module]/[slug]/page.tsx`.
5. Add wiki nav item σε admin sidebar + user menu.
6. Create `<HelpIcon>` component + integrate σε 1 page header ως POC.

### Phase 2 — Authoring tooling
7. CLI scaffolder `scripts/wiki/new.ts`.
8. Wiki search index builder `scripts/wiki/build-index.ts`.
9. Client search component με Fuse.js.

### Phase 3 — Screenshot automation
10. Playwright setup (αν δεν υπάρχει) + seed users per role.
11. `scripts/wiki/screenshot.ts` με action DSL.
12. npm scripts + README docs.

### Phase 4 — Content seed
13. Index page (welcome, role overview).
14. Initial pages για 3-4 πιο σημαντικά modules: programs, media, settings, users — ως template.
15. Run screenshot generation και verify.

### Phase 5 — Convention enforcement
16. Update CLAUDE.md με wiki convention.
17. Optional: pre-commit hook.

## Open questions / decisions
- **Drawer vs new tab για HelpIcon:** default = new tab (απλό). Drawer αν υπάρχει χρόνος.
- **MDX vs DB-backed:** MDX (versioned, code review, branchable). Όχι DB.
- **i18n μελλοντικά:** η δομή `docs/wiki/<lang>/<module>/...` υποστηρίζεται από τώρα (χωρίς να γραφτεί άλλη γλώσσα).
- **Search scope:** φιλτράρεται post-search με βάση τους ρόλους.

## Success criteria
- Όλοι οι 6 ρόλοι μπορούν να μπουν στο `/wiki` και να δουν ΜΟΝΟ τις σελίδες που τους αφορούν.
- Help icon σε κάθε admin page header ανοίγει την σωστή σελίδα.
- `npm run wiki:new` παράγει σκελετό σε <1s.
- `npm run wiki:screenshots` τρέχει χωρίς manual intervention και παράγει png.
- Search επιστρέφει σχετικά αποτελέσματα μόνο από επιτρεπτές σελίδες.
- Convention τεκμηριωμένη σε CLAUDE.md ώστε κάθε επόμενο feature να συνοδεύεται από wiki entry.
