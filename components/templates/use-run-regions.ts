'use client';

// The region side of the run card (spec §16.3): a box the user moved or resized on the canvas is a
// PENDING region — it lives here, next to the run, until the user either re-reads the field with it
// or pushes it back to the template. Keeping it out of `run.values` is the point: an adjustment is a
// per-document correction, and until «Επανάγνωση» runs, the run on the server still holds the old box.

import * as React from 'react';
import { toast } from 'sonner';
import { formatValue } from '@/lib/templates/run-view';
import type { FieldDef, Region } from '@/lib/templates/schema';
import { templatesApi, errorMessage, type RunDto } from './api';

type Args = {
  docId: string;
  run: RunDto | null;
  /** Hand the re-read run back to whoever owns the runs list. */
  onRun: (run: RunDto) => void;
};

export type RunRegions = {
  /** Boxes the user has adjusted but not yet re-read, by field key. */
  pending: Record<string, Region>;
  /** Field key currently being re-read (one at a time — the server rewrites the whole run). */
  rereading: string | null;
  /** Field key whose region is being written back to the template. */
  saving: string | null;
  setRegion: (key: string, region: Region) => void;
  reread: (key: string) => void;
  saveToTemplate: (key: string) => void;
};

export function useRunRegions({ docId, run, onRun }: Args): RunRegions {
  const [pending, setPending] = React.useState<Record<string, Region>>({});
  const [rereading, setRereading] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);

  const runId = run?.id ?? null;
  // Switching runs (history list) drops every adjustment: the boxes belonged to the other run's values.
  React.useEffect(() => { setPending({}); }, [runId]);

  const setRegion = React.useCallback((key: string, region: Region) => {
    setPending((p) => ({ ...p, [key]: region }));
  }, []);

  const reread = React.useCallback(async (key: string) => {
    if (!run || rereading) return;
    setRereading(key);
    try {
      // No pending box = read the field again from the region the run already used (a plain retry).
      const { run: updated, value } = await templatesApi.runs.reread(docId, run.id, key, pending[key]);
      onRun(updated);
      setPending(({ [key]: _dropped, ...rest }) => rest);
      const field = updated.template.fields.find((f) => f.key === key);
      const text = formatValue(value.value ?? null, field?.valueType ?? 'TEXT');
      if (value.value == null || value.value === '') toast.warning(`Δεν διαβάστηκε τιμή για «${field?.label ?? key}».`);
      else toast.success(`Διαβάστηκε: ${text}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRereading(null);
    }
  }, [docId, run, pending, onRun, rereading]);

  const saveToTemplate = React.useCallback(async (key: string) => {
    const region = pending[key];
    if (!run || !region || saving) return;
    const field = run.template.fields.find((f) => f.key === key);
    if (!field) return;
    if (!window.confirm(`Η περιοχή θα ενημερωθεί στο πρότυπο «${run.template.name}» για όλα τα επόμενα έγγραφα. Συνέχεια;`)) return;
    setSaving(key);
    try {
      // `PUT fields` is a whole-list write — every other field goes back exactly as the run carries it.
      const fields: FieldDef[] = run.template.fields.map((f) => (f.key === key ? { ...f, region } : f));
      const saved = await templatesApi.putFields(run.template.id, fields);
      // The template's version moves; THIS run does not — it keeps the values and the boxes it was
      // executed with. Only the next document sees the new region.
      toast.success(
        `Η περιοχή του «${field.label}» αποθηκεύτηκε στο πρότυπο (έκδοση ${saved.version}). Η τρέχουσα εκτέλεση δεν αλλάζει.`
        + (saved.demoted ? ' Το πρότυπο επέστρεψε σε πρόχειρο.' : ''),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }, [run, pending, saving]);

  return { pending, rereading, saving, setRegion, reread, saveToTemplate };
}
