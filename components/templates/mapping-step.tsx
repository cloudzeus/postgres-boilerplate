'use client';

import * as React from 'react';
import { FiPlus, FiSave, FiTrash2 } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TemplateDto } from '@/lib/templates/serialize';
import type { MappingRowExcel, MappingRowInvoice } from '@/lib/templates/schema';
import { INVOICE_KEY_GROUPS } from '@/lib/templates/labels';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';
import { useServerDraft } from './use-server-draft';

type Mapping = TemplateDto['mappings'][number];
type Source = { key: string; label: string; color: string; line: boolean };

const sel = 'h-9 w-full rounded-sm border border-input bg-background px-2 text-[12px]';
const KNOWN_INVOICE_KEYS = new Set(INVOICE_KEY_GROUPS.flatMap((g) => g.keys.map((k) => k.key)));

/** Module scope on purpose: declared inside MappingStep these would be a fresh component
 *  type each render, remounting every row and dropping focus after each keystroke. */
function SourceSelect({ value, onChange, sources, disabled }: { value: string; onChange: (v: string) => void; sources: Source[]; disabled: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={sel} disabled={disabled} style={{ borderLeft: `4px solid ${sources.find((s) => s.key === value)?.color ?? '#D1D1D1'}` }}>
      {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>);
}

function InvoiceKeySelect({ value, fieldKey, isLine, onChange, disabled }: { value: string; fieldKey: string; isLine: boolean; onChange: (v: string) => void; disabled: boolean }) {
  // A line source can only feed `items.*`, so offer the custom header key only for
  // simple fields — and always render whatever is stored, or the select would show
  // the first option while the row actually holds something else.
  const custom = isLine ? null : `customFields.${fieldKey.replace(/\./g, '_')}`;
  const stored = value && value !== custom && !KNOWN_INVOICE_KEYS.has(value) ? value : null;
  return (
    <select value={value} className={sel} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {INVOICE_KEY_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.keys.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</optgroup>)}
      {custom && <option value={custom}>Ειδικό πεδίο: {fieldKey}</option>}
      {stored && <option value={stored}>{stored}</option>}
    </select>);
}

export function MappingStep() {
  const { dto, setDto, canManage, setDirty } = useDesigner();
  // Content-keyed draft: every save returns a fresh DTO object, and an identity-keyed
  // sync would drop unsaved rows whenever another step (or the status button) saved.
  const [mappings, setMappings, dirty] = useServerDraft<Mapping[]>(dto.mappings);
  const [active, setActive] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);

  // Source keys: SINGLE fields by key, TABLE columns as `table.col`.
  const sources = React.useMemo(() => dto.fields.flatMap((f) => f.kind === 'TABLE'
    ? (f.columns ?? []).map((c) => ({ key: `${f.key}.${c.key}`, label: `${f.label} › ${c.label}`, color: f.color, line: true }))
    : [{ key: f.key, label: f.label, color: f.color, line: false }]), [dto.fields]);

  const m = mappings[active];
  const setM = (patch: Partial<Mapping>) => setMappings((ms) => ms.map((x, i) => (i === active ? ({ ...x, ...patch } as Mapping) : x)));
  const addMapping = (target: 'INVOICE' | 'EXCEL') => { setMappings((ms) => [...ms, { id: '', name: ms.length ? `${target === 'EXCEL' ? 'excel' : 'mapping'}-${ms.length + 1}` : 'default', target, isDefault: ms.length === 0, rows: [] } as Mapping]); setActive(mappings.length); };
  const removeMapping = () => { setMappings((ms) => ms.filter((_, i) => i !== active)); setActive(0); };

  const setRow = (i: number, row: MappingRowInvoice | MappingRowExcel) => setM({ rows: (m.rows as (MappingRowInvoice | MappingRowExcel)[]).map((r, j) => (j === i ? row : r)) as Mapping['rows'] });
  // A line source (table column) can only feed `items.*`, so a header key would be an
  // invalid row the moment it is added.
  const addRow = () => { const s0 = sources[0]; return setM({ rows: [...m.rows, m.target === 'INVOICE' ? { fieldKey: s0?.key ?? '', invoiceKey: s0?.line ? 'items.name' : 'invoiceNumber' } : { fieldKey: s0?.key ?? '', column: '', order: m.rows.length + 1 }] as Mapping['rows'] }); };
  const delRow = (i: number) => setM({ rows: (m.rows as unknown[]).filter((_, j) => j !== i) as Mapping['rows'] });

  const save = async () => {
    // A mapping name is the only handle a SWITCH_MAPPING action has, so renaming or
    // removing one silently breaks every rule that points at it.
    const kept = new Set(mappings.map((x) => x.name));
    const gone = dto.mappings.map((x) => x.name).filter((n) => !kept.has(n));
    const broken = gone.filter((n) => dto.conditions.some((c) => c.actions.some((a) => a.type === 'SWITCH_MAPPING' && a.params.mappingName === n)));
    if (broken.length && !window.confirm(`Κανόνες αναφέρονται σε mapping που αλλάζει/αφαιρείται: ${broken.join(', ')}. Οι αναφορές θα σπάσουν. Συνέχεια;`)) return;
    setBusy(true);
    try {
      const { demoted, ...next } = await templatesApi.putMappings(dto.id, mappings);
      setDto(next);
      toast.success('Αποθηκεύτηκε');
      if (demoted) toast.warning('Το πρότυπο έγινε Πρόχειρο — δεν πληροί πλέον τις προϋποθέσεις ενεργοποίησης');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div><h2 className="text-[16px] font-semibold">Mapping</h2><p className="text-[12px] text-muted-foreground">Πού πηγαίνει κάθε εξαγόμενο πεδίο: στα πεδία του παραστατικού ή σε στήλες Excel. Οι κανόνες μπορούν να αλλάζουν mapping.</p></div>
      <div className="flex flex-wrap items-center gap-1.5">
        {mappings.map((x, i) => (
          <button key={x.name || `new-${i}`} type="button" onClick={() => setActive(i)} className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] cx-transition', i === active ? 'border-sisyphus-500 bg-sisyphus-50 font-medium text-sisyphus-700' : 'border-border bg-white hover:border-sisyphus-300')}>
            {x.target === 'EXCEL' ? 'Excel' : 'Παραστατικό'}: {x.name}{x.isDefault && <span className="text-[10px] opacity-70">· προεπιλογή</span>}</button>))}
        {canManage && <><Button size="sm" variant="secondary" onClick={() => addMapping('INVOICE')}><FiPlus className="mr-1 size-3.5" /> Παραστατικό</Button><Button size="sm" variant="secondary" onClick={() => addMapping('EXCEL')}><FiPlus className="mr-1 size-3.5" /> Excel</Button></>}
        {canManage && <Button size="sm" className="ml-auto" onClick={save} disabled={!dirty || busy}><FiSave className="mr-1 size-3.5" /> {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>}
      </div>
      {m && (
        <div className="rounded-md border border-border p-3">
          <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div><label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Όνομα</label><Input value={m.name} disabled={!canManage} onChange={(e) => setM({ name: e.target.value })} className="mt-1" /></div>
            <label className="inline-flex items-center gap-2 text-[12px]"><input type="radio" checked={m.isDefault} disabled={!canManage} onChange={() => setMappings((ms) => ms.map((x, i) => ({ ...x, isDefault: i === active })))} /> Προεπιλογή</label>
            {canManage && mappings.length > 1 && <Button variant="ghost" size="sm" onClick={removeMapping} className="text-dg-red-600"><FiTrash2 className="mr-1 size-3.5" /> Αφαίρεση</Button>}
          </div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground"><th className="pb-1">Πεδίο προτύπου</th><th className="pb-1">{m.target === 'EXCEL' ? 'Στήλη Excel' : 'Πεδίο παραστατικού'}</th>{m.target === 'EXCEL' && <th className="w-20 pb-1">Σειρά</th>}<th className="w-8" /></tr></thead>
            <tbody>
              {m.rows.map((r, i) => (
                <tr key={`${r.fieldKey}-${i}`} className="border-t border-border">
                  <td className="py-1.5 pr-2"><SourceSelect value={r.fieldKey} sources={sources} disabled={!canManage} onChange={(v) => setRow(i, { ...r, fieldKey: v } as MappingRowInvoice | MappingRowExcel)} /></td>
                  <td className="py-1.5 pr-2">{m.target === 'INVOICE'
                    ? <InvoiceKeySelect value={(r as MappingRowInvoice).invoiceKey} fieldKey={r.fieldKey} isLine={!!sources.find((s) => s.key === r.fieldKey)?.line} disabled={!canManage} onChange={(v) => setRow(i, { ...r, invoiceKey: v } as MappingRowInvoice)} />
                    : <Input value={(r as MappingRowExcel).column} placeholder="Όνομα στήλης" disabled={!canManage} onChange={(e) => setRow(i, { ...r, column: e.target.value } as MappingRowExcel)} />}</td>
                  {m.target === 'EXCEL' && <td className="py-1.5 pr-2"><Input type="number" min={0} value={(r as MappingRowExcel).order} disabled={!canManage} onChange={(e) => setRow(i, { ...r, order: Number(e.target.value) || 0 } as MappingRowExcel)} /></td>}
                  <td className="py-1.5">{canManage && <button type="button" aria-label="Αφαίρεση" onClick={() => delRow(i)} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>}</td>
                </tr>))}
              {m.rows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[12px] italic text-muted-foreground">Καμία γραμμή.</td></tr>}
            </tbody>
          </table>
          {canManage && <Button size="sm" variant="secondary" className="mt-2" onClick={addRow} disabled={sources.length === 0}><FiPlus className="mr-1 size-3.5" /> Γραμμή</Button>}
          {m.target === 'INVOICE' && <p className="mt-2 text-[11px] text-muted-foreground">Στήλες πίνακα → «Γραμμές». Απλά πεδία → «Κεφαλίδα» ή «Ειδικό πεδίο».</p>}
        </div>
      )}
    </div>
  );
}
