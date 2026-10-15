'use client';
import { toast } from 'sonner';
import { confirmAction } from '@/components/ui/confirm-dialog';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiEdit2, FiTrash2, FiMoreVertical, FiBriefcase } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormSection, RowHint, fieldCls } from '@/components/admin/form-kit';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export type BusinessTypeRow = { id: string; code: string; name: string; order: number; active: boolean };
type FormState = { code: string; name: string; order: number; active: boolean };
const EMPTY: FormState = { code: '', name: '', order: 0, active: true };

export function BusinessTypesClient({ rows, canManage }: { rows: BusinessTypeRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<BusinessTypeRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resyncing, setResyncing] = React.useState(false);

  async function resync() {
    setResyncing(true);
    const res = await fetch('/api/admin/business-types/resolve', { method: 'POST' });
    setResyncing(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(json.error ?? 'Σφάλμα'); return; }
    toast.success(`Ενημερώθηκαν ${json.changed ?? 0} εταιρίες.`);
    router.refresh();
  }

  function openCreate() { setForm(EMPTY); setCreating(true); setError(null); }
  function openEdit(r: BusinessTypeRow) { setForm({ code: r.code, name: r.name, order: r.order, active: r.active }); setEditing(r); setError(null); }
  function close() { setCreating(false); setEditing(null); }

  async function save() {
    setSaving(true); setError(null);
    const url = editing ? `/api/admin/business-types/${editing.id}` : '/api/admin/business-types';
    const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    close(); router.refresh();
  }
  async function remove(r: BusinessTypeRow) {
    if (!(await confirmAction(`Διαγραφή μορφής «${r.name}»;`))) return;
    const res = await fetch(`/api/admin/business-types/${r.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    router.refresh();
  }
  const open = creating || editing !== null;

  return (
    <div className="space-y-4">
      {canManage && (<div className="flex justify-end gap-2"><Button variant="outline" onClick={resync} disabled={resyncing} title="Επαναϋπολογισμός τύπου για όλες τις εταιρίες χωρίς χειροκίνητη επιλογή">{resyncing ? 'Συγχρονισμός…' : 'Re-sync εταιρίες'}</Button><Button onClick={openCreate}><FiPlus className="mr-1.5" /> Νέα μορφή</Button></div>)}
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-body-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-3 py-2">Κωδικός</th>
              <th className="text-left font-medium px-3 py-2">Ονομασία</th>
              <th className="text-left font-medium px-3 py-2">Σειρά</th>
              <th className="text-left font-medium px-3 py-2">Κατάσταση</th>
              {canManage && <th className="px-3 py-2 w-16" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (<tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-muted-foreground">Καμία μορφή.</td></tr>)}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{r.code}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.order}</td>
                <td className="px-3 py-2">{r.active ? <Badge>Ενεργό</Badge> : <Badge variant="outline">Ανενεργό</Badge>}</td>
                {canManage && (
                  <td className="px-3 py-2"><div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Ενέργειες"><FiMoreVertical /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(r)}><FiEdit2 className="mr-2 size-4" /> Επεξεργασία</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(r)}><FiTrash2 className="mr-2 size-4" /> Διαγραφή</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiBriefcase className="size-4" /></span>
            <DialogTitle className="min-w-0 flex-1 truncate text-[length:var(--fs-15)]">{editing ? 'Επεξεργασία μορφής' : 'Νέα νομική μορφή'}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[66vh] space-y-3 overflow-auto bg-muted/20 px-4 py-3">
            <FormSection tone="blue" icon={<FiBriefcase />} title="Νομική μορφή">
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <Field label="Κωδικός (canonical)" required htmlFor="bt-code" className="col-span-12 sm:col-span-4">
                  <Input id="bt-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="π.χ. ΑΕ" className={`${fieldCls} font-mono`} />
                </Field>
                <Field label="Ονομασία" required htmlFor="bt-name" className="col-span-12 sm:col-span-8">
                  <Input id="bt-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Ανώνυμη Εταιρεία" className={fieldCls} />
                </Field>
                <Field label="Σειρά" htmlFor="bt-order" className="col-span-6 sm:col-span-4">
                  <Input id="bt-order" type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} className={`${fieldCls} tabular-nums`} />
                </Field>
                <div className="col-span-6 flex h-8 items-center gap-2 self-end sm:col-span-8">
                  <input id="bt-active" type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="size-4 accent-sisyphus-600" />
                  <label htmlFor="bt-active" className="cursor-pointer text-[length:var(--fs-13)]">Ενεργό</label>
                </div>
              </div>
              {error && <RowHint tone="bad">{error}</RowHint>}
            </FormSection>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
            <Button variant="outline" onClick={close} disabled={saving}>Άκυρο</Button>
            <Button onClick={save} disabled={saving || !form.code.trim() || !form.name.trim()}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
