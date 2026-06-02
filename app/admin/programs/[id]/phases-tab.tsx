'use client';
import * as React from 'react';
import { FiTrash2, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';

type DocTypeOption = { id: string; name: string };
type Requirement = { id: string; documentTypeId: string; mandatory: boolean; documentType: { id: string; name: string } };
type Phase = { id: string; name: string; order: number; requirements: Requirement[] };

export function PhasesTab({ programId, docTypes, canManage }: { programId: string; docTypes: DocTypeOption[]; canManage: boolean }) {
  const [phases, setPhases] = React.useState<Phase[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [templates, setTemplates] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => { fetch('/api/admin/phase-templates').then((r) => r.json()).then((j) => setTemplates(j.data ?? [])); }, []);

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
  async function addReq(phaseId: string, documentTypeId: string) {
    if (!documentTypeId) return;
    await fetch(`/api/admin/programs/${programId}/phases/${phaseId}/requirements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentTypeId }) });
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
                <div key={r.id} className="flex items-center gap-2 text-body-sm">
                  <span className="flex-1">{r.documentType.name}</span>
                  {canManage ? (
                    <>
                      <Button size="sm" variant={r.mandatory ? 'default' : 'outline'} onClick={() => toggleMandatory(p.id, r.documentTypeId, !r.mandatory)}>{r.mandatory ? 'Υποχρεωτικό' : 'Προαιρετικό'}</Button>
                      <Button size="icon" variant="ghost" onClick={() => removeReq(p.id, r.documentTypeId)} aria-label="Αφαίρεση"><FiTrash2 /></Button>
                    </>
                  ) : (<Badge variant={r.mandatory ? 'default' : 'outline'}>{r.mandatory ? 'Υποχρεωτικό' : 'Προαιρετικό'}</Badge>)}
                </div>
              ))}
            </div>
            {canManage && available.length > 0 && (
              <select className="text-body-sm rounded-md border border-border bg-background px-2 py-1" value="" onChange={(e) => addReq(p.id, e.target.value)}>
                <option value="">+ Προσθήκη δικαιολογητικού…</option>
                {available.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
