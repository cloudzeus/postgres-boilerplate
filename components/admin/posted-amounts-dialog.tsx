'use client';

// «Διόρθωση ποσών στη SoftOne»: για καταχωρισμένο παραστατικό που η SoftOne κράτησε με άλλο ποσό
// (π.χ. μηδέν). Δείχνει «στη SoftOne τώρα → μετά τη διόρθωση → στο παραστατικό» — η μεσαία στήλη
// είναι ήδη υπολογισμένη ΑΠΟ ΤΗ SoftOne χωρίς αποθήκευση — και ενημερώνει ΤΟ ΙΔΙΟ παραστατικό.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiAlertTriangle, FiArrowRight, FiCheckCircle, FiDollarSign, FiInfo, FiLoader, FiXCircle } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSection, RowHint } from '@/components/admin/form-kit';
import { useElapsedSeconds, elapsedSuffix } from '@/lib/use-elapsed';
import { cn } from '@/lib/utils';

interface Totals { net: number | null; vat: number | null; total: number | null }
interface Check {
  ref: string; status: 'ok' | 'mismatch'; saved: Totals; expected: Totals; preview: Totals | null;
  fixable: boolean; reason: string | null; vatWarning: string | null;
  lines: { linenum: number; mtrl: number; comment: string | null; saved: number | null; expected: number }[];
}

const eur = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
/** Ίδιο ποσό, με ανοχή στρογγυλοποίησης ΦΠΑ ανά γραμμή (λίγα λεπτά ανά γραμμή). */
const same = (a: number | null | undefined, b: number | null | undefined, lines = 1) => a != null && b != null && Math.abs(a - b) <= Math.max(0.1, 0.02 * lines);

export function PostedAmountsDialog({ docId, canFix, onClose }: { docId: string; canFix: boolean; onClose: () => void }) {
  const router = useRouter();
  const [check, setCheck] = React.useState<Check | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState<'load' | 'fix' | null>('load');
  const [done, setDone] = React.useState<Totals | null>(null);
  const secs = useElapsedSeconds(busy != null);

  const load = React.useCallback(async () => {
    setBusy('load'); setError(null);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/posted-amounts`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) throw new Error(d?.message ?? `HTTP ${r.status}`);
      setCheck(d);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }, [docId]);
  React.useEffect(() => { void load(); }, [load]);

  const fix = async () => {
    setBusy('fix'); setError(null);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/posted-amounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledgeVat: ack }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`);
      setDone(d.after);
      toast.success(`Τα ποσά διορθώθηκαν στη SoftOne · FINDOC ${check?.ref}`);
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const rows: Array<[string, keyof Totals]> = [['Καθαρή αξία', 'net'], ['ΦΠΑ', 'vat'], ['Σύνολο', 'total']];

  return (
    <Dialog open onOpenChange={(o) => { if (!o && busy !== 'fix') onClose(); }}>
      <DialogContent className="flex max-h-[92dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600"><FiDollarSign className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Ποσά στη SoftOne</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-12)]">
              {check ? <>Καταχωρισμένο παραστατικό <span className="font-mono">FINDOC {check.ref}</span> — σύγκριση με το χαρτί, διαβασμένη τώρα από τη SoftOne.</> : 'Ανάγνωση από τη SoftOne…'}
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {busy === 'load' && (
            <p role="status" className="flex items-center gap-2 text-[length:var(--fs-12)] text-muted-foreground">
              <FiLoader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Διαβάζω το παραστατικό και υπολογίζω τη διόρθωση στη SoftOne (χωρίς αποθήκευση)…{elapsedSuffix(secs)}
            </p>
          )}

          {check && !done && (
            <>
              {check.status === 'ok' ? (
                <FormSection tone="emerald" icon={<FiCheckCircle />} title="Τα ποσά στη SoftOne συμφωνούν με το παραστατικό">
                  <RowHint>Δεν χρειάζεται καμία διόρθωση.</RowHint>
                </FormSection>
              ) : (
                <FormSection tone="amber" icon={<FiAlertTriangle />} title="Η SoftOne κράτησε άλλο ποσό από αυτό του παραστατικού">
                  <table className="w-full text-[length:var(--fs-12)]">
                    <caption className="sr-only">Ποσά: στη SoftOne, μετά τη διόρθωση, στο παραστατικό</caption>
                    <thead className="text-left text-[length:var(--fs-11)] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-1 pr-2 font-semibold"><span className="sr-only">Ποσό</span></th>
                        <th scope="col" className="py-1 pr-2 text-right font-semibold">Στη SoftOne τώρα</th>
                        <th scope="col" className="w-5" />
                        <th scope="col" className="py-1 pr-2 text-right font-semibold">Μετά τη διόρθωση</th>
                        <th scope="col" className="py-1 text-right font-semibold">Στο παραστατικό</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(([label, k]) => (
                        <tr key={k} className="border-t border-border/60">
                          <th scope="row" className="py-1 pr-2 text-left font-medium text-muted-foreground">{label}</th>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums text-destructive">{eur(check.saved[k])}</td>
                          <td aria-hidden className="text-muted-foreground"><FiArrowRight className="size-3" /></td>
                          <td className={cn('py-1 pr-2 text-right font-mono font-semibold tabular-nums', check.preview && (same(check.preview[k], check.expected[k], check.lines.length) ? 'text-emerald-700' : 'text-amber-800'))}>{eur(check.preview?.[k])}</td>
                          <td className="py-1 text-right font-mono tabular-nums">{eur(check.expected[k])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {check.lines.length > 0 && (
                    <details className="mt-1 text-[length:var(--fs-12)]">
                      <summary className="cursor-pointer font-semibold text-sisyphus-700">Οι {check.lines.length} γραμμές</summary>
                      <ul className="mt-1 space-y-0.5">
                        {check.lines.map((l) => (
                          <li key={l.linenum} className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-0.5">
                            <span className="min-w-0 truncate">{l.linenum}. {l.comment ?? `χρεοπίστωση ${l.mtrl}`}</span>
                            <span className="shrink-0 font-mono tabular-nums"><span className="text-destructive">{eur(l.saved)}</span> → <strong>{eur(l.expected)}</strong></span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </FormSection>
              )}

              {check.status === 'mismatch' && check.fixable && (
                <p className="flex items-start gap-2 rounded-md border border-sisyphus-200 bg-sisyphus-50 px-3 py-2 text-[length:var(--fs-12)] text-sisyphus-900">
                  <FiInfo aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>Ενημερώνεται <strong>το ίδιο παραστατικό</strong> (FINDOC {check.ref}) — δεν δημιουργείται νέο. Αλλάζει μόνο η «Αξία» κάθε γραμμής· αριθμός, ημερομηνία, πιστωτής και γραμμές μένουν ίδια. Η στήλη «Μετά τη διόρθωση» υπολογίστηκε ήδη από τη SoftOne. Αν το παραστατικό είχε ήδη περάσει στη λογιστική, έλεγξε μετά και το λογιστικό άρθρο του.</span>
                </p>
              )}

              {check.status === 'mismatch' && !check.fixable && check.reason && (
                <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-950">
                  <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {check.reason}
                </p>
              )}

              {check.fixable && check.vatWarning && (
                <label htmlFor="pa-ack" className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[length:var(--fs-12)] text-amber-950">
                  <Checkbox id="pa-ack" checked={ack} onCheckedChange={(c) => setAck(c === true)} className="mt-0.5" />
                  <span><strong>Διαφορά ΦΠΑ.</strong> {check.vatWarning} <span className="block pt-0.5 font-semibold">Το κατάλαβα — διόρθωσε την καθαρή αξία.</span></span>
                </label>
              )}
            </>
          )}

          {done && (
            <FormSection tone="emerald" icon={<FiCheckCircle />} title="Διορθώθηκε και επαληθεύτηκε στη SoftOne">
              <p className="font-mono text-[length:var(--fs-12)] tabular-nums">Καθαρή {eur(done.net)} · ΦΠΑ {eur(done.vat)} · Σύνολο {eur(done.total)}</p>
              <RowHint>Η νέα ανάγνωση από τη SoftOne επιβεβαιώνει την καθαρή αξία. Η αλλαγή φαίνεται στο «Ιστορικό αλλαγών».</RowHint>
            </FormSection>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-12)] text-destructive">
              <FiXCircle aria-hidden className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0">{error}</span>
              {!check && <button type="button" onClick={() => void load()} className="ml-auto cursor-pointer font-semibold underline">Ξανά</button>}
            </p>
          )}
        </DialogBody>

        <DialogFooter className="m-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy === 'fix'}>Κλείσιμο</Button>
          {check?.status === 'mismatch' && check.fixable && !done && (
            <Button type="button" onClick={() => void fix()} disabled={!canFix || busy != null || (!!check.vatWarning && !ack)}
              title={canFix ? undefined : 'Χρειάζεται δικαίωμα καταχώρισης'} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {busy === 'fix' ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" /> : <FiCheckCircle aria-hidden className="mr-1.5 size-3.5" />}
              {busy === 'fix' ? `Διόρθωση στη SoftOne…${elapsedSuffix(secs)}` : 'Διόρθωση στη SoftOne'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
