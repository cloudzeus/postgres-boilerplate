'use client';

// components/templates/use-detection.ts — the vision-detection half of the regions step:
// «Από περιοχή» (one drawn box → one named field) and «Αυτόματη σάρωση» (a whole page → a batch
// of proposals). Both are long awaits, so everything they produce is resolved against the draft as
// it stands WHEN THE ANSWER LANDS, never against the array captured when the request went out.
import * as React from 'react';
import { toast } from 'sonner';
import { COLOR_PALETTE, nextColor, uniqueKey, type Bbox, type FieldDef, type Region } from '@/lib/templates/schema';
import { templatesApi, errorMessage, type TestFieldResult } from './api';

export const COLOR_CAP_MSG = `Μέγιστο ${COLOR_PALETTE.length} πεδία ανά πρότυπο (ένα χρώμα το καθένα)`;

/** The step's single warm accent (marking badge + «πρόταση» chip). One pair, not one per widget. */
export const ACCENT = { bg: '#FFF1E6', fg: '#C2410C' } as const;

/** A repeat scan re-reads the same boxes; anything this close to an existing region is the same field. */
const DUPLICATE_IOU = 0.5;

/** Intersection over union of two normalized [x, y, w, h] boxes. 0 when they do not overlap. */
export function iou(a: Bbox, b: Bbox): number {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - x;
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union <= 0 ? 0 : inter / union;
}

type TestMap = Record<string, TestFieldResult | { error: string } | 'busy'>;

type Args = {
  templateId: string;
  fields: FieldDef[];
  setFields: React.Dispatch<React.SetStateAction<FieldDef[]>>;
  setTests: React.Dispatch<React.SetStateAction<TestMap>>;
  setFocusKey: (k: string | null) => void;
  setPage: (p: number) => void;
};

export function useDetection({ templateId, fields, setFields, setTests, setFocusKey, setPage }: Args) {
  const [detecting, setDetecting] = React.useState(false);
  // Keys of fields the model proposed and the user has not saved yet — they carry a «πρόταση» chip.
  const [proposed, setProposed] = React.useState<Set<string>>(new Set());
  const [scanMode, setScanMode] = React.useState<'marks' | 'all'>('all');

  // Edits — and whole saves — land while a scan is in flight. A functional updater cannot be used to
  // read the fresh draft here because it would have to emit the chips/proposed side effects from
  // inside the reducer, which StrictMode double-invokes. A ref is the honest way to read it.
  const fieldsRef = React.useRef(fields);
  React.useEffect(() => { fieldsRef.current = fields; }, [fields]);

  /** Build one field for `d`, keyed and coloured against `draft` (which the caller keeps pushing to). */
  const build = (draft: FieldDef[], d: { label: string; key: string; kind: FieldDef['kind']; valueType: FieldDef['valueType']; columns: FieldDef['columns']; region: Region }): FieldDef => ({
    key: uniqueKey(d.key, draft.map((f) => f.key)), label: d.label, kind: d.kind, valueType: d.valueType,
    color: nextColor(draft.map((f) => f.color)), region: d.region, columns: d.columns,
    aiHint: null, required: false, order: draft.length,
  });

  // The model names the field behind a freshly drawn box (spec §14.1-6).
  const detectFromRegion = async (region: Region) => {
    if (fieldsRef.current.length >= COLOR_PALETTE.length) { toast.error(COLOR_CAP_MSG); return; }
    setDetecting(true);
    try {
      const r = await templatesApi.detectField(templateId, region, fieldsRef.current.map((f) => f.key));
      const draft = fieldsRef.current;                       // re-read: the scan may have outlived edits
      if (draft.length >= COLOR_PALETTE.length) { toast.error(COLOR_CAP_MSG); return; }
      const f = build(draft, { label: r.label, key: r.key, kind: r.kind, valueType: r.valueType, columns: r.columns, region });
      setFields([...draft, f]);
      setTests((t) => ({ ...t, [f.key]: { raw: r.value, value: r.value, source: 'vision', model: r.model, tokensUsed: r.tokensUsed, color: f.color, durationMs: r.durationMs } }));
      setProposed((p) => new Set(p).add(f.key));            // unsaved until the step is saved — same «πρόταση» chip as a scan
      setFocusKey(f.key);
      toast.success(`Αναγνωρίστηκε «${r.label}»`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setDetecting(false); }
  };

  // Whole-page scan: every label→value pair ('all') or only what the accountant circled ('marks') — spec §14.8.
  const detectMarks = async (mode: 'marks' | 'all', scanPage: number) => {
    const free = COLOR_PALETTE.length - fieldsRef.current.length;   // the server caps against SAVED fields; the draft holds colours too
    if (free <= 0) { toast.error(COLOR_CAP_MSG); return; }
    setDetecting(true);
    try {
      const r = await templatesApi.detectMarks(templateId, scanPage, mode, fieldsRef.current.map((f) => f.key), free);
      if (r.marks.length === 0) { toast.info(mode === 'marks' ? 'Δεν βρέθηκαν σημειώσεις στη σελίδα' : 'Δεν βρέθηκαν πεδία στη σελίδα'); return; }
      const draft = [...fieldsRef.current];                  // resolve against the CURRENT draft, not the captured one
      const room = COLOR_PALETTE.length - draft.length;
      if (room <= 0) { toast.error(COLOR_CAP_MSG); return; }
      // A second scan of the same page re-reads the same boxes — drop what the draft already covers.
      const boxes = draft.filter((f) => f.region?.page === scanPage).map((f) => f.region!.bbox);
      const fresh = r.marks.filter((m) => !boxes.some((b) => iou(b, m.bbox) >= DUPLICATE_IOU));
      const dupes = r.marks.length - fresh.length;
      if (fresh.length === 0) { toast.info(`${dupes} προτάσεις παραλείφθηκαν — υπάρχουν ήδη ως πεδία`); return; }
      const take = fresh.slice(0, room);
      const chips: Record<string, TestFieldResult> = {};
      for (const [i, m] of take.entries()) {
        const f = build(draft, { label: m.label, key: m.key, kind: 'SINGLE', valueType: m.valueType, columns: null, region: { page: scanPage, bbox: m.bbox } });
        draft.push(f);
        // One request pays for the whole batch — book its cost on the first chip instead of n times.
        chips[f.key] = { raw: m.value, value: m.value, source: 'vision', model: r.model, tokensUsed: i === 0 ? r.tokensUsed : 0, color: f.color, durationMs: i === 0 ? r.durationMs : 0 };
      }
      setFields(draft);
      setTests((t) => ({ ...t, ...chips }));
      setProposed((p) => { const n = new Set(p); for (const k of Object.keys(chips)) n.add(k); return n; });
      setPage(scanPage);                                     // the markers are on the scanned page, not wherever the user paged to
      const skipped = [dupes > 0 ? `${dupes} διπλότυπα` : '', take.length < fresh.length ? `${fresh.length - take.length} πάνω από το όριο χρωμάτων` : ''].filter(Boolean);
      const msg = `${take.length} προτάσεις — έλεγξε, διόρθωσε και αποθήκευσε · ${r.tokensUsed} tokens · ${r.durationMs} ms`;
      if (skipped.length) toast.warning(`${msg} · παραλείφθηκαν ${skipped.join(' και ')}`);
      else toast.success(msg);
    } catch (e) { toast.error(errorMessage(e)); } finally { setDetecting(false); }
  };

  return { detecting, proposed, setProposed, scanMode, setScanMode, detectFromRegion, detectMarks };
}
