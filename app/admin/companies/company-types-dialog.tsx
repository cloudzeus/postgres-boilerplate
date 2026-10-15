'use client';

import { confirmAction } from '@/components/ui/confirm-dialog';
import * as React from 'react';
import { FiPlus, FiTrash2, FiSave, FiLock, FiLayers } from 'react-icons/fi';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormSection, fieldCls } from '@/components/admin/form-kit';
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
    if (t.count > 0 && !(await confirmAction(`Ο τύπος έχει ${t.count} εταιρίες. Διαγραφή θα αφαιρέσει τη συσχέτιση. Συνέχεια;`))) return;
    const res = await fetch(`/api/admin/company-types/${t.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); onChanged(); }
    else toast.error('Αποτυχία');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiLayers className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Τύποι εταιριών</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-11)]">
              Διαχείριση τύπων (πελάτης, προμηθευτής, συνεργάτης, …). Οι system τύποι δεν διαγράφονται.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[66vh] space-y-3 overflow-auto bg-muted/20 px-4 py-3">
          <FormSection tone="blue" icon={<FiLayers />} title="Υπάρχοντες τύποι" aside={<span className="tabular-nums text-muted-foreground">{types.length}</span>}>
            <ul className="-mx-3 -my-2.5 divide-y divide-border">
              {types.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span
                    aria-hidden
                    className="inline-block size-3 shrink-0 rounded-full"
                    style={{ background: t.color ?? '#888' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[length:var(--fs-13)] font-medium text-foreground">{t.name}</div>
                    <div className="truncate text-[length:var(--fs-11)] text-muted-foreground"><span className="font-mono">{t.key}</span> · {t.count} εταιρίες</div>
                  </div>
                  {t.isSystem
                    ? <Badge variant="outline" className="text-[length:var(--fs-10)]"><FiLock className="mr-1" /> System</Badge>
                    : (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => remove(t)} aria-label="Διαγραφή">
                        <FiTrash2 className="text-destructive" />
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          </FormSection>

          <FormSection tone="amber" icon={<FiPlus />} title="Νέος τύπος">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <Field label="Key (UPPER_SNAKE)" htmlFor="t-key" className="col-span-12 sm:col-span-4">
                <Input id="t-key" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })} placeholder="LEAD" className={`${fieldCls} font-mono`} />
              </Field>
              <Field label="Όνομα" htmlFor="t-name" className="col-span-6 sm:col-span-3">
                <Input id="t-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Lead" className={fieldCls} />
              </Field>
              <Field label="Πληθυντικός" htmlFor="t-plural" className="col-span-6 sm:col-span-3">
                <Input id="t-plural" value={draft.pluralName} onChange={(e) => setDraft({ ...draft, pluralName: e.target.value })} placeholder="Leads" className={fieldCls} />
              </Field>
              <Field label="Χρώμα" htmlFor="t-color" className="col-span-12 sm:col-span-2">
                <Input id="t-color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-8 w-full p-1" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={create} disabled={busy}>
                <FiPlus className="mr-1" /> {busy ? 'Προσθήκη…' : 'Προσθήκη τύπου'}
              </Button>
            </div>
          </FormSection>
        </div>

        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button variant="outline" onClick={onClose}>Κλείσιμο</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
