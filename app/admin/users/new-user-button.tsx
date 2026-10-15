'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiShield, FiUser, FiUserPlus } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FormSection, FormSelect, fieldCls } from '@/components/admin/form-kit';

export function NewUserButton({ roles }: { roles: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [roleId, setRoleId] = React.useState(roles[0]?.id ?? '');
  const [active, setActive] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const reset = () => {
    setName(''); setEmail(''); setPassword('');
    setRoleId(roles[0]?.id ?? ''); setActive(true);
  };

  const submit = async () => {
    if (!name || !email || !password || !roleId) {
      toast.error('Συμπλήρωσε όλα τα πεδία');
      return;
    }
    if (password.length < 8) {
      toast.error('Ο κωδικός θέλει τουλάχιστον 8 χαρακτήρες');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, roleId }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success('Ο χρήστης δημιουργήθηκε');
      reset();
      setOpen(false);
      router.refresh();
    } else if (res.status === 409) {
      toast.error('Υπάρχει ήδη χρήστης με αυτό το email');
    } else {
      toast.error('Αποτυχία δημιουργίας');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button><FiPlus /> Νέος χρήστης</Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiUserPlus className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Νέος χρήστης</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]">Δημιούργησε λογαριασμό και όρισε ρόλο.</DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-3 bg-muted/20 px-4 py-3">
          <FormSection tone="blue" icon={<FiUser />} title="Στοιχεία λογαριασμού">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <Field label="Όνομα" required htmlFor="new-name" className="col-span-12 sm:col-span-6">
                <Input id="new-name" className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Email" required htmlFor="new-email" className="col-span-12 sm:col-span-6">
                <Input id="new-email" type="email" className={fieldCls} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection tone="amber" icon={<FiShield />} title="Πρόσβαση">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <Field label="Κωδικός" required htmlFor="new-password" className="col-span-12 sm:col-span-6">
                <Input id="new-password" type="password" className={fieldCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="τουλάχιστον 8 χαρακτήρες" />
              </Field>
              <Field label="Ρόλος" required htmlFor="new-role" className="col-span-12 sm:col-span-6">
                <FormSelect id="new-role" value={roleId} onChange={setRoleId} opts={roles} placeholder="Επίλεξε ρόλο" />
              </Field>
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2">
              <Checkbox checked={active} onCheckedChange={(v) => setActive(!!v)} />
              <span className="text-[length:var(--fs-13)] text-foreground">Ενεργός λογαριασμός</span>
            </label>
          </FormSection>
        </div>
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Άκυρο</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
