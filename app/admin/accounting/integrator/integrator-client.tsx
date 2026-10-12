'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiCheckCircle, FiCopy, FiPlus, FiRefreshCw, FiRotateCcw, FiAlertTriangle, FiInfo } from 'react-icons/fi';
import { BTN_GHOST, BTN_PRIMARY } from '@/components/admin/bulk-ui';
import type { IntegratorReport } from '@/lib/accounting/integrator';

const SECTION = 'rounded-xl border border-border bg-card shadow-fluent-2';
const H2 = 'text-[length:var(--fs-14)] font-semibold text-foreground';
const MUTED = 'text-[length:var(--fs-12)] text-muted-foreground';
const SEVERITY: Record<string, { text: string; cls: string }> = {
  high: { text: 'Υψηλή', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  mid: { text: 'Μεσαία', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  low: { text: 'Χαμηλή', cls: 'bg-slate-50 text-slate-700 border-slate-200' },
};
const REFRESH_MS = 60_000;
const fmt = (iso: string) => new Date(iso).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' });

function Severity({ s }: { s: string }) {
  const v = SEVERITY[s] ?? SEVERITY.mid;
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[length:var(--fs-12)] ${v.cls}`}>{v.text}</span>;
}

/** Η αναφορά ως απλό κείμενο — για email ή ticket προς τον integrator. */
function asText(r: IntegratorReport): string {
  const out = [`ΑΝΑΦΟΡΑ INTEGRATOR — ${fmt(r.generatedAt)}`, ''];
  if (r.open.length) {
    out.push('Α. ΑΙΤΗΜΑΤΑ ΛΟΓΙΣΤΗ / ΑΝΟΙΧΤΑ ΘΕΜΑΤΑ');
    r.open.forEach((i, n) => out.push(`${n + 1}. [${SEVERITY[i.severity]?.text ?? i.severity}] ${i.title}`, `   ${i.detail.replace(/\n/g, '\n   ')}`));
    out.push('');
  }
  if (r.checks.length) {
    out.push('Β. ΑΥΤΟΜΑΤΟΙ ΕΛΕΓΧΟΙ');
    r.checks.forEach((c, n) => { out.push(`${n + 1}. [${SEVERITY[c.severity].text}] ${c.title}`, `   ${c.detail}`); c.rows.forEach((x) => out.push(`   - ${x}`)); });
    out.push('');
  }
  if (r.changes.length) {
    out.push('Γ. ΑΛΛΑΓΕΣ ΣΤΗΝ ΕΓΚΑΤΑΣΤΑΣΗ ΑΠΟ ΤΗΝ ΕΦΑΡΜΟΓΗ');
    r.changes.forEach((c) => out.push(`- ${fmt(c.at)} · ${c.label}: ${c.summary}`));
  }
  return out.join('\n');
}

export function IntegratorClient({ report, canResolve, canAdd }: { report: IntegratorReport; canResolve: boolean; canAdd: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [detail, setDetail] = React.useState('');
  const [severity, setSeverity] = React.useState<'high' | 'mid' | 'low'>('mid');

  // Αυτόματη ανανέωση: η αναφορά υπολογίζεται στον server, άρα αρκεί ένα refresh όσο η σελίδα φαίνεται.
  React.useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  const setStatus = async (id: string, status: 'OPEN' | 'DONE') => {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/accounting/integrator/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error();
      toast.success(status === 'DONE' ? 'Σημειώθηκε ως διευθετημένο.' : 'Ξανάνοιξε.');
      router.refresh();
    } catch { toast.error('Η αλλαγή δεν αποθηκεύτηκε.'); } finally { setBusy(null); }
  };

  const add = async () => {
    setBusy('add');
    try {
      const r = await fetch('/api/admin/accounting/integrator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, detail, severity }) });
      if (!r.ok) throw new Error();
      toast.success('Το θέμα προστέθηκε.');
      setAdding(false); setTitle(''); setDetail(''); setSeverity('mid');
      router.refresh();
    } catch { toast.error('Το θέμα δεν αποθηκεύτηκε.'); } finally { setBusy(null); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(asText(report)); toast.success('Η αναφορά αντιγράφηκε.'); }
    catch { toast.error('Η αντιγραφή απέτυχε.'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`flex items-center gap-1.5 ${MUTED}`}>
          <FiRefreshCw className="size-3.5" aria-hidden />Ενημερώθηκε {fmt(report.generatedAt)} · ανανεώνεται αυτόματα
        </p>
        <div className="flex flex-wrap gap-2">
          {canAdd && <button type="button" className={BTN_GHOST} onClick={() => setAdding((v) => !v)} aria-expanded={adding}><FiPlus className="size-4" aria-hidden />Νέο θέμα</button>}
          <button type="button" className={BTN_PRIMARY} onClick={() => void copy()}><FiCopy className="size-4" aria-hidden />Αντιγραφή ως κείμενο</button>
        </div>
      </div>

      {adding && (
        <div className={`${SECTION} space-y-2 p-4`}>
          <label htmlFor="ii-title" className={MUTED}>Τίτλος</label>
          <input id="ii-title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-[length:var(--fs-13)]" />
          <label htmlFor="ii-detail" className={MUTED}>Τι πρέπει να γίνει</label>
          <textarea id="ii-detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-[length:var(--fs-13)]" />
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ii-sev" className={MUTED}>Προτεραιότητα</label>
            <select id="ii-sev" value={severity} onChange={(e) => setSeverity(e.target.value as 'high' | 'mid' | 'low')} className="rounded-md border border-border bg-background px-2 py-1.5 text-[length:var(--fs-13)]">
              <option value="high">Υψηλή</option><option value="mid">Μεσαία</option><option value="low">Χαμηλή</option>
            </select>
            <button type="button" className={BTN_PRIMARY} disabled={busy === 'add' || !title.trim() || !detail.trim()} onClick={() => void add()}>Προσθήκη</button>
          </div>
        </div>
      )}

      <section className={SECTION}>
        <div className="border-b border-border px-4 py-3">
          <h2 className={H2}>Α. Αιτήματα λογιστή & ανοιχτά θέματα <span className={MUTED}>({report.open.length})</span></h2>
          <p className={MUTED}>Δημιουργούνται αυτόματα όταν ο λογιστής ζητά κάτι που η εφαρμογή δεν μπορεί να κάνει μόνη της.</p>
        </div>
        {report.open.length ? (
          <ul className="divide-y divide-border">
            {report.open.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Severity s={i.severity} />
                <div className="min-w-[15rem] flex-1">
                  <p className="text-[length:var(--fs-13)] font-medium text-foreground">{i.title}</p>
                  <p className="whitespace-pre-line text-[length:var(--fs-13)] text-foreground/90">{i.detail}</p>
                  <p className={MUTED}>{i.createdBy ?? '—'} · {fmt(i.createdAt)}</p>
                </div>
                {canResolve && (
                  <button type="button" className={BTN_GHOST} disabled={busy === i.id} onClick={() => void setStatus(i.id, 'DONE')}>
                    <FiCheckCircle className="size-4" aria-hidden />Διευθετήθηκε
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : <p className={`px-4 py-4 ${MUTED}`}>Κανένα ανοιχτό αίτημα.</p>}
      </section>

      <section className={SECTION}>
        <div className="border-b border-border px-4 py-3">
          <h2 className={H2}>Β. Αυτόματοι έλεγχοι <span className={MUTED}>({report.checks.length})</span></h2>
          <p className={MUTED}>Ό,τι βλέπει η εφαρμογή ότι λείπει στο SoftOne για τα τρέχοντα παραστατικά. Φεύγουν μόνα τους όταν διορθωθούν.</p>
        </div>
        {report.checks.length ? (
          <ul className="divide-y divide-border">
            {report.checks.map((c) => (
              <li key={c.key} className="px-4 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <Severity s={c.severity} />
                  <div className="min-w-[15rem] flex-1">
                    <p className="text-[length:var(--fs-13)] font-medium text-foreground">{c.title} <span className={MUTED}>({c.rows.length})</span></p>
                    <p className={MUTED}>{c.detail}</p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[length:var(--fs-13)] text-foreground/90">
                      {c.rows.slice(0, 30).map((x) => <li key={x}>{x}</li>)}
                      {c.rows.length > 30 && <li className={MUTED}>+{c.rows.length - 30} ακόμη</li>}
                    </ul>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className={`flex items-center gap-1.5 px-4 py-4 ${MUTED}`}><FiCheckCircle className="size-4 text-emerald-600" aria-hidden />Κανένα εύρημα.</p>}
      </section>

      <section className={SECTION}>
        <div className="border-b border-border px-4 py-3">
          <h2 className={H2}>Γ. Αλλαγές στην εγκατάσταση από την εφαρμογή <span className={MUTED}>({report.changes.length})</span></h2>
          <p className={MUTED}>Λογαριασμοί, έξοδα, χρεοπιστώσεις, είδη, καρτέλες και καταχωρίσεις που έγιναν στο SoftOne μέσα από την εφαρμογή{report.tenantSince ? ` — από τη σύνδεση με την τρέχουσα εγκατάσταση (${fmt(report.tenantSince)})` : ''}.</p>
        </div>
        {report.changes.length ? (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-[length:var(--fs-13)]">
              <thead className="sticky top-0 bg-card text-left">
                <tr className={MUTED}><th className="px-4 py-2 font-medium">Πότε</th><th className="px-4 py-2 font-medium">Ενέργεια</th><th className="px-4 py-2 font-medium">Τι</th><th className="hidden px-4 py-2 font-medium md:table-cell">Ποιος</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.changes.map((c, n) => (
                  <tr key={`${c.at}-${n}`}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{fmt(c.at)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{c.label}</td>
                    <td className="px-4 py-2">{c.summary}</td>
                    <td className="hidden px-4 py-2 text-muted-foreground md:table-cell">{c.who ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className={`flex items-center gap-1.5 px-4 py-4 ${MUTED}`}><FiInfo className="size-4" aria-hidden />Δεν έχει γίνει καμία αλλαγή.</p>}
      </section>

      {report.done.length > 0 && (
        <details className={SECTION}>
          <summary className="cursor-pointer px-4 py-3 text-[length:var(--fs-13)] font-medium">Διευθετημένα ({report.done.length})</summary>
          <ul className="divide-y divide-border border-t border-border">
            {report.done.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <FiCheckCircle className="size-4 text-emerald-600" aria-hidden />
                <span className="min-w-0 flex-1 text-[length:var(--fs-13)]">{i.title}</span>
                <span className={MUTED}>{i.resolvedBy ?? '—'}{i.resolvedAt ? ` · ${fmt(i.resolvedAt)}` : ''}</span>
                {canResolve && (
                  <button type="button" className={BTN_GHOST} disabled={busy === i.id} onClick={() => void setStatus(i.id, 'OPEN')}>
                    <FiRotateCcw className="size-4" aria-hidden />Επαναφορά
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!canResolve && <p className={`flex items-center gap-1.5 ${MUTED}`}><FiAlertTriangle className="size-3.5" aria-hidden />Τα θέματα κλείνουν από χρήστη με δικαίωμα διαχείρισης μητρώων.</p>}
    </div>
  );
}
