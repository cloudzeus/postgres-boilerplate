# DGEspa — Project Rules

## Wiki convention (ΥΠΟΧΡΕΩΤΙΚΟ)

**Κάθε νέο feature που αλλάζει το UI πρέπει να συνοδεύεται από αντίστοιχη wiki entry.**

Όταν προστίθεται νέα σελίδα/λειτουργία στο `/admin/*` ή σε οποιοδήποτε άλλο user-facing route:

1. **Scaffold wiki page** στην ίδια PR/commit:
   ```
   npm run wiki:new -- <module>/<slug> --roles "ADMIN,EMPLOYEE" --title "Τίτλος"
   ```
   Modules registry: `lib/wiki/modules-meta.ts`. Αν το module δεν υπάρχει εκεί, πρόσθεσε εγγραφή (label, description, icon, gradient colors).

2. **Γράψε περιεχόμενο** στο `docs/wiki/<module>/<slug>.mdx` στα **Ελληνικά**:
   - Επισκόπηση (1 σύντομη παράγραφος)
   - Βήματα ως `<Steps>` με `<li>` αν είναι workflow
   - `<Callout type="info|warning|danger|success">` για σημαντικές σημειώσεις (κυρίως destructive actions, gotchas)
   - Frontmatter `roles:` — όσοι ρόλοι έχουν πραγματικά access (όχι μόνο τυπικά)
   - Frontmatter `description:` — μία γραμμή που εξηγεί τι κάνει
   - Frontmatter `helpAnchors: [anchor1]` — λέξεις-κλειδιά που θα συνδέσουν το `<PageHeader helpAnchor="...">` με αυτή τη σελίδα.

3. **Πρόσθεσε `helpAnchor` prop** στο αντίστοιχο `<PageHeader>` της σελίδας:
   ```tsx
   <PageHeader title="..." helpAnchor="<one-of-the-helpAnchors>" />
   ```
   Το εικονίδιο `?` θα ανοίγει αυτόματα τη σωστή wiki σελίδα.

4. **Screenshot** — πρόσθεσε στο frontmatter:
   ```yaml
   screenshots:
     - file: list.png
       route: /admin/<your-route>
       caption: "Σύντομη λεζάντα"
   ```
   Τρέξε `npm run wiki:screenshots` όταν είσαι έτοιμος (απαιτεί dev server up + `WIKI_USER_*` env vars).

5. **Search index** — `npm run wiki:index` αν θες να ενημερωθεί το `public/wiki/index.json`.

### Διαθέσιμα MDX components
- `<Steps>` `<li>...</li>` `</Steps>` — αριθμημένη ροή
- `<Callout type="info|warning|danger|success">` — έγχρωμο banner
- `<Screenshot src="x.png" caption="..." />` — inline εικόνα
- `<RoleBadge role="ADMIN" />` — έγχρωμο role chip

### Ρόλοι (`prisma/schema.prisma → enum RoleKey`)
`SUPER_ADMIN`, `ADMIN`, `EMPLOYEE`, `COLLABORATOR`, `SUPPLIER`, `CUSTOMER`. Ο SUPER_ADMIN βλέπει αυτόματα όλες τις σελίδες.

### Modules registry
Όλα τα colors / icons / labels της wiki UI ορίζονται **μόνο** στο [lib/wiki/modules-meta.ts](lib/wiki/modules-meta.ts). Μην χρησιμοποιείς δυναμικά Tailwind classes (π.χ. `from-sky-400`) γιατί ο JIT τα purge-άρει — χρησιμοποίησε hex inline styles ή ήδη ορισμένες κλάσεις.

### Συντομογραφία checklist για κάθε νέο feature
- [ ] `npm run wiki:new -- module/slug ...`
- [ ] Γράψε content (Ελληνικά, με Steps + Callouts όπου χρειάζεται)
- [ ] Πρόσθεσε `helpAnchor` στο `<PageHeader>`
- [ ] Πρόσθεσε screenshot route στο frontmatter
- [ ] (προαιρετικά) `npm run wiki:screenshots -- --module <name>`
