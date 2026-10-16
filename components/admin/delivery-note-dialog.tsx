'use client';

// «Από δελτίο αποστολής»: το τιμολόγιο που ήρθε ΜΕΤΑ το δελτίο, σύγκριση γραμμή-γραμμή με τα ανοιχτά
// δελτία του προμηθευτή, και μετασχηματισμός σε τιμολόγιο αγοράς (βλ. lib/ocr/delivery-note-convert.ts).
//
// Τρία βήματα στο ίδιο παράθυρο: 1) ποια δελτία (προεπιλεγμένο όποιο αναφέρει το τιμολόγιο),
// 2) ο πίνακας σύγκρισης με χρώμα ανά γραμμή, 3) το κουμπί — ενεργό ΜΟΝΟ όταν όλα είναι πράσινα
// (ή ο χρήστης αποδέχτηκε ρητά τον μερικό μετασχηματισμό).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  FiAlertTriangle, FiArrowRight, FiCheckCircle, FiFileText, FiLoader, FiRefreshCw, FiTruck, FiXCircle,
} from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSection } from '@/components/admin/form-kit';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

type Status = 'match' | 'partial' | 'blocked';
type LineStatus = 'covered' | 'not_stock' | 'unmatched' | 'not_in_note' | 'excess' | 'split_discount';
interface Candidate { findoc: number; fincode: string | null; series: number; date: string | null; transformed: number; total: number | null; score: number; lineCount: number }
interface Compare {
  status: Status;
  target: { series: number; label: string } | null;
  lines: { rowIndex: number; name: string | null; qty1: number; status: LineStatus; text: string; links: { findoc: number; fincode: string | null; mtrlines: number; qty1: number }[] }[];
  leftovers: { findoc: number; fincode: string | null; mtrlines: number; code: string | null; name: string | null; open1: number; left1: number }[];
  problems: string[];
}
interface Overview { candidates: Candidate[]; suggested: number[]; compare: Compare | null; referencedNote: string | null }

const qty = (n: number) => n.toLocaleString('el-GR', { maximumFractionDigits: 4 });
const money = (n: number | null) => (n == null ? '—' : n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' }));
const dateOf = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');

const LINE_TONE: Record<LineStatus, { cls: string; icon: React.ReactNode }> = {
  covered: { cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300', icon: <FiCheckCircle aria-hidden className="size-3.5" /> },
  not_stock: { cls: 'bg-muted text-muted-foreground', icon: <FiFileText aria-hidden className="size-3.5" /> },
  unmatched: { cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300', icon: <FiXCircle aria-hidden className="size-3.5" /> },
  not_in_note: { cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300', icon: <FiXCircle aria-hidden className="size-3.5" /> },
  excess: { cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300', icon: <FiXCircle aria-hidden className="size-3.5" /> },
  split_discount: { cls: 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300', icon: <FiAlertTriangle aria-hidden className="size-3.5" /> },
};

export function DeliveryNoteDialog({ docId, open, onOpenChange, onDone }: { docId: string; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const router = useRouter();
  const [data, setData] = React.useState<Overview | null>(null);
  const [selected, setSelected] = React.useState<number[]>([]);
  const [cmp, setCmp] = React.useState<Compare | null>(null);
  const [busy, setBusy] = React.useState<'load' | 'compare' | 'convert' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [acceptPartial, setAcceptPartial] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy('load'); setError(null); setCmp(null); setAcceptPartial(false);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/delivery-note`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.message ?? 'Τα δελτία δεν διαβάστηκαν από τη SoftOne.'); return; }
      setData(d); setSelected(d.suggested ?? []); setCmp(d.compare ?? null);
    } catch { setError('Σφάλμα δικτύου.'); } finally { setBusy(null); }
  }, [docId]);
  React.useEffect(() => { if (open) void load(); }, [open, load]);

  const compare = async (findocs: number[]) => {
    setSelected(findocs); setAcceptPartial(false);
    if (!findocs.length) { setCmp(null); return; }
    setBusy('compare');
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/delivery-note`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'compare', findocs }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { toast.error(d?.message ?? 'Η σύγκριση απέτυχε.'); return; }
      setCmp(d);
    } catch { toast.error('Σφάλμα δικτύου.'); } finally { setBusy(null); }
  };

  const convert = async () => {
    if (!cmp?.target) return;
    const codes = data?.candidates.filter((c) => selected.includes(c.findoc)).map((c) => c.fincode ?? c.findoc).join(', ');
    const ok = await confirmAction({
      title: 'Μετασχηματισμός σε τιμολόγιο',
      message: `Θα δημιουργηθεί «${cmp.target.label}» στη SoftOne από ${selected.length === 1 ? 'το δελτίο' : 'τα δελτία'} ${codes}.`
        + (cmp.status === 'partial' ? '\nΤα δελτία θα μείνουν ανοιχτά για ό,τι δεν τιμολογείται τώρα.' : '\nΤα δελτία θα κλείσουν.'),
      confirmLabel: 'Μετασχηματισμός',
    });
    if (!ok) return;
    setBusy('convert');
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/delivery-note`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert', findocs: selected, acceptPartial }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { toast.error(d?.message ?? 'Ο μετασχηματισμός απέτυχε.'); return; }
      if (d.warning) toast.warning(d.warning, { duration: 12000 }); else toast.success(`Δημιουργήθηκε τιμολόγιο · FINDOC ${d.ref}`);
      onOpenChange(false); onDone?.(); router.refresh();
    } catch { toast.error('Σφάλμα δικτύου — ΜΗΝ ξαναπατήσεις πριν ελέγξεις στη SoftOne.'); } finally { setBusy(null); }
  };

  const toggle = (f: number) => void compare(selected.includes(f) ? selected.filter((x) => x !== f) : [...selected, f]);
  const canConvert = !!cmp && !!cmp.target && busy == null && (cmp.status === 'match' || (cmp.status === 'partial' && acceptPartial));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 pt-4 pb-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-[length:var(--fs-15)]">
            <FiTruck aria-hidden className="size-4 text-sisyphus-600" /> Από δελτίο αποστολής
          </DialogTitle>
          <DialogDescription className="text-[length:var(--fs-12)]">
            Σύγκριση του τιμολογίου με τα ανοιχτά δελτία του προμηθευτή και μετασχηματισμός σε τιμολόγιο αγοράς.
            {data?.referencedNote && <> Το τιμολόγιο αναφέρει δελτίο <strong className="text-foreground">«{data.referencedNote}»</strong>.</>}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">

        {busy === 'load' && <div className="space-y-2" role="status"><span className="sr-only">Ανάγνωση από τη SoftOne…</span>{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}</div>}
        {error && (
          <p role="alert" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
            <button type="button" onClick={() => void load()} className="ml-auto cursor-pointer font-semibold underline">Ξανά</button>
          </p>
        )}

        {data && busy !== 'load' && (
          <div className="space-y-3">
            <FormSection
              tone="blue" icon={<FiTruck />} title="Ανοιχτά δελτία του προμηθευτή"
              aside={<button type="button" onClick={() => void load()} className="inline-flex cursor-pointer items-center gap-1 hover:underline"><FiRefreshCw aria-hidden className="size-3" /> Ανανέωση</button>}
            >
              {data.candidates.length === 0 ? (
                <p className="text-[length:var(--fs-12)] text-muted-foreground">Δεν βρέθηκε ανοιχτό δελτίο αποστολής αυτού του προμηθευτή (μέχρι την ημερομηνία του τιμολογίου).</p>
              ) : (
                <ul className="-mx-1 divide-y divide-border">
                  {data.candidates.map((c) => {
                    const on = selected.includes(c.findoc);
                    return (
                      <li key={c.findoc}>
                        <label className={cn('flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 hover:bg-muted/60', on && 'bg-sisyphus-50/60 dark:bg-sisyphus-500/10')}>
                          <input type="checkbox" checked={on} onChange={() => toggle(c.findoc)} disabled={busy != null} className="size-4 cursor-pointer accent-sisyphus-600" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--fs-13)]">
                              <strong className="font-semibold">{c.fincode ?? `FINDOC ${c.findoc}`}</strong>
                              <span className="text-muted-foreground">{dateOf(c.date)}</span>
                              {c.score === 2 && <span className="rounded-full bg-emerald-100 px-1.5 text-[length:var(--fs-11)] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">αναφέρεται στο τιμολόγιο</span>}
                              {c.transformed === 2 && <span className="rounded-full bg-amber-100 px-1.5 text-[length:var(--fs-11)] font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">μερικώς τιμολογημένο</span>}
                            </span>
                            <span className="text-[length:var(--fs-11)] text-muted-foreground">{c.lineCount} γραμμές · σειρά {c.series}{c.total ? ` · ${money(c.total)}` : ''}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </FormSection>

            {busy === 'compare' && <p role="status" className="flex items-center gap-1.5 text-[length:var(--fs-12)] text-muted-foreground"><FiLoader aria-hidden className="size-3.5 animate-spin" /> Σύγκριση με τη SoftOne…</p>}

            {cmp && busy !== 'compare' && (
              <FormSection
                tone={cmp.status === 'match' ? 'emerald' : cmp.status === 'partial' ? 'amber' : 'slate'}
                icon={cmp.status === 'blocked' ? <FiXCircle /> : <FiCheckCircle />}
                title={cmp.status === 'match' ? 'Συμφωνεί πλήρως' : cmp.status === 'partial' ? 'Συμφωνεί — τα δελτία αφήνουν υπόλοιπο' : 'Δεν συμφωνεί'}
              >
                <div className="-mx-3 overflow-x-auto">
                  <table className="w-full text-[length:var(--fs-12)]">
                    <thead className="bg-muted/50 text-[length:var(--fs-11)] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Γραμμή τιμολογίου</th>
                        <th className="px-2 py-1.5 text-right font-medium">Ποσότητα</th>
                        <th className="px-2 py-1.5 text-left font-medium">Από δελτίο</th>
                        <th className="px-3 py-1.5 text-left font-medium">Κατάσταση</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {cmp.lines.map((l) => (
                        <tr key={l.rowIndex}>
                          <td className="max-w-[16rem] px-3 py-1.5"><span className="line-clamp-2">{l.name ?? `Γραμμή ${l.rowIndex + 1}`}</span></td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{l.status === 'not_stock' ? '—' : qty(l.qty1)}</td>
                          <td className="px-2 py-1.5 text-[length:var(--fs-11)] tabular-nums text-muted-foreground">
                            {l.links.length ? l.links.map((s) => `${s.fincode ?? s.findoc} #${s.mtrlines} · ${qty(s.qty1)}`).join(' + ') : '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[length:var(--fs-11)] font-medium', LINE_TONE[l.status].cls)}>
                              {LINE_TONE[l.status].icon} {l.text}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[length:var(--fs-11)] text-muted-foreground">Ποσότητες σε βασική μονάδα του είδους (π.χ. 2 κιβώτια των 100 = 200 τεμάχια).</p>

                {cmp.leftovers.length > 0 && (
                  <div className="rounded-md bg-amber-50 px-2.5 py-2 text-[length:var(--fs-12)] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                    <p className="font-semibold">Θα μείνουν ανοιχτά στο δελτίο:</p>
                    <ul className="mt-0.5 list-disc pl-5">
                      {cmp.leftovers.map((r) => (
                        <li key={`${r.findoc}-${r.mtrlines}`}>
                          {r.fincode ?? r.findoc} #{r.mtrlines} — {r.code ? <span className="font-mono">{r.code}</span> : null} {r.name ?? ''}: <strong className="tabular-nums">{qty(r.left1)}</strong> από {qty(r.open1)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {cmp.problems.length > 0 && (
                  <ul role="alert" className="space-y-1 rounded-md bg-red-50 px-2.5 py-2 text-[length:var(--fs-12)] text-red-800 dark:bg-red-500/10 dark:text-red-300">
                    {cmp.problems.map((p) => <li key={p} className="flex gap-1.5"><FiXCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" /> {p}</li>)}
                  </ul>
                )}

                {cmp.target && (
                  <p className="flex flex-wrap items-center gap-1.5 text-[length:var(--fs-12)]">
                    <span className="text-muted-foreground">Θα δημιουργηθεί</span>
                    <FiArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                    <strong>{cmp.target.label}</strong>
                    <span className="text-muted-foreground">— χωρίς νέα κίνηση ποσότητας (τη μετέφερε ήδη το δελτίο).</span>
                  </p>
                )}
                {cmp.status === 'partial' && (
                  <label className="flex cursor-pointer items-start gap-2 text-[length:var(--fs-12)]">
                    <input type="checkbox" checked={acceptPartial} onChange={(e) => setAcceptPartial(e.target.checked)} className="mt-0.5 size-4 cursor-pointer accent-amber-600" />
                    Αποδέχομαι μερικό μετασχηματισμό — το υπόλοιπο μένει ανοιχτό στο δελτίο για επόμενο τιμολόγιο.
                  </label>
                )}
              </FormSection>
            )}
          </div>
        )}

        </DialogBody>

        <DialogFooter className="m-0 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy === 'convert'}>Κλείσιμο</Button>
          <Button onClick={() => void convert()} disabled={!canConvert} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {busy === 'convert' ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin" /> : <FiTruck aria-hidden className="mr-1.5 size-3.5" />}
            {busy === 'convert' ? 'Μετασχηματισμός…' : 'Μετασχηματισμός σε τιμολόγιο'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
