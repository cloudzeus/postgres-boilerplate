'use client';

// Επεξεργασία γραμμών ενός σκαναρισμένου παραστατικού: το χαρτί αριστερά, οι γραμμές δεξιά.
//
// Η ανάγνωση μπορεί να χάσει γραμμή, να διαβάσει υποσύνολο ως γραμμή ή να γράψει λάθος ποσό. Εδώ ο
// χρήστης το διορθώνει βλέποντας το πρωτότυπο, και η μπάρα στο κάτω μέρος του λέει ΣΥΝΕΧΩΣ αν οι
// γραμμές συμφωνούν πλέον με την καθαρή αξία του παραστατικού. Η αφαίρεση δεν είναι οριστική μέχρι
// την αποθήκευση («Επαναφορά»), και οι γραμμές που μένουν κρατούν αντιστοίχιση SoftOne και επιμερισμούς.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  FiAlertTriangle, FiCheckCircle, FiChevronLeft, FiChevronRight, FiFileText, FiHash, FiList, FiLoader, FiPlus, FiRotateCcw, FiTrash2,
} from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { emitDocLinesChanged } from '@/components/admin/doc-lines-events';
import { computeNet, parseSerialsInput, type LineEditOps } from '@/lib/ocr/line-edit';
import { n } from '@/lib/ocr/invoice-math';
import { cn } from '@/lib/utils';

interface DocLine { name: string | null; code: string | null; unit: string | null; quantity: number | null; unitPrice: number | null; discount: number | null; net: number | null; vatRate: number | null; serials?: string[] }
interface Totals { net: number | null; vatAmount: number | null; fees: number | null; total: number | null }
type Row = {
  key: string;
  from: number | null;
  removed: boolean;
  /** Η καθαρή αξία υπολογίζεται από ποσότητα × τιμή × έκπτωση μέχρι να τη γράψει ο χρήστης. */
  autoNet: boolean;
  name: string; code: string; quantity: string; unitPrice: string; discount: string; net: string; vatRate: string;
  /** Σειριακοί (S/N), όπως τους γράφει ο χρήστης: χωρισμένοι με κόμμα/κενό. */
  serials: string;
  /** Το πεδίο S/N φαίνεται όταν η γραμμή έχει ήδη σειριακούς ή όταν το ζητήσει ο χρήστης. */
  showSn: boolean;
};

export type LinesEditorPrefill = { add?: { net: number; vatRate: number | null; name?: string }; removeRow?: number };

const VAT_RATES = [24, 13, 6, 0, 17, 9, 4];
const fmt = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
const eur = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
let seq = 0;
const newKey = () => `new-${++seq}`;

function rowFrom(l: DocLine, i: number): Row {
  const computed = computeNet(l.quantity, l.unitPrice, l.discount);
  return {
    key: `row-${i}`, from: i, removed: false,
    autoNet: computed != null && l.net != null && Math.abs(computed - l.net) < 0.005,
    name: l.name ?? '', code: l.code ?? '', quantity: fmt(l.quantity), unitPrice: fmt(l.unitPrice),
    discount: fmt(l.discount), net: fmt(l.net), vatRate: l.vatRate == null ? '' : String(l.vatRate),
    serials: (l.serials ?? []).join(', '), showSn: (l.serials ?? []).length > 0,
  };
}

function blankRow(prefill?: { net: number; vatRate: number | null; name?: string }): Row {
  return {
    key: newKey(), from: null, removed: false, autoNet: true,
    name: prefill?.name ?? '', code: '', quantity: prefill ? '1' : '', unitPrice: prefill ? fmt(prefill.net) : '',
    discount: '', net: prefill ? fmt(prefill.net) : '', vatRate: prefill?.vatRate == null ? '' : String(prefill.vatRate),
    serials: '', showSn: false,
  };
}

const rowErrors = (r: Row): string[] => {
  if (r.removed) return [];
  const out: string[] = [];
  if (!r.name.trim()) out.push('περιγραφή');
  if (n(r.net) == null) out.push('καθαρή αξία');
  return out;
};

export function LinesEditorDialog({ docId, open, onOpenChange, prefill, lineMatches }: {
  docId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefill?: LinesEditorPrefill | null;
  /** rowIndex → σε τι έχει αντιστοιχιστεί η γραμμή στη SoftOne (για να ξέρει ο χρήστης τι χάνει αν τη σβήσει). */
  lineMatches?: Record<number, string | null>;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [original, setOriginal] = React.useState<DocLine[]>([]);
  const [totals, setTotals] = React.useState<Totals | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [lastPage, setLastPage] = React.useState<number | null>(null);
  const [showPaper, setShowPaper] = React.useState(true);
  const firstNew = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null); setError(null); setPage(0); setLastPage(null);
    (async () => {
      try {
        const r = await fetch(`/api/admin/ocr/${docId}/document`, { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.message ?? `HTTP ${r.status}`);
        if (!alive) return;
        const lines: DocLine[] = d.document?.lines ?? [];
        setOriginal(lines);
        setTotals(d.document?.totals ?? null);
        const base = lines.map(rowFrom);
        if (prefill?.removeRow != null && base[prefill.removeRow]) base[prefill.removeRow].removed = true;
        setRows(prefill?.add ? [...base, blankRow(prefill.add)] : base);
      } catch (e) {
        if (alive) setError(`Οι γραμμές δεν φορτώθηκαν: ${(e as Error).message}`);
      }
    })();
    return () => { alive = false; };
  }, [open, docId, prefill]);

  // Η νέα γραμμή (από «Πρόσθεσε τη γραμμή που λείπει») παίρνει το focus στην περιγραφή.
  React.useEffect(() => { if (rows && prefill?.add) setTimeout(() => firstNew.current?.focus(), 50); }, [rows == null, prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => {
    if (r.key !== key) return r;
    const next = { ...r, ...patch };
    if ('net' in patch) next.autoNet = false;
    if (next.autoNet && ('quantity' in patch || 'unitPrice' in patch || 'discount' in patch)) {
      const c = computeNet(n(next.quantity), n(next.unitPrice), n(next.discount));
      if (c != null) next.net = fmt(c);
    }
    return next;
  }) ?? rs);

  const live = rows?.filter((r) => !r.removed) ?? [];
  const sumLines = round2(live.reduce((t, r) => t + (n(r.net) ?? 0), 0));
  const headerNet = totals?.net ?? null;
  const diff = headerNet == null ? null : round2(headerNet - sumLines);
  const closes = diff != null && Math.abs(diff) <= Math.max(0.02, Math.abs(headerNet ?? 0) * 0.001);

  const ops: LineEditOps = React.useMemo(() => {
    const o: Required<LineEditOps> = { update: [], add: [], remove: [] };
    for (const r of rows ?? []) {
      const values = {
        name: r.name.trim(), code: r.code.trim() || null, unit: null as string | null,
        quantity: n(r.quantity), unitPrice: n(r.unitPrice), discount: n(r.discount), net: n(r.net), vatRate: n(r.vatRate),
        serials: parseSerialsInput(r.serials),
      };
      if (r.from == null) { if (!r.removed) o.add.push(values); continue; }
      if (r.removed) { o.remove.push(r.from); continue; }
      const old = original[r.from];
      const patch: Record<string, unknown> = {};
      if ((old.name ?? '') !== values.name) patch.name = values.name;
      if ((old.code ?? null) !== values.code) patch.code = values.code;
      for (const k of ['quantity', 'unitPrice', 'discount', 'net', 'vatRate'] as const) if ((old[k] ?? null) !== values[k]) patch[k] = values[k];
      if ((old.serials ?? []).join('|') !== values.serials.join('|')) patch.serials = values.serials;
      if (Object.keys(patch).length) o.update.push({ rowIndex: r.from, ...patch });
    }
    return o;
  }, [rows, original]);
  const changes = (ops.update?.length ?? 0) + (ops.add?.length ?? 0) + (ops.remove?.length ?? 0);
  const invalid = (rows ?? []).some((r) => rowErrors(r).length > 0);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/lines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ops) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`);
      toast.success(`Οι γραμμές αποθηκεύτηκαν · ${d.summary}`);
      emitDocLinesChanged(docId);
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  };

  const close = async (o: boolean) => {
    if (o || saving) return;
    if (changes > 0 && !(await confirmAction({ title: 'Κλείσιμο χωρίς αποθήκευση;', message: `Υπάρχουν ${changes} ${changes === 1 ? 'αλλαγή' : 'αλλαγές'} που δεν αποθηκεύτηκαν και θα χαθούν.`, confirmLabel: 'Κλείσιμο χωρίς αποθήκευση' }))) return;
    onOpenChange(false);
  };

  const input = 'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[length:var(--fs-13)] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
  const numCls = cn(input, 'text-right font-mono tabular-nums');

  return (
    <Dialog open={open} onOpenChange={(o) => void close(o)}>
      <DialogContent className="flex h-[min(92dvh,900px)] w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1400px,96vw)]">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiList className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Επεξεργασία γραμμών</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-12)]">
              Διόρθωσε ό,τι διαβάστηκε λάθος, πρόσθεσε ό,τι λείπει, αφαίρεσε ό,τι περισσεύει. Οι γραμμές που μένουν κρατούν την αντιστοίχισή τους στη SoftOne.
            </DialogDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="hidden lg:inline-flex" onClick={() => setShowPaper((v) => !v)} aria-pressed={showPaper}>
            <FiFileText aria-hidden className="mr-1.5 size-3.5" /> {showPaper ? 'Απόκρυψη πρωτοτύπου' : 'Πρωτότυπο'}
          </Button>
        </DialogHeader>

        <div className={cn('grid min-h-0 flex-1 grid-cols-1', showPaper && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
          {/* ΤΟ ΧΑΡΤΙ: για σύγκριση γραμμή-γραμμή, χωρίς να κλείσει το παράθυρο. */}
          {showPaper && (
            <section aria-label="Πρωτότυπο" className="hidden min-h-0 flex-col border-r border-border bg-muted/40 lg:flex">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[length:var(--fs-12)] text-muted-foreground">
                <span>Σελίδα {page + 1}{lastPage != null ? ` από ${lastPage + 1}` : ''}</span>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Προηγούμενη σελίδα"><FiChevronLeft aria-hidden className="size-4" /></Button>
                  <Button type="button" variant="ghost" size="sm" disabled={lastPage != null && page >= lastPage} onClick={() => setPage((p) => p + 1)} aria-label="Επόμενη σελίδα"><FiChevronRight aria-hidden className="size-4" /></Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={page} src={`/api/admin/ocr/${docId}/page-image?page=${page}&scale=2`} alt={`Σελίδα ${page + 1} του πρωτοτύπου`}
                  className="mx-auto w-full max-w-[900px] rounded border border-border bg-white shadow-fluent-2"
                  onError={() => { if (page > 0) { setLastPage(page - 1); setPage(page - 1); } else setLastPage(0); }} />
              </div>
            </section>
          )}

          <section aria-label="Γραμμές" className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
              {!rows && !error && (
                <div className="space-y-2" role="status"><span className="sr-only">Φόρτωση γραμμών…</span>
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}
                </div>
              )}
              {rows && (
                <table className="w-full min-w-[760px] border-separate border-spacing-y-1 text-[length:var(--fs-12)]">
                  <caption className="sr-only">Γραμμές παραστατικού</caption>
                  <thead className="text-left text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-7 px-1">#</th>
                      <th scope="col" className="px-1">Περιγραφή</th>
                      <th scope="col" className="w-[13%] px-1">Κωδικός</th>
                      <th scope="col" className="w-[8%] px-1 text-right">Ποσότητα</th>
                      <th scope="col" className="w-[10%] px-1 text-right">Τιμή</th>
                      <th scope="col" className="w-[7%] px-1 text-right">Έκπτ. %</th>
                      <th scope="col" className="w-[11%] px-1 text-right">Καθαρή αξία</th>
                      <th scope="col" className="w-[8%] px-1 text-right">ΦΠΑ %</th>
                      <th scope="col" className="w-9 px-1"><span className="sr-only">Ενέργεια</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const errs = rowErrors(r);
                      const match = r.from != null ? lineMatches?.[r.from] : null;
                      const label = `Γραμμή ${i + 1}`;
                      return (
                        <React.Fragment key={r.key}>
                          <tr className={cn(r.removed && 'opacity-55', r.from == null && !r.removed && '[&>td]:bg-emerald-50/70 dark:[&>td]:bg-emerald-950/30')}>
                            <td className="rounded-l-md px-1 align-top pt-2 font-mono text-muted-foreground">{i + 1}</td>
                            <td className="px-1 align-top">
                              <input ref={r.from == null && i === rows.length - 1 ? firstNew : undefined} aria-label={`${label}: περιγραφή`} value={r.name} disabled={r.removed}
                                onChange={(e) => set(r.key, { name: e.target.value })} aria-invalid={errs.includes('περιγραφή') || undefined}
                                className={cn(input, r.removed && 'line-through', errs.includes('περιγραφή') && 'border-destructive')} placeholder="Τι αφορά η γραμμή" />
                              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[length:var(--fs-11)] text-muted-foreground">
                                {r.from == null && !r.removed && <span className="font-semibold text-emerald-700 dark:text-emerald-300">Νέα γραμμή</span>}
                                {match && <span>SoftOne: {match}</span>}
                                {r.removed && <span className="font-semibold text-destructive">Θα αφαιρεθεί{match ? ' — μαζί με την αντιστοίχισή της' : ''}</span>}
                                {!r.removed && !r.showSn && (
                                  <button type="button" onClick={() => set(r.key, { showSn: true })} className="inline-flex cursor-pointer items-center gap-0.5 rounded font-medium text-sisyphus-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-sisyphus-300">
                                    <FiHash aria-hidden className="size-3" /> Σειριακοί (S/N)
                                  </button>
                                )}
                              </p>
                              {r.showSn && !r.removed && (() => {
                                const sn = parseSerialsInput(r.serials);
                                const q = n(r.quantity);
                                const off = sn.length > 0 && q != null && Math.abs(q - sn.length) > 1e-6;
                                return (
                                  <div className="mt-1">
                                    <label className="flex items-center gap-1.5">
                                      <span className="shrink-0 text-[length:var(--fs-11)] font-semibold text-muted-foreground"><abbr title="Σειριακοί αριθμοί" className="no-underline">S/N</abbr></span>
                                      <input aria-label={`${label}: σειριακοί αριθμοί`} value={r.serials} onChange={(e) => set(r.key, { serials: e.target.value })}
                                        placeholder="π.χ. DMV24000146, DMV24000147" className={cn(input, 'h-7 font-mono text-[length:var(--fs-12)]', off && 'border-amber-500')} />
                                    </label>
                                    <p className={cn('mt-0.5 text-[length:var(--fs-11)]', off ? 'font-medium text-amber-800 dark:text-amber-200' : 'text-muted-foreground')}>
                                      {sn.length === 0 ? 'Χώρισέ τους με κόμμα ή κενό — ένας ανά τεμάχιο.'
                                        : off ? `${sn.length} σειριακοί για ποσότητα ${fmt(q)} — σε είδος με σειριακούς πρέπει να είναι όσοι και τα τεμάχια.`
                                          : `${sn.length} ${sn.length === 1 ? 'σειριακός' : 'σειριακοί'}`}
                                    </p>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-1 align-top"><input aria-label={`${label}: κωδικός`} value={r.code} disabled={r.removed} onChange={(e) => set(r.key, { code: e.target.value })} className={cn(input, 'font-mono')} /></td>
                            <td className="px-1 align-top"><input aria-label={`${label}: ποσότητα`} inputMode="decimal" value={r.quantity} disabled={r.removed} onChange={(e) => set(r.key, { quantity: e.target.value })} className={numCls} /></td>
                            <td className="px-1 align-top"><input aria-label={`${label}: τιμή μονάδας`} inputMode="decimal" value={r.unitPrice} disabled={r.removed} onChange={(e) => set(r.key, { unitPrice: e.target.value })} className={numCls} /></td>
                            <td className="px-1 align-top"><input aria-label={`${label}: έκπτωση %`} inputMode="decimal" value={r.discount} disabled={r.removed} onChange={(e) => set(r.key, { discount: e.target.value })} className={numCls} /></td>
                            <td className="px-1 align-top">
                              <input aria-label={`${label}: καθαρή αξία`} inputMode="decimal" value={r.net} disabled={r.removed} onChange={(e) => set(r.key, { net: e.target.value })}
                                aria-invalid={errs.includes('καθαρή αξία') || undefined} className={cn(numCls, 'font-semibold', errs.includes('καθαρή αξία') && 'border-destructive')}
                                title={r.autoNet ? 'Υπολογίζεται από ποσότητα × τιμή × έκπτωση — γράψε ποσό για να το ορίσεις εσύ' : undefined} />
                            </td>
                            <td className="px-1 align-top">
                              <select aria-label={`${label}: ΦΠΑ %`} value={r.vatRate} disabled={r.removed} onChange={(e) => set(r.key, { vatRate: e.target.value })} className={cn(numCls, 'pr-1')}>
                                <option value="">—</option>
                                {[...new Set([...VAT_RATES, ...(n(r.vatRate) != null && !VAT_RATES.includes(n(r.vatRate)!) ? [n(r.vatRate)!] : [])])].map((v) => <option key={v} value={String(v)}>{v}%</option>)}
                              </select>
                            </td>
                            <td className="rounded-r-md px-1 align-top">
                              {r.removed ? (
                                <Button type="button" variant="ghost" size="sm" onClick={() => set(r.key, { removed: false })} aria-label={`${label}: επαναφορά`} title="Επαναφορά"><FiRotateCcw aria-hidden className="size-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="sm" onClick={() => (r.from == null ? setRows((rs) => rs?.filter((x) => x.key !== r.key) ?? rs) : set(r.key, { removed: true }))}
                                  aria-label={`${label}: αφαίρεση`} title="Αφαίρεση" className="text-muted-foreground hover:text-destructive"><FiTrash2 aria-hidden className="size-4" /></Button>
                              )}
                            </td>
                          </tr>
                          {errs.length > 0 && !r.removed && (
                            <tr><td /><td colSpan={8} className="px-1 pb-1 text-[length:var(--fs-11)] text-destructive" role="alert">Λείπει: {errs.join(', ')}.</td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {rows && (
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRows((rs) => [...(rs ?? []), blankRow()])}>
                  <FiPlus aria-hidden className="mr-1.5 size-3.5" /> Προσθήκη γραμμής
                </Button>
              )}
            </div>

            {/* ΣΥΜΦΩΝΙΑ ΜΕ ΤΟ ΠΑΡΑΣΤΑΤΙΚΟ — ζωντανά, σε κάθε πληκτρολόγηση. */}
            {rows && (
              <div role="status" aria-live="polite" className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[length:var(--fs-12)]',
                diff == null ? 'border-border bg-muted/30' : closes ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100')}>
                <span>Άθροισμα γραμμών: <strong className="font-mono tabular-nums">{eur(sumLines)}</strong></span>
                {headerNet != null && <span>Καθαρή αξία παραστατικού: <strong className="font-mono tabular-nums">{eur(headerNet)}</strong></span>}
                {diff != null && (closes
                  ? <span className="inline-flex items-center gap-1 font-semibold"><FiCheckCircle aria-hidden className="size-4" /> Οι γραμμές συμφωνούν με το παραστατικό</span>
                  : <span className="inline-flex items-center gap-1 font-semibold"><FiAlertTriangle aria-hidden className="size-4" /> {diff > 0 ? `Λείπουν ${eur(diff)}` : `Περισσεύουν ${eur(-diff)}`}</span>)}
              </div>
            )}
          </section>
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-1.5 border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-[length:var(--fs-12)] text-destructive">
            <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
        <DialogFooter className="m-0 items-center gap-2 border-t border-border bg-card px-4 py-2.5">
          <span className="mr-auto text-[length:var(--fs-12)] text-muted-foreground">{changes ? `${changes} ${changes === 1 ? 'αλλαγή' : 'αλλαγές'}` : 'Καμία αλλαγή ακόμη'}</span>
          <Button type="button" variant="outline" onClick={() => void close(false)} disabled={saving}>Άκυρο</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !changes || invalid}>
            {saving ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" /> : <FiCheckCircle aria-hidden className="mr-1.5 size-3.5" />}
            {saving ? 'Αποθήκευση…' : 'Αποθήκευση γραμμών'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
