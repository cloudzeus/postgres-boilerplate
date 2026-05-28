# Wiki / Οδηγός Χρήστη — Convention

Κάθε νέο feature που αλλάζει το UI **πρέπει** να συνοδεύεται από αντίστοιχη wiki σελίδα σε αυτόν τον φάκελο.

## Δομή

```
docs/wiki/<module>/<slug>.mdx
public/wiki/screenshots/<module>/<slug>/*.png
```

## Workflow

1. **Scaffold νέα σελίδα:**
   ```
   npm run wiki:new -- programs/import --roles "ADMIN,EMPLOYEE" --title "Εισαγωγή προγράμματος"
   ```

2. **Γράψε περιεχόμενο** στο νέο `.mdx` (Ελληνικά). Συστατικά διαθέσιμα:
   - `<Steps>` — αριθμημένα βήματα
   - `<Callout type="info|warning|success|danger">`
   - `<Screenshot src="file.png" caption="..." />`
   - `<RoleBadge role="ADMIN" />`

3. **Πρόσθεσε `helpAnchors`** στο frontmatter για να ενεργοποιήσεις το contextual help icon:
   ```yaml
   helpAnchors: [programs-import, programs-import-step2]
   ```
   Στη σελίδα της εφαρμογής:
   ```tsx
   <PageHeader title="..." helpAnchor="programs-import" />
   ```

4. **Screenshots:** στο frontmatter δήλωσε route + actions:
   ```yaml
   screenshots:
     - file: list.png
       route: /admin/programs
       caption: "Λίστα"
     - file: edit.png
       route: /admin/programs/123
       asRole: ADMIN
       actions:
         - waitFor:[data-testid="programs-table"]
   ```
   Τρέξε:
   ```
   npm run wiki:screenshots -- --module programs
   ```

5. **Search index** (αν χρησιμοποιείται):
   ```
   npm run wiki:index
   ```

## Roles

Διαθέσιμοι ρόλοι (από `prisma/schema.prisma → enum RoleKey`):

- `SUPER_ADMIN` — βλέπει τα πάντα αυτόματα
- `ADMIN`
- `EMPLOYEE`
- `COLLABORATOR`
- `SUPPLIER`
- `CUSTOMER`

## Modules

Πρόσθεσε νέο module label στο `lib/wiki/types.ts → MODULE_LABELS`.

## Env vars για Playwright screenshots

```
WIKI_BASE_URL=http://localhost:3000
WIKI_USER_SUPER_ADMIN=super@dev.local:password
WIKI_USER_ADMIN=admin@dev.local:password
WIKI_USER_EMPLOYEE=employee@dev.local:password
WIKI_USER_COLLABORATOR=collab@dev.local:password
WIKI_USER_SUPPLIER=supplier@dev.local:password
WIKI_USER_CUSTOMER=customer@dev.local:password
```

Setup Playwright:
```
npm i -D @playwright/test
npx playwright install chromium
```
