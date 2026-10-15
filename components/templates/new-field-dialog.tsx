'use client';

// components/templates/new-field-dialog.tsx — names the box the user just drew on the DOCUMENT
// («Νέο πεδίο» on the run card). Presentational on purpose: it collects a label, a key and a type
// and hands them back — adding the field to the template and re-reading the document is the job of
// `use-run-add-field`.

import * as React from 'react';
import { FiCrop, FiSliders, FiTag } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field, FormSection, FormSelect, RowHint, fieldCls } from '@/components/admin/form-kit';
import { cn } from '@/lib/utils';
import { KIND_LABEL, VALUE_TYPE_LABEL } from '@/lib/templates/labels';
import { parseColumns } from '@/lib/templates/run-view';
import { slugDraft, slugKey, uniqueKey, type FieldDef, type Region, type TemplateValueType } from '@/lib/templates/schema';
import type { NewFieldDraft } from './use-run-add-field';

const VALUE_TYPES = Object.keys(VALUE_TYPE_LABEL) as TemplateValueType[];
const KIND_OPTS = (Object.keys(KIND_LABEL) as FieldDef['kind'][]).map((k) => ({ id: k, name: KIND_LABEL[k] }));
const VALUE_TYPE_OPTS = VALUE_TYPES.map((v) => ({ id: v, name: VALUE_TYPE_LABEL[v] }));

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The box just drawn — its page is named, so the user can tell which mark they are naming. */
  region: Region | null;
  /** Keys already in the template, so the preview is the key the field will really get. */
  takenKeys: string[];
  busy: boolean;
  onSubmit: (draft: NewFieldDraft) => void;
};

export function NewFieldDialog({ open, onOpenChange, region, takenKeys, busy, onSubmit }: Props) {
  const [label, setLabel] = React.useState('');
  /** Empty = the key follows the label. A typed key stops following it. */
  const [key, setKey] = React.useState('');
  const [kind, setKind] = React.useState<FieldDef['kind']>('SINGLE');
  const [valueType, setValueType] = React.useState<TemplateValueType>('TEXT');
  const [columns, setColumns] = React.useState('');

  // Every opening starts a blank field: the same dialog names the next box too.
  React.useEffect(() => {
    if (!open) return;
    setLabel(''); setKey(''); setKind('SINGLE'); setValueType('TEXT'); setColumns('');
  }, [open]);

  // What the field will be called: the typed key, else the label slugged — made unique either way,
  // so the preview never promises a key the save would have to change behind the user's back.
  const previewKey = React.useMemo(() => {
    const base = key.trim() || (label.trim() ? slugKey(label) : '');
    return base ? uniqueKey(base, takenKeys) : '';
  }, [key, label, takenKeys]);

  // The same reading of the text the save will do — «, ,» is no columns, however non-empty it looks.
  const hasColumns = parseColumns(columns).length > 0;
  const canSubmit = !!label.trim() && !busy && (kind === 'SINGLE' || hasColumns);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit({ label: label.trim(), key: previewKey, kind, valueType, columns }); }}>
          <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15 [&_svg]:size-4"><FiCrop /></span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[length:var(--fs-15)]">Νέο πεδίο από την περιοχή</DialogTitle>
              <DialogDescription className="line-clamp-2 text-[length:var(--fs-11)]">
                {region ? `Σελίδα ${region.page + 1}. ` : ''}Το πεδίο μπαίνει στο πρότυπο με αυτή την περιοχή και διαβάζεται αμέσως από το έγγραφο.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="space-y-3 bg-muted/20 px-4 py-3">
            <FormSection tone="blue" icon={<FiTag />} title="Πεδίο">
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <Field label="Ετικέτα" required htmlFor="new-field-label" className="col-span-12 sm:col-span-6">
                  <Input id="new-field-label" autoFocus required value={label} disabled={busy} className={fieldCls}
                    placeholder="π.χ. Αριθμός παραγγελίας" onChange={(e) => setLabel(e.target.value)} />
                </Field>
                <Field label="Κλειδί" htmlFor="new-field-key" className="col-span-12 sm:col-span-6">
                  <Input id="new-field-key" value={key || previewKey} disabled={busy} className={cn(fieldCls, 'font-mono')} aria-describedby="new-field-key-hint"
                    placeholder="παράγεται από την ετικέτα" onChange={(e) => setKey(slugDraft(e.target.value))} />
                </Field>
              </div>
              <div id="new-field-key-hint"><RowHint>Κλειδί: με αυτό το όνομα βγαίνει η τιμή στο JSON και στα mappings.</RowHint></div>
            </FormSection>

            <FormSection tone="violet" icon={<FiSliders />} title="Μορφή">
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <Field label="Είδος" htmlFor="new-field-kind" className="col-span-6">
                  <FormSelect id="new-field-kind" value={kind} disabled={busy} ariaLabel="Είδος" opts={KIND_OPTS}
                    onChange={(v) => setKind(v as FieldDef['kind'])} />
                </Field>
                <Field label="Τύπος τιμής" htmlFor="new-field-type" className="col-span-6">
                  {/* A TABLE reads rows and each column carries its own type — the field's own is unused. */}
                  <FormSelect id="new-field-type" value={valueType} disabled={busy || kind === 'TABLE'} ariaLabel="Τύπος τιμής" opts={VALUE_TYPE_OPTS}
                    onChange={(v) => setValueType(v as TemplateValueType)} />
                </Field>
                {kind === 'TABLE' && (
                  <Field label="Στήλες" htmlFor="new-field-columns" className="col-span-12">
                    <Input id="new-field-columns" value={columns} disabled={busy} className={fieldCls} aria-describedby="new-field-columns-hint"
                      placeholder="Περιγραφή, Ποσότητα, Αξία" onChange={(e) => setColumns(e.target.value)} />
                  </Field>
                )}
              </div>
              {kind === 'TABLE' && <div id="new-field-columns-hint"><RowHint>Χωρισμένες με κόμμα — τα κλειδιά τους παράγονται αυτόματα.</RowHint></div>}
            </FormSection>
          </div>

          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Ακύρωση</Button>
            <Button type="submit" size="sm" disabled={!canSubmit} aria-busy={busy}>
              {busy ? 'Προσθήκη…' : 'Προσθήκη στο πρότυπο και ανάγνωση'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
