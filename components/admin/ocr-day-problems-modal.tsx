'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  FiCheckCircle, FiAlertTriangle, FiExternalLink, FiLoader, FiRefreshCw, FiZap, FiCheck, FiTool,
} from 'react-icons/fi';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { BTN_GHOST, BTN_PRIMARY } from '@/components/admin/bulk-ui';
import { FormSelect } from '@/components/admin/form-kit';
import { cn } from '@/lib/utils';
import { reconMeta, RECON_PENDING_ORDER, type ReconInput, type ReconStatus } from '@/lib/ocr/recon-status';
import { CATEGORY_LABEL, type CategorySuggestion, type OcrCategoryValue } from '@/lib/ocr/category-suggest';
import type { ProblemSuggestion } from '@/lib/ocr/problem-suggestions';

/** Minimal row shape the modal needs (a superset of ReconInput + display fields). */
export interface DayProblemRow extends ReconInput {
  id: string;
  fileName: string;
}

const CONFIDENCE: Record<CategorySuggestion['confidence'], { text: string; cls: string }> = {
  high: { text: 'σίγουρη', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' },
  mid: { text: 'πιθανή', cls: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300' },
  low: { text: 'να ελεγχθεί', cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
};

// Χρωματισμός ενότητας ανά κατάσταση — στατικές κλάσεις (JIT) με dark παραλλαγές, ίδια λογική με
// το FormSection: πλαίσιο, χρωματιστή κεφαλίδα, πλακίδιο εικονιδίου.
const GROUP_TONE: Partial<Record<ReconStatus, { box: string; head: string; icon: string }>> = {
  ERROR: { box: 'border-red-500/30', head: 'bg-red-50/80 text-red-800 dark:bg-red-500/10 dark:text-red-300', icon: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  NEEDS_REVIEW: { box: 'border-amber-500/30', head: 'bg-amber-50/70 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300', icon: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  DUPLICATE: { box: 'border-amber-500/30', head: 'bg-amber-50/70 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300', icon: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  NO_SUPPLIER: { box: 'border-orange-500/30', head: 'bg-orange-50/80 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300', icon: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  UNMATCHED_LINES: { box: 'border-orange-500/30', head: 'bg-orange-50/80 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300', icon: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  READY: { box: 'border-sisyphus-500/25', head: 'bg-sisyphus-50/70 text-sisyphus-700 dark:bg-sisyphus-500/10 dark:text-sisyphus-300', icon: 'bg-sisyphus-500/15 text-sisyphus-600 dark:text-sisyphus-300' },
};
const GROUP_TONE_FALLBACK = { box: 'border-border', head: 'bg-muted/50 text-muted-foreground', icon: 'bg-muted text-muted-foreground' };

/** Γραμμή λίστας με επιλογή: τικ | παραστατικό | επιλογή λύσης | αιτιολογία — στοιχισμένες στήλες. */
const PICK_ROW = 'grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-1 md:grid-cols-[2.25rem_minmax(0,1fr)_13rem_minmax(0,1.4fr)]';
/** Στήλες 3–4 σε στενή οθόνη: κάτω από το όνομα (στήλη 2). */
const PICK_SUB = 'col-start-2 md:col-start-auto';
const ROW_SELECT = 'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[length:var(--fs-13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
const RETRY_OPTS = [
  { id: 'retry', name: 'Επανανάγνωση (κανονικό μοντέλο)' },
  { id: 'hq', name: 'Επανασκανάρισμα HQ (~8× κόστος)' },
];
const CATEGORIES = Object.keys(CATEGORY_LABEL) as OcrCategoryValue[];
const shortName = (f: string) => f.replace(/^.*\//, '').replace(/\.(pdf|png|jpe?g)$/i, '');

function DocLink({ id, fileName }: { id: string; fileName: string }) {
  return (
    <Link href={`/admin/ocr/${id}`} target="_blank" className="inline-flex min-w-0 items-center gap-1 text-foreground hover:text-sisyphus-700 hover:underline" title={fileName}>
      <span className="truncate">{shortName(fileName)}</span>
      <FiExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}

/** Ένας τικ για επιλογή γραμμής, 44px στόχος αφής. */
function Pick({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="size-4 cursor-pointer accent-[#0078D4]" />
    </label>
  );
}

/**
 * «Προβλήματα & λύσεις» μιας ημέρας — με ΜΑΖΙΚΗ επίλυση μετά από πρόταση.
 *
 * Για κάθε ομάδα εκκρεμότητας η εφαρμογή προτείνει λύση ανά παραστατικό (κατηγορία με αιτιολογία,
 * είδος επανανάγνωσης κ.λπ.) και ο χρήστης εγκρίνει όσες θέλει με ένα κουμπί. Τίποτα δεν
 * εφαρμόζεται χωρίς ρητό πάτημα, και ό,τι δεν γίνεται μαζικά (νέοι συναλλασσόμενοι, είδη)
 * οδηγεί στη σωστή ουρά.
 */
export function OcrDayProblemsModal({
  open, onOpenChange, dayLabel, rows,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dayLabel: string;
  rows: DayProblemRow[];
}) {
  const router = useRouter();
  const [suggestions, setSuggestions] = React.useState<Record<string, ProblemSuggestion> | null>(null);
  const [category, setCategory] = React.useState<Record<string, OcrCategoryValue | ''>>({});
  const [retry, setRetry] = React.useState<Record<string, 'retry' | 'hq'>>({});
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ n: number; of: number } | null>(null);

  // Group the day's pending documents by their derived status (most urgent first).
  const groups = React.useMemo(() => {
    const map = new Map<ReconStatus, { meta: ReturnType<typeof reconMeta>; rows: DayProblemRow[] }>();
    for (const r of rows) {
      const meta = reconMeta(r);
      if (!meta.pending) continue;
      const g = map.get(meta.status);
      if (g) g.rows.push(r); else map.set(meta.status, { meta, rows: [r] });
    }
    return [...map.values()].sort((a, b) => RECON_PENDING_ORDER.indexOf(a.meta.status) - RECON_PENDING_ORDER.indexOf(b.meta.status));
  }, [rows]);
  const totalPending = groups.reduce((n, g) => n + g.rows.length, 0);
  const idsKey = rows.map((r) => r.id).join(',');

  // Προτάσεις: μία κλήση για όλη την ημέρα, όταν ανοίγει το παράθυρο.
  React.useEffect(() => {
    if (!open || !idsKey) return;
    setSuggestions(null); setDone(new Set());
    let cancelled = false;
    fetch('/api/admin/ocr/problem-suggestions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsKey.split(',') }),
    })
      .then((r) => (r.ok ? r.json() : { suggestions: {} }))
      .then((d: { suggestions: Record<string, ProblemSuggestion> }) => {
        if (cancelled) return;
        const s = d.suggestions ?? {};
        setSuggestions(s);
        const cat: Record<string, OcrCategoryValue | ''> = {};
        const rt: Record<string, 'retry' | 'hq'> = {};
        const sel = new Set<string>();
        for (const [id, v] of Object.entries(s)) {
          if (v.category) { cat[id] = v.category.category; if (v.category.confidence !== 'low') sel.add(id); }
          if (v.error) { rt[id] = v.error.hint; sel.add(id); }
        }
        setCategory(cat); setRetry(rt); setSelected(sel);
      })
      .catch(() => { if (!cancelled) setSuggestions({}); });
    return () => { cancelled = true; };
  }, [open, idsKey]);

  const toggle = (id: string, v: boolean) => setSelected((p) => { const n = new Set(p); if (v) n.add(id); else n.delete(id); return n; });
  const setAll = (ids: string[], v: boolean) => setSelected((p) => { const n = new Set(p); for (const id of ids) { if (v) n.add(id); else n.delete(id); } return n; });

  /** Σειριακή εκτέλεση με πρόοδο — ποτέ παράλληλα βαριές κλήσεις προς το μοντέλο ή το ERP. */
  async function runEach(key: string, ids: string[], fn: (id: string) => Promise<void>, okText: (n: number) => string) {
    setBusy(key); setProgress({ n: 0, of: ids.length });
    let ok = 0;
    const failed: string[] = [];
    for (const [i, id] of ids.entries()) {
      try { await fn(id); ok++; setDone((p) => new Set(p).add(id)); } catch (e) { failed.push(`${shortName(rows.find((r) => r.id === id)?.fileName ?? id)}: ${(e as Error).message}`); }
      setProgress({ n: i + 1, of: ids.length });
    }
    setBusy(null); setProgress(null);
    if (ok) toast.success(okText(ok));
    if (failed.length) toast.error(`${failed.length} δεν ολοκληρώθηκαν`, { description: failed.slice(0, 3).join(' · ') });
    router.refresh();
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/admin/ocr/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
  };
  const reread = async (id: string) => {
    const hq = retry[id] === 'hq';
    const r = await fetch(`/api/admin/ocr/${id}/${hq ? 'reextract' : 'extract'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: hq ? JSON.stringify({ docType: 'auto' }) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? d.message ?? `HTTP ${r.status}`);
  };

  const pending = (g: { rows: DayProblemRow[] }) => g.rows.filter((r) => !done.has(r.id));
  const chosen = (g: { rows: DayProblemRow[] }) => pending(g).filter((r) => selected.has(r.id)).map((r) => r.id);

  function toolbar(g: { rows: DayProblemRow[] }, children: React.ReactNode) {
    const ids = pending(g).map((r) => r.id);
    const all = ids.length > 0 && ids.every((id) => selected.has(id));
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_GHOST} disabled={!ids.length || !!busy} onClick={() => setAll(ids, !all)}>
          {all ? 'Αποεπιλογή όλων' : 'Επιλογή όλων'}
        </button>
        {children}
      </div>
    );
  }

  function groupBody(status: ReconStatus, g: { rows: DayProblemRow[] }) {
    const loading = suggestions == null;
    if (status === 'NEEDS_REVIEW') {
      const ids = chosen(g).filter((id) => category[id]);
      return (
        <>
          <ul className="-mx-3 -mt-2.5 divide-y divide-border border-b border-border">
            {g.rows.map((r) => {
              const s = suggestions?.[r.id]?.category ?? null;
              const isDone = done.has(r.id);
              return (
                <li key={r.id} className={PICK_ROW}>
                  {isDone ? <FiCheck className="mx-2.5 size-4 text-emerald-600" aria-label="Ολοκληρώθηκε" /> : <Pick checked={selected.has(r.id)} disabled={!!busy || !category[r.id]} onChange={(v) => toggle(r.id, v)} label={`Επιλογή ${r.fileName}`} />}
                  <div className="min-w-0 text-[length:var(--fs-12)]"><DocLink id={r.id} fileName={r.fileName} /></div>
                  <select
                    value={category[r.id] ?? ''} disabled={!!busy || isDone}
                    onChange={(e) => { const v = e.target.value as OcrCategoryValue | ''; setCategory((p) => ({ ...p, [r.id]: v })); if (v) toggle(r.id, true); }}
                    className={cn(ROW_SELECT, PICK_SUB)}
                    aria-label={`Κατηγορία για ${r.fileName}`}
                  >
                    <option value="">— Κατηγορία —</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                  <div className={cn('flex min-w-0 items-center gap-1.5 text-[length:var(--fs-11)] leading-snug text-muted-foreground', PICK_SUB)}>
                    {loading ? <FiLoader className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : s ? (
                      <>
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-semibold ${CONFIDENCE[s.confidence].cls}`}>{CONFIDENCE[s.confidence].text}</span>
                        <span>{s.reason}</span>
                      </>
                    ) : <span>Καμία πρόταση — διάλεξε χειροκίνητα.</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          {toolbar(g, <>
            <button
              type="button" className={BTN_PRIMARY} disabled={!ids.length || !!busy}
              onClick={() => void runEach('cat', ids, (id) => patch(id, { category: category[id] }), (n) => `Ορίστηκε κατηγορία σε ${n} παραστατικά.`)}
            >
              {busy === 'cat' ? <FiLoader className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <FiZap className="size-4" aria-hidden />}
              Εφαρμογή κατηγορίας σε {ids.length}
            </button>
          </>)}
        </>
      );
    }
    if (status === 'ERROR') {
      const ids = chosen(g);
      return (
        <>
          <ul className="-mx-3 -mt-2.5 divide-y divide-border border-b border-border">
            {g.rows.map((r) => {
              const e = suggestions?.[r.id]?.error ?? null;
              const isDone = done.has(r.id);
              return (
                <li key={r.id} className={PICK_ROW}>
                  {isDone ? <FiCheck className="mx-2.5 size-4 text-emerald-600" aria-label="Ολοκληρώθηκε" /> : <Pick checked={selected.has(r.id)} disabled={!!busy} onChange={(v) => toggle(r.id, v)} label={`Επιλογή ${r.fileName}`} />}
                  <div className="min-w-0 text-[length:var(--fs-12)]"><DocLink id={r.id} fileName={r.fileName} /></div>
                  <FormSelect
                    value={retry[r.id] ?? 'retry'} disabled={!!busy || isDone}
                    onChange={(v) => setRetry((p) => ({ ...p, [r.id]: v as 'retry' | 'hq' }))}
                    opts={RETRY_OPTS}
                    className={PICK_SUB}
                    ariaLabel={`Τρόπος επανανάγνωσης για ${r.fileName}`}
                  />
                  <div className={cn('min-w-0 text-[length:var(--fs-11)] leading-snug text-muted-foreground', PICK_SUB)}>
                    {e ? <>{e.reason} <span className="font-mono opacity-70" title={e.message}>· {e.message.slice(0, 60)}</span></> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {toolbar(g, <>
            <button
              type="button" className={BTN_PRIMARY} disabled={!ids.length || !!busy}
              onClick={() => void runEach('read', ids, reread, (n) => `Ξαναδιαβάστηκαν ${n} παραστατικά.`)}
            >
              {busy === 'read' ? <FiLoader className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <FiRefreshCw className="size-4" aria-hidden />}
              Επανανάγνωση {ids.length}
            </button>
            <span className="text-[length:var(--fs-11)] text-muted-foreground">Μία-μία, όχι ταυτόχρονα· κάθε ανάγνωση παίρνει λίγα δευτερόλεπτα.</span>
          </>)}
        </>
      );
    }
    if (status === 'DUPLICATE') {
      const ids = chosen(g);
      return (
        <>
          <ul className="-mx-3 -mt-2.5 divide-y divide-border border-b border-border">
            {g.rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-1">
                {done.has(r.id) ? <FiCheck className="mx-2.5 size-4 text-emerald-600" aria-label="Ολοκληρώθηκε" /> : <Pick checked={selected.has(r.id)} disabled={!!busy} onChange={(v) => toggle(r.id, v)} label={`Επιλογή ${r.fileName}`} />}
                <div className="min-w-0 flex-1 text-[length:var(--fs-12)]"><DocLink id={r.id} fileName={r.fileName} /></div>
              </li>
            ))}
          </ul>
          {toolbar(g, <>
            <button
              type="button" className={BTN_GHOST} disabled={!ids.length || !!busy}
              onClick={() => void runEach('ign', ids, (id) => patch(id, { reconOverride: 'IGNORED' }), (n) => `${n} παραστατικά σημειώθηκαν ως αγνοημένα.`)}
            >
              Σήμανση {ids.length} ως ήδη καταχωρισμένα (αγνόηση)
            </button>
            <span className="text-[length:var(--fs-11)] text-muted-foreground">Επίλεξε μόνο όσα επιβεβαίωσες ότι υπάρχουν ήδη στο SoftOne.</span>
          </>)}
        </>
      );
    }
    // Ό,τι δεν λύνεται μαζικά εδώ: λίστα + η σωστή ουρά.
    const action = status === 'UNMATCHED_LINES'
      ? (
        <>
          <button
            type="button" className={BTN_PRIMARY} disabled={!!busy}
            onClick={async () => {
              setBusy('rematch');
              try {
                const r = await fetch('/api/admin/ocr/rematch-all', { method: 'POST' });
                const d = await r.json();
                if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`);
                toast.success(`Επανεφαρμογή μνήμης: κάλυψη ${d.before.matched} → ${d.after.matched} από ${d.after.total} γραμμές.`);
                router.refresh();
              } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
            }}
          >
            {busy === 'rematch' ? <FiLoader className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <FiZap className="size-4" aria-hidden />}
            Επανεφαρμογή μνήμης
          </button>
          <Link href="/admin/ocr/new-items" className={BTN_GHOST}>Είδη & έξοδα <FiExternalLink className="size-3" aria-hidden /></Link>
        </>
      )
      : status === 'NO_SUPPLIER'
        ? <Link href="/admin/ocr/new-traders" className={BTN_PRIMARY}>Νέοι συναλλασσόμενοι <FiExternalLink className="size-3" aria-hidden /></Link>
        : status === 'READY'
          ? <span className="text-[length:var(--fs-11)] text-muted-foreground">Μαζική ανάρτηση: κουμπί «Ανάρτηση» στην κεφαλίδα της ημέρας.</span>
          : null;
    return (
      <>
        <ul className="-mx-3 -mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1 border-b border-border px-3 py-2 sm:grid-cols-2">
          {g.rows.map((r) => <li key={r.id} className="min-w-0 text-[length:var(--fs-12)]"><DocLink id={r.id} fileName={r.fileName} /></li>)}
        </ul>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15">
            <FiTool className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Προβλήματα & λύσεις — {dayLabel}</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]">
              {totalPending > 0
                ? `${totalPending} ${totalPending === 1 ? 'παραστατικό χρειάζεται' : 'παραστατικά χρειάζονται'} ενέργεια. Η εφαρμογή προτείνει λύση· επίλεξε και εφάρμοσε μαζικά.`
                : 'Καμία εκκρεμότητα για αυτή την ημέρα.'}
            </DialogDescription>
          </div>
        </DialogHeader>

        {progress && (
          <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2 text-[length:var(--fs-12)] text-muted-foreground" aria-live="polite">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-sisyphus-500 transition-[width]" style={{ width: `${(progress.n / progress.of) * 100}%` }} />
            </div>
            <span className="tabular-nums">{progress.n}/{progress.of}</span>
          </div>
        )}

        {totalPending === 0 ? (
          <div className="flex flex-col items-center gap-2 bg-muted/20 px-4 py-8 text-center">
            <FiCheckCircle className="size-8 text-emerald-500" aria-hidden />
            <p className="text-[length:var(--fs-13)] text-muted-foreground">Όλα τα παραστατικά της ημέρας είναι εντάξει.</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-muted/20 px-4 py-3">
            {groups.map((g) => {
              const t = GROUP_TONE[g.meta.status] ?? GROUP_TONE_FALLBACK;
              return (
                <section key={g.meta.status} aria-label={g.meta.label} className={cn('overflow-hidden rounded-lg border bg-card', t.box)}>
                  <header className={cn('flex min-h-8 items-center gap-2 px-3 py-1.5', t.head)}>
                    <span aria-hidden className={cn('grid size-5 shrink-0 place-items-center rounded [&_svg]:size-3', t.icon)}><FiAlertTriangle /></span>
                    <h3 className="text-[length:var(--fs-11)] font-semibold uppercase tracking-wide">{g.meta.label}</h3>
                    <span className="ml-auto rounded-full border border-black/10 bg-card/70 px-1.5 py-0.5 text-[length:var(--fs-10)] font-semibold tabular-nums dark:border-white/15">
                      {pending(g).length}{done.size && pending(g).length !== g.rows.length ? ` / ${g.rows.length}` : ''}
                    </span>
                  </header>
                  {(g.meta.problem || g.meta.solution) && (
                    <div className="grid gap-x-4 gap-y-0.5 border-b border-border px-3 py-1.5 text-[length:var(--fs-12)] leading-snug md:grid-cols-2">
                      {g.meta.problem && <p className="text-foreground/80">{g.meta.problem}</p>}
                      {g.meta.solution && (
                        <p>
                          <span className="font-semibold">Λύση: </span>
                          <span className="text-foreground/80">{g.meta.solution}</span>
                        </p>
                      )}
                    </div>
                  )}
                  <div className="space-y-2.5 px-3 py-2.5">
                    {groupBody(g.meta.status, g)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
