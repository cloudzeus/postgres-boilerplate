'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiShield } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Νέος χρήστης</DialogTitle>
          <DialogDescription>Δημιούργησε λογαριασμό και όρισε ρόλο.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="new-name">Όνομα</Label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">Κωδικός</Label>
            <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="τουλάχιστον 8 χαρακτήρες" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-role">Ρόλος</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger id="new-role" className="w-full">
                <SelectValue placeholder="Επίλεξε ρόλο" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(!!v)} />
            <span className="text-[13px] text-foreground">Ενεργός λογαριασμός</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Άκυρο</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
