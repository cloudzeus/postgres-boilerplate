'use client';

// Έλεγχος ξένου ΑΦΜ στο VIES ΚΑΤΑ ΠΑΡΑΓΓΕΛΙΑ (taxid.dev ή απευθείας VIES — βλ. `lib/foreign-vat-check.ts`).
// Δεν τρέχει ποτέ μόνο του: κάθε έλεγχος μετράει στο μηνιαίο όριο του κλειδιού.
import * as React from 'react';
import { FiCheckCircle, FiLoader, FiShield, FiXCircle, FiAlertTriangle } from 'react-icons/fi';

export interface ViesCheckResult {
  vat: string; countryCode: string; valid: boolean | null;
  name: string | null; address: string | null;
  provider?: 'taxid' | 'vies' | null; source?: string | null; error?: string; message?: string;
}

export function ViesCheck({ vat, onResult, className }: {
  /** Το ΑΦΜ ΜΕ πρόθεμα χώρας (π.χ. «IT01808880270»). */
  vat: string | null;
  onResult?: (r: ViesCheckResult) => void;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [r, setR] = React.useState<ViesCheckResult | null>(null);
  React.useEffect(() => { setR(null); }, [vat]);

  const run = async () => {
    if (!vat || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/vies?vat=${encodeURIComponent(vat)}`, { cache: 'no-store' });
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

  return (
    <div className={className}>
      <button
        type="button" onClick={() => void run()} disabled={!vat || busy}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-[length:var(--fs-12)] font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        title="Έλεγχος του ΑΦΜ στο VIES — γίνεται μόνο όταν το πατάς"
      >
        {busy ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiShield aria-hidden className="size-3.5" />}
        {busy ? 'Έλεγχος…' : r ? 'Έλεγχος ξανά στο VIES' : 'Έλεγχος στο VIES'}
      </button>
      {r && (
        <div className="mt-1 text-[length:var(--fs-11)] leading-snug" role="status" aria-live="polite">
          {r.valid === true ? (
            <p className="flex items-start gap-1 text-emerald-700 dark:text-emerald-300">
              <FiCheckCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span>
                <strong>Ενεργό</strong> · {r.vat}{r.name ? ` · ${r.name}` : ''}{r.address ? ` · ${r.address}` : ''}
                <span className="text-muted-foreground"> ({r.source ?? 'VIES'}{r.provider === 'taxid' ? ' μέσω TaxID' : ''})</span>
              </span>
            </p>
          ) : r.valid === false ? (
            <p className="flex items-start gap-1 text-dg-red-600">
              <FiXCircle aria-hidden className="mt-0.5 size-3 shrink-0" /> Το {r.vat} ΔΕΝ είναι ενεργό στο VIES — έλεγξε το ΑΦΜ στο χαρτί.
            </p>
          ) : (
            <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
              <FiAlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" /> {r.message ?? 'Ο έλεγχος δεν ολοκληρώθηκε.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
