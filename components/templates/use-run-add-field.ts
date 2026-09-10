'use client';

// «Νέο πεδίο» on the run card: a field nobody thought of when the template was designed is noticed
// HERE, on a real document — so the box is drawn here, the field is named here, and the template
// gains it before the document is read again.
//
// Two writes, in this order and no other: the template grows first (`PUT fields`), the run re-reads
// second. `rereadField` looks the field up in the template as it stands in the database, so a field
// that is not there yet is simply `unknown_field` — the write is what makes the read possible.

import * as React from 'react';
import { toast } from 'sonner';
import { formatValue } from '@/lib/templates/run-view';
import { COLOR_PALETTE, nextColor, slugKey, uniqueKey, type ColumnDef, type FieldDef, type Region } from '@/lib/templates/schema';
import { templatesApi, errorMessage, type RunDto } from './api';
import { COLOR_CAP_MSG } from './use-detection';

type Args = {
  docId: string;
  run: RunDto | null;
  /** Hand the re-read run back to whoever owns the runs list. */
  onRun: (run: RunDto) => void;
  /** The field landed: bring it into view (its row and the page its box is on). */
  onAdded: (key: string, page: number) => void;
};

/** What the dialog collects. Everything else about the field is decided here. */
export type NewFieldDraft = {
  label: string;
  /** The key the dialog previewed; empty = derive it from the label. */
  key: string;
  kind: FieldDef['kind'];
  valueType: FieldDef['valueType'];
  /** TABLE only: comma-separated column labels — their keys are slugged from them. */
  columns: string;
};

export type RunAddField = {
  /** The canvas is waiting for a drag. */
  marking: boolean;
  /** The box just drawn, waiting for a name — non-null exactly while the dialog is open. */
  region: Region | null;
  /** A write (and the read after it) is in flight. */
  busy: boolean;
  /** Field keys of the run's template, so the dialog can preview the key the field will really get. */
  takenKeys: string[];
  startMarking: () => void;
  /** `RegionMarker.onRegionComplete` — the drawn box, in the page it was drawn on. */
  onRegion: (box: { x: number; y: number; w: number; h: number }, page: number) => void;
  cancel: () => void;
  submit: (draft: NewFieldDraft) => void;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** «Περιγραφή, Ποσότητα, Αξία» → three columns with unique slugged keys. Empty entries drop out. */
export function parseColumns(text: string): ColumnDef[] {
  const cols: ColumnDef[] = [];
  for (const raw of text.split(',')) {
    const label = raw.trim();
    if (!label) continue;
    cols.push({ key: uniqueKey(slugKey(label), cols.map((c) => c.key)), label, valueType: 'TEXT' });
  }
  return cols;
}

export function useRunAddField({ docId, run, onRun, onAdded }: Args): RunAddField {
  const [marking, setMarking] = React.useState(false);
  const [region, setRegion] = React.useState<Region | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Esc cancels marking from anywhere; a focusable wrapper only worked while it held focus.
  React.useEffect(() => {
    if (!marking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMarking(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marking]);

  // Switching runs (history list) drops a half-finished addition: the box was drawn over another
  // run's page, and the template the dialog previewed keys against is the other run's template.
  const runId = run?.id ?? null;
  React.useEffect(() => { setMarking(false); setRegion(null); }, [runId]);

  const takenKeys = React.useMemo(() => run?.template.fields.map((f) => f.key) ?? [], [run]);

  const onRegion = React.useCallback((box: { x: number; y: number; w: number; h: number }, page: number) => {
    setMarking(false);
    setRegion({ page, bbox: [round(box.x), round(box.y), round(box.w), round(box.h)] });
  }, []);

  const cancel = React.useCallback(() => { setMarking(false); setRegion(null); }, []);

  const submit = React.useCallback(async (draft: NewFieldDraft) => {
    if (!run || !region || busy) return;
    const label = draft.label.trim();
    if (!label) { toast.error('Δώσε ετικέτα στο πεδίο.'); return; }
    const columns = draft.kind === 'TABLE' ? parseColumns(draft.columns) : null;
    if (draft.kind === 'TABLE' && columns!.length === 0) { toast.error('Ο πίνακας χρειάζεται τουλάχιστον μία στήλη.'); return; }
    const forRun = run.id;
    setBusy(true);
    try {
      // `PUT fields` is a whole-list write: everything absent from the body is DELETED. The copy of
      // the fields inside the run is a snapshot of the version it executed with, so sending that back
      // would drop every field added to the template since — read the template as it stands NOW and
      // append exactly one field to it.
      const current = await templatesApi.get(run.template.id);
      // One palette colour per field, and the overlay is unreadable without distinct colours.
      if (current.fields.length >= COLOR_PALETTE.length) { toast.error(COLOR_CAP_MSG); return; }
      // The dialog previewed a key against the run's snapshot; the template may have grown since.
      const key = uniqueKey(draft.key.trim() || slugKey(label), current.fields.map((f) => f.key));
      const field: FieldDef = {
        key, label, kind: draft.kind,
        // A TABLE reads rows, and each column carries its own type — the field's own is unused.
        valueType: draft.kind === 'TABLE' ? 'TEXT' : draft.valueType,
        color: nextColor(current.fields.map((f) => f.color)),
        region, columns, aiHint: null, required: false, order: current.fields.length,
      };
      const saved = await templatesApi.putFields(current.id, [...current.fields, field]);
      const version = `Το πρότυπο «${current.name}» πήγε στην έκδοση ${saved.version}.`
        + (saved.demoted ? ' Επέστρεψε σε πρόχειρο.' : '');
      // A write can still cost the template references elsewhere (the same cleanup the designer reports).
      const maps = saved.cleanup?.mappings.map((m) => m.name) ?? [];
      const conds = saved.cleanup?.conditions.map((c) => c.name) ?? [];
      if (maps.length || conds.length) {
        const parts = [maps.length ? `mappings: ${maps.join(', ')}` : '', conds.length ? `conditions: ${conds.join(', ')}` : ''].filter(Boolean);
        toast.warning(`Καθαρίστηκαν αναφορές σε ${parts.join(' · ')}.`);
      }
      // The field EXISTS from here on. Close the dialog before the read, so a slow (or failing)
      // vision call cannot tempt the user into drawing the same field a second time.
      setRegion(null);
      try {
        const { run: updated, value } = await templatesApi.runs.reread(docId, forRun, key);
        onRun(updated);
        onAdded(key, region.page);
        const text = formatValue(value.value ?? null, field.valueType);
        if (value.value == null || value.value === '') toast.warning(`Προστέθηκε «${label}», αλλά δεν διαβάστηκε τιμή. ${version}`);
        else toast.success(`Προστέθηκε «${label}» και διαβάστηκε: ${text}. ${version}`);
      } catch (e) {
        // Half-done is worth saying out loud: the template kept the field, this run did not read it.
        toast.error(`Το πεδίο «${label}» προστέθηκε στο πρότυπο, αλλά η ανάγνωση απέτυχε: ${errorMessage(e)}`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [docId, run, region, busy, onRun, onAdded]);

  return {
    marking, region, busy, takenKeys,
    startMarking: React.useCallback(() => { setRegion(null); setMarking(true); }, []),
    onRegion, cancel, submit,
  };
}
