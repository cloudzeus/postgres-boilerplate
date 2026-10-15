'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import {
  FiEdit2, FiTrash2, FiShield, FiCheck, FiX, FiMail,
  FiAlertTriangle, FiKey, FiMoreVertical, FiUser, FiGlobe, FiLock,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FormSection, FormSelect, RowHint, fieldCls } from '@/components/admin/form-kit';
import { LocaleMultiSelect } from '@/components/i18n/locale-multi-select';

type UserRow = {
  id: string; email: string; name: string;
  roleId: string; roleName: string;
  isActive: boolean; preferredLocales: string[];
  emailVerified: string | null; createdAt: string;
};
type RoleOpt = { id: string; name: string };

export function UsersTable({ rows, roles }: { rows: UserRow[]; roles: RoleOpt[] }) {
  const router = useRouter();
  const [editUser, setEditUser] = React.useState<UserRow | null>(null);
  const [deleteUser, setDeleteUser] = React.useState<UserRow | null>(null);
  const [pwUser, setPwUser] = React.useState<UserRow | null>(null);

  const toggleActive = async (userId: string, isActive: boolean) => {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    if (res.ok) { toast.success(isActive ? 'Απενεργοποιήθηκε' : 'Ενεργοποιήθηκε'); router.refresh(); }
    else toast.error('Αποτυχία');
  };

  const columns: ColumnDef<UserRow>[] = [
    {
      accessorKey: 'name', header: 'Όνομα', size: 220,
      cell: ({ row }) => {
        const initials = (row.original.name || row.original.email).slice(0, 2).toUpperCase();
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[length:var(--fs-10)] font-semibold shrink-0">
              {initials}
            </span>
            <span className="font-medium text-foreground truncate text-[length:var(--fs-12)]">{row.original.name || '—'}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'email', header: 'Email', size: 260,
      cell: ({ row }) => <span className="text-muted-foreground truncate text-[length:var(--fs-12)]">{row.original.email}</span>,
    },
    {
      accessorKey: 'roleName', header: 'Ρόλος', size: 140,
      cell: ({ row }) => <Badge variant="default">{row.original.roleName}</Badge>,
    },
    {
      accessorKey: 'isActive', header: 'Κατάσταση', size: 110,
      cell: ({ row }) => row.original.isActive
        ? <Badge variant="outline" className="border-emerald-300 text-emerald-700"><FiCheck /> Ενεργός</Badge>
        : <Badge variant="outline"><FiX /> Ανενεργός</Badge>,
    },
    {
      accessorKey: 'emailVerified', header: 'Επαλήθευση', size: 110,
      cell: ({ row }) => row.original.emailVerified
        ? <Badge variant="outline" className="border-blue-300 text-blue-700"><FiMail /> Επιβεβ.</Badge>
        : <Badge variant="outline" className="border-amber-300 text-amber-700">Εκκρεμεί</Badge>,
    },
    {
      accessorKey: 'createdAt', header: 'Δημιουργία', size: 120,
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums text-[length:var(--fs-12)]">
          {new Date(row.original.createdAt).toLocaleDateString('el-GR')}
        </span>
      ),
    },
    {
      id: 'actions', header: '', size: 56, enableHiding: false, enableSorting: false, enableResizing: false,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Ενέργειες"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground hover:border-border data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
            >
              <FiMoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuLabel>Ενέργειες</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setEditUser(u)}>
                <FiEdit2 /> Επεξεργασία στοιχείων
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPwUser(u)}>
                <FiKey /> Αλλαγή κωδικού
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleActive(u.id, u.isActive)}>
                {u.isActive ? <FiX /> : <FiCheck />} {u.isActive ? 'Απενεργοποίηση' : 'Ενεργοποίηση'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteUser(u)}>
                <FiTrash2 /> Διαγραφή
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        /* ΣΕΙΡΑ ΘΥΣΙΑΣ: πρώτη η λιγότερο χρήσιμη. Κρύβονται όσες χρειαστεί ώστε ο πίνακας να
           ΧΩΡΑΕΙ — ποτέ οριζόντιο scroll. Το «Στήλες» υπερισχύει. */
        growColumnId="email"
        responsiveHide={['createdAt', 'emailVerified']}
        columns={columns}
        data={rows}
        searchPlaceholder="Αναζήτηση χρηστών..."
        enableSelection
        expandable={(u) => (
          <div className="grid sm:grid-cols-2 gap-4 text-[length:var(--fs-12)] px-1 py-1">
            <div>
              <div className="text-[length:var(--fs-10)] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Δημιουργήθηκε</div>
              <div className="text-foreground">{new Date(u.createdAt).toLocaleString('el-GR')}</div>
            </div>
            <div>
              <div className="text-[length:var(--fs-10)] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Email επιβεβαιωμένο</div>
              <div className="text-foreground">{u.emailVerified ? new Date(u.emailVerified).toLocaleString('el-GR') : '—'}</div>
            </div>
          </div>
        )}
      />

      <EditUserDialog
        user={editUser}
        roles={roles}
        onClose={() => setEditUser(null)}
        onSaved={() => { setEditUser(null); router.refresh(); }}
      />
      <PasswordDialog
        user={pwUser}
        onClose={() => setPwUser(null)}
        onSaved={() => { setPwUser(null); }}
      />
      <DeleteUserDialog
        user={deleteUser}
        onClose={() => setDeleteUser(null)}
        onDeleted={() => { setDeleteUser(null); router.refresh(); }}
      />
    </>
  );
}

function EditUserDialog({
  user, roles, onClose, onSaved,
}: { user: UserRow | null; roles: RoleOpt[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [roleId, setRoleId] = React.useState('');
  const [isActive, setIsActive] = React.useState(true);
  const [locales, setLocales] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setName(user.name); setEmail(user.email);
      setRoleId(user.roleId); setIsActive(user.isActive);
      setLocales(user.preferredLocales ?? []);
    }
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const [r1, r2] = await Promise.all([
      fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, isActive, preferredLocales: locales }),
      }),
      roleId !== user.roleId
        ? fetch(`/api/admin/users/${user.id}/role`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId }),
          })
        : Promise.resolve({ ok: true } as Response),
    ]);
    setSaving(false);
    if (r1.ok && r2.ok) { toast.success('Αποθηκεύτηκε'); onSaved(); }
    else toast.error('Αποτυχία αποθήκευσης');
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiEdit2 className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Επεξεργασία χρήστη</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]">Άλλαξε όνομα, email, ρόλο ή κατάσταση.</DialogDescription>
          </div>
        </DialogHeader>
        <div className="max-h-[66vh] space-y-3 overflow-auto bg-muted/20 px-4 py-3">
          <FormSection tone="blue" icon={<FiUser />} title="Στοιχεία λογαριασμού">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <Field label="Όνομα" htmlFor="edit-name" className="col-span-12 sm:col-span-6">
                <Input id="edit-name" className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="edit-email" className="col-span-12 sm:col-span-6">
                <Input id="edit-email" type="email" className={fieldCls} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection tone="amber" icon={<FiShield />} title="Ρόλος & κατάσταση">
            <div className="grid grid-cols-12 items-end gap-x-3 gap-y-2">
              <Field label="Ρόλος" htmlFor="edit-role" className="col-span-12 sm:col-span-7">
                <FormSelect id="edit-role" value={roleId} onChange={setRoleId} opts={roles} placeholder="Επίλεξε ρόλο" />
              </Field>
              <label className="col-span-12 flex h-8 w-fit cursor-pointer items-center gap-2 sm:col-span-5">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
                <span className="text-[length:var(--fs-13)] text-foreground">Ενεργός λογαριασμός</span>
              </label>
            </div>
          </FormSection>
          <FormSection tone="violet" icon={<FiGlobe />} title="Γλώσσες">
            <div role="group" aria-labelledby="edit-locales" className="grid min-w-0 gap-1">
              <span id="edit-locales" className="text-[length:var(--fs-11)] font-medium text-muted-foreground">Προτιμώμενες γλώσσες</span>
              <LocaleMultiSelect value={locales} onChange={setLocales} />
            </div>
          </FormSection>
        </div>
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button variant="outline" onClick={onClose} disabled={saving}>Άκυρο</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { if (user) { setPw(''); setPw2(''); } }, [user]);

  const save = async () => {
    if (!user) return;
    if (pw.length < 8) { toast.error('Ελάχιστο 8 χαρακτήρες'); return; }
    if (pw !== pw2) { toast.error('Οι κωδικοί δεν ταιριάζουν'); return; }
    setSaving(true);
    const res = await fetch(`/api/admin/users/${user.id}/password`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    setSaving(false);
    if (res.ok) { toast.success('Ο κωδικός ενημερώθηκε'); onSaved(); }
    else toast.error('Αποτυχία ενημέρωσης κωδικού');
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiKey className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Αλλαγή κωδικού</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]">
              Όρισε νέο κωδικό για τον χρήστη <strong className="text-foreground">{user?.name || user?.email}</strong>.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-3 bg-muted/20 px-4 py-3">
          <FormSection tone="amber" icon={<FiLock />} title="Νέος κωδικός">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <Field label="Νέος κωδικός" htmlFor="pw-new" className="col-span-12 sm:col-span-6">
                <Input id="pw-new" type="password" className={fieldCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Επιβεβαίωση" htmlFor="pw-confirm" className="col-span-12 sm:col-span-6">
                <Input id="pw-confirm" type="password" className={fieldCls} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            <RowHint>Τουλάχιστον 8 χαρακτήρες. Ο χρήστης θα ενημερωθεί ξεχωριστά.</RowHint>
          </FormSection>
        </div>
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button variant="outline" onClick={onClose} disabled={saving}>Άκυρο</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Ενημέρωση…' : 'Ορισμός κωδικού'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ user, onClose, onDeleted }: { user: UserRow | null; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = React.useState(false);

  const confirmDelete = async () => {
    if (!user) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) { toast.success('Διαγράφηκε'); onDeleted(); }
    else toast.error('Αποτυχία διαγραφής');
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><FiAlertTriangle className="size-4" /></span>
          <DialogTitle className="min-w-0 flex-1 truncate text-[length:var(--fs-15)] text-destructive">Διαγραφή χρήστη</DialogTitle>
        </DialogHeader>
        <div className="bg-muted/20 px-4 py-3">
          <DialogDescription className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[length:var(--fs-13)] text-foreground">
            Σίγουρα θες να διαγραφεί ο χρήστης{' '}
            <strong className="text-foreground">{user?.name || user?.email}</strong>;
            Αυτή η ενέργεια δεν μπορεί να αναιρεθεί.
          </DialogDescription>
        </div>
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button variant="outline" onClick={onClose} disabled={deleting}>Άκυρο</Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
            <FiTrash2 /> {deleting ? 'Διαγραφή…' : 'Οριστική διαγραφή'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
