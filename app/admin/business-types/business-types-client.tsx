'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiEdit2, FiTrash2, FiMoreVertical } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    if (!confirm(`Διαγραφή μορφής «${r.name}»;`)) return;
    const res = await fetch(`/api/admin/business-types/${r.id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    router.refresh();
  }
  const open = creating || editing !== null;

  return (
    <div className="space-y-4">
      {canManage && (<div className="flex justify-end"><Button onClick={openCreate}><FiPlus className="mr-1.5" /> Νέα μορφή</Button></div>)}
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
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Επεξεργασία μορφής' : 'Νέα νομική μορφή'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Κωδικός * (canonical)</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="π.χ. ΑΕ" /></div>
            <div><Label>Ονομασία *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Ανώνυμη Εταιρεία" /></div>
            <div><Label>Σειρά</Label><Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></div>
            <div className="flex items-center justify-between"><Label>Ενεργό</Label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" /></div>
            {error && <p className="text-body-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>Άκυρο</Button>
            <Button onClick={save} disabled={saving || !form.code.trim() || !form.name.trim()}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
