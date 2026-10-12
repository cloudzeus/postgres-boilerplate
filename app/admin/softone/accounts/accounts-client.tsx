'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiCopy, FiRefreshCw, FiSearch, FiAlertTriangle, FiCheckCircle, FiExternalLink, FiPlus } from 'react-icons/fi';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_GHOST, BTN_PRIMARY } from '@/components/admin/bulk-ui';
import type { ChartRow, MissingAccount, UtilityGap } from '@/lib/ocr/accounts-overview';
import type { AccountStatus } from '@/lib/ocr/account-check';

const STATUS_TEXT: Partial<Record<AccountStatus, string>> = {
  not_in_chart: 'Δεν υπάρχει στο σχέδιο',
  not_postable: 'Συγκεντρωτικός — δεν κινείται',
  mask: 'Μοτίβο αντί για λογαριασμό',
  missing: 'Η χρεοπίστωση δεν έχει λογαριασμό',
};

const SECTION = 'rounded-xl border border-border bg-card shadow-fluent-2';
const H2 = 'text-[length:var(--fs-14)] font-semibold text-foreground';
const MUTED = 'text-[length:var(--fs-12)] text-muted-foreground';
const MAX_ROWS = 300;

function DocLinks({ docs }: { docs: { id: string; fileName: string }[] }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {docs.slice(0, 4).map((d) => (
        <Link key={d.id} href={`/admin/ocr/${d.id}`} className="inline-flex items-center gap-0.5 text-sisyphus-700 hover:underline">
          {d.fileName.replace(/\.(pdf|png|jpe?g)$/i, '')}<FiExternalLink className="size-3" aria-hidden />
        </Link>
      ))}
      {docs.length > 4 && <span>+{docs.length - 4}</span>}
    </span>
  );
}

type OpenRequest = { code: string; name: string; vatRate: number | null };
type Plan = {
  code: string; name: string;
  parent: { code: string; name: string };
  template: { code: string; name: string };
  vat: { rate: number; code: string } | null;
  vatAccount: { code: string; name: string } | null;
};

/**
 * Άνοιγμα λογαριασμού στο SoftOne σε δύο βήματα: πρώτα η εφαρμογή δείχνει ΤΙ θα σταλεί (πρότυπο,
 * ΦΠΑ, λογαριασμός ΦΠΑ), και μόνο μετά από ρητό «Άνοιγμα» φεύγει η εγγραφή.
 */
function OpenAccountDialog({ req, onClose, onDone }: { req: OpenRequest | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = React.useState('');
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Η περιγραφή της τελευταίας προεπισκόπησης: χωρίς αλλαγή, η απομάκρυνση από το πεδίο δεν ξανατρέχει
  // προεπισκόπηση (που θα απενεργοποιούσε το κουμπί ακριβώς τη στιγμή του κλικ).
  const previewed = React.useRef('');

  React.useEffect(() => {
    if (!req) return;
    setName(req.name); setPlan(null); setError(null); previewed.current = '';
    void preview(req.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  async function call(body: object) {
    const res = await fetch('/api/admin/softone/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: req!.code, name, vatRate: req!.vatRate, ...body }),
    });
    return { ok: res.ok, d: await res.json().catch(() => ({})) };
  }
  async function preview(n = name) {
    if (!req || !n.trim() || n === previewed.current) return;
    previewed.current = n;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/softone/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: req.code, name: n, vatRate: req.vatRate, dryRun: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setPlan(d); setError(null); } else { setPlan(null); setError(d.message ?? 'Η προεπισκόπηση απέτυχε.'); }
    } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true);
    try {
      const { ok, d } = await call({});
      if (!ok) { setError(d.message ?? 'Η δημιουργία απέτυχε.'); return; }
      toast.success(`Ο λογαριασμός ${d.code} άνοιξε στο SoftOne και επαληθεύτηκε.`);
      onDone();
    } catch {
      setError('Σφάλμα δικτύου — έλεγξε στο SoftOne αν δημιουργήθηκε πριν ξαναπροσπαθήσεις.');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!req} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Άνοιγμα λογαριασμού στο SoftOne</DialogTitle>
          <DialogDescription className="font-mono">{req?.code}</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1">
          <span className="text-[length:var(--fs-12)] font-semibold text-foreground">Περιγραφή</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void preview()}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-[length:var(--fs-14)]" />
        </label>
        {plan && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-[length:var(--fs-12)]">
            <dt className="text-muted-foreground">Κάτω από</dt><dd><span className="font-mono">{plan.parent.code}</span> {plan.parent.name}</dd>
            <dt className="text-muted-foreground">Ρυθμίσεις από</dt><dd><span className="font-mono">{plan.template.code}</span> {plan.template.name}</dd>
            <dt className="text-muted-foreground">ΦΠΑ</dt><dd>{plan.vat ? `${plan.vat.rate}% (κωδ. ${plan.vat.code})` : 'Χωρίς ΦΠΑ'}</dd>
            {plan.vatAccount && <><dt className="text-muted-foreground">Λογ. ΦΠΑ</dt><dd><span className="font-mono">{plan.vatAccount.code}</span> {plan.vatAccount.name}</dd></>}
          </dl>
        )}
        {error && <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-[length:var(--fs-12)] text-foreground">{error}</p>}
        <DialogFooter className="mx-0 mb-0">
          <button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>Άκυρο</button>
          <button type="button" className={BTN_PRIMARY} onClick={create} disabled={busy || !plan}>
            {busy ? 'Περιμένε…' : 'Άνοιγμα στο SoftOne'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsClient({
  missing, chartSynced, gaps, chart, syncedAt, canSync,
}: {
  missing: MissingAccount[];
  chartSynced: boolean;
  gaps: UtilityGap[];
  chart: ChartRow[];
  syncedAt: string | null;
  canSync: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [onlyPostable, setOnlyPostable] = React.useState(false);
  const [openReq, setOpenReq] = React.useState<OpenRequest | null>(null);
  const [activating, setActivating] = React.useState<number | null>(null);
  const activate = async (mtrl: number, code: string) => {
    setActivating(mtrl);
    try {
      const res = await fetch(`/api/admin/softone/lineitems/${mtrl}/activate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowCreditors: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok && d.error !== 'nothing_to_do') { toast.error(d.message ?? 'Η ενεργοποίηση απέτυχε.'); return; }
      toast.success(`Ενεργοποιήθηκε η ${code} — διάλεξέ τη τώρα σε μία γραμμή του λογαριασμού.`);
      router.refresh();
    } catch {
      toast.error('Σφάλμα δικτύου.');
    } finally { setActivating(null); }
  };
  const openBtn = (r: OpenRequest) => canSync && (
    <button type="button" className={`${BTN_PRIMARY} mt-1`} onClick={() => setOpenReq(r)}>
      <FiPlus className="size-3.5" aria-hidden /> Άνοιγμα στο SoftOne
    </button>
  );

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/metadata/sync-accounts-softone', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.message ?? d.error ?? 'Ο συγχρονισμός απέτυχε.'); return; }
      toast.success(`Το σχέδιο ενημερώθηκε: ${d.total ?? 0} λογαριασμοί (${d.created ?? 0} νέοι).`);
      router.refresh();
    } catch {
      toast.error('Σφάλμα δικτύου — ο συγχρονισμός δεν έγινε.');
    } finally {
      setSyncing(false);
    }
  };

  // Οι λογαριασμοί προς άνοιγμα, έτοιμοι για επικόλληση: «κωδικός<TAB>περιγραφή».
  // Και οι λογαριασμοί που λείπουν για τον ΦΠΑ των λογαριασμών κοινής ωφέλειας — μία λίστα, χωρίς διπλά.
  const toCreate = [
    ...missing.filter((m) => m.status === 'not_in_chart' && m.account).map((m) => ({ code: m.account!, name: m.proposedName })),
    ...gaps.flatMap((g) => (g.toOpen ? [g.toOpen] : [])),
  ].filter((a, i, arr) => arr.findIndex((b) => b.code === a.code) === i);
  const copyForSoftone = async () => {
    const text = toCreate.map((a) => `${a.code}\t${a.name ?? ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Αντιγράφηκαν ${toCreate.length} λογαριασμοί για το SoftOne.`);
    } catch {
      toast.error('Ο browser δεν επέτρεψε την αντιγραφή.');
    }
  };

  const nq = q.trim().toLowerCase();
  const filtered = React.useMemo(
    () => chart.filter((r) => (!onlyPostable || r.postable === true)
      && (!nq || r.code.startsWith(nq) || r.name.toLowerCase().includes(nq))),
    [chart, nq, onlyPostable],
  );

  return (
    <div className="space-y-5">
      <OpenAccountDialog req={openReq} onClose={() => setOpenReq(null)} onDone={() => { setOpenReq(null); router.refresh(); }} />
      <p className="rounded-lg border border-sisyphus-500/25 bg-sisyphus-500/[0.06] px-4 py-3 text-[length:var(--fs-13)] text-foreground">
        Ο λογαριασμός που λείπει ανοίγει με <strong>«Άνοιγμα στο SoftOne»</strong>: παίρνει τις ρυθμίσεις του διπλανού λογαριασμού
        της ίδιας ομάδας, τον σωστό ΦΠΑ και τον λογαριασμό ΦΠΑ εισροών του ίδιου συντελεστή. Πριν φύγει βλέπεις τι θα σταλεί,
        και μετά η εφαρμογή ελέγχει ότι το σχέδιο απέκτησε ακριβώς έναν λογαριασμό. Οι <strong>χρεοπιστώσεις</strong> δημιουργούνται
        από τη γραμμή του παραστατικού.
      </p>

      {/* 1. ΤΙ ΛΕΙΠΕΙ */}
      <section aria-labelledby="missing-h" className={SECTION}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="missing-h" className={H2}>Λείπουν από το σχέδιο</h2>
            <p className={MUTED}>Λογαριασμοί που χρειάζονται γραμμές ανοιχτών παραστατικών και δεν μπορούν να δεχτούν εγγραφή.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {toCreate.length > 0 && (
              <button type="button" className={BTN_GHOST} onClick={copyForSoftone}>
                <FiCopy className="size-3.5" aria-hidden /> Αντιγραφή για το SoftOne ({toCreate.length})
              </button>
            )}
            {canSync && (
              <button type="button" className={BTN_PRIMARY} onClick={sync} disabled={syncing}>
                <FiRefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
                {syncing ? 'Συγχρονισμός…' : 'Συγχρονισμός σχεδίου'}
              </button>
            )}
          </div>
        </header>
        {!chartSynced ? (
          <p className={`px-4 py-6 ${MUTED}`}>Το σχέδιο δεν έχει συγχρονιστεί ακόμη — πάτησε «Συγχρονισμός σχεδίου».</p>
        ) : missing.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-[length:var(--fs-13)] text-emerald-700">
            <FiCheckCircle className="size-4" aria-hidden /> Όλοι οι λογαριασμοί που χρειάζονται τα ανοιχτά παραστατικά υπάρχουν.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {missing.map((m) => (
              <li key={`${m.status}|${m.account ?? m.article}`} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-start">
                <div>
                  <p className="font-mono text-[length:var(--fs-13)] font-semibold text-foreground">{m.account ?? '—'}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[length:var(--fs-11)] font-semibold text-amber-700">
                    <FiAlertTriangle className="size-3" aria-hidden /> {STATUS_TEXT[m.status] ?? m.status}
                  </p>
                </div>
                <div className="min-w-0 space-y-1 text-[length:var(--fs-12)]">
                  {m.proposedName && (
                    <p><span className="text-muted-foreground">Άνοιγμα ως: </span><span className="font-semibold text-foreground">{m.proposedName}</span>
                      {m.parent && <span className="text-muted-foreground"> · κάτω από {m.parent.code}</span>}</p>
                  )}
                  {m.article && <p className="text-muted-foreground">Χρεοπίστωση: <span className="text-foreground">{m.article}</span></p>}
                  <div className="text-muted-foreground"><DocLinks docs={m.docs} /></div>
                </div>
                <div className="flex flex-col items-start gap-1 md:items-end">
                  <p className="text-[length:var(--fs-12)] tabular-nums text-muted-foreground md:text-right">
                    {m.lines} γραμμ{m.lines === 1 ? 'ή' : 'ές'} · {m.docs.length} παραστ.
                  </p>
                  {m.status === 'not_in_chart' && m.account && openBtn({ code: m.account, name: m.proposedName ?? '', vatRate: m.vatRate })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. ΧΡΕΩΣΕΙΣ ΧΩΡΙΣ ΧΡΕΟΠΙΣΤΩΣΗ */}
      {gaps.length > 0 && (
        <section aria-labelledby="gaps-h" className={SECTION}>
          <header className="border-b border-border px-4 py-3">
            <h2 id="gaps-h" className={H2}>Λογαριασμοί κοινής ωφέλειας χωρίς χρεοπίστωση</h2>
            <p className={MUTED}>
              Άνοιξε ένα παραστατικό και δημιούργησε ή διάλεξε χρεοπίστωση σε μία γραμμή: ισχύει για όλες τις γραμμές του ίδιου είδους,
              σε όλους τους λογαριασμούς. Δίπλα, οι λογαριασμοί του σχεδίου που ταιριάζουν.
            </p>
          </header>
          <ul className="divide-y divide-border">
            {gaps.map((g) => (
              <li key={`${g.kind}:${g.charge}`} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-start">
                <p className="text-[length:var(--fs-13)] font-semibold text-foreground">{g.label}</p>
                <div className="min-w-0 space-y-1.5 text-[length:var(--fs-12)]">
                  <div className="text-muted-foreground"><DocLinks docs={g.docs} /></div>
                  {g.toOpen && (
                    <p className="inline-flex flex-wrap items-center gap-1 text-amber-800">
                      <FiAlertTriangle className="size-3" aria-hidden />
                      Λείπει για ΦΠΑ {g.vatRate}%: <span className="font-mono font-semibold">{g.toOpen.code}</span>
                      {g.toOpen.name && <span>· {g.toOpen.name}</span>}
                    </p>
                  )}
                  {g.toOpen && openBtn({ code: g.toOpen.code, name: g.toOpen.name ?? '', vatRate: g.toOpen.vatRate })}
                  {g.inactive.length > 0 && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2">
                      <p className="text-[length:var(--fs-11)] font-semibold text-foreground">Υπάρχουν ήδη στο SoftOne, ανενεργές:</p>
                      <ul className="mt-1 space-y-1">
                        {g.inactive.map((it) => (
                          <li key={it.mtrl} className="flex flex-wrap items-center justify-between gap-2">
                            <span><span className="font-mono font-semibold text-foreground">{it.code}</span> <span className="text-muted-foreground">{it.name}</span></span>
                            {canSync && (
                              <button type="button" className={BTN_GHOST} disabled={activating != null} onClick={() => activate(it.mtrl, it.code)}>
                                {activating === it.mtrl ? 'Ενεργοποίηση…' : 'Ενεργοποίηση'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {g.suggestions.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5" aria-label="Λογαριασμοί του σχεδίου που ταιριάζουν">
                      {g.suggestions.map((s) => (
                        <li key={s.code} className="rounded-md border border-border bg-background px-2 py-0.5">
                          <span className="font-mono font-semibold text-foreground">{s.code}</span>
                          <span className="text-muted-foreground"> {s.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-amber-700">Κανένας κατάλληλος κινούμενος λογαριασμός στο σχέδιο — χρειάζεται άνοιγμα στο SoftOne.</p>
                  )}
                </div>
                <p className="text-[length:var(--fs-12)] tabular-nums text-muted-foreground md:text-right">
                  {g.lines} γραμμ{g.lines === 1 ? 'ή' : 'ές'} · {g.docs.length} παραστ.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. ΟΛΟ ΤΟ ΣΧΕΔΙΟ */}
      <section aria-labelledby="chart-h" className={SECTION}>
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="chart-h" className={H2}>Όλο το σχέδιο <span className="font-normal text-muted-foreground">· {chart.length.toLocaleString('el-GR')} λογαριασμοί</span></h2>
            <p className={MUTED}>{syncedAt ? `Τελευταίος συγχρονισμός ${new Date(syncedAt).toLocaleString('el-GR')}` : 'Δεν έχει συγχρονιστεί'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative">
              <span className="sr-only">Αναζήτηση λογαριασμού</span>
              <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Κωδικός ή περιγραφή"
                className="h-9 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-[length:var(--fs-13)]"
              />
            </label>
            <label className="inline-flex min-h-9 items-center gap-2 text-[length:var(--fs-12)] text-foreground">
              <input type="checkbox" checked={onlyPostable} onChange={(e) => setOnlyPostable(e.target.checked)} className="size-4 rounded border-input" />
              Μόνο κινούμενοι
            </label>
          </div>
        </header>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-[length:var(--fs-12)]">
            <thead className="sticky top-0 bg-card text-left text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_var(--color-border)]">
              <tr>
                <th className="px-4 py-2">Κωδικός</th>
                <th className="px-4 py-2">Περιγραφή</th>
                <th className="px-4 py-2">Κινείται</th>
                <th className="px-4 py-2 text-right">Χρεοπιστώσεις</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, MAX_ROWS).map((r) => (
                <tr key={r.code} className={`border-t border-border ${r.active ? '' : 'opacity-50'}`}>
                  <td className="whitespace-nowrap px-4 py-1.5 font-mono tabular-nums" style={{ paddingLeft: `${1 + Math.max(0, (r.grade ?? 1) - 1) * 0.75}rem` }}>
                    {r.code}
                  </td>
                  <td className={`px-4 py-1.5 ${r.postable ? 'text-foreground' : 'font-semibold text-foreground'}`}>
                    {r.name}{!r.active && <span className="ml-1 text-muted-foreground">(ανενεργός)</span>}
                  </td>
                  <td className="px-4 py-1.5 text-muted-foreground">{r.postable === true ? 'Ναι' : r.postable === false ? 'Όχι' : '—'}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{r.lineItems || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > MAX_ROWS && (
            <p className={`px-4 py-3 ${MUTED}`}>Εμφανίζονται οι πρώτοι {MAX_ROWS} από {filtered.length.toLocaleString('el-GR')} — στένεψε την αναζήτηση.</p>
          )}
          {filtered.length === 0 && <p className={`px-4 py-6 ${MUTED}`}>Κανένας λογαριασμός δεν ταιριάζει.</p>}
        </div>
      </section>
    </div>
  );
}
