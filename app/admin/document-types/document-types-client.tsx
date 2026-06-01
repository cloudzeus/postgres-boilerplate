'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type DocumentTypeRow = {
  id: string; name: string; description: string | null; category: string | null;
  requiresExpiry: boolean; notifyExpiry: boolean; active: boolean; order: number;
};
type FormState = { name: string; description: string; category: string; requiresExpiry: boolean; notifyExpiry: boolean; active: boolean; order: number; };
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
    const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
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
      {canManage && (<div className="flex justify-end"><Button onClick={openCreate}><FiPlus className="mr-1.5" /> Νέος τύπος</Button></div>)}
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
            {rows.length === 0 && (<tr><td colSpan={canManage ? 6 : 5} className="px-3 py-8 text-center text-muted-foreground">Δεν υπάρχουν τύποι ακόμη.</td></tr>)}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2"><div className="font-medium text-foreground">{r.name}</div>{r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.category ?? '—'}</td>
                <td className="px-3 py-2">{r.requiresExpiry ? <Badge variant="secondary">Υποχρεωτική</Badge> : <span className="text-muted-foreground">Προαιρετική</span>}</td>
                <td className="px-3 py-2">{r.notifyExpiry ? 'Ναι' : 'Όχι'}</td>
                <td className="px-3 py-2">{r.active ? <Badge>Ενεργό</Badge> : <Badge variant="outline">Ανενεργό</Badge>}</td>
                {canManage && (<td className="px-3 py-2"><div className="flex gap-1 justify-end"><Button size="icon" variant="ghost" onClick={() => openEdit(r)} aria-label="Επεξεργασία"><FiEdit2 /></Button><Button size="icon" variant="ghost" onClick={() => remove(r)} aria-label="Διαγραφή"><FiTrash2 /></Button></div></td>)}
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
            <div className="flex items-center justify-between">
              <Label>Απαιτεί ημερομηνία λήξης</Label>
              <input type="checkbox" checked={form.requiresExpiry} onChange={(e) => setForm({ ...form, requiresExpiry: e.target.checked })} className="h-4 w-4" />
            </div>
            <div className="flex items-center justify-between">
              <Label>Ειδοποιήσεις λήξης</Label>
              <input type="checkbox" checked={form.notifyExpiry} onChange={(e) => setForm({ ...form, notifyExpiry: e.target.checked })} className="h-4 w-4" />
            </div>
            <div className="flex items-center justify-between">
              <Label>Ενεργό</Label>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" />
            </div>
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
