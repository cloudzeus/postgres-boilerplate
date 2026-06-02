'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiEdit2, FiTrash2, FiCopy, FiMoreVertical } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export type DocumentTypeRow = {
  id: string; name: string; description: string | null; category: string | null; categoryId: string | null;
  requiresExpiry: boolean; notifyExpiry: boolean; active: boolean; order: number;
};
type FormState = { name: string; description: string; categoryId: string | null; requiresExpiry: boolean; notifyExpiry: boolean; active: boolean; order: number; };
const EMPTY: FormState = { name: '', description: '', categoryId: null, requiresExpiry: true, notifyExpiry: true, active: true, order: 0 };

export function DocumentTypesClient({ rows, canManage, categories: initialCategories }: { rows: DocumentTypeRow[]; canManage: boolean; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [categories, setCategories] = React.useState(initialCategories);
  const [editing, setEditing] = React.useState<DocumentTypeRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [duplicating, setDuplicating] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [catName, setCatName] = React.useState('');

  function openCreate() { setForm(EMPTY); setDuplicating(false); setCreating(true); setError(null); }
  function openEdit(r: DocumentTypeRow) {
    setForm({ name: r.name, description: r.description ?? '', categoryId: r.categoryId ?? null, requiresExpiry: r.requiresExpiry, notifyExpiry: r.notifyExpiry, active: r.active, order: r.order });
    setEditing(r); setError(null);
  }
  function openDuplicate(r: DocumentTypeRow) {
    // Pre-fill every field from the source record so the user only tweaks what differs (π.χ. το έτος).
    // Το όνομα είναι unique — προσθέτουμε επίθεμα ώστε να μην συγκρούεται αν αποθηκευτεί ως έχει.
    setForm({ name: `${r.name} (αντίγραφο)`, description: r.description ?? '', categoryId: r.categoryId ?? null, requiresExpiry: r.requiresExpiry, notifyExpiry: r.notifyExpiry, active: r.active, order: r.order });
    setDuplicating(true); setCreating(true); setError(null);
  }
  function close() { setCreating(false); setEditing(null); setDuplicating(false); }

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

  async function addCategory() {
    const name = catName.trim(); if (!name) return;
    const res = await fetch('/api/admin/document-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    const json = await res.json();
    if (json.data) setCategories((p) => p.some((c) => c.id === json.data.id) ? p : [...p, { id: json.data.id, name: json.data.name }]);
    setCatName('');
  }
  async function removeCategory(id: string) {
    const res = await fetch(`/api/admin/document-categories/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
    setCategories((p) => p.filter((c) => c.id !== id));
  }

  const open = creating || editing !== null;

  return (
    <div className="space-y-4">
      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">Τύποι</TabsTrigger>
          <TabsTrigger value="categories">Κατηγορίες</TabsTrigger>
        </TabsList>
        <TabsContent value="types">
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
                      <td className="px-3 py-2 text-muted-foreground">{categories.find((c) => c.id === r.categoryId)?.name ?? '—'}</td>
                      <td className="px-3 py-2">{r.requiresExpiry ? <Badge variant="secondary">Υποχρεωτική</Badge> : <span className="text-muted-foreground">Προαιρετική</span>}</td>
                      <td className="px-3 py-2">{r.notifyExpiry ? 'Ναι' : 'Όχι'}</td>
                      <td className="px-3 py-2">{r.active ? <Badge>Ενεργό</Badge> : <Badge variant="outline">Ανενεργό</Badge>}</td>
                      {canManage && (
                        <td className="px-3 py-2">
                          <div className="flex justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" aria-label="Ενέργειες"><FiMoreVertical /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => openEdit(r)}><FiEdit2 className="mr-2 size-4" /> Επεξεργασία</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => openDuplicate(r)}><FiCopy className="mr-2 size-4" /> Δημιουργία αντιγράφου</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => remove(r)}><FiTrash2 className="mr-2 size-4" /> Διαγραφή</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="categories">
          <div className="space-y-3">
            {canManage && (
              <div className="flex gap-2">
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Νέα κατηγορία" onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
                <Button onClick={addCategory}><FiPlus className="mr-1.5" /> Προσθήκη</Button>
              </div>
            )}
            <ul className="rounded-md border border-border divide-y divide-border">
              {categories.length === 0 && <li className="px-3 py-2 text-muted-foreground text-body-sm">Καμία κατηγορία.</li>}
              {categories.map((c) => (
                <li key={c.id} className="flex items-center px-3 py-2 text-body-sm">
                  <span className="flex-1">{c.name}</span>
                  {canManage && <Button size="icon" variant="ghost" onClick={() => removeCategory(c.id)} aria-label="Διαγραφή"><FiTrash2 /></Button>}
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Επεξεργασία τύπου' : duplicating ? 'Αντίγραφο τύπου δικαιολογητικού' : 'Νέος τύπος δικαιολογητικού'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Όνομα *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Καταστατικό" /></div>
            <div><Label>Περιγραφή</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <Label>Κατηγορία</Label>
              <Combobox
                value={form.categoryId}
                items={categories.map((c) => ({ value: c.id, label: c.name }))}
                onSelect={(v) => setForm({ ...form, categoryId: v })}
                allowCreate
                placeholder="Επίλεξε ή δημιούργησε κατηγορία…"
                onCreate={async (label) => {
                  const res = await fetch('/api/admin/document-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label }) });
                  if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Σφάλμα'); return; }
                  const json = await res.json();
                  if (json.data) { setCategories((prev) => prev.some((c) => c.id === json.data.id) ? prev : [...prev, { id: json.data.id, name: json.data.name }]); setForm((f) => ({ ...f, categoryId: json.data.id })); }
                }}
              />
            </div>
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
