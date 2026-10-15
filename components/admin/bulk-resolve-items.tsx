'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiLayers, FiCheck, FiAlertTriangle, FiClock, FiLoader, FiX, FiDatabase, FiLink, FiSearch, FiAlertOctagon } from 'react-icons/fi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { MatchKind } from '@/lib/ocr/line-match';
import {
  planItemRow, withKind, withTarget, creatableKind, sharedSupplierCodes, KIND_LABEL,
  type ItemPlanInput, type ItemPlanRow, type ItemTarget,
} from '@/lib/ocr/bulk-item-plan';
import { Line, Chip, BTN_PRIMARY, BTN_GHOST } from '@/components/admin/bulk-ui';

type Opt = { code: string; label: string; rate?: number | null };
type RunState = { s: 'idle' } | { s: 'running' } | { s: 'done'; msg: string } | { s: 'error'; msg: string };

const KINDS: MatchKind[] = ['product', 'service', 'expense', 'lineitem'];
/** Ποιος τύπος αναζήτησης του `/api/admin/softone/search` αντιστοιχεί σε κάθε μητρώο. */
const SEARCH_TYPE: Record<MatchKind, string> = { product: 'products', service: 'services', expense: 'expenses', lineitem: 'lineitems' };

/**
 * ΓΡΗΓΟΡΟ ΚΟΥΜΠΙ + MODAL μαζικής διευθέτησης γραμμών («Είδη & έξοδα»).
 *
 * Ο ένας-ένας δρόμος ήταν μια ομάδα τη φορά: διάλεξε μητρώο, πάρε κωδικό, δημιούργησε ή ψάξε,
 * επόμενη. Με 141 ομάδες, απόγευμα ολόκληρο. Εδώ:
 *   • ΦΙΛΤΡΟ ανά εκδότη + «επιλογή όλων» → π.χ. όλα τα εργαλεία της BESSEY μαζί
 *   • ΜΗΤΡΩΟ για τις επιλεγμένες με ένα πάτημα → «Είδος» σε 29 ομάδες
 *   • ΑΝΤΙΣΤΟΙΧΙΣΗ επιλεγμένων σε ΕΝΑ υπάρχον → όλες οι χρεώσεις της ZIM σε μία χρεοπίστωση
 *   • ΕΚΤΕΛΕΣΗ σειριακά, με φρέσκο κωδικό ανά νέα καρτέλα και κατάσταση ανά γραμμή
 *
 * Ίδια όψη, ίδια συμπεριφορά με τη μαζική δημιουργία συναλλασσομένων (`bulk-ui.tsx`). Γράφει μέσω
 * των ΥΠΑΡΧΟΝΤΩΝ routes (`new-items/create`, `new-items/match`) — ίδιοι έλεγχοι, ίδια μνήμη
 * κανόνων, καμία δεύτερη λογική.
 */
export function BulkResolveItemsButton(p: { groups: ItemPlanInput[]; vats: Opt[]; units: Opt[]; canManage: boolean }) {
  const [open, setOpen] = React.useState(false);
  if (!p.canManage) return null;
  return (
    <>
      {p.groups.length > 0 && (
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 active:bg-sisyphus-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500/40 focus-visible:ring-offset-1">
          <FiLayers className="size-3.5" /> Μαζική διευθέτηση ({p.groups.length})
        </button>
      )}
      {/* Μένει ανοιχτό ακόμη κι αν αδειάσει η ουρά μετά την εκτέλεση — αλλιώς τα αποτελέσματα χάνονται. */}
      {open && <Modal {...p} onClose={() => setOpen(false)} />}
    </>
  );
}

function Modal({ groups, vats, units, onClose }: { groups: ItemPlanInput[]; vats: Opt[]; units: Opt[]; onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<ItemPlanRow[]>(() => groups.map(planItemRow));
  const [run, setRun] = React.useState<Record<string, RunState>>({});
  const [phase, setPhase] = React.useState<'edit' | 'confirm' | 'running' | 'finished'>('edit');
  const [supplier, setSupplier] = React.useState('');
  const [vat, setVat] = React.useState(() => vats.find((v) => v.rate === 24)?.code ?? vats[0]?.code ?? '');
  const [unit, setUnit] = React.useState(() => units.find((u) => /τεμ/i.test(u.label))?.code ?? units[0]?.code ?? '');
  const [target, setTarget] = React.useState<string | null>(null);
  const [picker, setPicker] = React.useState(false);
  const stop = React.useRef(false);
  /** Κωδικοί προμηθευτή που μοιράζονται πολλές ομάδες — δεν χρησιμοποιούνται ως κωδικός είδους. */
  const shared = React.useMemo(() => sharedSupplierCodes(groups), [groups]);
  const idCode = (r: ItemPlanRow) => (r.code && !shared.has(`${r.afm}|${r.code}`) ? r.code : null);

  React.useEffect(() => {
    fetch('/api/admin/softone/connection', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.tenantKey) setTarget(String(j.tenantKey).split('|')[0]); })
      .catch(() => null);
  }, []);

  const suppliers = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.supplier ?? '—', (m.get(r.supplier ?? '—') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const visible = rows.filter((r) => !supplier || (r.supplier ?? '—') === supplier);
  const busy = phase === 'running';
  const locked = busy || phase === 'finished';
  const executable = rows.filter((r) => r.selected && r.status === 'ready' && run[r.key]?.s !== 'done');
  // Η εργαλειοθήκη δρα ΜΟΝΟ σε ό,τι ΦΑΙΝΕΤΑΙ. Με «όλες τις επιλεγμένες», ένα φίλτρο «BESSEY» +
  // «Είδος» θα άλλαζε και τις κρυμμένες επιλεγμένες γραμμές άλλου εκδότη — δηλαδή ο χρήστης θα
  // άλλαζε κάτι που δεν βλέπει. Η ΕΚΤΕΛΕΣΗ αντίθετα παίρνει όλες τις έτοιμες, ορατές ή όχι.
  const visibleKeys = new Set(visible.map((r) => r.key));
  const checked = visible.filter((r) => r.selected);
  const counts = {
    ready: rows.filter((r) => r.status === 'ready').length,
    kind: rows.filter((r) => r.status === 'needs_kind').length,
    target: rows.filter((r) => r.status === 'needs_target').length,
  };

  const update = (key: string, f: (r: ItemPlanRow) => ItemPlanRow) => setRows((rs) => rs.map((r) => (r.key === key ? f(r) : r)));
  const updateChecked = (f: (r: ItemPlanRow) => ItemPlanRow) =>
    setRows((rs) => rs.map((r) => (r.selected && visibleKeys.has(r.key) && run[r.key]?.s !== 'done' ? f(r) : r)));

  async function runOne(r: ItemPlanRow): Promise<RunState> {
    if (r.action === 'match' && r.target) {
      const t = r.target;
      const res = await fetch('/api/admin/ocr/new-items/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          afm: r.afm, pattern: r.pattern,
          target: t.kind === 'lineitem' ? { lin: t.id } : t.kind === 'expense' ? { expn: t.id } : { mtrl: t.id },
          isService: t.kind === 'service',
        }),
      });
      const d = await res.json().catch(() => ({}));
      return res.ok
        ? { s: 'done', msg: `Αντιστοιχίστηκε · ${d.linesUpdated ?? r.lineCount} γραμμ.${d.utility?.propagated ? ` · +${d.utility.propagated} από κανόνα «${d.utility.label}»` : ''}` }
        : { s: 'error', msg: d.message ?? `HTTP ${res.status}` };
    }
    if (r.action === 'create' && r.kind && creatableKind(r.kind)) {
      const qs = new URLSearchParams({ kind: r.kind });
      const sc = idCode(r);
      if (sc) qs.set('supplierCode', sc);
      const next = await fetch(`/api/admin/ocr/new-items/next-code?${qs}`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      let code: string | null = next?.code ? String(next.code) : null;
      if (!code) return { s: 'error', msg: 'Δεν βρέθηκε επόμενος κωδικός για το μητρώο.' };
      // Μία ΜΟΝΟ επανάληψη, και μόνο όταν ο κωδικός πιάστηκε στο μεσοδιάστημα.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res: Response = await fetch('/api/admin/ocr/new-items/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            afm: r.afm, pattern: r.pattern, kind: r.kind, code, name: r.name,
            vat: vat || null, unit: r.kind === 'expense' ? null : unit || null,
            price: r.price, supplierCode: sc,
          }),
        });
        const d: { code?: string; suggestion?: string; message?: string } = await res.json().catch(() => ({}));
        if (res.ok) return { s: 'done', msg: `Δημιουργήθηκε · ${d.code ?? code}` };
        // 409 = ο κωδικός πιάστηκε· 422 = εκτός μάσκας του ERP (η εφαρμογή μόλις την έμαθε).
        if ((res.status === 409 || res.status === 422) && d.suggestion && attempt === 0) { code = String(d.suggestion); continue; }
        return { s: 'error', msg: d.message ?? `HTTP ${res.status}` };
      }
    }
    return { s: 'error', msg: 'Δεν υπάρχει ενέργεια για τη γραμμή.' };
  }

  async function start() {
    setPhase('running');
    stop.current = false;
    const todo = executable;
    setRun((m) => ({ ...m, ...Object.fromEntries(todo.map((r) => [r.key, { s: 'idle' } as RunState])) }));
    let ok = 0, failed = 0;
    for (const r of todo) {
      if (stop.current) break;
      setRun((m) => ({ ...m, [r.key]: { s: 'running' } }));
      let out: RunState;
      try { out = await runOne(r); } catch (e) { out = { s: 'error', msg: (e as Error).message }; }
      setRun((m) => ({ ...m, [r.key]: out }));
      if (out.s === 'done') ok++; else failed++;
    }
    setPhase('finished');
    toast[failed === 0 ? 'success' : 'warning'](`Ολοκληρώθηκαν ${ok}${failed ? ` · απέτυχαν ${failed}` : ''}.`);
    router.refresh();
  }

  const allVisibleChecked = visible.length > 0 && visible.every((r) => r.selected);

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 p-0 sm:max-w-none lg:w-[70vw] lg:min-w-[60vw] lg:max-w-[70vw]">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15 [&_svg]:size-4"><FiLayers /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Μαζική διευθέτηση γραμμών</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]" title="Φίλτραρε ανά εκδότη, επίλεξε γραμμές και όρισέ τους μητρώο ή αντιστοίχισέ τες μαζί σε ένα υπάρχον.">
              Φίλτραρε ανά εκδότη, επίλεξε γραμμές και όρισέ τους μητρώο ή αντιστοίχισέ τες μαζί σε ένα υπάρχον.
            </DialogDescription>
          </div>
          <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 text-[length:var(--fs-11)] sm:flex">
            <Chip icon={FiCheck} fg="#047857">{counts.ready} έτοιμες</Chip>
            {counts.kind > 0 && <Chip icon={FiAlertTriangle} fg="#B45309">{counts.kind} θέλουν μητρώο</Chip>}
            {counts.target > 0 && <Chip icon={FiLink} fg="#B45309">{counts.target} θέλουν χρεοπίστωση</Chip>}
          </div>
        </DialogHeader>
        {/* Στο κινητό οι μετρητές κατεβαίνουν σε δική τους λωρίδα (η κεφαλίδα δεν χωρά). */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-4 py-1.5 text-[length:var(--fs-11)] sm:hidden">
          <Chip icon={FiCheck} fg="#047857">{counts.ready} έτοιμες</Chip>
          {counts.kind > 0 && <Chip icon={FiAlertTriangle} fg="#B45309">{counts.kind} θέλουν μητρώο</Chip>}
          {counts.target > 0 && <Chip icon={FiLink} fg="#B45309">{counts.target} θέλουν χρεοπίστωση</Chip>}
        </div>

        {/* ── Εργαλειοθήκη: δρα στις ΕΠΙΛΕΓΜΕΝΕΣ ─────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/40 px-4 py-2 text-[length:var(--fs-11)]">
          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Εκδότης</span>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={locked}
              className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-1.5 text-[length:var(--fs-12)] text-foreground focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60">
              <option value="">Όλοι ({rows.length})</option>
              {suppliers.map(([s, n]) => <option key={s} value={s}>{s.slice(0, 40)} ({n})</option>)}
            </select>
          </label>
          <span className="h-5 w-px bg-border" aria-hidden />
          <span className="font-semibold text-muted-foreground">{checked.length} επιλεγμένες:</span>
          <div role="group" aria-label="Μητρώο για τις επιλεγμένες" className="flex overflow-hidden rounded-md border border-input bg-background">
            {KINDS.map((k) => (
              <button key={k} type="button" disabled={locked || checked.length === 0}
                onClick={() => updateChecked((r) => withKind(r, k))}
                className="h-8 border-r border-input bg-background px-2 font-semibold text-foreground last:border-r-0 hover:bg-muted focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sisyphus-500/40 disabled:cursor-not-allowed disabled:opacity-50">
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button type="button" disabled={locked || checked.length === 0} onClick={() => setPicker((v) => !v)}
            className={cn(BTN_GHOST, 'px-2 text-[length:var(--fs-11)]')}>
            <FiLink className="size-3.5" /> Αντιστοίχιση σε υπάρχον…
          </button>
          <span className="h-5 w-px bg-border" aria-hidden />
          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">ΦΠΑ νέων</span>
            <select value={vat} onChange={(e) => setVat(e.target.value)} disabled={locked}
              className="h-8 max-w-[9rem] rounded-md border border-input bg-background px-1.5 text-[length:var(--fs-12)] text-foreground focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60">
              {vats.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Μονάδα</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} disabled={locked}
              className="h-8 max-w-[8rem] rounded-md border border-input bg-background px-1.5 text-[length:var(--fs-12)] text-foreground focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60">
              {units.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
            </select>
          </label>
        </div>

        {picker && (
          <TargetPicker
            defaultKind={checked.find((r) => r.kind)?.kind ?? 'lineitem'}
            onPick={(t) => { updateChecked((r) => withTarget(r, t)); setPicker(false); }}
            onClose={() => setPicker(false)}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-3">
          <div className="overflow-clip rounded-lg border border-border bg-card">
          <table className="w-full table-fixed text-[length:var(--fs-12)]">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted text-left text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-1.5">
                  <input type="checkbox" aria-label="Επιλογή όλων των εμφανιζόμενων" disabled={locked}
                    checked={allVisibleChecked}
                    onChange={(e) => { const keys = new Set(visible.map((r) => r.key)); setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, selected: e.target.checked } : r))); }}
                    className="size-4 cursor-pointer accent-sisyphus-500" />
                </th>
                <th className="px-2 py-1.5">Γραμμή</th>
                <th className="w-[4rem] px-2 py-1.5 text-right">Γρ.</th>
                <th className="w-[8.5rem] px-2 py-1.5">Μητρώο</th>
                <th className="w-[34%] px-2 py-1.5">Ενέργεια / Κατάσταση</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r) => {
                const st = run[r.key];
                const rowLocked = locked || st?.s === 'done';
                return (
                  <tr key={r.key} className={cn('align-top transition-colors hover:bg-muted/30', st?.s === 'done' && 'bg-emerald-500/5 dark:bg-emerald-500/10', r.status !== 'ready' && st?.s !== 'done' && 'bg-muted/20')}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" aria-label={`Επιλογή ${r.name}`} disabled={rowLocked} checked={r.selected}
                        onChange={(e) => update(r.key, (x) => ({ ...x, selected: e.target.checked }))}
                        className="size-4 cursor-pointer accent-sisyphus-500 disabled:cursor-not-allowed" />
                    </td>
                    <td className="min-w-0 px-2 py-1">
                      <p className="truncate font-medium text-foreground" title={r.name}>{r.name}</p>
                      <p className="truncate text-[length:var(--fs-10)] text-muted-foreground">
                        {r.supplier ?? '—'}{r.code ? ` · κωδ. ${r.code}` : ''}
                        {r.code && !idCode(r) && <span title="Ο ίδιος κωδικός σε πολλά είδη του εκδότη — δεν ταυτοποιεί είδος, ο νέος κωδικός βγαίνει από την αρίθμηση."> (κοινός — δεν χρησιμοποιείται)</span>}
                      </p>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{r.lineCount}</td>
                    <td className="px-2 py-1">
                      <select value={r.kind ?? ''} disabled={rowLocked} aria-label={`Μητρώο για ${r.name}`}
                        onChange={(e) => e.target.value && update(r.key, (x) => withKind(x, e.target.value as MatchKind))}
                        className={cn('h-7 w-full rounded-md border bg-background px-1.5 text-[length:var(--fs-12)] text-foreground focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60',
                          r.kind ? 'border-input' : 'border-amber-400')}>
                        <option value="">— Μητρώο —</option>
                        {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <div className="pt-0.5"><Status row={r} st={st} /></div>
                      {/* Η πρόταση ΦΑΙΝΕΤΑΙ ως επιλογή ενός πατήματος — δεν εφαρμόζεται μόνη της. */}
                      {r.suggestion && !r.target && !rowLocked && (
                        <button type="button" onClick={() => update(r.key, (x) => withTarget(x, r.suggestion!))}
                          className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-md border border-sisyphus-500/40 px-1.5 py-0.5 text-[length:var(--fs-10)] font-semibold text-sisyphus-700 hover:bg-sisyphus-500/10 dark:text-sisyphus-300">
                          <FiLink className="size-3 shrink-0" /> Πρόταση: {r.suggestion.code} {r.suggestion.name} ({Math.round(r.suggestion.score * 100)}%)
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-2 border-t border-border bg-card px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-[length:var(--fs-11)] text-muted-foreground">
            <FiDatabase className="size-3.5 shrink-0" aria-hidden />
            {target ? <>Οι νέες καρτέλες γράφονται στο SoftOne: <strong className="font-semibold text-foreground">{target}</strong></> : 'Οι νέες καρτέλες γράφονται στο συνδεδεμένο SoftOne.'}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {phase === 'running'
              ? <button type="button" onClick={() => { stop.current = true; }} className={BTN_GHOST}><FiX className="size-3.5" /> Διακοπή μετά την τρέχουσα</button>
              : <button type="button" onClick={onClose} className={BTN_GHOST}>{phase === 'finished' ? 'Κλείσιμο' : 'Ακύρωση'}</button>}
            {(phase === 'edit' || phase === 'finished') && executable.length > 0 && (
              <button type="button" onClick={() => setPhase('confirm')} className={BTN_PRIMARY}>Εκτέλεση {executable.length}</button>
            )}
            {phase === 'confirm' && (
              <>
                <span className="text-[length:var(--fs-11)] font-semibold text-foreground">
                  {executable.filter((r) => r.action === 'create').length} νέες καρτέλες · {executable.filter((r) => r.action === 'match').length} αντιστοιχίσεις. Σίγουρα;
                </span>
                <button type="button" onClick={() => setPhase('edit')} className={BTN_GHOST}>Πίσω</button>
                <button type="button" onClick={start} className={BTN_PRIMARY}>Ναι, εκτέλεσέ τες</button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Status({ row, st }: { row: ItemPlanRow; st?: RunState }) {
  if (st?.s === 'running') return <Line icon={FiLoader} fg="#1F6FEB" spin>Εκτελείται…</Line>;
  if (st?.s === 'idle') return <Line icon={FiClock} fg="#6B7280">Σε αναμονή</Line>;
  if (st?.s === 'done') return <Line icon={FiCheck} fg="#047857">{st.msg}</Line>;
  if (st?.s === 'error') return <Line icon={FiAlertOctagon} fg="#B91C1C">{st.msg}</Line>;
  if (row.status === 'ready') return <Line icon={row.action === 'match' ? FiLink : FiCheck} fg="#047857">{row.reason}</Line>;
  return <Line icon={FiAlertTriangle} fg="#B45309">{row.reason}</Line>;
}

/**
 * Επιλογή ΕΝΟΣ υπάρχοντος μητρώου για όλες τις επιλεγμένες γραμμές. Οι χρεοπιστώσεις και τα έξοδα
 * φαίνονται ολόκληρα χωρίς αναζήτηση (λίγα — το Demo S1 έχει 15 χρεοπιστώσεις)· είδη/υπηρεσίες
 * είναι χιλιάδες, άρα θέλουν τουλάχιστον δύο γράμματα.
 */
function TargetPicker({ defaultKind, onPick, onClose }: { defaultKind: MatchKind; onPick: (t: ItemTarget) => void; onClose: () => void }) {
  const [kind, setKind] = React.useState<MatchKind>(defaultKind);
  const [q, setQ] = React.useState('');
  const [res, setRes] = React.useState<{ id: number; code: string; name: string; sub?: string; isService?: boolean }[]>([]);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    const browsable = kind === 'lineitem' || kind === 'expense';
    if (!browsable && q.trim().length < 2) { setRes([]); return; }
    let ignore = false;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/admin/softone/search?type=${SEARCH_TYPE[kind]}&q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j) => { if (!ignore) setRes(j.results ?? []); })
        .finally(() => { if (!ignore) setLoading(false); });
    }, 200);
    return () => { ignore = true; clearTimeout(h); };
  }, [kind, q]);
  return (
    <div className="border-b border-sisyphus-500/25 bg-sisyphus-50/40 px-4 py-2.5 dark:bg-sisyphus-500/[0.06]">
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as MatchKind)} aria-label="Μητρώο στόχου"
          className="h-8 rounded-md border border-input bg-background px-1.5 text-[length:var(--fs-13)] text-foreground focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <label className="relative min-w-[14rem] flex-1">
          <FiSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Κωδικός ή περιγραφή…" autoFocus
            className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-[length:var(--fs-13)] text-foreground focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25" />
        </label>
        <button type="button" onClick={onClose} className={cn(BTN_GHOST, 'px-2 text-[length:var(--fs-11)]')}>Κλείσιμο</button>
      </div>
      <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
        {loading && <li className="px-2 py-1.5 text-[length:var(--fs-11)] text-muted-foreground">Αναζήτηση…</li>}
        {!loading && res.length === 0 && <li className="px-2 py-1.5 text-[length:var(--fs-11)] text-muted-foreground">{kind === 'product' || kind === 'service' ? 'Γράψε τουλάχιστον δύο χαρακτήρες.' : 'Δεν βρέθηκε τίποτα.'}</li>}
        {res.map((x) => (
          <li key={x.id}>
            <button type="button" onClick={() => onPick({ kind, id: x.id, code: x.code, name: x.name, isService: x.isService })}
              className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-[length:var(--fs-12)] hover:bg-sisyphus-500/10 focus-visible:bg-sisyphus-500/10 focus-visible:outline-none">
              <span className="shrink-0 font-mono text-foreground">{x.code}</span>
              <span className="min-w-0 truncate text-foreground">{x.name}</span>
              {x.sub && <span className="ml-auto shrink-0 text-[length:var(--fs-10)] text-muted-foreground">{x.sub}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
