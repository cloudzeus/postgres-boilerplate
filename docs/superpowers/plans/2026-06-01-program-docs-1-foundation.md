# Program Documents — Plan 1: Foundation (Types + Phases + Requirements) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the configuration layer for program supporting-documents: a global catalog of document types, free-form phases per program, and the type↔phase requirement mapping (with mandatory flag).

**Architecture:** Three new Prisma models (`DocumentType`, `ProgramPhase`, `PhaseDocumentRequirement`). A `/admin/document-types` CRUD page (mirrors the reference-data pattern) and a new "Φάσεις & Δικαιολογητικά" tab on `/admin/programs/[id]`. Plain Next.js route handlers gated by existing permissions (`metadata.manage`, `programs.update`). Pure validation helpers are unit-tested with vitest (TDD); API/UI verified manually.

**Tech Stack:** Next.js 16 (App Router, server components), Prisma 7 + PostgreSQL, shadcn/ui + Tailwind, react-icons, vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-program-documents-phases-design.md` (§1.1–1.3, §2.1, §2.2, §3, §5)

**Conventions discovered (do not deviate):**
- Prisma client: `import { prisma } from '@/lib/db'`.
- Auth: `import { requirePermission } from '@/lib/rbac'` → `await requirePermission('x.y')` (throws/redirects on fail; returns the user).
- Route handlers start with `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';`.
- **Migrations:** `prisma migrate dev` is broken in this repo. Use `npx prisma db push` for dev, then `npx prisma generate`.
- Tests: `npx vitest run <path>`.
- Page header: `import { PageHeader } from '@/components/admin/page-header'` — props `{ title, description?, icon?, actions?, helpAnchor? }`.
- Wiki scaffold: `npm run wiki:new -- <module>/<slug> --roles "ADMIN,EMPLOYEE" --title "..."`.

---

### Task 1: Prisma schema — DocumentType, ProgramPhase, PhaseDocumentRequirement

**Files:**
- Modify: `prisma/schema.prisma` (append models near the Program block ~line 1131; add one relation field to `model Program`)

- [ ] **Step 1: Add `phases` relation to the `Program` model**

In `model Program { ... }`, in the relations group (after `deadlines       ProgramDeadline[]`, around line 995), add:

```prisma
  phases          ProgramPhase[]
```

- [ ] **Step 2: Append the three new models** (after `model ProgramDeadline { ... }`, around line 1131)

```prisma
// ============================================================
// Supporting documents — catalog, program phases, requirements
// ============================================================

/// Global catalog of supporting-document types (δικαιολογητικά), reused across all programs.
model DocumentType {
  id             String   @id @default(cuid())
  name           String   @unique                 // «Καταστατικό», «Φορολογική ενημερότητα»
  description    String?
  category       String?                           // optional grouping label
  requiresExpiry Boolean  @default(true)           // if true → expiry date mandatory on upload form
  notifyExpiry   Boolean  @default(true)           // on/off expiry notifications for this type
  active         Boolean  @default(true)
  order          Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  requirements PhaseDocumentRequirement[]

  @@index([active])
}

/// Free-form phases of a program (e.g. Υποβολή → Ένταξη → Υλοποίηση → Ολοκλήρωση). No dates here.
model ProgramPhase {
  id        String   @id @default(cuid())
  programId String
  program   Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  name      String
  order     Int      @default(0)
  createdAt DateTime @default(now())

  requirements PhaseDocumentRequirement[]

  @@index([programId])
}

/// Which document types are required at which phase, and whether mandatory.
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

> NOTE: `DocumentType` will gain `supportingDocs` and `uploadLinkTypes` relations in later plans (2 and 4). Do not add them now — the referenced models don't exist yet and Prisma would fail to validate.

- [ ] **Step 3: Push schema and regenerate client**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema." then "Generated Prisma Client".

- [ ] **Step 4: Verify the client typechecks the new models**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "documentType\|programPhase\|phaseDocumentRequirement" || echo "no type errors for new models"`
Expected: `no type errors for new models`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(docs): add DocumentType, ProgramPhase, PhaseDocumentRequirement models"
```

---

### Task 2: Pure validation helper for document-type input (TDD)

**Files:**
- Create: `lib/documents/document-types.ts`
- Test: `lib/documents/document-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/documents/document-types.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeDocumentTypeInput } from './document-types';

describe('normalizeDocumentTypeInput', () => {
  it('trims name and keeps booleans', () => {
    const r = normalizeDocumentTypeInput({ name: '  Καταστατικό  ', requiresExpiry: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Καταστατικό');
      expect(r.value.requiresExpiry).toBe(false);
      expect(r.value.notifyExpiry).toBe(true); // default
      expect(r.value.active).toBe(true);       // default
    }
  });

  it('rejects empty name', () => {
    const r = normalizeDocumentTypeInput({ name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });

  it('coerces description/category empty strings to null', () => {
    const r = normalizeDocumentTypeInput({ name: 'X', description: '', category: '  ' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.description).toBeNull();
      expect(r.value.category).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/documents/document-types.test.ts`
Expected: FAIL — "Failed to resolve import './document-types'".

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/documents/document-types.ts

export interface DocumentTypeInput {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  requiresExpiry?: unknown;
  notifyExpiry?: unknown;
  active?: unknown;
  order?: unknown;
}

export interface NormalizedDocumentType {
  name: string;
  description: string | null;
  category: string | null;
  requiresExpiry: boolean;
  notifyExpiry: boolean;
  active: boolean;
  order: number;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedDocumentType }
  | { ok: false; error: string };

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function normalizeDocumentTypeInput(input: DocumentTypeInput): NormalizeResult {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  const order = Number.isFinite(Number(input.order)) ? Math.trunc(Number(input.order)) : 0;
  return {
    ok: true,
    value: {
      name,
      description: strOrNull(input.description),
      category: strOrNull(input.category),
      requiresExpiry: boolOr(input.requiresExpiry, true),
      notifyExpiry: boolOr(input.notifyExpiry, true),
      active: boolOr(input.active, true),
      order,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/documents/document-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/documents/document-types.ts lib/documents/document-types.test.ts
git commit -m "feat(docs): document-type input normalization helper"
```

---

### Task 3: API — list & create document types

**Files:**
- Create: `app/api/admin/document-types/route.ts`

- [ ] **Step 1: Implement the route handler**

```ts
// app/api/admin/document-types/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeDocumentTypeInput } from '@/lib/documents/document-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — full catalog (admin)
export async function GET() {
  await requirePermission('metadata.read');
  const types = await prisma.documentType.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json({ data: types });
}

// POST — create a document type
export async function POST(req: Request) {
  const user = await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const norm = normalizeDocumentTypeInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

  const existing = await prisma.documentType.findUnique({ where: { name: norm.value.name } });
  if (existing) return NextResponse.json({ error: 'Υπάρχει ήδη τύπος με αυτό το όνομα' }, { status: 409 });

  const created = await prisma.documentType.create({ data: norm.value });
  await logAudit({ action: 'document_type.create', resource: 'document_type', resourceId: created.id, actorId: user.id });
  return NextResponse.json({ data: created }, { status: 201 });
}
```

> Verify `logAudit`'s signature before use: `grep -n "export async function logAudit\|export function logAudit" lib/audit.ts` and match the param names (the backup cron calls `logAudit({ action, resource, resourceId })`). If `actorId` is not a supported key, drop it.

- [ ] **Step 2: Manual verification**

Run dev server (`npm run dev`), then:
```bash
curl -s -X POST http://localhost:3000/api/admin/document-types \
  -H 'Content-Type: application/json' --cookie "<admin session cookie>" \
  -d '{"name":"Καταστατικό","requiresExpiry":false}' | head
```
Expected: JSON with `data.id` and `requiresExpiry:false`. (If you cannot supply a session cookie, defer to the UI verification in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/document-types/route.ts
git commit -m "feat(docs): GET/POST /api/admin/document-types"
```

---

### Task 4: API — update & delete a document type

**Files:**
- Create: `app/api/admin/document-types/[id]/route.ts`

- [ ] **Step 1: Implement the route handler**

```ts
// app/api/admin/document-types/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeDocumentTypeInput } from '@/lib/documents/document-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH — update
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const norm = normalizeDocumentTypeInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

  const clash = await prisma.documentType.findFirst({
    where: { name: norm.value.name, NOT: { id } },
    select: { id: true },
  });
  if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη τύπος με αυτό το όνομα' }, { status: 409 });

  const updated = await prisma.documentType.update({ where: { id }, data: norm.value });
  await logAudit({ action: 'document_type.update', resource: 'document_type', resourceId: id });
  return NextResponse.json({ data: updated });
}

// DELETE — remove (blocked if used by any requirement)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const usedBy = await prisma.phaseDocumentRequirement.count({ where: { documentTypeId: id } });
  if (usedBy > 0) {
    return NextResponse.json(
      { error: `Ο τύπος χρησιμοποιείται σε ${usedBy} φάση/εις προγραμμάτων. Απενεργοποίησέ τον αντί να τον διαγράψεις.` },
      { status: 409 },
    );
  }
  await prisma.documentType.delete({ where: { id } });
  await logAudit({ action: 'document_type.delete', resource: 'document_type', resourceId: id });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/api/admin/document-types/[id]/route.ts"
git commit -m "feat(docs): PATCH/DELETE /api/admin/document-types/[id]"
```

---

### Task 5: `/admin/document-types` page + client CRUD table

**Files:**
- Create: `app/admin/document-types/page.tsx`
- Create: `app/admin/document-types/document-types-client.tsx`

- [ ] **Step 1: Server page**

```tsx
// app/admin/document-types/page.tsx
import { FiFileText } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { DocumentTypesClient, type DocumentTypeRow } from './document-types-client';

export const dynamic = 'force-dynamic';

export default async function DocumentTypesPage() {
  await requirePermission('metadata.read');
  const canManage = await hasPermission('metadata.manage');
  const types = await prisma.documentType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  const rows: DocumentTypeRow[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    requiresExpiry: t.requiresExpiry,
    notifyExpiry: t.notifyExpiry,
    active: t.active,
    order: t.order,
  }));

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiFileText />}
        title="Τύποι Δικαιολογητικών"
        description="Κατάλογος τύπων δικαιολογητικών που χρησιμοποιούνται σε όλα τα προγράμματα και τις εταιρίες."
        helpAnchor="document-types"
      />
      <DocumentTypesClient rows={rows} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 2: Client component (table + create/edit dialog + delete)**

```tsx
// app/admin/document-types/document-types-client.tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

export type DocumentTypeRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  requiresExpiry: boolean;
  notifyExpiry: boolean;
  active: boolean;
  order: number;
};

type FormState = {
  name: string; description: string; category: string;
  requiresExpiry: boolean; notifyExpiry: boolean; active: boolean; order: number;
};

const EMPTY: FormState = { name: '', description: '', category: '', requiresExpiry: true, notifyExpiry: true, active: true, order: 0 };

export function DocumentTypesClient({ rows, canManage }: { rows: DocumentTypeRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<DocumentTypeRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function openCreate() { setForm(EMPTY); setCreating(true); setError(null); }
  function openEdit(r: DocumentTypeRow) {
    setForm({ name: r.name, description: r.description ?? '', category: r.category ?? '', requiresExpiry: r.requiresExpiry, notifyExpiry: r.notifyExpiry, active: r.active, order: r.order });
    setEditing(r); setError(null);
  }
  function close() { setCreating(false); setEditing(null); }

  async function save() {
    setSaving(true); setError(null);
    const url = editing ? `/api/admin/document-types/${editing.id}` : '/api/admin/document-types';
    const res = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    close(); router.refresh();
  }

  async function remove(r: DocumentTypeRow) {
    if (!confirm(`Διαγραφή τύπου «${r.name}»;`)) return;
    const res = await fetch(`/api/admin/document-types/${r.id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Σφάλμα διαγραφής'); return; }
    router.refresh();
  }

  const open = creating || editing !== null;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={openCreate}><FiPlus className="mr-1.5" /> Νέος τύπος</Button>
        </div>
      )}

      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-body-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-3 py-2">Όνομα</th>
              <th className="text-left font-medium px-3 py-2">Κατηγορία</th>
              <th className="text-left font-medium px-3 py-2">Λήξη</th>
              <th className="text-left font-medium px-3 py-2">Ειδοποιήσεις</th>
              <th className="text-left font-medium px-3 py-2">Κατάσταση</th>
              {canManage && <th className="px-3 py-2 w-24" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-8 text-center text-muted-foreground">Δεν υπάρχουν τύποι ακόμη.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">{r.name}</div>
                  {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.category ?? '—'}</td>
                <td className="px-3 py-2">{r.requiresExpiry ? <Badge variant="secondary">Υποχρεωτική</Badge> : <span className="text-muted-foreground">Προαιρετική</span>}</td>
                <td className="px-3 py-2">{r.notifyExpiry ? 'Ναι' : 'Όχι'}</td>
                <td className="px-3 py-2">{r.active ? <Badge>Ενεργό</Badge> : <Badge variant="outline">Ανενεργό</Badge>}</td>
                {canManage && (
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)} aria-label="Επεξεργασία"><FiEdit2 /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(r)} aria-label="Διαγραφή"><FiTrash2 /></Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Επεξεργασία τύπου' : 'Νέος τύπος δικαιολογητικού'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Όνομα *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Καταστατικό" /></div>
            <div><Label>Περιγραφή</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label>Κατηγορία</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="π.χ. Νομιμοποιητικά" /></div>
            <div className="flex items-center justify-between"><Label>Απαιτεί ημερομηνία λήξης</Label><Switch checked={form.requiresExpiry} onCheckedChange={(v) => setForm({ ...form, requiresExpiry: v })} /></div>
            <div className="flex items-center justify-between"><Label>Ειδοποιήσεις λήξης</Label><Switch checked={form.notifyExpiry} onCheckedChange={(v) => setForm({ ...form, notifyExpiry: v })} /></div>
            <div className="flex items-center justify-between"><Label>Ενεργό</Label><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></div>
            {error && <p className="text-body-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>Άκυρο</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

> Before writing, confirm these UI primitives exist: `ls components/ui/ | grep -E "switch|badge|label|dialog|input|button"`. If `switch` is missing, replace the `<Switch>` rows with a checkbox `<input type="checkbox">`. Match imports to whatever the repo exports.

- [ ] **Step 3: Manual verification**

Start dev server, log in as ADMIN, visit `/admin/document-types`. Create "Καταστατικό" (Απαιτεί λήξη = off), create "Φορολογική ενημερότητα" (on). Edit one, toggle Ενεργό. Verify the table refreshes. Try deleting — succeeds (no requirements yet).
Expected: all CRUD operations work; duplicate name shows the 409 message.

- [ ] **Step 4: Commit**

```bash
git add app/admin/document-types/
git commit -m "feat(docs): /admin/document-types CRUD page"
```

---

### Task 6: Sidebar entry for document types

**Files:**
- Modify: `components/admin/sidebar.tsx` (the main nav array, near line 58 `reference-data`)

- [ ] **Step 1: Add the nav item**

Immediately after the `'/admin/reference-data'` entry (line ~58), add:

```tsx
      { href: '/admin/document-types', label: 'Τύποι Δικαιολογητικών', icon: FiFileText, permissions: ['metadata.read'] },
```

- [ ] **Step 2: Ensure the icon is imported**

Check the existing `react-icons/fi` import line at the top of the file. If `FiFileText` is not already imported, add it to that import list. (It is already used elsewhere in the file at `/admin/docs`, so it is likely present — verify with `grep -n "FiFileText" components/admin/sidebar.tsx`.)

- [ ] **Step 3: Manual verification**

Reload `/admin`. The "Τύποι Δικαιολογητικών" link appears for an ADMIN and navigates correctly.

- [ ] **Step 4: Commit**

```bash
git add components/admin/sidebar.tsx
git commit -m "feat(docs): sidebar link to document types"
```

---

### Task 7: API — program phases CRUD

**Files:**
- Create: `app/api/admin/programs/[id]/phases/route.ts`
- Create: `app/api/admin/programs/[id]/phases/[phaseId]/route.ts`

- [ ] **Step 1: List + create phases**

```ts
// app/api/admin/programs/[id]/phases/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — phases of a program with their requirements
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const phases = await prisma.programPhase.findMany({
    where: { programId: id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      requirements: { include: { documentType: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json({ data: phases });
}

// POST — create a phase (order = current count, appended last)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Το όνομα φάσης είναι υποχρεωτικό' }, { status: 400 });
  const program = await prisma.program.findUnique({ where: { id }, select: { id: true } });
  if (!program) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const count = await prisma.programPhase.count({ where: { programId: id } });
  const phase = await prisma.programPhase.create({ data: { programId: id, name, order: count } });
  return NextResponse.json({ data: phase }, { status: 201 });
}
```

- [ ] **Step 2: Update + delete a phase**

```ts
// app/api/admin/programs/[id]/phases/[phaseId]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH — rename and/or reorder. body: { name?: string, order?: number }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; phaseId: string }> }) {
  await requirePermission('programs.update');
  const { phaseId } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { name?: string; order?: number } = {};
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: 'Το όνομα φάσης είναι υποχρεωτικό' }, { status: 400 });
    data.name = n;
  }
  if (Number.isFinite(Number(body.order))) data.order = Math.trunc(Number(body.order));
  const updated = await prisma.programPhase.update({ where: { id: phaseId }, data });
  return NextResponse.json({ data: updated });
}

// DELETE — remove a phase (cascade deletes its requirements)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; phaseId: string }> }) {
  await requirePermission('programs.update');
  const { phaseId } = await params;
  await prisma.programPhase.delete({ where: { id: phaseId } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/programs/[id]/phases/"
git commit -m "feat(docs): program phases CRUD API"
```

---

### Task 8: API — phase document requirements

**Files:**
- Create: `app/api/admin/programs/[id]/phases/[phaseId]/requirements/route.ts`

- [ ] **Step 1: Implement add / update-mandatory / remove**

```ts
// app/api/admin/programs/[id]/phases/[phaseId]/requirements/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — attach a document type to the phase. body: { documentTypeId, mandatory? }
export async function POST(req: Request, { params }: { params: Promise<{ phaseId: string }> }) {
  await requirePermission('programs.update');
  const { phaseId } = await params;
  const body = await req.json().catch(() => ({}));
  const documentTypeId = typeof body.documentTypeId === 'string' ? body.documentTypeId : '';
  if (!documentTypeId) return NextResponse.json({ error: 'documentTypeId required' }, { status: 400 });
  const mandatory = typeof body.mandatory === 'boolean' ? body.mandatory : true;
  const existing = await prisma.phaseDocumentRequirement.findUnique({
    where: { phaseId_documentTypeId: { phaseId, documentTypeId } },
  });
  if (existing) return NextResponse.json({ error: 'Ο τύπος υπάρχει ήδη σε αυτή τη φάση' }, { status: 409 });
  const req_ = await prisma.phaseDocumentRequirement.create({
    data: { phaseId, documentTypeId, mandatory },
    include: { documentType: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ data: req_ }, { status: 201 });
}

// PATCH — toggle mandatory. body: { documentTypeId, mandatory }
export async function PATCH(req: Request, { params }: { params: Promise<{ phaseId: string }> }) {
  await requirePermission('programs.update');
  const { phaseId } = await params;
  const body = await req.json().catch(() => ({}));
  const documentTypeId = typeof body.documentTypeId === 'string' ? body.documentTypeId : '';
  if (!documentTypeId || typeof body.mandatory !== 'boolean') {
    return NextResponse.json({ error: 'documentTypeId and mandatory required' }, { status: 400 });
  }
  const updated = await prisma.phaseDocumentRequirement.update({
    where: { phaseId_documentTypeId: { phaseId, documentTypeId } },
    data: { mandatory: body.mandatory },
  });
  return NextResponse.json({ data: updated });
}

// DELETE — detach a type. query: ?documentTypeId=...
export async function DELETE(req: Request, { params }: { params: Promise<{ phaseId: string }> }) {
  await requirePermission('programs.update');
  const { phaseId } = await params;
  const documentTypeId = new URL(req.url).searchParams.get('documentTypeId') ?? '';
  if (!documentTypeId) return NextResponse.json({ error: 'documentTypeId required' }, { status: 400 });
  await prisma.phaseDocumentRequirement.delete({
    where: { phaseId_documentTypeId: { phaseId, documentTypeId } },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/api/admin/programs/[id]/phases/[phaseId]/requirements/"
git commit -m "feat(docs): phase document requirements API"
```

---

### Task 9: Program "Φάσεις & Δικαιολογητικά" tab

**Files:**
- Create: `app/admin/programs/[id]/phases-tab.tsx`
- Modify: `app/admin/programs/[id]/editor.tsx` (or wherever the program tabs are rendered — find with `grep -n "TabsTrigger\|questionnaire" app/admin/programs/[id]/*.tsx`)

- [ ] **Step 1: Locate the tab host**

Run: `grep -n "TabsList\|TabsTrigger\|TabsContent\|QuestionnaireTab\|questionnaire-tab" app/admin/programs/[id]/editor.tsx app/admin/programs/[id]/page.tsx`
Expected: identifies the `<Tabs>` block and how `programId` and `canManage` reach it. Mirror that wiring.

- [ ] **Step 2: Build the tab component**

```tsx
// app/admin/programs/[id]/phases-tab.tsx
'use client';
import * as React from 'react';
import { FiPlus, FiTrash2, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type DocTypeOption = { id: string; name: string };
type Requirement = { id: string; documentTypeId: string; mandatory: boolean; documentType: { id: string; name: string } };
type Phase = { id: string; name: string; order: number; requirements: Requirement[] };

export function PhasesTab({ programId, docTypes, canManage }: { programId: string; docTypes: DocTypeOption[]; canManage: boolean }) {
  const [phases, setPhases] = React.useState<Phase[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newName, setNewName] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/programs/${programId}/phases`);
    const json = await res.json();
    setPhases(json.data ?? []);
    setLoading(false);
  }, [programId]);
  React.useEffect(() => { load(); }, [load]);

  async function addPhase() {
    const name = newName.trim();
    if (!name) return;
    await fetch(`/api/admin/programs/${programId}/phases`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    setNewName(''); load();
  }
  async function renamePhase(phaseId: string, name: string) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
  }
  async function deletePhase(phaseId: string) {
    if (!confirm('Διαγραφή φάσης και των απαιτήσεών της;')) return;
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}`, { method: 'DELETE' });
    load();
  }
  async function move(phaseId: string, dir: -1 | 1) {
    const idx = phases.findIndex((p) => p.id === phaseId);
    const swap = idx + dir;
    if (swap < 0 || swap >= phases.length) return;
    const a = phases[idx], b = phases[swap];
    await Promise.all([
      fetch(`/api/admin/programs/${programId}/phases/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: b.order }) }),
      fetch(`/api/admin/programs/${programId}/phases/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: a.order }) }),
    ]);
    load();
  }
  async function addReq(phaseId: string, documentTypeId: string) {
    if (!documentTypeId) return;
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentTypeId }),
    });
    load();
  }
  async function toggleMandatory(phaseId: string, documentTypeId: string, mandatory: boolean) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentTypeId, mandatory }),
    });
    load();
  }
  async function removeReq(phaseId: string, documentTypeId: string) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements?documentTypeId=${encodeURIComponent(documentTypeId)}`, { method: 'DELETE' });
    load();
  }

  if (loading) return <p className="text-body-sm text-muted-foreground">Φόρτωση…</p>;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Νέα φάση (π.χ. Υποβολή)" onKeyDown={(e) => e.key === 'Enter' && addPhase()} />
          <Button onClick={addPhase}><FiPlus className="mr-1.5" /> Προσθήκη φάσης</Button>
        </div>
      )}

      {phases.length === 0 && <p className="text-body-sm text-muted-foreground">Δεν υπάρχουν φάσεις ακόμη.</p>}

      {phases.map((p, i) => {
        const usedIds = new Set(p.requirements.map((r) => r.documentTypeId));
        const available = docTypes.filter((d) => !usedIds.has(d.id));
        return (
          <div key={p.id} className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-center gap-2">
              {canManage ? (
                <Input className="max-w-xs font-medium" defaultValue={p.name} onBlur={(e) => renamePhase(p.id, e.target.value)} />
              ) : (
                <span className="font-medium">{p.name}</span>
              )}
              {canManage && (
                <div className="flex gap-1 ml-auto">
                  <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(p.id, -1)} aria-label="Πάνω"><FiChevronUp /></Button>
                  <Button size="icon" variant="ghost" disabled={i === phases.length - 1} onClick={() => move(p.id, 1)} aria-label="Κάτω"><FiChevronDown /></Button>
                  <Button size="icon" variant="ghost" onClick={() => deletePhase(p.id)} aria-label="Διαγραφή"><FiTrash2 /></Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              {p.requirements.length === 0 && <p className="text-xs text-muted-foreground">Κανένα δικαιολογητικό σε αυτή τη φάση.</p>}
              {p.requirements.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-body-sm">
                  <span className="flex-1">{r.documentType.name}</span>
                  {canManage ? (
                    <>
                      <Button size="sm" variant={r.mandatory ? 'default' : 'outline'} onClick={() => toggleMandatory(p.id, r.documentTypeId, !r.mandatory)}>
                        {r.mandatory ? 'Υποχρεωτικό' : 'Προαιρετικό'}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => removeReq(p.id, r.documentTypeId)} aria-label="Αφαίρεση"><FiTrash2 /></Button>
                    </>
                  ) : (
                    <Badge variant={r.mandatory ? 'default' : 'outline'}>{r.mandatory ? 'Υποχρεωτικό' : 'Προαιρετικό'}</Badge>
                  )}
                </div>
              ))}
            </div>

            {canManage && available.length > 0 && (
              <select
                className="text-body-sm rounded-md border border-border bg-background px-2 py-1"
                value=""
                onChange={(e) => addReq(p.id, e.target.value)}
              >
                <option value="">+ Προσθήκη δικαιολογητικού…</option>
                {available.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire the tab into the program page**

In the program tab host identified in Step 1, add a new `TabsTrigger value="phases"` labelled "Φάσεις & Δικαιολογητικά" and a matching `TabsContent value="phases"` that renders `<PhasesTab programId={...} docTypes={...} canManage={...} />`. Fetch active document types in the server page (`page.tsx`) and pass them down:

```tsx
// in app/admin/programs/[id]/page.tsx server component, before rendering the tabs:
const docTypes = await prisma.documentType.findMany({
  where: { active: true },
  orderBy: [{ order: 'asc' }, { name: 'asc' }],
  select: { id: true, name: true },
});
// pass docTypes (and existing canManage flag) into the tab host / PhasesTab
```

- [ ] **Step 4: Manual verification**

Open a program at `/admin/programs/<id>`, go to the new tab. Add phases "Υποβολή", "Ένταξη". Reorder them. Add "Καταστατικό" to "Υποβολή", toggle to Προαιρετικό, then back. Remove it. Delete a phase.
Expected: all actions persist (reload page → state intact).

- [ ] **Step 5: Commit**

```bash
git add "app/admin/programs/[id]/phases-tab.tsx" "app/admin/programs/[id]/page.tsx" "app/admin/programs/[id]/editor.tsx"
git commit -m "feat(docs): program phases & requirements tab"
```

---

### Task 10: Wiki pages + module registration

**Files:**
- Modify: `lib/wiki/modules-meta.ts` (add a `documents` module if absent)
- Create (via script): `docs/wiki/documents/document-types.mdx`, `docs/wiki/programs/phases.mdx`

- [ ] **Step 1: Register the `documents` module** (if not present)

Open `lib/wiki/modules-meta.ts`, find the `MODULE_META` map, and add an entry mirroring the shape of an existing one (e.g. the `companies` entry). Use static hex colors (no dynamic Tailwind classes — they get purged):

```ts
  documents: {
    label: 'Δικαιολογητικά',
    description: 'Τύποι δικαιολογητικών, φάσεις προγραμμάτων και απαιτήσεις',
    icon: 'FiFileText',
    // copy the color/gradient field names from a neighbouring entry; use hex values
  },
```

(Match the exact field names the interface requires — read a neighbouring entry first.)

- [ ] **Step 2: Scaffold the two wiki pages**

```bash
npm run wiki:new -- documents/document-types --roles "ADMIN,EMPLOYEE" --title "Τύποι Δικαιολογητικών"
npm run wiki:new -- programs/phases --roles "ADMIN,EMPLOYEE" --title "Φάσεις & Δικαιολογητικά Προγράμματος"
```
Expected: two `.mdx` files created under `docs/wiki/`.

- [ ] **Step 3: Write content for `docs/wiki/documents/document-types.mdx`** (replace body, keep generated frontmatter; add `helpAnchors: [document-types]`)

```mdx
## Επισκόπηση

Ο κατάλογος **Τύπων Δικαιολογητικών** είναι ένας ενιαίος κατάλογος που ορίζεις μία φορά και
επαναχρησιμοποιείς σε όλα τα προγράμματα και τις εταιρίες (π.χ. «Καταστατικό», «Φορολογική
ενημερότητα»).

<Steps>
  <li>Πάτησε **Νέος τύπος** και δώσε όνομα (υποχρεωτικό).</li>
  <li>Όρισε αν **απαιτεί ημερομηνία λήξης** — για μόνιμα έγγραφα (π.χ. Καταστατικό) άφησέ το ανενεργό.</li>
  <li>Άφησε τις **Ειδοποιήσεις λήξης** ενεργές για να ειδοποιείται η ομάδα πριν τη λήξη.</li>
  <li>Απενεργοποίησε (Ανενεργό) έναν τύπο αντί να τον διαγράψεις αν χρησιμοποιείται ήδη.</li>
</Steps>

<Callout type="warning">
Δεν μπορείς να διαγράψεις τύπο που χρησιμοποιείται σε φάση προγράμματος. Απενεργοποίησέ τον.
</Callout>
```

- [ ] **Step 4: Write content for `docs/wiki/programs/phases.mdx`** (add `helpAnchors: [program-phases]`)

```mdx
## Επισκόπηση

Κάθε πρόγραμμα χωρίζεται σε **φάσεις** (π.χ. Υποβολή → Ένταξη → Υλοποίηση → Ολοκλήρωση). Σε κάθε
φάση ορίζεις ποια δικαιολογητικά απαιτούνται και αν είναι υποχρεωτικά.

<Steps>
  <li>Στην καρτέλα προγράμματος άνοιξε το tab **Φάσεις & Δικαιολογητικά**.</li>
  <li>Πρόσθεσε φάσεις και βάλ' τες στη σωστή σειρά με τα βελάκια.</li>
  <li>Σε κάθε φάση πρόσθεσε δικαιολογητικά από τον κατάλογο τύπων.</li>
  <li>Όρισε κάθε δικαιολογητικό ως **Υποχρεωτικό** ή **Προαιρετικό**.</li>
</Steps>
```

- [ ] **Step 5: Add `helpAnchor` to the page headers**

- `app/admin/document-types/page.tsx` `<PageHeader>` already has `helpAnchor="document-types"` (added in Task 5). Confirm it matches the wiki `helpAnchors`.
- For the program phases tab, the program page `<PageHeader>` is shared; add `helpAnchor="program-phases"` only if the page does not already set a different anchor. If it does, skip (the tab is reachable from the documented program page).

- [ ] **Step 6: Rebuild the wiki search index**

Run: `npm run wiki:index`
Expected: `public/wiki/index.json` updated (git diff shows the two new entries).

- [ ] **Step 7: Commit**

```bash
git add lib/wiki/modules-meta.ts docs/wiki/documents/ docs/wiki/programs/phases.mdx public/wiki/index.json app/admin/document-types/page.tsx
git commit -m "docs(wiki): document-types & program phases wiki pages"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Plan 1 scope = §1.1–1.3, §2.1, §2.2, §3 config rows, §5):**
- §1.1 DocumentType → Task 1 ✓
- §1.2 ProgramPhase → Task 1 ✓
- §1.3 PhaseDocumentRequirement → Task 1 ✓
- §2.1 /admin/document-types → Tasks 5, 6 ✓
- §2.2 program phases tab → Tasks 7–9 ✓
- §3 API rows (document-types, phases, requirements) → Tasks 3, 4, 7, 8 ✓
- §5 wiki + sidebar + permissions reuse → Tasks 6, 10 ✓ (no new permissions needed — reuse `metadata.*`, `programs.*`)

**Out of Plan 1 (later plans, intentionally not here):** SupportingDocument, compliance, notifications, upload links, and the `DocumentType.supportingDocs`/`uploadLinkTypes` relations.

**Placeholder scan:** No TBD/TODO. Two deliberate "confirm/verify before writing" notes (logAudit signature, UI primitive names, program tab host location) — these are discovery steps with explicit grep commands and fallbacks, not vague placeholders.

**Type consistency:** `normalizeDocumentTypeInput` signature/return used identically in Tasks 2/3/4. Requirement composite key `phaseId_documentTypeId` used consistently in Task 8. Phase shape (`{id,name,order,requirements[]}`) consistent between API (Task 7 GET include) and UI (Task 9).
