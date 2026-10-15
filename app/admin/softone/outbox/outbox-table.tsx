'use client';

import { confirmAction } from '@/components/ui/confirm-dialog';
import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { FiSend, FiX, FiRotateCw } from 'react-icons/fi';
import { cn } from '@/lib/utils';

export interface OutboxRow {
  id: string; kind: string; label: string; status: string; attempts: number;
  lastError: string | null; createdAt: string; sentAt: string | null; tenantKey: string;
}

/** Τι σημαίνει κάθε κατάσταση — στη γλώσσα του χρήστη, όχι της βάσης. */
const STATUS: Record<string, { label: string; help: string; fg: string; bg: string }> = {
  PENDING:      { label: 'Σε αναμονή', help: 'Δεν έχει εκτελεστεί. Θα φύγει μόλις απαντήσει το SoftOne.', fg: '#1F6FEB', bg: '#EFF6FF' },
  SENT:         { label: 'Ολοκληρώθηκε', help: 'Έφυγε και επιβεβαιώθηκε.', fg: '#047857', bg: '#ECFDF5' },
  NEEDS_REVIEW: { label: 'Θέλει έλεγχο', help: 'Η σύνδεση κόπηκε ενώ έφευγε — ΙΣΩΣ εκτελέστηκε. Έλεγξέ τη στο SoftOne πριν την ξαναστείλεις.', fg: '#B45309', bg: '#FFF8EE' },
  REJECTED:     { label: 'Απορρίφθηκε', help: 'Το SoftOne την απέρριψε. Η επανάληψη ως έχει δεν θα βοηθήσει.', fg: '#B91C1C', bg: '#FEF2F2' },
  CANCELLED:    { label: 'Ακυρώθηκε', help: 'Ακυρώθηκε από χρήστη.', fg: '#6B7280', bg: '#F3F4F6' },
};

export function OutboxTable({ initial }: { initial: OutboxRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(id: string, action: 'retry' | 'cancel') {
    // Η ΕΠΑΝΑΛΗΨΗ ΘΕΛΕΙ ΡΗΤΗ ΒΕΒΑΙΩΣΗ. Δεν ρωτάμε «είσαι σίγουρος;» για το τυπικό: ρωτάμε το
    // ΣΥΓΚΕΚΡΙΜΕΝΟ πράγμα που μόνο ο χρήστης μπορεί να ξέρει — αν η εγγραφή υπάρχει ήδη εκεί.
    if (action === 'retry' && !(await confirmAction(
      'Έλεγξες στο SoftOne ότι η εγγραφή ΔΕΝ υπάρχει;\n\nΑν υπάρχει και σταλεί ξανά, θα δημιουργηθεί ΔΕΥΤΕΡΗ.',
    ))) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/softone/outbox/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${r.status}`);
      toast.success(j.status === 'sent' ? 'Ολοκληρώθηκε.' : j.message ?? 'Έγινε.');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  }

  async function drain() {
    setBusy('*');
    try {
      const r = await fetch('/api/admin/softone/outbox/drain', { method: 'POST' });
      const j = await r.json();
      toast[j.sent > 0 ? 'success' : 'info'](j.message ?? 'Έγινε.');
      router.refresh();
    } finally { setBusy(null); }
  }

  if (initial.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-[length:var(--fs-13)] font-semibold text-foreground">Η ουρά είναι άδεια.</p>
        <p className="mt-1 text-[length:var(--fs-12)] text-muted-foreground">
          Ό,τι στέλνουμε στο SoftOne φεύγει αμέσως. Εδώ θα εμφανιστεί μόνο ό,τι δεν μπόρεσε.
        </p>
      </div>
    );
  }

  const pending = initial.filter((i) => i.status === 'PENDING').length;
  return (
    <div className="space-y-3">
      {pending > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="text-[length:var(--fs-12)] text-foreground">{pending} σε αναμονή</span>
          <button type="button" onClick={drain} disabled={busy != null}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 text-[length:var(--fs-11)] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none">
            <FiSend className="size-3.5" /> Στείλε τώρα
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full table-fixed">
          <thead className="border-b border-border bg-muted/50 text-left text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground">
            <tr>
              <th className="px-3 py-1.5">Εργασία</th>
              <th className="w-[9rem] px-3 py-1.5">Κατάσταση</th>
              <th className="w-[10rem] px-3 py-1.5">Πότε</th>
              <th className="w-[11rem] px-3 py-1.5">Ενέργειες</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {initial.map((i) => {
              const st = STATUS[i.status] ?? STATUS.PENDING;
              const canRetry = i.status === 'NEEDS_REVIEW' || i.status === 'REJECTED' || i.status === 'PENDING';
              const canCancel = i.status !== 'SENT' && i.status !== 'CANCELLED';
              return (
                <tr key={i.id} className="align-top">
                  <td className="min-w-0 px-3 py-2">
                    <p className="truncate text-[length:var(--fs-12)] font-medium text-foreground" title={i.label}>{i.label}</p>
                    <p className="text-[length:var(--fs-10)] text-muted-foreground">{i.kind}{i.attempts > 0 ? ` · ${i.attempts} προσπάθειες` : ''}</p>
                    {i.lastError && (
                      <p className="mt-0.5 text-[length:var(--fs-10)] text-muted-foreground">{i.lastError}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span style={{ color: st.fg, backgroundColor: st.bg }} title={st.help}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[length:var(--fs-10)] font-bold">
                      {st.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[length:var(--fs-11)] tabular-nums text-muted-foreground">
                    {new Date(i.sentAt ?? i.createdAt).toLocaleString('el-GR')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {canRetry && (
                        <button type="button" onClick={() => act(i.id, 'retry')} disabled={busy != null}
                          className={cn(BTN, 'border-sisyphus-500/40 text-sisyphus-700 hover:bg-sisyphus-500/10 dark:text-sisyphus-300')}>
                          <FiRotateCw className="size-3" /> Ξαναστείλ' τη
                        </button>
                      )}
                      {canCancel && (
                        <button type="button" onClick={() => act(i.id, 'cancel')} disabled={busy != null}
                          className={cn(BTN, 'border-input text-muted-foreground hover:bg-muted')}>
                          <FiX className="size-3" /> Ακύρωση
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const BTN =
  'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[length:var(--fs-10)] font-semibold ' +
  'transition disabled:cursor-not-allowed disabled:opacity-60';
