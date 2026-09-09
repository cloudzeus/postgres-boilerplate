'use client';

import * as React from 'react';
import { FiPlus, FiSave, FiTrash2, FiZap } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { TemplateDto } from '@/lib/templates/serialize';
import type { Action, Clause, ClauseOp, TemplateMode } from '@/lib/templates/schema';
import { ACTION_LABEL, EXTRA_VARS, MODE_HELP, MODE_LABEL, OP_LABEL, OPS_WITHOUT_VALUE } from '@/lib/templates/labels';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';
import { useServerDraft } from './use-server-draft';

type Cond = TemplateDto['conditions'][number];
const sel = 'h-9 rounded-sm border border-input bg-background px-2 text-[12px]';

/** Module scope on purpose: declared inside ConditionsStep it would be a new component
 *  type on every render, remounting the inputs and dropping focus after each keystroke. */
function ActionEditor({ a, onChange, onRemove, fields, mappings, canManage }: {
  a: Action; onChange: (a: Action) => void; onRemove: () => void;
  fields: TemplateDto['fields']; mappings: TemplateDto['mappings']; canManage: boolean;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr_28px] items-center gap-2">
      <select value={a.type} className={sel} disabled={!canManage} onChange={(e) => { const type = e.target.value as Action['type']; onChange(type === 'SET_FIELD' ? { type, params: { fieldKey: fields[0]?.key, value: '' } } : type === 'SWITCH_MAPPING' ? { type, params: { mappingName: mappings[0]?.name ?? 'default' } } : type === 'NOTIFY' ? { type, params: { subject: 'Ειδοποίηση' } } : { type, params: { reason: 'Έλεγχος' } } as Action); }}>
        {(Object.keys(ACTION_LABEL) as Action['type'][]).map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}</select>
      <div className="flex gap-2">
        {a.type === 'SET_FIELD' && <><select value={a.params.fieldKey ?? ''} className={sel} disabled={!canManage} onChange={(e) => onChange({ type: 'SET_FIELD', params: { ...a.params, fieldKey: e.target.value } })}>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select><Input value={a.params.value} placeholder="τιμή" disabled={!canManage} onChange={(e) => onChange({ type: 'SET_FIELD', params: { ...a.params, value: e.target.value } })} /></>}
        {(a.type === 'FLAG_REVIEW' || a.type === 'BLOCK_POSTING') && <Input value={a.params.reason} placeholder="λόγος" disabled={!canManage} onChange={(e) => onChange({ type: a.type, params: { reason: e.target.value } })} />}
        {a.type === 'SWITCH_MAPPING' && <select value={a.params.mappingName} className={sel} disabled={!canManage} onChange={(e) => onChange({ type: 'SWITCH_MAPPING', params: { mappingName: e.target.value } })}>{mappings.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select>}
        {a.type === 'NOTIFY' && <><Input value={a.params.subject} placeholder="θέμα" disabled={!canManage} onChange={(e) => onChange({ type: 'NOTIFY', params: { ...a.params, subject: e.target.value } })} /><Input value={a.params.emails ?? ''} placeholder="emails (προαιρ.)" disabled={!canManage} onChange={(e) => onChange({ type: 'NOTIFY', params: { ...a.params, emails: e.target.value || undefined } })} /></>}
      </div>
      {canManage && <button type="button" aria-label="Αφαίρεση" onClick={onRemove} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>}
    </div>);
}

export function ConditionsStep() {
  const { dto, setDto, canManage, canPost, setDirty } = useDesigner();
  // Three drafts synced on CONTENT, not identity: «Ενεργοποίηση» and «Αποθήκευση
  // λειτουργίας» both return a fresh DTO whose `conditions` are unchanged, and an
  // identity-keyed sync would wipe the rule edits the user has not saved yet.
  const [conds, setConds, dirtyRules] = useServerDraft<Cond[]>(dto.conditions);
  const [mode, setMode] = useServerDraft<TemplateMode>(dto.mode);
  const [emails, setEmails] = useServerDraft(dto.notifyEmails ?? '');
  const [busy, setBusy] = React.useState(false);
  const dirtyMode = mode !== dto.mode || emails.trim() !== (dto.notifyEmails ?? '').trim();
  const dirty = dirtyRules || dirtyMode;
  React.useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);

  const fieldOptions = [...dto.fields.map((f) => ({ key: f.key, label: f.label, color: f.color })), ...EXTRA_VARS.map((v) => ({ key: v.key, label: v.label, color: '#5C5C5C' }))];
  const setC = (i: number, patch: Partial<Cond>) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addRule = () => setConds((cs) => [...cs, { id: '', name: `Κανόνας ${cs.length + 1}`, order: cs.length, isActive: true, logic: 'AND', clauses: [{ fieldKey: fieldOptions[0]?.key ?? '$total', op: 'notEmpty' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'Έλεγχος' } }] }]);

  const saveRules = async () => {
    setBusy(true);
    try { setDto(await templatesApi.putConditions(dto.id, conds.map((c, i) => ({ ...c, id: c.id || undefined, order: i })) as Cond[])); toast.success('Οι κανόνες αποθηκεύτηκαν'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const saveMode = async () => {
    setBusy(true);
    try { setDto(await templatesApi.patch(dto.id, { mode, notifyEmails: emails.trim() || null })); toast.success('Η λειτουργία αποθηκεύτηκε'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const setStatus = async (status: 'DRAFT' | 'ACTIVE') => {
    setBusy(true);
    try { setDto(await templatesApi.patch(dto.id, { status })); toast.success(status === 'ACTIVE' ? 'Το πρότυπο ενεργοποιήθηκε' : 'Το πρότυπο έγινε πρόχειρο'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div><h2 className="text-[16px] font-semibold">Conditions</h2><p className="text-[12px] text-muted-foreground">Κανόνες πάνω στα εξαγόμενα πεδία. Όλοι όσοι ισχύουν εφαρμόζουν τις ενέργειές τους.</p></div>
          {canManage && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={addRule}><FiPlus className="mr-1 size-3.5" /> Κανόνας</Button><Button size="sm" onClick={saveRules} disabled={!dirtyRules || busy}><FiSave className="mr-1 size-3.5" /> Αποθήκευση</Button></div>}
        </div>
        {conds.length === 0 && <p className="text-[12px] italic text-muted-foreground">Κανένας κανόνας.</p>}
        {conds.map((c, i) => (
          <div key={c.id || `new-${i}`} className={cn('rounded-md border border-border p-3', !c.isActive && 'opacity-60')}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Input value={c.name} disabled={!canManage} onChange={(e) => setC(i, { name: e.target.value })} className="h-8 max-w-[260px]" />
              <label className="inline-flex items-center gap-1.5 text-[12px]"><Switch checked={c.isActive} disabled={!canManage} onCheckedChange={(v) => setC(i, { isActive: v })} /> Ενεργός</label>
              <select value={c.logic} className={sel} disabled={!canManage} onChange={(e) => setC(i, { logic: e.target.value as 'AND' | 'OR' })}><option value="AND">Όλες οι ρήτρες (AND)</option><option value="OR">Οποιαδήποτε ρήτρα (OR)</option></select>
              {canManage && <button type="button" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[12px] text-dg-red-600 hover:underline"><FiTrash2 className="size-3.5" /> Διαγραφή</button>}
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Αν</p>
              {c.clauses.map((cl, k) => (
                <div key={k} className="grid grid-cols-[1fr_170px_1fr_28px] items-center gap-2">
                  <select value={cl.fieldKey} className={sel} disabled={!canManage} style={{ borderLeft: `4px solid ${fieldOptions.find((f) => f.key === cl.fieldKey)?.color ?? '#D1D1D1'}` }} onChange={(e) => setC(i, { clauses: c.clauses.map((x, j) => (j === k ? { ...x, fieldKey: e.target.value } : x)) })}>{fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                  <select value={cl.op} className={sel} disabled={!canManage} onChange={(e) => setC(i, { clauses: c.clauses.map((x, j) => (j === k ? { ...x, op: e.target.value as ClauseOp } : x)) })}>{(Object.keys(OP_LABEL) as ClauseOp[]).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
                  {OPS_WITHOUT_VALUE.includes(cl.op) ? <span /> : <Input value={cl.value ?? ''} disabled={!canManage} placeholder="τιμή" onChange={(e) => setC(i, { clauses: c.clauses.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} />}
                  {canManage && <button type="button" aria-label="Αφαίρεση ρήτρας" onClick={() => setC(i, { clauses: c.clauses.filter((_, j) => j !== k) })} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>}
                </div>))}
              {canManage && <button type="button" onClick={() => setC(i, { clauses: [...c.clauses, { fieldKey: fieldOptions[0]?.key ?? '$total', op: 'notEmpty' } as Clause] })} className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-sisyphus-700 hover:underline"><FiPlus className="size-3" /> Ρήτρα</button>}
              <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Τότε</p>
              {c.actions.map((a, k) => <ActionEditor key={k} a={a} fields={dto.fields} mappings={dto.mappings} canManage={canManage} onChange={(na) => setC(i, { actions: c.actions.map((x, j) => (j === k ? na : x)) })} onRemove={() => setC(i, { actions: c.actions.filter((_, j) => j !== k) })} />)}
              {canManage && <button type="button" onClick={() => setC(i, { actions: [...c.actions, { type: 'FLAG_REVIEW', params: { reason: 'Έλεγχος' } }] })} className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-sisyphus-700 hover:underline"><FiPlus className="size-3" /> Ενέργεια</button>}
            </div>
          </div>))}
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <h2 className="text-[16px] font-semibold">Λειτουργία</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(MODE_LABEL) as TemplateMode[]).map((m) => { const locked = m === 'AUTO' && !canPost; return (
            <button key={m} type="button" disabled={!canManage || locked} onClick={() => setMode(m)} aria-pressed={mode === m}
              className={cn('cursor-pointer rounded-md border p-3 text-left cx-transition disabled:cursor-not-allowed disabled:opacity-50', mode === m ? 'border-sisyphus-500 bg-sisyphus-50' : 'border-border bg-white hover:border-sisyphus-300')}>
              <div className="text-[13px] font-semibold">{MODE_LABEL[m]}{locked && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(απαιτεί ocr.post)</span>}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{MODE_HELP[m]}</div></button>); })}
        </div>
        <div><label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Emails ειδοποίησης (χωρισμένα με ;)</label><Input value={emails} disabled={!canManage} onChange={(e) => setEmails(e.target.value)} className="mt-1 max-w-lg" placeholder="logistirio@example.gr; admin@example.gr" /></div>
        {canManage && <Button size="sm" onClick={saveMode} disabled={!dirtyMode || busy}><FiSave className="mr-1 size-3.5" /> Αποθήκευση λειτουργίας</Button>}
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-neutral-4 p-3">
        <div className="flex-1 text-[12px]"><span className="font-semibold">Κατάσταση:</span> {dto.status === 'ACTIVE' ? 'Ενεργό — εφαρμόζεται αυτόματα σε νέα έγγραφα του προμηθευτή.' : 'Πρόχειρο — δεν εφαρμόζεται. Χρειάζεται δείγμα, πεδίο με περιοχή και mapping.'}</div>
        {canManage && (dto.status === 'ACTIVE'
          ? <Button size="sm" variant="secondary" onClick={() => setStatus('DRAFT')} disabled={busy}>Απενεργοποίηση</Button>
          : <Button size="sm" onClick={() => setStatus('ACTIVE')} disabled={busy}><FiZap className="mr-1 size-3.5" /> Ενεργοποίηση</Button>)}
      </section>
    </div>
  );
}
