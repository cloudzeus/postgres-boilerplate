'use client';
import * as React from 'react';
import { FiTrash2, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';

type DocTypeOption = { id: string; name: string };
type Requirement = { id: string; documentTypeId: string; mandatory: boolean; appliesToAll: boolean; businessTypes: { businessTypeId: string }[]; documentType: { id: string; name: string } };
type Phase = { id: string; name: string; order: number; requirements: Requirement[] };

export function PhasesTab({ programId, docTypes, canManage }: { programId: string; docTypes: DocTypeOption[]; canManage: boolean }) {
  const [phases, setPhases] = React.useState<Phase[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [templates, setTemplates] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => { fetch('/api/admin/phase-templates').then((r) => r.json()).then((j) => setTemplates(j.data ?? [])); }, []);
  const [bizTypes, setBizTypes] = React.useState<{ id: string; code: string; name: string }[]>([]);
  React.useEffect(() => { fetch(`/api/admin/programs/${programId}/eligible-business-types`).then((r) => r.json()).then((j) => setBizTypes(j.data ?? [])); }, [programId]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/programs/${programId}/phases`);
    const json = await res.json();
    setPhases(json.data ?? []);
    setLoading(false);
  }, [programId]);
  React.useEffect(() => { load(); }, [load]);

  async function renamePhase(phaseId: string, name: string) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
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
  async function addReqs(phaseId: string, documentTypeIds: string[]) {
    const ids = documentTypeIds.filter(Boolean);
    if (ids.length === 0) return;
    await Promise.all(ids.map((documentTypeId) =>
      fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentTypeId }) })
    ));
    load();
  }
  async function toggleMandatory(phaseId: string, documentTypeId: string, mandatory: boolean) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentTypeId, mandatory }) });
    load();
  }
  async function removeReq(phaseId: string, documentTypeId: string) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements?documentTypeId=${encodeURIComponent(documentTypeId)}`, { method: 'DELETE' });
    load();
  }
  async function setScope(phaseId: string, reqId: string, appliesToAll: boolean, businessTypeIds: string[]) {
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements/${reqId}/business-types`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliesToAll, businessTypeIds }),
    });
    load();
  }

  if (loading) return <p className="text-body-sm text-muted-foreground">Φόρτωση…</p>;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex gap-2 items-center">
          <div className="w-72">
            <Combobox
              value={null}
              items={templates.map((t) => ({ value: t.id, label: t.name }))}
              placeholder="Προσθήκη φάσης (π.χ. Υποβολή)…"
              allowCreate
              onSelect={async (id) => {
                const t = templates.find((x) => x.id === id); if (!t) return;
                await fetch(`/api/admin/programs/${programId}/phases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: t.name, phaseTemplateId: t.id }) });
                load();
              }}
              onCreate={async (label) => {
                const res = await fetch('/api/admin/phase-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label }) });
                const json = await res.json();
                if (json.data) {
                  setTemplates((p) => p.some((x) => x.id === json.data.id) ? p : [...p, { id: json.data.id, name: json.data.name }]);
                  await fetch(`/api/admin/programs/${programId}/phases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: json.data.name, phaseTemplateId: json.data.id }) });
                  load();
                }
              }}
            />
          </div>
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
              ) : (<span className="font-medium">{p.name}</span>)}
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
                <div key={r.id} className="flex flex-col gap-1 text-body-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{r.documentType.name}</span>
                    {canManage ? (
                      <>
                        <Button size="sm" variant={r.mandatory ? 'default' : 'outline'} onClick={() => toggleMandatory(p.id, r.documentTypeId, !r.mandatory)}>{r.mandatory ? 'Υποχρεωτικό' : 'Προαιρετικό'}</Button>
                        <Button size="icon" variant="ghost" onClick={() => removeReq(p.id, r.documentTypeId)} aria-label="Αφαίρεση"><FiTrash2 /></Button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{r.appliesToAll ? 'Όλες οι μορφές' : `${r.businessTypes.length} μορφές`}</span>
                        <Badge variant={r.mandatory ? 'default' : 'outline'}>{r.mandatory ? 'Υποχρεωτικό' : 'Προαιρετικό'}</Badge>
                      </div>
                    )}
                  </div>
                  {canManage && (
                    <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 pl-1">
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={r.appliesToAll} onChange={(e) => setScope(p.id, r.id, e.target.checked, e.target.checked ? [] : r.businessTypes.map((b) => b.businessTypeId))} className="h-3.5 w-3.5" />
                        Όλες οι μορφές
                      </label>
                      {!r.appliesToAll && bizTypes.map((b) => {
                        const on = r.businessTypes.some((x) => x.businessTypeId === b.id);
                        return (
                          <button key={b.id} type="button"
                            onClick={() => setScope(p.id, r.id, false, on ? r.businessTypes.filter((x) => x.businessTypeId !== b.id).map((x) => x.businessTypeId) : [...r.businessTypes.map((x) => x.businessTypeId), b.id])}
                            className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-blue-600 bg-blue-600 font-bold text-white' : 'border-border text-muted-foreground'}`}>
                            {b.code}
                          </button>
                        );
                      })}
                      {!r.appliesToAll && r.businessTypes.length === 0 && (
                        <span className="text-xs text-amber-600">⚠ δεν θα ζητηθεί από καμία εταιρία</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {canManage && available.length > 0 && (
              <AddRequirements available={available} onAdd={(ids) => addReqs(p.id, ids)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddRequirements({ available, onAdd }: { available: DocTypeOption[]; onAdd: (ids: string[]) => void | Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  function reset() { setOpen(false); setQuery(''); setSelected(new Set()); }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const q = query.toLocaleLowerCase('el').trim();
  const filtered = q ? available.filter((d) => d.name.toLocaleLowerCase('el').includes(q)) : available;

  async function submit() {
    if (selected.size === 0) return;
    setSaving(true);
    try { await onAdd(Array.from(selected)); reset(); }
    finally { setSaving(false); }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>+ Προσθήκη δικαιολογητικών</Button>
    );
  }

  return (
    <div className="rounded-md border border-border p-2 space-y-2">
      <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Αναζήτηση δικαιολογητικού…" className="h-8" />
      <div className="max-h-56 overflow-y-auto space-y-0.5">
        {filtered.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">Δεν βρέθηκαν δικαιολογητικά.</p>}
        {filtered.map((d) => (
          <label key={d.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-body-sm hover:bg-muted cursor-pointer">
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="h-3.5 w-3.5" />
            <span className="flex-1">{d.name}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={selected.size === 0 || saving}>
          {saving ? 'Προσθήκη…' : `Προσθήκη${selected.size ? ` (${selected.size})` : ''}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>Άκυρο</Button>
      </div>
    </div>
  );
}
