'use client';

// Έλεγχος ξένου ΑΦΜ ΚΑΤΑ ΠΑΡΑΓΓΕΛΙΑ στις επίσημες αρχές (VIES / HMRC / Brønnøysund / UID — βλ.
// `lib/foreign-vat-check.ts`). Δείχνει τον ΑΡΙΘΜΟ ΕΛΕΓΧΟΥ (αποδεικτικό), τη σύγκριση επωνυμίας/
// διεύθυνσης όπου το κράτος την υποστηρίζει, και αν η απάντηση ήρθε από το ιστορικό (30 ημέρες).
import * as React from 'react';
import { toast } from 'sonner';
import { FiAlertTriangle, FiCheckCircle, FiCopy, FiLoader, FiRefreshCw, FiShield, FiXCircle } from 'react-icons/fi';
import { cn } from '@/lib/utils';

type Flag = 'VALID' | 'INVALID' | 'NOT_PROCESSED';
export interface ViesCheckResult {
  vat: string; countryCode: string; valid: boolean | null;
  name: string | null; address: string | null;
  provider?: string | null; source?: string | null; consultationNumber?: string | null; checkedAt?: string;
  match?: { name?: Flag; street?: Flag; postalCode?: Flag; city?: Flag } | null;
  cached?: boolean; error?: string; message?: string;
}

const MATCH_LABEL: Record<string, string> = { name: 'Επωνυμία', street: 'Οδός', postalCode: 'ΤΚ', city: 'Πόλη' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function ViesCheck({ vat, trader, onResult, className, autoRun = false }: {
  /** Τρέχει μόλις εμφανιστεί (π.χ. από «Εξακρίβωση VIES» του μενού) — ένα κλικ, όχι δύο. */
  autoRun?: boolean;
  /** Το ΑΦΜ ΜΕ πρόθεμα χώρας (π.χ. «IT01808880270», «CHE-116.281.710», «NO923609016MVA»). */
  vat: string | null;
  /** Τα στοιχεία του χαρτιού — το VIES τα συγκρίνει με το μητρώο όπου το κράτος το υποστηρίζει. */
  trader?: { name?: string | null; street?: string | null; postalCode?: string | null; city?: string | null } | null;
  onResult?: (r: ViesCheckResult) => void;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [r, setR] = React.useState<ViesCheckResult | null>(null);
  React.useEffect(() => { setR(null); }, [vat]);
  const ran = React.useRef<string | null>(null);

  const run = async (force = false) => {
    if (!vat || busy) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ vat });
      if (force) q.set('force', '1');
      if (trader?.name) q.set('name', trader.name);
      if (trader?.street) q.set('street', trader.street);
      if (trader?.postalCode) q.set('zip', trader.postalCode);
      if (trader?.city) q.set('city', trader.city);
      const res = await fetch(`/api/admin/vies?${q}`, { cache: 'no-store' });
      const d = (await res.json().catch(() => null)) as ViesCheckResult | null;
      const out = d ?? { vat, countryCode: '', valid: null, name: null, address: null, message: 'Η υπηρεσία ελέγχου δεν απάντησε.' };
      setR(out);
      onResult?.(out);
    } catch {
      setR({ vat, countryCode: '', valid: null, name: null, address: null, message: 'Σφάλμα δικτύου.' });
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    if (!autoRun || !vat || ran.current === vat) return;
    ran.current = vat;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, vat]);

  const copy = (s: string) => { void navigator.clipboard?.writeText(s).then(() => toast.success('Ο αριθμός ελέγχου αντιγράφηκε')); };
  const matches = r?.match ? Object.entries(r.match).filter(([, v]) => v && v !== 'NOT_PROCESSED') as [string, Flag][] : [];

  return (
    <div className={className}>
      <button
        type="button" onClick={() => void run(false)} disabled={!vat || busy}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-[length:var(--fs-12)] font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        title="Έλεγχος του ΑΦΜ στην επίσημη αρχή της χώρας (VIES, HMRC, Brønnøysund, UID) — γίνεται μόνο όταν το πατάς"
      >
        {busy ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiShield aria-hidden className="size-3.5" />}
        {busy ? 'Έλεγχος…' : 'Έλεγχος ΑΦΜ (VIES)'}
      </button>
      {r && (
        <div className="mt-1 space-y-1 text-[length:var(--fs-11)] leading-snug" role="status" aria-live="polite">
          {r.valid === true ? (
            <p className="flex items-start gap-1 text-emerald-700 dark:text-emerald-300">
              <FiCheckCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span>
                <strong>Ενεργό</strong> · {r.vat}{r.name ? ` · ${r.name}` : ''}{r.address ? ` · ${r.address}` : ''}
                <span className="text-muted-foreground"> ({r.source ?? 'VIES'})</span>
              </span>
            </p>
          ) : r.valid === false ? (
            <p className="flex items-start gap-1 text-dg-red-600">
              <FiXCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span>Το {r.vat} ΔΕΝ είναι ενεργό{r.source ? ` (${r.source})` : ''} — {r.message ?? 'έλεγξε το ΑΦΜ στο χαρτί.'}</span>
            </p>
          ) : (
            <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
              <FiAlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" /> {r.message ?? 'Ο έλεγχος δεν ολοκληρώθηκε.'}
            </p>
          )}
          {r.valid === true && r.message && <p className="text-amber-700 dark:text-amber-300">{r.message}</p>}

          {matches.length > 0 && (
            <p className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">Σύγκριση με το χαρτί:</span>
              {matches.map(([k, v]) => (
                <span key={k} className={cn('rounded px-1 font-medium', v === 'VALID' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300')}>
                  {MATCH_LABEL[k] ?? k} {v === 'VALID' ? '✓' : '✗'}
                </span>
              ))}
            </p>
          )}

          {(r.consultationNumber || r.checkedAt) && r.valid != null && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
              {r.consultationNumber && (
                <button type="button" onClick={() => copy(r.consultationNumber!)} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground" title="Αντιγραφή — αποδεικτικό ελέγχου">
                  Αρ. ελέγχου <span className="font-mono text-foreground">{r.consultationNumber}</span> <FiCopy aria-hidden className="size-3" />
                </button>
              )}
              {r.checkedAt && <span>{r.cached ? 'από το ιστορικό · ' : ''}{when(r.checkedAt)}</span>}
              {r.cached && (
                <button type="button" onClick={() => void run(true)} disabled={busy} className="inline-flex cursor-pointer items-center gap-0.5 font-medium text-sisyphus-600 hover:underline">
                  <FiRefreshCw aria-hidden className="size-3" /> Νέος έλεγχος
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
