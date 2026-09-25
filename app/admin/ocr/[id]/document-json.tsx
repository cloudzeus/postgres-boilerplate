'use client';

// Η κάρτα «JSON εγγράφου» στη σελίδα ενός εγγράφου (plan 5, §17.1): το κανονικό JSON όπως θα το
// διαβάσει το Excel και το SoftOne, και δίπλα του η ΠΡΟΕΠΙΣΚΟΠΗΣΗ της καταχώρισης — τι payload θα
// σταλεί και τι το εμποδίζει. Η προεπισκόπηση δεν αγγίζει ποτέ το SoftOne (dry-run στον server).

import * as React from 'react';
import Link from 'next/link';
import { FiAlertTriangle, FiCheckCircle, FiChevronDown, FiChevronRight, FiCode, FiCopy, FiDownload, FiHelpCircle, FiRefreshCw, FiUploadCloud } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useDocLinesChanged } from '@/components/admin/doc-lines-events';
import type { DocumentEnvelope } from '@/lib/ocr/canonical';
import type { AccountCheck } from '@/lib/ocr/account-check';
import { AccountLine } from '@/components/admin/account-line';

type PurdocHeader = Record<string, string | number>;
type PurdocLine = Record<string, string | number>;
type PayloadData = {
  PURDOC?: PurdocHeader[]; LINSUPDOC?: PurdocHeader[]; LINCREDOC?: PurdocHeader[]; LINDEBDOC?: PurdocHeader[];
  ITELINES?: PurdocLine[]; SRVLINES?: PurdocLine[];
  EXPANAL?: PurdocLine[]; LINLINES?: PurdocLine[];
};
type Preview = {
  enabled: boolean;
  blockers: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  /** Πού πάει: SoftOne object + πίνακας γραμμών, με ελληνική περιγραφή και το «γιατί». */
  target: { object: string; lines: string; source: 'configured' | 'default'; supported: boolean; reason: string; label: string };
  payload: { OBJECT: string; KEY: string; DATA: PayloadData };
  /** Ο έλεγχος λογαριασμού γενικής ανά γραμμή (παλιός server χωρίς αυτό → δεν δείχνεται). */
  accounts?: AccountCheck;
  summary: {
    series: string | null; trader: string | null; trdr: number | null; date: string | null;
    lines: number;
    reference: { fincode: string | null; taxSeries: string | null; taxSeriesNum: string | null };
  };
  postStatus: string;
  postedRef: string | null;
};

/** Η wiki σελίδα της κάρτας — σταθερή διαδρομή, όπως το `helpAnchors: [document-json]` του MDX. */
const HELP_HREF = '/wiki/ocr/document-json';

const KIND_LABEL: Record<string, string> = { invoice: 'Τιμολόγιο', receipt: 'Απόδειξη', general: 'Κείμενο' };

const money = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? '#047857' : tone === 'warn' ? '#B45309' : undefined;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[length:var(--fs-11)]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium" style={color ? { color } : undefined}>{value}</span>
    </span>
  );
}

/** Ένα `<pre>` με JSON που δεν σπάει τη σελίδα: κυλάει μόνο του, οριζόντια και κάθετα. */
function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <pre aria-label={label} tabIndex={0}
      className="mt-2 max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[length:var(--fs-11)] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Disclosure({ open, onToggle, children, label }: { open: boolean; onToggle: () => void; children: React.ReactNode; label: string }) {
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 text-[length:var(--fs-12)] font-medium text-muted-foreground hover:text-foreground">
        {open ? <FiChevronDown className="size-3.5" /> : <FiChevronRight className="size-3.5" />} {label}
      </button>
      {open && children}
    </div>
  );
}

export function DocumentJsonCard({ docId, canPost }: { docId: string; canPost: boolean }) {
  const [envelope, setEnvelope] = React.useState<DocumentEnvelope | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [jsonOpen, setJsonOpen] = React.useState(false);
  const [payloadOpen, setPayloadOpen] = React.useState(false);
  const [posting, setPosting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/document`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Το JSON δεν φορτώθηκε (${res.status})`);
      setEnvelope(await res.json());
      // Η προεπισκόπηση είναι προαιρετική: χωρίς δικαίωμα ανάρτησης (ή σε σφάλμα) η κάρτα
      // εξακολουθεί να δείχνει το JSON — δεν χάνεται το κύριο περιεχόμενο για το δευτερεύον.
      if (canPost) {
        const p = await fetch(`/api/admin/ocr/${docId}/post-softone?dryRun=1`, { cache: 'no-store' });
        setPreview(p.ok ? await p.json() : null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [docId, canPost]);

  React.useEffect(() => { void load(); }, [load]);
  // Ο χρήστης μόλις αντιστοίχισε γραμμή: τα εμπόδια («γραμμές χωρίς αντιστοίχιση») πρέπει
  // να ξαναμετρηθούν ΕΔΩ, αλλιώς η σελίδα λέει ότι δεν μπορεί να καταχωρίσει για κάτι που
  // μόλις λύθηκε — και το μαθαίνει μόνο με reload.
  useDocLinesChanged(docId, () => { void load(); });

  const copy = React.useCallback(async () => {
    if (!envelope) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(envelope, null, 2));
      toast.success('Το JSON αντιγράφηκε');
    } catch {
      toast.error('Η αντιγραφή δεν επιτράπηκε από τον browser');
    }
  }, [envelope]);

  const doPost = React.useCallback(async () => {
    setPosting(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/post-softone`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? body.error ?? `Σφάλμα ${res.status}`);
      toast.success(`Καταχωρίστηκε στο SoftOne (${body.ref})`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  }, [docId, load]);

  const d = envelope?.document ?? null;
  const lines = preview?.payload.DATA;
  const payloadRows: { kind: string; row: PurdocLine }[] = React.useMemo(() => [
    ...(lines?.ITELINES ?? []).map((row) => ({ kind: 'Είδος', row })),
    ...(lines?.SRVLINES ?? []).map((row) => ({ kind: 'Υπηρεσία', row })),
    ...(lines?.EXPANAL ?? []).map((row) => ({ kind: 'Έξοδο', row })),
    ...(lines?.LINLINES ?? []).map((row) => ({ kind: 'Χρεοπίστωση', row })),
  ], [lines]);
  const blocked = (preview?.blockers.length ?? 0) > 0;
  // Ήδη καταχωρισμένο: το κουμπί κλειδώνει. Ο server το απορρίπτει ούτως ή άλλως (`already_posted`),
  // αλλά ένα ενεργό «Καταχώριση» πάνω σε καταχωρισμένο παραστατικό είναι από μόνο του λάθος μήνυμα.
  const posted = preview?.postStatus === 'POSTED';

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="document-json">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <FiCode className="size-4 text-muted-foreground" aria-hidden /> JSON εγγράφου
          <Link href={HELP_HREF} target="_blank" aria-label="Βοήθεια: JSON εγγράφου" title="Βοήθεια: JSON εγγράφου"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <FiHelpCircle className="size-3.5" />
          </Link>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={!envelope}>
            <FiCopy /> Αντιγραφή
          </Button>
          <a href={`/api/admin/ocr/${docId}/document?download=1`} download
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-input bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted">
            <FiDownload className="size-3.5" /> Λήψη
          </a>
        </div>
      </div>

      {loading && <div role="status" aria-live="polite" className="h-16 animate-pulse rounded-lg bg-muted/50" aria-label="Φόρτωση JSON…" />}

      {!loading && error && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-[length:var(--fs-12)]" style={{ borderColor: '#B91C1C40', backgroundColor: '#FDE8E8', color: '#B91C1C' }}>
          <FiAlertTriangle className="size-4" aria-hidden /> {error}
          <Button size="xs" variant="outline" onClick={() => void load()}><FiRefreshCw /> Δοκιμή ξανά</Button>
        </div>
      )}

      {!loading && d && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip label="Είδος" value={KIND_LABEL[d.kind] ?? d.kind} />
            {d.type.label && <Chip label="Τύπος" value={d.type.label} />}
            <Chip label="Αριθμός" value={[d.type.series, d.type.number].filter(Boolean).join(' ') || '—'} />
            <Chip label="Ημερομηνία" value={d.date ?? '—'} />
            <Chip label="Εκδότης" value={d.issuer.name ?? '—'} />
            <Chip label="ΑΦΜ" value={d.issuer.vat ?? '—'} />
            <Chip label="Σύνολο" value={`${money(d.totals.total)} ${d.currency}`} />
            <Chip label="ΜΑΡΚ" value={d.digital.mark ?? 'χωρίς'} tone={d.digital.mark ? 'ok' : undefined} />
            <Chip label="Γραμμές" value={String(d.lines.length)} />
          </div>

          <Disclosure open={jsonOpen} onToggle={() => setJsonOpen((o) => !o)} label={`Πλήρες JSON (v${envelope?.version})`}>
            <JsonBlock value={envelope} label="Κανονικό JSON εγγράφου" />
          </Disclosure>
        </>
      )}

      {!loading && canPost && preview && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[length:var(--fs-13)] font-semibold">Καταχώριση στο SoftOne</h3>
            {posted ? (
              <span className="inline-flex items-center gap-1.5 text-[length:var(--fs-12)] font-medium" style={{ color: '#047857' }}>
                <FiCheckCircle className="size-3.5" aria-hidden />
                Καταχωρίστηκε{preview.postedRef ? ` · ${preview.postedRef}` : ''}
              </span>
            ) : (
              <Button size="sm" variant="secondary" onClick={doPost} disabled={posting || blocked || !preview.enabled}
                title={!preview.enabled ? 'Απενεργοποιημένη στις Ρυθμίσεις' : blocked ? 'Υπάρχουν εκκρεμότητες' : 'Αποστολή στο SoftOne'}>
                <FiUploadCloud /> {posting ? 'Καταχώριση…' : 'Καταχώριση'}
              </Button>
            )}
          </div>

          {!preview.enabled && !posted && (
            <p className="text-[length:var(--fs-12)] text-muted-foreground">
              Η καταχώριση είναι απενεργοποιημένη — αυτό που βλέπετε είναι μόνο προεπισκόπηση
              (Ρυθμίσεις → Διασυνδέσεις → «Καταχώριση παραστατικών στο SoftOne»).
            </p>
          )}

          {posted ? null : blocked ? (
            <div className="rounded-lg border p-2.5 text-[length:var(--fs-12)]" style={{ borderColor: '#B4530940', backgroundColor: '#FDF3E3', color: '#B45309' }}>
              <p className="font-semibold">Εκκρεμότητες πριν την καταχώριση</p>
              <ul className="mt-1 space-y-0.5">
                {preview.blockers.map((b, i) => (
                  <li key={`${b.code}-${i}`} className="flex items-start gap-1.5">
                    <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {b.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[length:var(--fs-12)]" style={{ color: '#047857' }}>
              <FiCheckCircle className="size-3.5" aria-hidden /> Το παραστατικό είναι έτοιμο για καταχώριση.
            </p>
          )}

          {/* Πού πάει: το πρώτο πράγμα που θέλει να δει ο χρήστης πριν σταλεί οτιδήποτε. */}
          <div className="rounded-lg border p-2.5 text-[length:var(--fs-12)]"
            style={preview.target.supported ? { borderColor: 'var(--border)', backgroundColor: 'color-mix(in srgb, var(--muted) 40%, transparent)' } : { borderColor: '#B4530940', backgroundColor: '#FDF3E3', color: '#B45309' }}>
            <p className="font-semibold">Προορισμός: {preview.target.label}</p>
            <p className="mt-0.5 text-muted-foreground">
              {preview.target.source === 'default' ? 'Προεπιλογή ενότητας' : 'Ρύθμιση σειράς'} · {preview.target.reason}
              {' · '}
              <Link href="/admin/doc-series" className="underline hover:text-foreground">Αλλαγή στις σειρές παραστατικών</Link>
            </p>
          </div>

          {preview.warnings.length > 0 && !posted && (
            <div className="rounded-lg border p-2.5 text-[length:var(--fs-12)]" style={{ borderColor: '#B4530930', backgroundColor: '#FFFBF3', color: '#92400E' }}>
              <p className="font-semibold">Παρατηρήσεις (δεν εμποδίζουν)</p>
              <ul className="mt-1 space-y-0.5">
                {preview.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} className="flex items-start gap-1.5">
                    <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[length:var(--fs-12)] sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Σειρά καταχώρισης</dt><dd className="font-medium">{preview.summary.series ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Προμηθευτής</dt><dd className="font-medium">{preview.summary.trader ?? '—'}{preview.summary.trdr ? ` (${preview.summary.trdr})` : ''}</dd></div>
            <div><dt className="text-muted-foreground">Ημερομηνία</dt><dd className="font-medium">{preview.summary.date ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Γραμμές</dt><dd className="font-medium">{preview.summary.lines}</dd></div>
          </dl>

          {/* Η αναφορά του εκδότη ΑΝΑ ΠΕΔΙΟ: ο σαρωμένος αριθμός δεν πάει σε ένα πεδίο, πάει σε τρία. */}
          <div className="rounded-lg border border-border p-2.5">
            <p className="text-[length:var(--fs-12)] font-semibold">Αριθμός παραστατικού του προμηθευτή — πού γράφεται</p>
            <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-[length:var(--fs-12)] sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Παραστατικό <code className="text-[length:var(--fs-10)]">FINCODE</code></dt>
                <dd className="font-medium">{preview.summary.reference.fincode ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Φορ/κή σειρά <code className="text-[length:var(--fs-10)]">TAXSERIES</code></dt>
                <dd className="font-medium">{preview.summary.reference.taxSeries ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Φορ/κός αριθμός <code className="text-[length:var(--fs-10)]">TAXSERIESNUM</code></dt>
                <dd className="font-medium">{preview.summary.reference.taxSeriesNum ?? '—'}</dd>
              </div>
            </dl>
            <p className="mt-1.5 text-[length:var(--fs-11)] text-muted-foreground">
              Ο «Αριθμός» (<code className="text-[length:var(--fs-10)]">SERIESNUM</code>) της σειράς μας τον δίνει το SoftOne — δεν τον στέλνουμε.
            </p>
          </div>

          {payloadRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-[length:var(--fs-12)]">
                <caption className="sr-only">Γραμμές που θα σταλούν στο SoftOne</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="py-1 pr-2 font-medium">Γραμμή</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Τύπος</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Κωδικός SoftOne</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Περιγραφή</th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">Ποσότητα</th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">Τιμή / Αξία</th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">ΦΠΑ</th>
                    <th scope="col" className="py-1 font-medium">Αναλυτική</th>
                  </tr>
                </thead>
                <tbody>
                  {payloadRows.map(({ kind, row }, i) => (
                    <tr key={`${kind}-${row.LINENUM}-${i}`} className="border-b border-border/60 last:border-0">
                      <td className="py-1 pr-2">{row.LINENUM}</td>
                      <td className="py-1 pr-2">{kind}</td>
                      <td className="py-1 pr-2">{row.MTRL ?? row.EXPN ?? '—'}</td>
                      <td className="py-1 pr-2">{row.COMMENTS ?? '—'}</td>
                      <td className="py-1 pr-2 text-right">{row.QTY1 ?? '—'}</td>
                      <td className="py-1 pr-2 text-right">{money(Number(row.PRICE ?? row.EXPVAL))}</td>
                      <td className="py-1 pr-2 text-right">{row.VAT ?? '—'}</td>
                      {/* Κέντρο κόστους / έργο / δραστηριότητα — προαιρετικά, και ποτέ σε EXPANAL. */}
                      <td className="py-1">
                        {[
                          row.COSTCNTR != null ? `ΚΚ ${row.COSTCNTR}` : null,
                          row.PRJC != null ? `Έργο ${row.PRJC}` : null,
                          row.PRJCSTAGE != null ? `Δρ. ${row.PRJCSTAGE}` : null,
                        ].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Ο λογαριασμός γενικής ΚΑΘΕ γραμμής, με το όνομά του στο λογιστικό σχέδιο. Εδώ φαίνεται
              ένα «Ύδρευση → Έξοδα εκθέσεων» πριν γίνει λογιστική εγγραφή· την κρίση την κάνει ο άνθρωπος. */}
          {preview.accounts && preview.accounts.lines.length > 0 && (
            <div className="rounded-lg border border-border p-2.5" data-testid="account-check">
              <p className="flex items-center gap-1 text-[length:var(--fs-12)] font-semibold">
                Λογαριασμοί γενικής λογιστικής
                <Link href="/wiki/ocr/account-check" target="_blank" aria-label="Βοήθεια: έλεγχος λογαριασμού γενικής" title="Βοήθεια: έλεγχος λογαριασμού γενικής"
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <FiHelpCircle className="size-3.5" />
                </Link>
              </p>
              <p className="mt-0.5 text-[length:var(--fs-11)] text-muted-foreground">
                Από την καρτέλα κάθε χρεοπίστωσης στο SoftOne. Έλεγξε ότι το όνομα του λογαριασμού ταιριάζει με τη δαπάνη —
                η εφαρμογή ελέγχει μόνο ότι ο λογαριασμός υπάρχει, όχι ότι είναι ο σωστός.
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {preview.accounts.lines.map((l) => (
                  <li key={l.rowIndex} className="text-[length:var(--fs-12)]">
                    <span className="font-medium">Γραμμή {l.rowIndex + 1}</span>
                    <span className="text-muted-foreground">
                      {' · '}{d?.lines[l.rowIndex]?.name ?? '—'}{l.article ? ` → ${l.article}` : ''}
                    </span>
                    <AccountLine line={l} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Disclosure open={payloadOpen} onToggle={() => setPayloadOpen((o) => !o)} label={`Προβολή payload (${preview.payload.OBJECT} · ${preview.target.lines})`}>
            <JsonBlock value={preview.payload} label={`Payload καταχώρισης ${preview.payload.OBJECT}`} />
          </Disclosure>
        </div>
      )}
    </section>
  );
}
