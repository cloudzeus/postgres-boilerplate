'use client';

import * as React from 'react';
import { FiPlus, FiTrash2, FiSave, FiLock } from 'react-icons/fi';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { TypeOption } from './companies-view';

export function CompanyTypesDialog({
  open, types, onClose, onChanged,
}: { open: boolean; types: TypeOption[]; onClose: () => void; onChanged: () => void }) {
  const [draft, setDraft] = React.useState({ key: '', name: '', pluralName: '', color: '#2563eb' });
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!draft.key.trim() || !draft.name.trim()) { toast.error('Συμπλήρωσε key και όνομα'); return; }
    setBusy(true);
    const res = await fetch('/api/admin/company-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Δημιουργήθηκε');
      setDraft({ key: '', name: '', pluralName: '', color: '#2563eb' });
      onChanged();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'exists' ? 'Το key υπάρχει ήδη' : 'Αποτυχία');
    }
  };

  const remove = async (t: TypeOption) => {
    if (t.isSystem) { toast.error('Δεν διαγράφονται οι system τύποι'); return; }
    if (t.count > 0 && !confirm(`Ο τύπος έχει ${t.count} εταιρίες. Διαγραφή θα αφαιρέσει τη συσχέτιση. Συνέχεια;`)) return;
    const res = await fetch(`/api/admin/company-types/${t.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); onChanged(); }
    else toast.error('Αποτυχία');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Τύποι εταιριών</DialogTitle>
          <DialogDescription>
            Διαχείριση τύπων (πελάτης, προμηθευτής, συνεργάτης, …). Οι system τύποι δεν διαγράφονται.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ul className="divide-y divide-border rounded-sm border">
            {types.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                <span
                  className="inline-block size-3 rounded-full shrink-0"
                  style={{ background: t.color ?? '#888' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground truncate">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{t.key} · {t.count} εταιρίες</div>
                </div>
                {t.isSystem
                  ? <Badge variant="outline" className="text-[10px]"><FiLock className="mr-1" /> System</Badge>
                  : (
                    <Button variant="ghost" size="sm" onClick={() => remove(t)} aria-label="Διαγραφή">
                      <FiTrash2 className="text-destructive" />
                    </Button>
                  )}
              </li>
            ))}
          </ul>

          <div className="rounded-sm border border-dashed p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Νέος τύπος</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="t-key" className="text-[11px]">Key (UPPER_SNAKE)</Label>
                <Input id="t-key" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })} placeholder="LEAD" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="t-name" className="text-[11px]">Όνομα</Label>
                <Input id="t-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Lead" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="t-plural" className="text-[11px]">Πληθυντικός</Label>
                <Input id="t-plural" value={draft.pluralName} onChange={(e) => setDraft({ ...draft, pluralName: e.target.value })} placeholder="Leads" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="t-color" className="text-[11px]">Χρώμα</Label>
                <Input id="t-color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-8 w-full" />
              </div>
            </div>
            <Button size="sm" onClick={create} disabled={busy}>
              <FiPlus className="mr-1" /> {busy ? 'Προσθήκη…' : 'Προσθήκη τύπου'}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Κλείσιμο</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
