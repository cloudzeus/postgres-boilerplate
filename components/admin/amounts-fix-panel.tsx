'use client';

// «Τα ποσά δεν κλείνουν — τι να κάνω;» Κοινό για τη σελίδα του παραστατικού και την καρτέλα της λίστας.
//
// Δύο πηγές λύσεων, και οι δύο ΕΛΕΓΜΕΝΕΣ πριν φανούν (κλείνουν σε όλους τους ελέγχους):
//   1. αριθμητικές εξηγήσεις (`totalsPlans`): έκπτωση % στη γραμμή, ΦΠΑ πάνω στις επιβαρύνσεις…
//   2. ΕΠΑΝΕΛΕΓΧΟΣ από το χαρτί: ξαναδιαβάζονται μόνο τα ποσά και η νέα ανάγνωση ελέγχεται κι αυτή.
// Κάθε λύση δείχνει ΤΙ αλλάζει (παλιό → νέο) πριν από το κλικ.

import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { FiAlertCircle, FiCheck, FiFileText, FiLoader, FiRefreshCw } from 'react-icons/fi';
import { totalsClose, totalsPlans, type FixStep, type TotalsInput, n } from '@/lib/ocr/invoice-math';
import type { AmountsProposal, RecheckResult } from '@/lib/ocr/amounts-recheck';

export type PanelItem = TotalsInput['items'][number] & { rowIndex: number };
export interface PanelInput extends Omit<TotalsInput, 'items'> { items: PanelItem[] }

const eur = (v: unknown) => { const x = n(v); return x == null ? '—' : `${x.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`; };

const STEP_TEXT = (s: FixStep): string => {
  switch (s.kind) {
    case 'line_discount': return `Έκπτωση ${String(s.pct).replace('.', ',')}% στις γραμμές — υπάρχει στο χαρτί αλλά δεν είχε διαβαστεί`;
    case 'line_discount_from_total': return 'Η γραμμή έχει έκπτωση % — βγαίνει ακριβώς από το σύνολό της (δεν είχε διαβαστεί)';
    case 'net_from_lines': return 'Καθαρή αξία = άθροισμα των γραμμών';
    case 'vat': return s.mode === 'lines' ? 'ΦΠΑ = ΦΠΑ των γραμμών' : 'Ο ΦΠΑ υπολογίζεται ΚΑΙ πάνω στις επιβαρύνσεις (π.χ. τέλος ανακύκλωσης)';
    case 'vat_rate': return `Οι γραμμές έχουν ΦΠΑ ${s.rate}% — δεν είχε διαβαστεί συντελεστής`;
    case 'total': return s.mode === 'net_vat' ? 'Γενικό Σύνολο = καθαρή + ΦΠΑ (το σύνολο διαβάστηκε λάθος)' : 'Γενικό Σύνολο = καθαρή + ΦΠΑ + επιβαρύνσεις';
    case 'fees_from_diff': return 'Η διαφορά είναι επιβαρύνσεις (μεταφορικά, τέλη) που δεν διαβάστηκαν χωριστά';
  }
};

/** «Τι αλλάζει»: παλιό → νέο, μόνο ό,τι αλλάζει. */
function changes(a: PanelInput, b: TotalsInput): string[] {
  const out: string[] = [];
  const f = (label: string, x: unknown, y: unknown) => { if ((n(x) ?? null) !== (n(y) ?? null)) out.push(`${label}: ${eur(x)} → ${eur(y)}`); };
  b.items.forEach((l, i) => {
    const o = a.items[i];
    if (!o) return;
    if ((n(o.total) ?? null) !== (n(l.total) ?? null)) out.push(`Γραμμή ${i + 1}: σύνολο ${eur(o.total)} → ${eur(l.total)}${n(l.discount) ? ` (έκπτωση ${l.discount})` : ''}`);
    if ((n(o.vatRate) ?? null) !== (n(l.vatRate) ?? null)) out.push(`Γραμμή ${i + 1}: ΦΠΑ ${n(o.vatRate) ?? '—'}% → ${n(l.vatRate) ?? '—'}%`);
  });
  f('Καθαρή αξία', a.subtotal, b.subtotal);
  f('ΦΠΑ', a.vatAmount, b.vatAmount);
  f('Επιβαρύνσεις', a.otherCharges, b.otherCharges);
  f('Γενικό Σύνολο', a.totalAmount, b.totalAmount);
  return out;
}

const toProposal = (input: PanelInput, r: TotalsInput): AmountsProposal => ({
  subtotal: n(r.subtotal), vatAmount: n(r.vatAmount), otherCharges: n(r.otherCharges), totalAmount: n(r.totalAmount),
  lines: r.items.map((l, i) => ({
    rowIndex: input.items[i]?.rowIndex ?? i, quantity: n(l.quantity), price: n(l.price), discount: n(l.discount), total: n(l.total), vatRate: n(l.vatRate),
  })),
});

export function AmountsFixPanel({ docId, input, canManage, onApplyLocal, onSaved }: {
  docId: string;
  input: PanelInput;
  canManage: boolean;
  /** Καρτέλα λίστας: η λύση μπαίνει στη φόρμα (αποθηκεύει ο χρήστης). */
  onApplyLocal?: (r: TotalsInput) => void;
  /** Σελίδα παραστατικού: η λύση αποθηκεύεται αμέσως. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const closes = React.useMemo(() => totalsClose(input), [input]);
  const plans = React.useMemo(() => (closes ? [] : totalsPlans(input)), [closes, input]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [recheck, setRecheck] = React.useState<RecheckResult | null>(null);
  React.useEffect(() => { setRecheck(null); }, [docId]);

  if (closes || !canManage) return null;

  const apply = async (r: TotalsInput, source: 'plan' | 'recheck', key: string) => {
    if (onApplyLocal) { onApplyLocal(r); toast.success('Η διόρθωση μπήκε στη φόρμα — έλεγξε και πάτα «Αποθήκευση».'); return; }
    setBusy(key);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/amounts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', source, proposal: toProposal(input, r) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.message ?? 'Η διόρθωση δεν εφαρμόστηκε.'); return; }
      toast.success('Τα ποσά διορθώθηκαν — όλοι οι έλεγχοι κλείνουν.');
      if (onSaved) onSaved(); else router.refresh();
    } catch { toast.error('Σφάλμα δικτύου — δεν εφαρμόστηκε τίποτα.'); } finally { setBusy(null); }
  };

  const runRecheck = async () => {
    setBusy('recheck');
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/amounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recheck' }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.message ?? 'Ο επανέλεγχος απέτυχε.'); return; }
      setRecheck(d as RecheckResult);
    } catch { toast.error('Σφάλμα δικτύου — ο επανέλεγχος δεν έγινε.'); } finally { setBusy(null); }
  };

  const recheckInput: TotalsInput | null = recheck?.proposal ? {
    items: input.items.map((it) => {
      const l = recheck.proposal!.lines.find((x) => x.rowIndex === it.rowIndex);
      return l ? { quantity: l.quantity, price: l.price, discount: l.discount, vatRate: l.vatRate, total: l.total } : it;
    }),
    subtotal: recheck.proposal.subtotal, vatAmount: recheck.proposal.vatAmount,
    otherCharges: recheck.proposal.otherCharges, totalAmount: recheck.proposal.totalAmount,
  } : null;

  return (
    <div role="region" aria-label="Τα ποσά δεν κλείνουν" className="rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30">
      <p className="flex items-center gap-1.5 text-[length:var(--fs-12)] font-bold text-amber-900 dark:text-amber-200">
        <FiAlertCircle aria-hidden className="size-3.5" /> Τα ποσά δεν κλείνουν — τι να κάνεις
      </p>

      {plans.length > 0 ? (
        <ul className="mt-1.5 space-y-2">
          {plans.map((p, i) => (
            <li key={i} className="rounded-md bg-card/80 px-2.5 py-2 text-[length:var(--fs-12)] text-foreground">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{i === 0 ? 'Πιθανότερη εξήγηση' : `Εναλλακτικά (${i + 1})`}</p>
                  <ul className="mt-0.5 list-disc pl-4">{p.steps.map((s, k) => <li key={k}>{STEP_TEXT(s)}</li>)}</ul>
                  <p className="mt-1 text-[length:var(--fs-11)] text-muted-foreground">{changes(input, p.result).join(' · ')}</p>
                </div>
                <button type="button" disabled={busy != null} onClick={() => void apply(p.result, 'plan', `p${i}`)}
                  className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50">
                  {busy === `p${i}` ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiCheck aria-hidden className="size-3.5" />} Εφάρμοσε
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[length:var(--fs-12)] text-foreground">Καμία γνωστή εξήγηση δεν κλείνει τα ποσά. Κάνε επανέλεγχο από το χαρτί.</p>
      )}

      {/* ΕΠΑΝΕΛΕΓΧΟΣ: η απάντηση είναι στο χαρτί, όχι στην αριθμητική. */}
      <div className="mt-2 border-t border-amber-200 pt-2 dark:border-amber-800">
        {!recheck ? (
          <button type="button" disabled={busy != null} onClick={() => void runRecheck()}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-sisyphus-500/40 bg-card px-2.5 text-[length:var(--fs-12)] font-semibold text-sisyphus-700 hover:bg-sisyphus-500/10 disabled:opacity-50 dark:text-sisyphus-300">
            {busy === 'recheck' ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiRefreshCw aria-hidden className="size-3.5" />}
            {busy === 'recheck' ? 'Ξαναδιαβάζω τα ποσά από το χαρτί…' : 'Επανέλεγχος από το χαρτί'}
          </button>
        ) : (
          <div className="text-[length:var(--fs-12)] text-foreground">
            <p className="flex items-center gap-1.5 font-semibold">
              <FiFileText aria-hidden className="size-3.5" /> Επανέλεγχος από το χαρτί: {recheck.closes ? <span className="text-emerald-700 dark:text-emerald-300">κλείνει ✓</span> : <span className="text-amber-800 dark:text-amber-300">δεν κλείνει</span>}
            </p>
            <p className="text-[length:var(--fs-11)] text-muted-foreground">{recheck.message}</p>
            {recheck.closes && recheckInput && plans[0] && changes(input, recheckInput).join() === changes(input, plans[0].result).join() && (
              <p className="mt-0.5 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[length:var(--fs-11)] font-semibold text-emerald-800 dark:text-emerald-300">
                <FiCheck aria-hidden className="size-3" /> Η νέα ανάγνωση επιβεβαιώνει την πιθανότερη εξήγηση
              </p>
            )}
            {recheck.closes && recheck.steps && (
              <ul className="mt-0.5 list-disc pl-4 text-[length:var(--fs-12)]">{recheck.steps.map((s, k) => <li key={k}>{STEP_TEXT(s)}</li>)}</ul>
            )}
            {recheck.closes && recheckInput && (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 text-[length:var(--fs-11)] text-muted-foreground">{changes(input, recheckInput).join(' · ') || 'Καμία αλλαγή.'}</p>
                <button type="button" disabled={busy != null} onClick={() => void apply(recheckInput, 'recheck', 'r')}
                  className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50">
                  {busy === 'r' ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiCheck aria-hidden className="size-3.5" />} Εφάρμοσε την ανάγνωση
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
