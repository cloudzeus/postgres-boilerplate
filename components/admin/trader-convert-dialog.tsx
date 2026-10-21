'use client';

// «Μετατροπή σε προμηθευτή / πιστωτή»: νέα καρτέλα του άλλου τύπου στη SoftOne, με τα στοιχεία της
// τρέχουσας. Ο τύπος μιας καρτέλας ΔΕΝ αλλάζει στη SoftOne (βλ. `lib/trader-convert.ts`), γι' αυτό
// το παράθυρο λέει ρητά τι δημιουργείται, τι αντιγράφεται και τι μένει πίσω — πριν από το κλικ.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiAlertTriangle, FiCheckCircle, FiCopy, FiLink, FiLoader, FiRepeat } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormSection, RowHint, fieldCls } from '@/components/admin/form-kit';
import { useElapsedSeconds, elapsedSuffix } from '@/lib/use-elapsed';
import { cn } from '@/lib/utils';

type Values = Record<string, string | number | null | undefined>;
interface Preview {
  trdr: number; sodtype: number; code: string; values: Values;
  labels: { irsData: string | null; country: string | null };
  route: { to: 'supplier' | 'creditor'; fromLabel: string; toLabel: string; toAcc: string; fromAcc: string };
  existing: { trdr: number; code: string; name: string } | null;
  proposedCode: string | null;
  codeRule: { mask: string | null; known: boolean } | null;
  pendingDocs: number;
}
interface Result {
  trdr: number; code: string; name: string; docsUpdated: number; warnings: string[];
  existing?: boolean; sourceDeactivated: boolean;
}

const ROWS: Array<[string, string]> = [
  ['name', 'Επωνυμία'], ['afm', 'Α.Φ.Μ.'], ['irsData', 'Δ.Ο.Υ.'], ['profession', 'Επάγγελμα'],
  ['address', 'Διεύθυνση'], ['district', 'Περιοχή'], ['zip', 'Τ.Κ.'], ['city', 'Πόλη'], ['country', 'Χώρα'],
  ['phone', 'Τηλέφωνο'], ['phone2', 'Τηλέφωνο 2'], ['fax', 'Fax'], ['email', 'Email'], ['webpage', 'Ιστοσελίδα'],
];

const WARNING_TEXT: Record<string, string> = {
  kad_not_saved: 'Ο ΚΑΔ δεν αποθηκεύτηκε στη νέα καρτέλα — συμπλήρωσέ τον στη SoftOne.',
  source_not_deactivated: 'Η παλιά καρτέλα ΔΕΝ απενεργοποιήθηκε (η SoftOne δεν το κράτησε) — κάν’ το από τη SoftOne αν χρειάζεται.',
  country_not_found: 'Η χώρα δεν μεταφέρθηκε.',
};

export function TraderConvertDialog({ trdr, open, onOpenChange }: { trdr: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [data, setData] = React.useState<Preview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [deactivate, setDeactivate] = React.useState(false);
  const [busy, setBusy] = React.useState<'load' | 'save' | null>('load');
  const [result, setResult] = React.useState<Result | null>(null);
  const savingFor = useElapsedSeconds(busy === 'save');

  const load = React.useCallback(async () => {
    setBusy('load'); setError(null);
    try {
      const r = await fetch(`/api/admin/traders/${trdr}/convert`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) throw new Error(d?.message ?? `HTTP ${r.status}`);
      setData(d); setCode(d.proposedCode ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }, [trdr]);
  React.useEffect(() => { void load(); }, [load]);

  const run = async () => {
    setBusy('save'); setError(null);
    try {
      const r = await fetch(`/api/admin/traders/${trdr}/convert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() || null, deactivateSource: deactivate }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) throw new Error(d?.message ?? `HTTP ${r.status}`);
      setResult(d);
      toast.success(d.existing ? `Συνδέθηκε με τον υπάρχοντα ${data?.route.toAcc} ${d.code}` : `Δημιουργήθηκε ${data?.route.toLabel.toLowerCase()} ${d.code}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  };

  const v = data?.values ?? {};
  const shown = (k: string) => (k === 'irsData' ? data?.labels.irsData : k === 'country' ? data?.labels.country : v[k]);
  const copied = ROWS.filter(([k]) => shown(k) != null && String(shown(k)).trim() !== '');
  const to = data?.route.toAcc ?? 'προμηθευτή';
  const toNom = data?.route.toLabel.toLowerCase() ?? 'προμηθευτής';
  const from = data?.route.fromAcc ?? 'πιστωτή';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (busy !== 'save') onOpenChange(o); }}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 pt-4 pb-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-[length:var(--fs-15)]">
            <FiRepeat aria-hidden className="size-4 text-sisyphus-600" /> Μετατροπή σε {to}
          </DialogTitle>
          <DialogDescription className="text-[length:var(--fs-12)]">
            {data ? <><span className="font-mono">{data.code}</span> — {String(v.name ?? '')} · {data.route.fromLabel}, διαβάστηκε τώρα από τη SoftOne</> : 'Ανάγνωση από τη SoftOne…'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {busy === 'load' && (
            <div className="space-y-2" role="status"><span className="sr-only">Ανάγνωση…</span>
              {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}
            </div>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0">{error}</span>
              {!data && <button type="button" onClick={() => void load()} className="ml-auto cursor-pointer font-semibold underline">Ξανά</button>}
            </p>
          )}

          {result && (
            <FormSection tone="emerald" icon={<FiCheckCircle />} title={result.existing ? `Συνδέθηκε με τον υπάρχοντα ${to}` : `Δημιουργήθηκε ${toNom}`}>
              <ul className="space-y-1 text-[length:var(--fs-12)]">
                <li><span className="font-mono">{result.code}</span> — {result.name} <span className="text-muted-foreground">(TRDR {result.trdr})</span></li>
                <li>{result.docsUpdated ? `Συνδέθηκαν ${result.docsUpdated} εκκρεμή παραστατικά της εφαρμογής.` : 'Κανένα εκκρεμές παραστατικό δεν χρειάστηκε αλλαγή.'}</li>
                {result.sourceDeactivated && <li>Η καρτέλα {from} απενεργοποιήθηκε.</li>}
              </ul>
              {result.warnings.filter((w) => WARNING_TEXT[w]).map((w) => <RowHint key={w} tone="warn">{WARNING_TEXT[w]}</RowHint>)}
            </FormSection>
          )}

          {data && !result && busy !== 'load' && (
            <>
              <RowHint>
                Η SoftOne κρατά <strong>ξεχωριστή καρτέλα ανά τύπο</strong> — ο τύπος μιας καρτέλας δεν αλλάζει. Δημιουργείται
                {' '}<strong>νέα καρτέλα {to}</strong> με τα στοιχεία αυτής· η καρτέλα {from} μένει με το ιστορικό και τα υπόλοιπά της.
              </RowHint>

              {data.existing && (
                <FormSection tone="amber" icon={<FiLink />} title={`Υπάρχει ήδη ${toNom} με αυτόν τον ΑΦΜ`}>
                  <p className="text-[length:var(--fs-12)]"><span className="font-mono">{data.existing.code}</span> — {data.existing.name}</p>
                  <RowHint>Δεν θα δημιουργηθεί δεύτερη καρτέλα: τα εκκρεμή παραστατικά που ζητούν {to} συνδέονται σε αυτήν.</RowHint>
                </FormSection>
              )}

              {!data.existing && (
                <FormSection tone="blue" icon={<FiCopy />} title={`Τι περνά στη νέα καρτέλα ${to}`}>
                  <dl className="grid gap-x-4 gap-y-1 text-[length:var(--fs-12)] sm:grid-cols-[auto_minmax(0,1fr)]">
                    {copied.map(([k, label]) => (
                      <React.Fragment key={k}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className={cn('min-w-0 break-words', (k === 'afm' || k === 'zip' || k.startsWith('phone')) && 'font-mono tabular-nums')}>{String(shown(k))}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  <RowHint>
                    Επίσης ΚΑΔ, καθεστώς ΦΠΑ, τρόπος πληρωμής και νόμισμα. <strong>Όχι</strong> η λογιστική κατηγορία: διαφέρει ανά τύπο
                    καρτέλας — η νέα παίρνει την προεπιλογή της SoftOne.
                  </RowHint>
                  <Field label={`Κωδικός νέου ${to}`} htmlFor="tc-code">
                    <Input id="tc-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={25}
                      className={cn(fieldCls, 'font-mono tabular-nums sm:max-w-56')} placeholder="αυτόματος" />
                  </Field>
                  {data.codeRule?.mask && <RowHint>Μορφή κωδικού στη SoftOne: <span className="font-mono">{data.codeRule.mask}</span></RowHint>}
                </FormSection>
              )}

              <label htmlFor="tc-deactivate" className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
                <Checkbox id="tc-deactivate" checked={deactivate} onCheckedChange={(c) => setDeactivate(c === true)} className="mt-0.5" />
                <span className="min-w-0 text-[length:var(--fs-12)]">
                  <span className="font-medium">Απενεργοποίηση της καρτέλας {from}</span>
                  <span className="block text-muted-foreground">Δεν θα προτείνεται πια για επιλογή. Το ιστορικό και τα υπόλοιπά της μένουν· ξαναενεργοποιείται από τη SoftOne.</span>
                </span>
              </label>

              {data.pendingDocs > 0 && (
                <RowHint>
                  {data.pendingDocs === 1 ? '1 εκκρεμές παραστατικό' : `${data.pendingDocs} εκκρεμή παραστατικά`} της εφαρμογής δείχνουν σε αυτόν τον {from}:
                  {' '}όσα η σειρά τους ζητά {to} θα συνδεθούν αυτόματα με τη νέα καρτέλα. Τα ήδη καταχωρισμένα δεν αλλάζουν.
                </RowHint>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter className="m-0 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy === 'save'}>Κλείσιμο</Button>
          {data && !result && (
            <Button onClick={() => void run()} disabled={busy != null} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {busy === 'save' ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin" /> : data.existing ? <FiLink aria-hidden className="mr-1.5 size-3.5" /> : <FiRepeat aria-hidden className="mr-1.5 size-3.5" />}
              {busy === 'save' ? `Αποθήκευση στη SoftOne…${elapsedSuffix(savingFor)}` : data.existing ? `Σύνδεση με τον υπάρχοντα ${to}` : `Δημιουργία ${to} στη SoftOne`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
