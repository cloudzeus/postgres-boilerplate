'use client';

// The region side of the run card (spec §16.3): a box the user moved or resized on the canvas is a
// PENDING region — it lives here, next to the run, until the user either re-reads the field with it
// or pushes it back to the template. Keeping it out of `run.values` is the point: an adjustment is a
// per-document correction, and until «Επανάγνωση» runs, the run on the server still holds the old box.

import * as React from 'react';
import { toast } from 'sonner';
import { formatValue } from '@/lib/templates/run-view';
import type { Region } from '@/lib/templates/schema';
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
  /** Keys whose pending box already reached the template — the box stays, the button is spent. */
  savedKeys: ReadonlySet<string>;
  setRegion: (key: string, region: Region) => void;
  reread: (key: string) => void;
  saveToTemplate: (key: string) => void;
};

export function useRunRegions({ docId, run, onRun }: Args): RunRegions {
  const [pending, setPending] = React.useState<Record<string, Region>>({});
  const [rereading, setRereading] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [savedKeys, setSavedKeys] = React.useState<ReadonlySet<string>>(() => new Set());

  const runId = run?.id ?? null;
  // Which run the boxes below belong to, readable from an async callback that started before a switch.
  const runIdRef = React.useRef(runId);
  const mounted = React.useRef(false);
  // Switching runs (history list) drops every adjustment: the boxes belonged to the other run's values.
  // The FIRST pass is not a switch — clearing there would only throw away a fresh render's own state.
  React.useEffect(() => {
    runIdRef.current = runId;
    if (!mounted.current) { mounted.current = true; return; }
    setPending({});
    setSavedKeys(new Set());
  }, [runId]);

  const setRegion = React.useCallback((key: string, region: Region) => {
    setPending((p) => ({ ...p, [key]: region }));
  }, []);

  const reread = React.useCallback(async (key: string) => {
    if (!run || rereading) return;
    const forRun = run.id;
    setRereading(key);
    try {
      // No pending box = read the field again from the region the run already used (a plain retry).
      const { run: updated, value } = await templatesApi.runs.reread(docId, forRun, key, pending[key]);
      onRun(updated);
      // The user can switch runs while the read is in flight. The map now holds the OTHER run's
      // adjustments, and dropping a key from it would silently erase a box nobody has read yet.
      if (runIdRef.current === forRun) setPending(({ [key]: _dropped, ...rest }) => rest);
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
    setSaving(key);
    try {
      // `PUT fields` is a whole-list write: everything absent from the body is DELETED. The copy of
      // the fields inside the run is a snapshot of the version it executed with, so sending that back
      // would drop every field added to the template since — read the template as it stands NOW and
      // change exactly one box in it.
      const current = await templatesApi.get(run.template.id);
      const field = current.fields.find((f) => f.key === key);
      if (!field) { toast.error('Το πεδίο δεν υπάρχει πια στο πρότυπο.'); return; }
      // Asked AFTER the fetch, so the name in the question is the template's real, current name.
      if (!window.confirm(`Η περιοχή θα ενημερωθεί στο πρότυπο «${current.name}» για όλα τα επόμενα έγγραφα. Συνέχεια;`)) return;
      const saved = await templatesApi.putFields(current.id, current.fields.map((f) => (f.key === key ? { ...f, region } : f)));
      setSavedKeys((s) => new Set(s).add(key));
      // The template's version moves; THIS run does not — it keeps the values and the boxes it was
      // executed with. Only the next document sees the new region.
      const done = `Η περιοχή του «${field.label}» αποθηκεύτηκε στο πρότυπο (έκδοση ${saved.version}). Η τρέχουσα εκτέλεση δεν αλλάζει.`
        + (saved.demoted ? ' Το πρότυπο επέστρεψε σε πρόχειρο.' : '');
      // A write can still cost the template references elsewhere (the same cleanup the designer reports).
      const maps = saved.cleanup?.mappings.map((m) => m.name) ?? [];
      const conds = saved.cleanup?.conditions.map((c) => c.name) ?? [];
      if (maps.length || conds.length) {
        const parts = [maps.length ? `mappings: ${maps.join(', ')}` : '', conds.length ? `conditions: ${conds.join(', ')}` : ''].filter(Boolean);
        toast.warning(`${done} Καθαρίστηκαν αναφορές σε ${parts.join(' · ')}.`);
      } else toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }, [run, pending, saving]);

  return { pending, rereading, saving, savedKeys, setRegion, reread, saveToTemplate };
}
