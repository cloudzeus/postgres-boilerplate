'use client';

import * as React from 'react';
import { FiRefreshCw, FiCheck, FiAlertTriangle, FiAlertOctagon, FiExternalLink } from 'react-icons/fi';
import { cn } from '@/lib/utils';

/** Ό,τι επιστρέφει το `/api/admin/ocr/[id]/recover-afm` (βλ. `lib/ocr/afm-recovery.ts`). */
export interface AfmRecoveryResult {
  status: 'confirmed' | 'unconfirmed' | 'unchanged' | 'no_file' | 'no_name';
  afm: string | null;
  aadeName: string | null;
  previousAfm: string | null;
  rereadAfm: string | null;
  evidence: 'stored' | 'filename' | 'reread' | null;
  applied: boolean;
  linkedTrader: { trdr: number; code: string | null; name: string | null } | null;
  clearedTrader: { trdr: number; name: string | null; afm: string | null } | null;
  tried: { afm: string; aadeName: string | null; match: boolean }[];
  message: string;
}

export async function recoverAfm(docId: string, force = false): Promise<AfmRecoveryResult> {
  const r = await fetch(`/api/admin/ocr/${docId}/recover-afm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apply: true, force }),
  });
  return r.json();
}

/**
 * «ΕΠΑΝΑΓΝΩΣΗ ΑΦΜ ΑΠΟ ΤΟ ΑΡΧΕΙΟ» — για παραστατικό με ΑΦΜ εκδότη που λείπει ή δεν περνά τον έλεγχο.
 *
 * Η ιδέα είναι του χρήστη: το χαρτί έχει ΠΑΝΤΑ σωστό ΑΦΜ, άρα το λάθος είναι της ανάγνωσης. Το
 * κουμπί ξαναδιαβάζει το αρχείο και γράφει ΜΟΝΟ ό,τι επιβεβαιώνει η ΑΑΔΕ με την ίδια επωνυμία.
 * Όταν η απόδειξη είναι αδύναμη (η επωνυμία βγήκε από την ΙΔΙΑ επανάγνωση), ΔΕΝ γράφει: δείχνει
 * το εύρημα και ζητά από τον χρήστη να κοιτάξει το αρχείο — έτσι πιάστηκε ένα σκανάρισμα με ΔΥΟ
 * αποδείξεις στην ίδια σελίδα, όπου η «σωστή» απάντηση θα έκρυβε τη μία.
 */
export function AfmRecover({ docId, onDone }: { docId: string; onDone?: (r: AfmRecoveryResult) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<AfmRecoveryResult | null>(null);

  async function go(force = false) {
    setBusy(true);
    try {
      const r = await recoverAfm(docId, force);
      setRes(r);
      if (r.applied || r.clearedTrader) onDone?.(r);
    } catch (e) {
      setRes({ status: 'no_file', message: (e as Error).message } as AfmRecoveryResult);
    } finally { setBusy(false); }
  }

  const weak = res?.status === 'confirmed' && !res.applied && res.evidence === 'reread';
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
      <p className="text-[length:var(--fs-11)] text-muted-foreground">
        Το ΑΦΜ του εκδότη λείπει ή δεν περνά τον έλεγχο ψηφίου — σχεδόν πάντα λάθος ανάγνωσης. Το χαρτί έχει το σωστό.
      </p>
      {!res?.applied && !weak && (
        <button type="button" onClick={() => go(false)} disabled={busy} className={BTN}>
          <FiRefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
          {busy ? 'Επανάγνωση…' : 'Επανάγνωση ΑΦΜ από το αρχείο'}
        </button>
      )}
      {res && <Outcome r={res} />}
      {weak && (
        <div className="flex flex-wrap items-center gap-1.5">
          <a href={`/api/admin/ocr/${docId}/file`} target="_blank" rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-[length:var(--fs-11)] font-semibold text-foreground hover:bg-muted">
            <FiExternalLink className="size-3.5" /> Άνοιγμα αρχείου
          </a>
          <button type="button" onClick={() => go(true)} disabled={busy} className={BTN}>
            <FiCheck className="size-3.5" /> Το έλεγξα — εφάρμοσέ το
          </button>
        </div>
      )}
    </div>
  );
}

export function Outcome({ r }: { r: AfmRecoveryResult }) {
  const ok = r.applied || r.status === 'unchanged';
  const weak = r.status === 'confirmed' && !r.applied;
  const Icon = ok ? FiCheck : weak ? FiAlertTriangle : FiAlertOctagon;
  const fg = ok ? '#047857' : weak ? '#B45309' : '#B91C1C';
  return (
    <p className="flex items-start gap-1.5 text-[length:var(--fs-11)] text-foreground">
      <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: fg }} aria-hidden />
      <span>{r.message}</span>
    </p>
  );
}

const BTN =
  'inline-flex h-7 items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 text-[length:var(--fs-11)] font-semibold text-white shadow-sm transition ' +
  'hover:bg-sisyphus-600 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none';
