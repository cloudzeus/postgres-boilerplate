'use client';

// components/templates/new-field-dialog.tsx — names the box the user just drew on the DOCUMENT
// («Νέο πεδίο» on the run card). Presentational on purpose: it collects a label, a key and a type
// and hands them back — adding the field to the template and re-reading the document is the job of
// `use-run-add-field`.

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KIND_LABEL, VALUE_TYPE_LABEL } from '@/lib/templates/labels';
import { parseColumns } from '@/lib/templates/run-view';
import { slugDraft, slugKey, uniqueKey, type FieldDef, type Region, type TemplateValueType } from '@/lib/templates/schema';
import type { NewFieldDraft } from './use-run-add-field';

const VALUE_TYPES = Object.keys(VALUE_TYPE_LABEL) as TemplateValueType[];
const sel = 'mt-1 h-9 w-full rounded-sm border border-input bg-background px-2 text-[length:var(--fs-13)]';

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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit({ label: label.trim(), key: previewKey, kind, valueType, columns }); }} className="space-y-3">
          <DialogHeader>
            <DialogTitle>Νέο πεδίο από την περιοχή</DialogTitle>
            <DialogDescription>
              {region ? `Σελίδα ${region.page + 1}. ` : ''}Το πεδίο μπαίνει στο πρότυπο με αυτή την περιοχή και διαβάζεται αμέσως από το έγγραφο.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="new-field-label">Ετικέτα</Label>
            <Input id="new-field-label" autoFocus required value={label} disabled={busy} className="mt-1"
              placeholder="π.χ. Αριθμός παραγγελίας" onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="new-field-key">Κλειδί</Label>
            <Input id="new-field-key" value={key || previewKey} disabled={busy} className="mt-1 font-mono text-[length:var(--fs-12)]"
              placeholder="παράγεται από την ετικέτα" onChange={(e) => setKey(slugDraft(e.target.value))} />
            <p className="mt-1 text-[length:var(--fs-10)] text-muted-foreground">Με αυτό το όνομα βγαίνει η τιμή στο JSON και στα mappings.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-field-kind">Είδος</Label>
              <select id="new-field-kind" value={kind} disabled={busy} className={sel} onChange={(e) => setKind(e.target.value as FieldDef['kind'])}>
                {(Object.keys(KIND_LABEL) as FieldDef['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="new-field-type">Τύπος τιμής</Label>
              {/* A TABLE reads rows and each column carries its own type — the field's own is unused. */}
              <select id="new-field-type" value={valueType} disabled={busy || kind === 'TABLE'} className={sel} onChange={(e) => setValueType(e.target.value as TemplateValueType)}>
                {VALUE_TYPES.map((v) => <option key={v} value={v}>{VALUE_TYPE_LABEL[v]}</option>)}
              </select>
            </div>
          </div>

          {kind === 'TABLE' && (
            <div>
              <Label htmlFor="new-field-columns">Στήλες</Label>
              <Input id="new-field-columns" value={columns} disabled={busy} className="mt-1"
                placeholder="Περιγραφή, Ποσότητα, Αξία" onChange={(e) => setColumns(e.target.value)} />
              <p className="mt-1 text-[length:var(--fs-10)] text-muted-foreground">Χωρισμένες με κόμμα — τα κλειδιά τους παράγονται αυτόματα.</p>
            </div>
          )}

          <DialogFooter>
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
