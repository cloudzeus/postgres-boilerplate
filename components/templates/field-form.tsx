'use client';

import * as React from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { COLOR_PALETTE, slugKey, type ColumnDef, type FieldDef, type TemplateValueType } from '@/lib/templates/schema';
import { KIND_LABEL, VALUE_TYPE_LABEL } from '@/lib/templates/labels';

const VALUE_TYPES = Object.keys(VALUE_TYPE_LABEL) as TemplateValueType[];

export function FieldForm({ field, usedColors, onChange, disabled, isNew, keyUnlocked, onUnlockKey }: {
  field: FieldDef; usedColors: string[]; onChange: (f: FieldDef) => void; disabled?: boolean;
  /** The field has never been saved — only then may the key follow the label. */
  isNew: boolean;
  /** «Αλλαγή κλειδιού» was pressed for this (saved) field. */
  keyUnlocked?: boolean;
  onUnlockKey?: () => void;
}) {
  const set = (patch: Partial<FieldDef>) => onChange({ ...field, ...patch });
  const setCol = (i: number, patch: Partial<ColumnDef>) => set({ columns: (field.columns ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const sel = 'mt-1 h-9 w-full rounded-sm border border-input bg-background px-2 text-[13px]';

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label>Ετικέτα</Label>
          <Input value={field.label} disabled={disabled} className="mt-1" onChange={(e) => {
            const label = e.target.value;
            // The key is the only handle mappings/conditions have on a field, so it may
            // trail the label only until the field is first saved.
            set(isNew ? { label, key: field.key && field.key !== slugKey(field.label) ? field.key : slugKey(label) } : { label });
          }} />
          {isNew
            ? <p className="mt-1 font-mono text-[10px] text-muted-foreground">key: {field.key || '—'}</p>
            : keyUnlocked
              ? <div className="mt-1">
                  <Input value={field.key} disabled={disabled} aria-label="Κλειδί πεδίου" className="font-mono text-[12px]" onChange={(e) => set({ key: slugKey(e.target.value) || field.key })} />
                  <p className="mt-1 text-[10px] text-[#B45309]">Η αλλαγή κλειδιού αφαιρεί αναφορές σε mappings/conditions</p>
                </div>
              : <p className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>key: {field.key || '—'}</span>
                  {!disabled && <button type="button" onClick={onUnlockKey} className="cursor-pointer font-sans text-[10px] text-sisyphus-700 hover:underline">Αλλαγή κλειδιού</button>}
                </p>}</div>
        <div><Label>Είδος</Label>
          <select value={field.kind} disabled={disabled} className={sel} onChange={(e) => { const kind = e.target.value as FieldDef['kind']; set({ kind, columns: kind === 'TABLE' ? (field.columns?.length ? field.columns : [{ key: 'col1', label: 'Στήλη 1', valueType: 'TEXT' }]) : null }); }}>
            {(Object.keys(KIND_LABEL) as FieldDef['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select></div>
        <div><Label>Τύπος τιμής</Label>
          <select value={field.valueType} disabled={disabled || field.kind === 'TABLE'} className={sel} onChange={(e) => set({ valueType: e.target.value as TemplateValueType })}>
            {VALUE_TYPES.map((v) => <option key={v} value={v}>{VALUE_TYPE_LABEL[v]}</option>)}
          </select></div>
        <div className="sm:col-span-2"><Label>Οδηγία στο μοντέλο (προαιρετικό)</Label>
          <Input value={field.aiHint ?? ''} disabled={disabled} className="mt-1" placeholder="π.χ. ο αριθμός δίπλα στη λέξη «Αρ.»" onChange={(e) => set({ aiHint: e.target.value || null })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div><Label className="mb-1 block">Χρώμα</Label>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PALETTE.map((c) => { const used = usedColors.includes(c) && c !== field.color; return (
              <button key={c} type="button" disabled={disabled || used} title={used ? 'Χρησιμοποιείται' : c} onClick={() => set({ color: c })}
                className="size-6 cursor-pointer rounded-full border-2 disabled:cursor-not-allowed disabled:opacity-30" style={{ backgroundColor: c, borderColor: field.color === c ? '#1F1F1F' : 'transparent' }} aria-label={`Χρώμα ${c}`} />); })}
          </div></div>
        <label className="inline-flex items-center gap-2 text-[12px]"><Switch checked={field.required} disabled={disabled} onCheckedChange={(v) => set({ required: v })} /> Υποχρεωτικό</label>
      </div>
      {field.kind === 'TABLE' && (
        <div className="rounded-md border border-border bg-neutral-4 p-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Στήλες πίνακα</span>
            {!disabled && <button type="button" onClick={() => set({ columns: [...(field.columns ?? []), { key: `col${(field.columns?.length ?? 0) + 1}`, label: `Στήλη ${(field.columns?.length ?? 0) + 1}`, valueType: 'TEXT' }] })} className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-sisyphus-700 hover:underline"><FiPlus className="size-3" /> Στήλη</button>}</div>
          <div className="space-y-2">
            {(field.columns ?? []).map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_120px_28px] items-center gap-2">
                <Input value={c.label} disabled={disabled} placeholder="Ετικέτα" onChange={(e) => setCol(i, { label: e.target.value, key: slugKey(e.target.value) || c.key })} />
                <Input value={c.key} disabled={disabled} placeholder="key" className="font-mono text-[12px]" onChange={(e) => setCol(i, { key: slugKey(e.target.value) || c.key })} />
                <select value={c.valueType} disabled={disabled} className="h-9 rounded-sm border border-input bg-background px-2 text-[12px]" onChange={(e) => setCol(i, { valueType: e.target.value as TemplateValueType })}>
                  {VALUE_TYPES.map((v) => <option key={v} value={v}>{VALUE_TYPE_LABEL[v]}</option>)}</select>
                {!disabled && <button type="button" aria-label="Αφαίρεση στήλης" onClick={() => set({ columns: (field.columns ?? []).filter((_, j) => j !== i) })} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-dg-red-600"><FiX className="size-3.5" /></button>}
              </div>))}
          </div>
        </div>
      )}
    </div>
  );
}
