'use client';

// Η κάρτα «JSON εγγράφου» στη σελίδα ενός εγγράφου (plan 5, §17.1): το κανονικό JSON όπως θα το
// διαβάσει το Excel και το SoftOne, και δίπλα του η ΠΡΟΕΠΙΣΚΟΠΗΣΗ της καταχώρισης — τι payload θα
// σταλεί και τι το εμποδίζει. Η προεπισκόπηση δεν αγγίζει ποτέ το SoftOne (dry-run στον server).

import * as React from 'react';
import Link from 'next/link';
import { FiAlertTriangle, FiCheckCircle, FiChevronDown, FiChevronRight, FiCode, FiCopy, FiDownload, FiHelpCircle, FiRefreshCw, FiUploadCloud } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { DocumentEnvelope } from '@/lib/ocr/canonical';

type PurdocHeader = Record<string, string | number>;
type PurdocLine = Record<string, string | number>;
type PayloadData = {
  PURDOC?: PurdocHeader[]; LINSUPDOC?: PurdocHeader[]; LINCREDOC?: PurdocHeader[]; LINDEBDOC?: PurdocHeader[];
  ITELINES?: PurdocLine[]; SRVLINES?: PurdocLine[]; ASSLINES?: PurdocLine[];
  EXPANAL?: PurdocLine[]; LINLINES?: PurdocLine[];
};
type Preview = {
  enabled: boolean;
  blockers: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  /** Πού πάει: SoftOne object + πίνακας γραμμών, με ελληνική περιγραφή και το «γιατί». */
  target: { object: string; lines: string; source: 'configured' | 'default'; reason: string; label: string };
  payload: { OBJECT: string; KEY: string; DATA: PayloadData };
  summary: { series: string | null; trader: string | null; trdr: number | null; date: string | null; number: string | null; lines: number };
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
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium" style={color ? { color } : undefined}>{value}</span>
    </span>
  );
}

/** Ένα `<pre>` με JSON που δεν σπάει τη σελίδα: κυλάει μόνο του, οριζόντια και κάθετα. */
function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <pre aria-label={label} tabIndex={0}
      className="mt-2 max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Disclosure({ open, onToggle, children, label }: { open: boolean; onToggle: () => void; children: React.ReactNode; label: string }) {
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
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
    ...(lines?.ASSLINES ?? []).map((row) => ({ kind: 'Πάγιο', row })),
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
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-[12px]" style={{ borderColor: '#B91C1C40', backgroundColor: '#FDE8E8', color: '#B91C1C' }}>
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
            <h3 className="text-[13px] font-semibold">Καταχώριση στο SoftOne</h3>
            {posted ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#047857' }}>
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
            <p className="text-[12px] text-muted-foreground">
              Η καταχώριση είναι απενεργοποιημένη — αυτό που βλέπετε είναι μόνο προεπισκόπηση
              (Ρυθμίσεις → Διασυνδέσεις → «Καταχώριση παραστατικών στο SoftOne»).
            </p>
          )}

          {posted ? null : blocked ? (
            <div className="rounded-lg border p-2.5 text-[12px]" style={{ borderColor: '#B4530940', backgroundColor: '#FDF3E3', color: '#B45309' }}>
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
            <p className="flex items-center gap-1.5 text-[12px]" style={{ color: '#047857' }}>
              <FiCheckCircle className="size-3.5" aria-hidden /> Το παραστατικό είναι έτοιμο για καταχώριση.
            </p>
          )}

          {/* Πού πάει: το πρώτο πράγμα που θέλει να δει ο χρήστης πριν σταλεί οτιδήποτε. */}
          <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-[12px]">
            <p className="font-semibold">Προορισμός: {preview.target.label}</p>
            <p className="mt-0.5 text-muted-foreground">
              {preview.target.source === 'default' ? 'Προεπιλογή ενότητας' : 'Ρύθμιση σειράς'} · {preview.target.reason}
              {' · '}
              <Link href="/admin/doc-series" className="underline hover:text-foreground">Αλλαγή στις σειρές παραστατικών</Link>
            </p>
          </div>

          {preview.warnings.length > 0 && !posted && (
            <div className="rounded-lg border p-2.5 text-[12px]" style={{ borderColor: '#B4530930', backgroundColor: '#FFFBF3', color: '#92400E' }}>
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

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Σειρά</dt><dd className="font-medium">{preview.summary.series ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Προμηθευτής</dt><dd className="font-medium">{preview.summary.trader ?? '—'}{preview.summary.trdr ? ` (${preview.summary.trdr})` : ''}</dd></div>
            <div><dt className="text-muted-foreground">Ημερομηνία</dt><dd className="font-medium">{preview.summary.date ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Αριθμός</dt><dd className="font-medium">{preview.summary.number ?? '—'}</dd></div>
          </dl>

          {payloadRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-[12px]">
                <caption className="sr-only">Γραμμές που θα σταλούν στο SoftOne</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="py-1 pr-2 font-medium">Γραμμή</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Τύπος</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Κωδικός SoftOne</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Περιγραφή</th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">Ποσότητα</th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">Τιμή / Αξία</th>
                    <th scope="col" className="py-1 text-right font-medium">ΦΠΑ</th>
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
                      <td className="py-1 text-right">{row.VAT ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
