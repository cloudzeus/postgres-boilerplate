'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  FiUsers, FiCheck, FiAlertTriangle, FiAlertOctagon, FiClock, FiLoader, FiX, FiDatabase,
} from 'react-icons/fi';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { planRow, type PlanRow, type TraderKind } from '@/lib/ocr/bulk-trader-plan';

/** Ό,τι χρειάζεται από κάθε ομάδα της ουράς — ΟΧΙ ολόκληρο το `TraderGroup` (δείγματα, μικρογραφίες). */
export interface BulkGroup {
  afm: string;
  name: string | null;
  country: string | null;
  suggestedKind: TraderKind;
  missingKinds: TraderKind[];
  docCount: number;
}

type RunState =
  | { s: 'idle' }
  | { s: 'running' }
  | { s: 'done'; code: string | null; docs: number }
  | { s: 'queued'; msg: string }
  | { s: 'error'; msg: string };

const KIND_LABEL: Record<TraderKind, string> = { supplier: 'Προμηθευτής', creditor: 'Πιστωτής', debtor: 'Χρεώστης' };

/** Οι χώρες που προσφέρονται για ξένους χωρίς πρόθεμα. Οι προτάσεις του `guessCountry` είναι όλες εδώ. */
const COUNTRIES: [string, string][] = [
  ['DE', 'Γερμανία'], ['IT', 'Ιταλία'], ['TR', 'Τουρκία'], ['RS', 'Σερβία'], ['LB', 'Λίβανος'],
  ['IL', 'Ισραήλ'], ['NL', 'Ολλανδία'], ['FR', 'Γαλλία'], ['PL', 'Πολωνία'], ['AT', 'Αυστρία'],
  ['BG', 'Βουλγαρία'], ['CY', 'Κύπρος'], ['ES', 'Ισπανία'], ['GB', 'Ηνωμένο Βασίλειο'],
  ['US', 'ΗΠΑ'], ['CN', 'Κίνα'], ['AE', 'Ηνωμένα Αραβικά Εμιράτα'], ['CH', 'Ελβετία'],
];

/**
 * ΓΡΗΓΟΡΟ ΚΟΥΜΠΙ + MODAL μαζικής δημιουργίας συναλλασσομένων.
 *
 * Υπάρχει επειδή ο ένας-ένας δρόμος —άνοιξε εκδότη, άντλησε ΑΑΔΕ, πάρε κωδικό, δημιούργησε,
 * επόμενος— ήταν τρία λεπτά ανά εκδότη. Με 33 εκκρεμείς εκδότες, μιάμιση ώρα για δουλειά που
 * ο υπολογιστής κάνει σε ένα λεπτό.
 *
 * ΔΕΝ είναι «πάτα και φύγε». Κάθε γραμμή κρίνεται πρώτα (`lib/ocr/bulk-trader-plan.ts`) και
 * προεπιλέγονται ΜΟΝΟ οι ασφαλείς: λάθος ΑΦΜ και ξένοι χωρίς χώρα φαίνονται με τον λόγο τους και
 * περιμένουν απόφαση. Η εγκατάσταση-στόχος γράφεται ΠΑΝΩ από το κουμπί — μετά από μια αλλαγή
 * λογαριασμού SoftOne, το «πού θα γραφτούν» δεν είναι αυτονόητο.
 *
 * Γράφει μέσω του ΥΠΑΡΧΟΝΤΟΣ route δημιουργίας, έναν-έναν: ίδιοι έλεγχοι Δ.Ο.Υ./κωδικού, ίδια
 * ουρά αν πέσει η σύνδεση, και φρέσκος κωδικός για κάθε καρτέλα (σειριακά ⇒ καμία σύγκρουση).
 */
export function BulkCreateTradersButton({ groups, canManage }: { groups: BulkGroup[]; canManage: boolean }) {
  const [open, setOpen] = React.useState(false);
  if (!canManage || groups.length === 0) return null;
  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 active:bg-sisyphus-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500/40 focus-visible:ring-offset-1"
      >
        <FiUsers className="size-3.5" /> Μαζική δημιουργία ({groups.length})
      </button>
      {open && <BulkCreateTradersModal groups={groups} onClose={() => setOpen(false)} />}
    </>
  );
}

function BulkCreateTradersModal({ groups, onClose }: { groups: BulkGroup[]; onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<PlanRow[]>(() => groups.map((g) => planRow(g)));
  const [run, setRun] = React.useState<Record<string, RunState>>({});
  const [phase, setPhase] = React.useState<'edit' | 'confirm' | 'running' | 'finished'>('edit');
  const [target, setTarget] = React.useState<string | null>(null);
  const stop = React.useRef(false);

  // ΠΟΥ θα γραφτούν. Χωρίς δικαίωμα στη σύνδεση (403) απλώς δεν εμφανίζεται — δεν μαντεύουμε.
  React.useEffect(() => {
    fetch('/api/admin/softone/connection', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const key: string | undefined = j?.tenantKey;
        if (key) setTarget(key.split('|')[0]);
      })
      .catch(() => null);
  }, []);

  const set = (afm: string, patch: Partial<PlanRow>) =>
    setRows((rs) => rs.map((r) => (r.afm === afm ? { ...r, ...patch } : r)));

  /** Επιλέξιμη = όχι λάθος ΑΦΜ, και ξένος μόνο ΑΦΟΥ έχει χώρα. */
  const selectable = (r: PlanRow) => r.status !== 'invalid_afm' && r.country != null;
  const chosen = rows.filter((r) => r.selected && selectable(r));
  const counts = {
    ready: rows.filter((r) => r.status === 'ready').length,
    country: rows.filter((r) => r.status === 'needs_country').length,
    invalid: rows.filter((r) => r.status === 'invalid_afm').length,
  };
  const busy = phase === 'running';

  async function runOne(r: PlanRow): Promise<RunState> {
    let aade: any = null;
    if (r.useAade) {
      const res = await fetch('/api/admin/ocr/supplier-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ afm: r.afm }),
      });
      aade = await res.json().catch(() => null);
      // ΔΕΝ δημιουργούμε με τα στοιχεία του OCR όταν η ΑΑΔΕ δεν βρίσκει το ΑΦΜ: είναι ακριβώς η
      // περίπτωση που το ΑΦΜ είναι λάθος — και η καρτέλα θα έμενε στο ERP με ψεύτικα στοιχεία.
      if (!res.ok || !aade?.name) {
        return { s: 'error', msg: aade?.error === 'not_found' ? 'Δεν βρέθηκε στην ΑΑΔΕ — έλεγξε το ΑΦΜ.' : (aade?.message ?? 'Αποτυχία ΑΑΔΕ.') };
      }
    }

    const next = await fetch(`/api/admin/ocr/new-traders/next-code?kind=${r.kind}&fresh=1`, { cache: 'no-store' })
      .then((x) => (x.ok ? x.json() : null)).catch(() => null);
    let code: string | null = next?.code ?? null;

    // Μία ΜΟΝΟ επανάληψη, και μόνο όταν το ERP αρνήθηκε τον ΚΩΔΙΚΟ και πρότεινε άλλον — ποτέ
    // βρόχος, ποτέ επανάληψη σε άλλο σφάλμα.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`/api/admin/ocr/new-traders/${encodeURIComponent(r.afm)}/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: r.kind,
          name: (aade?.name ?? r.name).trim(),
          code,
          country: r.country,
          irsData: aade?.softoneDoy?.office?.key ?? null,
          profession: aade?.profession ?? null,
          address: aade?.address ?? null,
          zip: aade?.zip ?? null,
          city: aade?.city ?? null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) return { s: 'done', code: d.code ?? code, docs: d.docsUpdated ?? 0 };
      if (res.status === 202 && d.queued) return { s: 'queued', msg: 'Σε ουρά — θα δημιουργηθεί στην επανασύνδεση.' };
      if (d.field === 'code' && d.suggestion && attempt === 0) { code = d.suggestion; continue; }
      return { s: 'error', msg: d.userMessage ?? d.message ?? `HTTP ${res.status}` };
    }
    return { s: 'error', msg: 'Ο κωδικός απορρίφθηκε δύο φορές.' };
  }

  async function start() {
    setPhase('running');
    stop.current = false;
    const todo = chosen;
    setRun(Object.fromEntries(todo.map((r) => [r.afm, { s: 'idle' } as RunState])));
    let ok = 0, failed = 0, queued = 0;
    for (const r of todo) {
      if (stop.current) break;
      setRun((m) => ({ ...m, [r.afm]: { s: 'running' } }));
      let out: RunState;
      try { out = await runOne(r); } catch (e) { out = { s: 'error', msg: (e as Error).message }; }
      setRun((m) => ({ ...m, [r.afm]: out }));
      if (out.s === 'done') ok++; else if (out.s === 'queued') queued++; else failed++;
    }
    setPhase('finished');
    toast[failed === 0 ? 'success' : 'warning'](
      `Δημιουργήθηκαν ${ok}${queued ? ` · σε ουρά ${queued}` : ''}${failed ? ` · απέτυχαν ${failed}` : ''}.`,
    );
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      {/* 60–70% του πλάτους στην επιφάνεια εργασίας, όπως ζητήθηκε: ο πίνακας έχει έξι στήλες και
          τα ονόματα είναι μακριά. Στο κινητό όλη η οθόνη. Το modal ΚΥΛΑ μέσα του — εξαιρείται από
          τον κανόνα του ενός scroller, γιατί κάθεται πάνω από τη σελίδα. */}
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 p-0 sm:max-w-none lg:w-[65vw] lg:min-w-[60vw] lg:max-w-[70vw]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[length:var(--fs-16)]">Μαζική δημιουργία συναλλασσομένων</DialogTitle>
          <DialogDescription className="text-[length:var(--fs-12)]">
            Προεπιλεγμένοι είναι μόνο όσοι μπορούν να δημιουργηθούν με ασφάλεια. Οι υπόλοιποι φαίνονται με τον λόγο τους.
          </DialogDescription>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[length:var(--fs-11)]">
            <Chip icon={FiCheck} fg="#047857">{counts.ready} έτοιμοι</Chip>
            {counts.country > 0 && <Chip icon={FiAlertTriangle} fg="#B45309">{counts.country} θέλουν χώρα</Chip>}
            {counts.invalid > 0 && <Chip icon={FiAlertOctagon} fg="#B91C1C">{counts.invalid} με λάθος ΑΦΜ</Chip>}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full table-fixed text-[length:var(--fs-12)]">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted text-left text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox" aria-label="Επιλογή όλων των επιλέξιμων" disabled={busy || phase === 'finished'}
                    checked={chosen.length > 0 && chosen.length === rows.filter(selectable).length}
                    onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked && selectable(r) })))}
                    className="size-4 cursor-pointer accent-sisyphus-500"
                  />
                </th>
                <th className="px-2 py-2">Επωνυμία</th>
                <th className="w-[8.5rem] px-2 py-2">ΑΦΜ</th>
                <th className="w-[8.5rem] px-2 py-2">Τύπος</th>
                <th className="w-[7.5rem] px-2 py-2">Χώρα</th>
                <th className="w-[30%] px-2 py-2">Κατάσταση</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const st = run[r.afm];
                const locked = busy || phase === 'finished' || st?.s === 'done';
                return (
                  <tr key={r.afm} className={cn('align-top', !selectable(r) && 'bg-muted/30', st?.s === 'done' && 'bg-emerald-500/5')}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox" aria-label={`Επιλογή ${r.name}`}
                        disabled={locked || !selectable(r)} checked={r.selected && selectable(r)}
                        onChange={(e) => set(r.afm, { selected: e.target.checked })}
                        className="size-4 cursor-pointer accent-sisyphus-500 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="min-w-0 px-2 py-2">
                      <p className="truncate font-medium text-foreground" title={r.name}>{r.name}</p>
                      {r.useAade && <p className="text-[length:var(--fs-10)] text-muted-foreground">Η επωνυμία θα έρθει από την ΑΑΔΕ</p>}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums text-foreground">{r.afm}</td>
                    <td className="px-2 py-2">
                      <select
                        value={r.kind} disabled={locked} aria-label={`Τύπος για ${r.name}`}
                        onChange={(e) => set(r.afm, { kind: e.target.value as TraderKind })}
                        className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-[length:var(--fs-12)] text-foreground focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60"
                      >
                        {(['supplier', 'creditor', 'debtor'] as TraderKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      {r.status === 'needs_country' ? (
                        <select
                          value={r.country ?? ''} disabled={locked} aria-label={`Χώρα για ${r.name}`}
                          onChange={(e) => set(r.afm, { country: e.target.value || null, countryGuessed: false })}
                          className={cn(
                            'h-7 w-full rounded-md border bg-background px-1.5 text-[length:var(--fs-12)] text-foreground focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60',
                            r.countryGuessed ? 'border-amber-400' : 'border-input',
                          )}
                        >
                          <option value="">— Χώρα —</option>
                          {COUNTRIES.map(([cc, label]) => <option key={cc} value={cc}>{cc} · {label}</option>)}
                        </select>
                      ) : (
                        <span className="text-foreground">{r.country ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-2 py-2"><StatusCell row={r} st={st} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-[length:var(--fs-11)] text-muted-foreground">
            <FiDatabase className="size-3.5 shrink-0" aria-hidden />
            {target
              ? <>Θα γραφτούν στο SoftOne: <strong className="font-semibold text-foreground">{target}</strong></>
              : 'Θα γραφτούν στο συνδεδεμένο SoftOne.'}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {phase === 'running' ? (
              <button type="button" onClick={() => { stop.current = true; }} className={BTN_GHOST}>
                <FiX className="size-3.5" /> Διακοπή μετά την τρέχουσα
              </button>
            ) : (
              <button type="button" onClick={onClose} className={BTN_GHOST}>
                {phase === 'finished' ? 'Κλείσιμο' : 'Ακύρωση'}
              </button>
            )}
            {phase === 'edit' && (
              <button type="button" disabled={chosen.length === 0} onClick={() => setPhase('confirm')} className={BTN_PRIMARY}>
                Δημιουργία {chosen.length} στο SoftOne
              </button>
            )}
            {phase === 'confirm' && (
              <>
                <span className="text-[length:var(--fs-11)] font-semibold text-foreground">
                  {chosen.length} νέες καρτέλες{target ? ` στο ${target}` : ''}. Σίγουρα;
                </span>
                <button type="button" onClick={() => setPhase('edit')} className={BTN_GHOST}>Πίσω</button>
                <button type="button" onClick={start} className={BTN_PRIMARY}>Ναι, δημιούργησέ τες</button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusCell({ row, st }: { row: PlanRow; st?: RunState }) {
  if (st?.s === 'running') return <Line icon={FiLoader} fg="#1F6FEB" spin>Δημιουργείται…</Line>;
  if (st?.s === 'idle') return <Line icon={FiClock} fg="#6B7280">Σε αναμονή</Line>;
  if (st?.s === 'done') {
    return (
      <Line icon={FiCheck} fg="#047857">
        Δημιουργήθηκε{st.code ? ` · ${st.code}` : ''}{st.docs ? ` · ${st.docs} παραστατικ${st.docs === 1 ? 'ό' : 'ά'}` : ''}
      </Line>
    );
  }
  if (st?.s === 'queued') return <Line icon={FiClock} fg="#1F6FEB">{st.msg}</Line>;
  if (st?.s === 'error') return <Line icon={FiAlertOctagon} fg="#B91C1C">{st.msg}</Line>;
  if (row.status === 'invalid_afm') return <Line icon={FiAlertOctagon} fg="#B91C1C">{row.reason}</Line>;
  if (row.status === 'needs_country') {
    return <Line icon={FiAlertTriangle} fg="#B45309">{row.country && !row.countryGuessed ? 'Χώρα επιλεγμένη.' : row.reason}</Line>;
  }
  return <Line icon={FiCheck} fg="#047857">{row.reason}</Line>;
}

/** Το χρώμα ΜΟΝΟ στο εικονίδιο· το κείμενο μένει στο χρώμα κειμένου για να διαβάζεται. */
function Line({ icon: Icon, fg, spin, children }: { icon: React.ElementType; fg: string; spin?: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-[length:var(--fs-11)] text-foreground">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', spin && 'animate-spin')} style={{ color: fg }} aria-hidden />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

function Chip({ icon: Icon, fg, children }: { icon: React.ElementType; fg: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-semibold text-foreground">
      <Icon className="size-3" style={{ color: fg }} aria-hidden /> {children}
    </span>
  );
}

const BTN_PRIMARY =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3.5 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition ' +
  'hover:bg-sisyphus-600 active:bg-sisyphus-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500/40 focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none';

const BTN_GHOST =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[length:var(--fs-12)] font-semibold text-foreground transition hover:bg-muted ' +
  'disabled:cursor-not-allowed disabled:opacity-60';
