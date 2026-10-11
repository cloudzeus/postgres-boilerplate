'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiAlertTriangle, FiAlertOctagon, FiClock, FiRefreshCw, FiSend, FiCheck } from 'react-icons/fi';
import { cn } from '@/lib/utils';

/**
 * Η ΛΩΡΙΔΑ ΣΥΝΔΕΣΗΣ ΜΕ ΤΟ SOFTONE.
 *
 * ΓΙΑΤΙ ΥΠΑΡΧΕΙ. Όταν το ERP έπεφτε, η εφαρμογή δεν το έλεγε πουθενά: οι αναγνώσεις γύριζαν
 * σιωπηλά στον τοπικό καθρέφτη και όλα έμοιαζαν φυσιολογικά, μέχρι που μια εγγραφή απέτυχε με
 * τεχνικό μήνυμα. Το ίδιο και με την αλλαγή λογαριασμού SoftOne: τα μητρώα της ΠΑΛΙΑΣ
 * εγκατάστασης συνέχιζαν να εμφανίζονται ως έγκυρα.
 *
 * ΔΕΝ ΓΚΡΙΝΙΑΖΕΙ. Όταν όλα είναι εντάξει και η ουρά άδεια, η λωρίδα δεν υπάρχει καθόλου — μια
 * μόνιμη πράσινη μπάρα «όλα καλά» είναι θόρυβος που μαθαίνεις να αγνοείς, και τότε δεν βλέπεις
 * ούτε την κόκκινη.
 */

interface Status {
  reachable: boolean;
  endpoint: string | null;
  message: string;
  tenantKey: string | null;
  tenantChange: { from: string; to: string; at: string } | null;
  foreignMirrors: string[];
  unstampedMirrors: string[];
  outbox: { pending: number; needsReview: number; rejected: number };
}

/** Πόσο συχνά ρωτάμε. Ένα `ping` χωρίς login — αρκετά φθηνό για λεπτό, αρκετά συχνό για να προλάβει. */
const POLL_MS = 60_000;

export function SoftoneConnectionBar() {
  const [s, setS] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState<null | 'probe' | 'drain' | 'ack'>(null);
  /** Για να μην ξανατρέξει το αυτόματο άδειασμα σε κάθε δημοσκόπηση όσο λείπει η σύνδεση. */
  const drainedFor = React.useRef<string>('');

  const load = React.useCallback(async (): Promise<Status | null> => {
    try {
      const r = await fetch('/api/admin/softone/connection', { cache: 'no-store' });
      if (!r.ok) return null;             // 403 σε χρήστη χωρίς δικαίωμα: η λωρίδα απλώς δεν υπάρχει
      const j = (await r.json()) as Status;
      setS(j);
      return j;
    } catch { return null; }
  }, []);

  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      const j = await load();
      if (!alive || !j) return;
      // ΕΠΑΝΑΣΥΝΔΕΣΗ: ο διακομιστής ξαναήρθε και υπάρχει δουλειά σε αναμονή — φεύγει μόνη της.
      // Αυτό είναι ΟΛΟΚΛΗΡΟ το νόημα της ουράς: ο χρήστης δεν χρειάζεται να θυμάται τίποτα.
      const sig = `${j.tenantKey}|${j.outbox.pending}`;
      if (j.reachable && j.outbox.pending > 0 && drainedFor.current !== sig) {
        drainedFor.current = sig;
        void drain(true);
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function drain(silent = false) {
    setBusy('drain');
    try {
      const r = await fetch('/api/admin/softone/outbox/drain', { method: 'POST' });
      const j = await r.json();
      if (!silent || j.sent > 0) toast[j.sent > 0 ? 'success' : 'info'](j.message ?? 'Έγινε.');
      await load();
    } catch (e) {
      if (!silent) toast.error(`Αποτυχία: ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  async function probe() {
    setBusy('probe');
    try {
      const r = await fetch('/api/admin/softone/connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'probe' }),
      });
      const j = await r.json();
      toast[j.ok ? 'success' : 'error'](j.message ?? 'Άγνωστο αποτέλεσμα.');
      await load();
    } finally { setBusy(null); }
  }

  async function acknowledge() {
    setBusy('ack');
    try {
      await fetch('/api/admin/softone/connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge' }),
      });
      await load();
    } finally { setBusy(null); }
  }

  if (!s) return null;

  // Η σειρά ΕΙΝΑΙ η προτεραιότητα: η αλλαγή εγκατάστασης είναι χειρότερη από την πτώση, γιατί
  // η πτώση φαίνεται ενώ η αλλαγή δουλεύει κανονικά δείχνοντας λάθος δεδομένα.
  const state = s.tenantChange ? 'tenant'
    : s.foreignMirrors.length > 0 ? 'foreign'
      : !s.reachable ? 'down'
        : s.outbox.needsReview > 0 ? 'review'
          : s.outbox.pending > 0 ? 'queued'
            : s.unstampedMirrors.length > 0 ? 'unstamped'
              : null;
  if (!state) return null;

  const V = {
    tenant: {
      icon: FiAlertOctagon, fg: '#B91C1C', bg: '#FEF2F2', bd: '#FECACA',
      title: 'Άλλαξε η εγκατάσταση SoftOne',
      body: 'Τα μητρώα που έχουμε κατεβασμένα ανήκουν στην προηγούμενη εγκατάσταση. Οι κωδικοί τους (συναλλασσόμενοι, είδη, λογαριασμοί) ΔΕΝ ισχύουν εδώ. Κάνε πλήρη συγχρονισμό πριν καταχωρίσεις οτιδήποτε.',
    },
    foreign: {
      icon: FiAlertOctagon, fg: '#B91C1C', bg: '#FEF2F2', bd: '#FECACA',
      title: `${s.foreignMirrors.length} μητρώα από άλλη εγκατάσταση`,
      body: `Δεν έχουν ξανακατέβει μετά την αλλαγή: ${s.foreignMirrors.join(', ')}. Ό,τι δείχνουν μπορεί να είναι λάθος.`,
    },
    down: {
      icon: FiAlertTriangle, fg: '#B45309', bg: '#FFF8EE', bd: '#FCD9A8',
      title: 'Δεν υπάρχει σύνδεση με το SoftOne',
      body: `${s.message} Οι αναγνώσεις γίνονται από τα τοπικά μητρώα· οι καταχωρίσεις μπαίνουν σε σειρά και θα φύγουν μόλις επανέλθει.`,
    },
    review: {
      icon: FiAlertTriangle, fg: '#B45309', bg: '#FFF8EE', bd: '#FCD9A8',
      title: `${s.outbox.needsReview} εργασίες θέλουν έλεγχο`,
      body: 'Η σύνδεση κόπηκε ενώ έφευγαν — ΙΣΩΣ εκτελέστηκαν στο SoftOne. Δεν ξαναστέλνονται μόνες τους, για να μη δημιουργηθούν διπλές εγγραφές.',
    },
    queued: {
      icon: FiClock, fg: '#1F6FEB', bg: '#EFF6FF', bd: '#BFDBFE',
      title: `${s.outbox.pending} εργασίες σε αναμονή`,
      body: 'Θα σταλούν αυτόματα μόλις απαντήσει το SoftOne.',
    },
    unstamped: {
      icon: FiAlertTriangle, fg: '#B45309', bg: '#FFF8EE', bd: '#FCD9A8',
      title: `${s.unstampedMirrors.length} μητρώα χωρίς γνωστή προέλευση`,
      body: `Κατέβηκαν πριν αρχίσουμε να καταγράφουμε από ΠΟΙΑ εγκατάσταση προέρχονται: ${s.unstampedMirrors.join(', ')}. Αν η σύνδεση έχει αλλάξει από τότε, οι κωδικοί τους δεν ισχύουν. Ένας πλήρης συγχρονισμός το ξεκαθαρίζει οριστικά.`,
    },
  }[state];

  const Icon = V.icon;
  return (
    <div
      role="status" aria-live="polite"
      style={{ backgroundColor: V.bg, borderColor: V.bd }}
      className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2"
    >
      <Icon className="mt-0.5 size-4 shrink-0" style={{ color: V.fg }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[length:var(--fs-12)] font-bold text-foreground">{V.title}</p>
        <p className="text-[length:var(--fs-11)] text-muted-foreground">{V.body}</p>
      </div>
      {/* Οι ενέργειες έχουν ΕΝΑ χρώμα — το μπλε της εφαρμογής. Το χρώμα της κατάστασης μένει
          στο εικονίδιο και στο φόντο, εκεί που σημαίνει κάτι. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {state === 'tenant' && (
          <>
            <a href="/admin/metadata"
              className="inline-flex h-7 items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 text-[length:var(--fs-11)] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600">
              <FiRefreshCw className="size-3.5" /> Πλήρης συγχρονισμός
            </a>
            <button type="button" onClick={acknowledge} disabled={busy != null}
              className={BTN_GHOST}>
              <FiCheck className="size-3.5" /> Το είδα
            </button>
          </>
        )}
        {(state === 'foreign' || state === 'unstamped') && (
          <a href="/admin/metadata"
            className="inline-flex h-7 items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 text-[length:var(--fs-11)] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600">
            <FiRefreshCw className="size-3.5" /> Συγχρονισμός
          </a>
        )}
        {state === 'down' && (
          <button type="button" onClick={probe} disabled={busy != null} className={BTN_PRIMARY}>
            <FiRefreshCw className={cn('size-3.5', busy === 'probe' && 'animate-spin')} />
            {busy === 'probe' ? 'Έλεγχος…' : 'Έλεγχος σύνδεσης'}
          </button>
        )}
        {(state === 'queued' || state === 'review') && (
          <>
            {s.outbox.pending > 0 && (
              <button type="button" onClick={() => drain()} disabled={busy != null} className={BTN_PRIMARY}>
                <FiSend className="size-3.5" /> {busy === 'drain' ? 'Αποστολή…' : 'Στείλε τώρα'}
              </button>
            )}
            <a href="/admin/softone/outbox" className={BTN_GHOST}>Δες την ουρά</a>
          </>
        )}
      </div>
    </div>
  );
}

const BTN_PRIMARY =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 text-[length:var(--fs-11)] ' +
  'font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 ' +
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none';

const BTN_GHOST =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2.5 ' +
  'text-[length:var(--fs-11)] font-semibold text-foreground transition hover:bg-muted ' +
  'disabled:cursor-not-allowed disabled:opacity-60';
