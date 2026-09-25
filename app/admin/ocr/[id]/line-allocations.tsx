'use client';

// Ο ΕΠΙΜΕΡΙΣΜΟΣ μιας γραμμής σε πολλούς λογαριασμούς γενικής, ΜΕΣΑ στον πίνακα γραμμών.
//
// ΓΙΑΤΙ ΕΔΩ ΚΑΙ ΟΧΙ ΣΕ ΠΑΡΑΘΥΡΟ: το ζητούμενο είναι «σπάσε ΑΥΤΗ τη γραμμή στα δύο». Ένα modal
// κρύβει τη γραμμή τη στιγμή που ο χρήστης την επιμερίζει, και τον αναγκάζει να θυμάται το ποσό
// της. Εδώ οι επιμερισμοί εμφανίζονται ως ΕΠΙΠΛΕΟΝ ΓΡΑΜΜΕΣ κάτω από τη δική τους, με το σύνολο
// μπροστά στα μάτια.
//
// ΠΟΣΟ **Ή** ΠΟΣΟΣΤΟ: τα δύο πεδία είναι συνδεδεμένα — γράφεις όποιο σε βολεύει και το άλλο
// ακολουθεί. Κανείς δεν σκέφτεται πάντα με τον ίδιο τρόπο: «τα μισά» είναι ποσοστό, «τα 40 € του
// κρασιού» είναι ποσό.

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave, FiSearch, FiAlertCircle, FiCheck, FiZap } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { emitDocLinesChanged } from '@/components/admin/doc-lines-events';
import { percentOf, validateAllocations } from '@/lib/ocr/line-allocation';

export type AllocationKind = 'LINEITEM' | 'SXACCOUNT';

export interface AllocationRow {
  order: number;
  registryMtrl: number;
  kind?: AllocationKind;
  accountCode: string | null;
  /** Η περιγραφή της χρεοπίστωσης — μόνο για την οθόνη. */
  accountName?: string | null;
  percent: number;
  amount: number;
}

interface Hit { id: number; code: string; name: string; sub?: string }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Ποσό σε ευρώ για τα τσιπ του χειρόγραφου — σύντομο, με ελληνικό διαχωριστή. */
const eur = (n: number) => `${n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmt = (n: number) => n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CELL =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-[length:var(--fs-12)] text-foreground ' +
  'transition focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60';

/** Αναζήτηση χρεοπίστωσης — ο κωδικός της ΕΙΝΑΙ ο λογαριασμός γενικής. */
function AccountPicker({
  value, label, disabled, searchType, onPick,
}: {
  value: number | null; label: string | null; disabled?: boolean;
  /** Ποιο μητρώο ψάχνουμε — το ορίζει ο ΠΡΟΟΡΙΣΜΟΣ του παραστατικού, όχι ο χρήστης. */
  searchType: 'lineitems' | 'sxaccounts';
  onPick: (hit: Hit) => void;
}) {
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [rect, setRect] = React.useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  /**
   * Η λίστα ζει σε PORTAL, όχι μέσα στη γραμμή.
   *
   * Ο πίνακας γραμμών είναι κάρτα με `overflow-hidden` (για τις στρογγυλές γωνίες). Όσο η λίστα
   * ήταν παιδί της, ο πρόγονος την ΕΚΟΒΕ: τα αποτελέσματα υπήρχαν κανονικά στο DOM αλλά η δεύτερη
   * γραμμή του επιμερισμού κάθεται χαμηλά, οπότε η λίστα της εμφανιζόταν κουτσουρεμένη ή καθόλου —
   * έμοιαζε με «δεν βρίσκει τίποτα». Ένα popup δεν επιτρέπεται να εξαρτάται από τα overflow των
   * προγόνων του.
   */
  const place = React.useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const PANEL_H = 320;
    const below = window.innerHeight - r.bottom;
    const above = below < PANEL_H && r.top > below;
    setRect({
      top: above ? r.top - 4 : r.bottom + 4,
      left: Math.min(r.left, Math.max(8, window.innerWidth - 420)),
      width: Math.max(r.width, 380),
      above,
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  // Με το ΑΝΟΙΓΜΑ φέρνουμε ΟΛΟΥΣ τους λογαριασμούς — ο χρήστης δεν ξέρει από πού αρχίζει αυτός
  // που ψάχνει, και μια λίστα που απαιτεί να μαντέψεις τα δύο πρώτα γράμματα είναι άχρηστη.
  // Η πληκτρολόγηση απλώς ΣΤΕΝΕΥΕΙ.
  React.useEffect(() => {
    if (!open) { setHits([]); return; }
    let ignore = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/softone/search?type=${searchType}&q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => { if (!ignore) setHits((d.results ?? []) as Hit[]); })
        .catch(() => { if (!ignore) setHits([]); })
        .finally(() => { if (!ignore) setLoading(false); });
    }, q.trim().length < 2 ? 0 : 220);
    return () => { ignore = true; clearTimeout(t); };
  }, [q, open, searchType]);

  React.useEffect(() => {
    if (!open) return;
    // Το κλείσιμο ελέγχει ΚΑΙ το panel: με portal δεν είναι παιδί του trigger, οπότε ένα κλικ
    // πάνω σε επιλογή θα μετρούσε ως «έξω» και θα έκλεινε τη λίστα πριν προλάβει να διαλέξει.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const panel = open && rect ? createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed', top: rect.above ? undefined : rect.top,
        bottom: rect.above ? window.innerHeight - rect.top : undefined,
        left: rect.left, width: rect.width, zIndex: 60,
      }}
      className="max-w-[92vw] rounded-lg border border-border bg-card p-2 shadow-lg"
    >
      <input
        autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Φιλτράρισμα: κωδικός ή περιγραφή…"
        className={CELL}
      />
      <div className="mt-1 max-h-72 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-3 text-[length:var(--fs-11)] text-muted-foreground">Αναζήτηση…</p>
        ) : hits.length === 0 ? (
          <p className="px-2 py-3 text-[length:var(--fs-11)] text-muted-foreground">Καμία χρεοπίστωση.</p>
        ) : hits.map((h) => (
          <button
            key={h.id} type="button"
            onClick={() => { onPick(h); setOpen(false); setQ(''); }}
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-sisyphus-500/10"
          >
            <span className="font-mono text-[length:var(--fs-11)] text-sisyphus-700 dark:text-sisyphus-300">{h.code}</span>
            <span className="ml-2 text-[length:var(--fs-12)] text-foreground">{h.name}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={cn(CELL, 'flex items-center justify-between gap-2 text-left', !value && 'text-muted-foreground')}
      >
        <span className="truncate">{label ?? (searchType === 'sxaccounts' ? 'Επίλεξε λογαριασμό εξόδων…' : 'Επίλεξε λογαριασμό δαπάνης…')}</span>
        <FiSearch className="size-3.5 shrink-0 opacity-60" />
      </button>
      {panel}
    </div>
  );
}

export function LineAllocations({
  lineId, lineTotal, canManage, initial, colSpan, kind,
}: {
  lineId: string;
  /**
   * Ο ΚΟΣΜΟΣ του παραστατικού, από τη σειρά του: `LINEITEM` χρεοπιστώσεις (διπλογραφικά) ή
   * `SXACCOUNT` λογαριασμοί εσόδων/εξόδων (απλογραφικά). Δεν τον διαλέγει ο χρήστης — μια λάθος
   * επιλογή μητρώου απορρίπτεται στην καταχώριση, οπότε δεν πρέπει καν να προσφέρεται.
   */
  kind: AllocationKind;
  /** Το σύνολο της γραμμής — η βάση του επιμερισμού. */
  lineTotal: number | null;
  canManage: boolean;
  initial: AllocationRow[];
  colSpan: number;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<AllocationRow[]>(initial);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => { setRows(initial); setDirty(false); }, [initial]);

  /**
   * ΠΡΟΤΑΣΗ από τη μνήμη: «το προηγούμενο τιμολόγιο του ίδιου εκδότη με αυτή τη γραμμή πήγε εκεί».
   * ΔΕΝ εφαρμόζεται μόνη της — ο λογαριασμός δαπάνης είναι λογιστική απόφαση, και μια σιωπηλή
   * εφαρμογή θα αντέγραφε ένα λάθος της πρώτης φοράς σε κάθε επόμενο παραστατικό.
   */
  const [hint, setHint] = React.useState<
    { registryMtrl: number; code: string; name: string; timesUsed: number; sameIssuer: boolean } | null
  >(null);
  /**
   * ΤΟ ΣΠΑΣΙΜΟ ΠΟΥ ΕΓΡΑΨΕ Ο ΛΟΓΙΣΤΗΣ ΜΕ ΤΟ ΣΤΥΛΟ. Το διαβάζαμε ήδη και δεν το έδειχνε κανείς.
   * Όταν κάθε κομμάτι λύνεται σε λογαριασμό, εφαρμόζεται με ένα κλικ· αλλιώς ΤΟ ΔΕΙΧΝΟΥΜΕ
   * ούτως ή άλλως — «ο λογιστής το έσπασε σε 6» είναι πληροφορία, ακόμη κι αν δεν μπορούμε να
   * την περάσουμε αυτόματα (τα κέντρα κόστους δεν χωράνε ακόμη στον επιμερισμό).
   */
  const [hw, setHw] = React.useState<
    { applicable: boolean;
      parts: { label: string; amount: number; percent: number; registryMtrl: number; code: string; name: string }[];
      unresolved: { label: string; amount: number | null; accountLike: boolean }[] } | null
  >(null);
  React.useEffect(() => {
    // ΤΟ ΧΕΙΡΟΓΡΑΦΟ ΔΕΝ ΕΞΑΡΤΑΤΑΙ ΑΠΟ ΤΟΝ ΚΟΣΜΟ. Ο φύλακας `kind === 'SXACCOUNT'` υπάρχει για τη
    // ΜΝΗΜΗ, που καλύπτει μόνο χρεοπιστώσεις — αλλά έκοβε και το χειρόγραφο, δηλαδή ακριβώς στα
    // απλογραφικά (Cosmote, 1261) όπου ο λογιστής έχει γράψει το σπάσιμο με το χέρι.
    if (!canManage || rows.length > 0) { setHint(null); setHw(null); return; }
    let ignore = false;
    fetch(`/api/admin/ocr/line-allocations/suggest?lineId=${encodeURIComponent(lineId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (ignore) return;
        setHint(kind === 'SXACCOUNT' ? null : (d?.suggestion ?? null));
        setHw(d?.handwritten ?? null);
      })
      .catch(() => { if (!ignore) { setHint(null); setHw(null); } });
    return () => { ignore = true; };
  }, [lineId, canManage, rows.length, kind]);

  /** Περνά ΟΛΟΚΛΗΡΟ το χειρόγραφο σχήμα — όχι ένα κομμάτι. */
  function applyHandwritten() {
    if (!hw?.applicable) return;
    setDirty(true);
    setRows(hw.parts.map((p, i) => ({
      order: i, registryMtrl: p.registryMtrl, kind,
      accountCode: p.code, accountName: p.name,
      percent: p.percent, amount: p.amount,
    })));
  }

  function applyHint() {
    if (!hint) return;
    setDirty(true);
    setRows([{
      order: 0, registryMtrl: hint.registryMtrl, kind,
      accountCode: hint.code, accountName: hint.name,
      percent: 100, amount: round2(total),
    }]);
  }

  const total = lineTotal ?? 0;
  const sumPct = round2(rows.reduce((t, r) => t + (Number.isFinite(r.percent) ? r.percent : 0), 0));
  const sumAmt = round2(rows.reduce((t, r) => t + (Number.isFinite(r.amount) ? r.amount : 0), 0));
  const problems = validateAllocations(rows, lineTotal);
  const balanced = rows.length > 0 && problems.length === 0;

  function update(i: number, patch: Partial<AllocationRow>) {
    setDirty(true);
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  /**
   * Γράφει το ποσοστό της γραμμής `i` και **ισορροπεί την ΤΕΛΕΥΤΑΙΑ** ώστε το σύνολο να κλείνει.
   *
   * Αυτό είναι το «σπάσε τη γραμμή στα δύο» όπως το σκέφτεται ο χρήστης: γράφει 40 στην πρώτη και
   * η δεύτερη γίνεται 60 μόνη της. Χωρίς αυτό, κάθε αλλαγή άφηνε τον επιμερισμό «ανοιχτό» και ο
   * χρήστης έπρεπε να κάνει την αφαίρεση με το μυαλό του — σε κάθε διόρθωση.
   * Η τελευταία γραμμή δεν ισορροπεί τον εαυτό της (θα ήταν κυκλικό): εκεί ο χρήστης έχει τον λόγο.
   */
  function rebalance(rs: AllocationRow[], edited: number): AllocationRow[] {
    const last = rs.length - 1;
    if (last <= 0 || edited === last) return rs;
    const others = rs.reduce((t, r, k) => (k === last ? t : t + (Number.isFinite(r.percent) ? r.percent : 0)), 0);
    const rest = round2(100 - others);
    return rs.map((r, k) => (k === last ? { ...r, percent: rest, amount: round2((total * rest) / 100) } : r));
  }

  /** Ποσοστό → ποσό. */
  function setPercent(i: number, raw: string) {
    const p = Number(raw.replace(',', '.'));
    const pct = Number.isFinite(p) ? p : 0;
    setDirty(true);
    setRows((rs) => rebalance(
      rs.map((r, k) => (k === i ? { ...r, percent: pct, amount: round2((total * pct) / 100) } : r)), i));
  }
  /** Ποσό → ποσοστό. Η άλλη κατεύθυνση της ΙΔΙΑΣ σχέσης. */
  function setAmount(i: number, raw: string) {
    const a = Number(raw.replace(',', '.'));
    const amt = Number.isFinite(a) ? a : 0;
    setDirty(true);
    setRows((rs) => rebalance(
      rs.map((r, k) => (k === i ? { ...r, amount: amt, percent: percentOf(amt, total) } : r)), i));
  }

  function addRow() {
    setDirty(true);
    setRows((rs) => {
      // Η νέα γραμμή παίρνει ό,τι ΠΕΡΙΣΣΕΥΕΙ — στη συνηθισμένη περίπτωση «σπάσε στα δύο» ο χρήστης
      // γράφει ένα ποσοστό στην πρώτη και η δεύτερη κλείνει μόνη της.
      const used = rs.reduce((t, r) => t + (Number.isFinite(r.percent) ? r.percent : 0), 0);
      const rest = round2(Math.max(0, 100 - used));
      return [...rs, {
        order: rs.length, registryMtrl: 0, accountCode: null, accountName: null,
        kind, percent: rest, amount: round2((total * rest) / 100),
      }];
    });
  }

  function removeRow(i: number) {
    setDirty(true);
    setRows((rs) => rs.filter((_, k) => k !== i).map((r, k) => ({ ...r, order: k })));
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/line-allocations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId,
          allocations: rows.map((r) => ({ registryMtrl: r.registryMtrl, kind: r.kind ?? kind, percent: r.percent })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message ?? 'Ο επιμερισμός δεν αποθηκεύτηκε.'); return; }
      toast.success(rows.length === 0 ? 'Ο επιμερισμός αφαιρέθηκε.' : `Αποθηκεύτηκε σε ${rows.length} λογαριασμούς.`);
      setDirty(false);
      router.refresh();
      emitDocLinesChanged(lineId);
    } catch {
      toast.error('Σφάλμα δικτύου.');
    } finally {
      setBusy(false);
    }
  }

  if (!canManage && rows.length === 0) return null;

  return (
    <tr className="bg-sisyphus-500/5">
      <td colSpan={colSpan} className="px-3 py-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[length:var(--fs-12)] font-extrabold uppercase tracking-wide text-foreground">
              Λογαριασμός δαπάνης {rows.length > 1 ? `— επιμερισμός σε ${rows.length}` : ''}
            </span>
            {canManage && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button" onClick={addRow} disabled={busy || lineTotal == null}
                  title={lineTotal == null ? 'Η γραμμή δεν έχει σύνολο' : undefined}
                  className="inline-flex items-center gap-1 rounded bg-sisyphus-500 px-2.5 py-1 text-[length:var(--fs-12)] font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600 disabled:opacity-50"
                >
                  <FiPlus className="size-3" /> Προσθήκη γραμμής επιμερισμού
                </button>
                {dirty && (
                  <button
                    type="button" onClick={save} disabled={busy || (rows.length > 0 && !balanced)}
                    className="inline-flex items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 py-1 text-[length:var(--fs-11)] font-semibold text-white transition hover:bg-sisyphus-600 disabled:opacity-50"
                  >
                    <FiSave className="size-3" /> {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── ΧΕΙΡΟΓΡΑΦΟ: πρώτο, γιατί είναι η απόφαση που ΗΔΗ πήρε ο λογιστής ──── */}
          {hw && rows.length === 0 && (
            <div className="rounded-md border border-sisyphus-500/40 bg-sisyphus-500/10 px-2 py-1.5 shadow-fluent-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[length:var(--fs-12)] font-extrabold uppercase tracking-wide text-foreground">
                  <FiZap aria-hidden className="size-3 text-sisyphus-600" /> Χειρόγραφο στο παραστατικό
                  {hw.parts.length + hw.unresolved.length > 1 && ` — ${hw.parts.length + hw.unresolved.length} κομμάτια`}
                </span>
                {hw.applicable && canManage && (
                  <button type="button" onClick={applyHandwritten}
                    className="shrink-0 rounded bg-sisyphus-500 px-2 py-0.5 text-[length:var(--fs-11)] font-semibold text-white transition hover:bg-sisyphus-600">
                    Χρήση
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[length:var(--fs-11)] text-foreground">
                {hw.parts.map((p, i) => (
                  <span key={`r${i}`}><span className="font-mono">{p.code}</span> {eur(p.amount)}</span>
                ))}
                {hw.unresolved.map((p, i) => (
                  <span key={`u${i}`} className="text-muted-foreground">{p.label}{p.amount != null ? ` ${eur(p.amount)}` : ''}</span>
                ))}
              </div>
              {!hw.applicable && (
                /* ΛΕΜΕ ΓΙΑΤΙ. Ένα «δεν γίνεται» χωρίς αιτία μοιάζει με σφάλμα της εφαρμογής. */
                <p className="mt-1 text-[length:var(--fs-11)] text-muted-foreground">
                  {hw.unresolved.every((p) => p.accountLike)
                    ? 'Οι λογαριασμοί διαβάστηκαν σωστά αλλά δεν υπάρχουν στο μητρώο αυτής της εγκατάστασης — θα αντιστοιχιστούν μόλις συγχρονιστεί το λογιστικό σχέδιο.'
                    : hw.parts.length === 0
                      ? 'Ο επιμερισμός είναι σε κέντρα κόστους ή συντελεστές ΦΠΑ, όχι σε λογαριασμούς — δεν χωράει ακόμη στον επιμερισμό.'
                      : 'Μέρος των κομματιών δεν αντιστοιχεί σε λογαριασμό του μητρώου — η μερική εφαρμογή θα έχανε ποσά.'}
                </p>
              )}
            </div>
          )}

          {hint && rows.length === 0 && (
            <button
              type="button" onClick={applyHint}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-sisyphus-500/40 bg-sisyphus-500/10 px-2 py-1.5 text-left text-[length:var(--fs-11)] transition hover:bg-sisyphus-500/20"
            >
              <span className="min-w-0">
                <FiZap aria-hidden className="mr-1.5 inline size-3 text-sisyphus-600" />
                <span className="font-semibold text-sisyphus-700 dark:text-sisyphus-300">Προτείνεται:</span>{' '}
                <span className="font-mono">{hint.code}</span> <span className="text-foreground">{hint.name}</span>
                <span className="text-muted-foreground">
                  {' · '}{hint.sameIssuer ? 'ίδιος εκδότης' : 'ίδια περιγραφή'}
                  {hint.timesUsed > 0 ? ` · ${hint.timesUsed} φορές` : ''}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-sisyphus-500 px-2 py-0.5 font-semibold text-white">Χρήση</span>
            </button>
          )}

          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_92px_120px_32px] sm:items-center">
              <AccountPicker
                value={r.registryMtrl || null}
                label={r.registryMtrl ? [r.accountCode, r.accountName].filter(Boolean).join(' · ') || `#${r.registryMtrl}` : null}
                disabled={!canManage || busy}
                searchType={kind === 'SXACCOUNT' ? 'sxaccounts' : 'lineitems'}
                onPick={(h) => update(i, { registryMtrl: h.id, kind, accountCode: h.code, accountName: h.name })}
              />
              <div className="relative">
                <input
                  inputMode="decimal" disabled={!canManage || busy}
                  value={Number.isFinite(r.percent) ? String(round2(r.percent)).replace('.', ',') : ''}
                  onChange={(e) => setPercent(i, e.target.value)}
                  className={cn(CELL, 'pr-6 text-right font-mono tabular-nums')}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[length:var(--fs-11)] text-muted-foreground">%</span>
              </div>
              <div className="relative">
                <input
                  inputMode="decimal" disabled={!canManage || busy}
                  value={Number.isFinite(r.amount) ? String(round2(r.amount)).replace('.', ',') : ''}
                  onChange={(e) => setAmount(i, e.target.value)}
                  className={cn(CELL, 'pr-6 text-right font-mono tabular-nums')}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[length:var(--fs-11)] text-muted-foreground">€</span>
              </div>
              {canManage && (
                <button
                  type="button" onClick={() => removeRow(i)} disabled={busy} title="Αφαίρεση"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-dg-red-500/10 hover:text-dg-red-500"
                >
                  <FiTrash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}

          {rows.length > 0 && (
            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 text-[length:var(--fs-11)] font-semibold',
                balanced ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {balanced ? <FiCheck className="size-3.5" /> : <FiAlertCircle className="size-3.5" />}
                {balanced ? 'Κλείνει με το σύνολο της γραμμής' : (problems[0]?.message ?? 'Ο επιμερισμός δεν κλείνει')}
              </span>
              <span className="font-mono tabular-nums">
                {fmt(sumPct)} % · {fmt(sumAmt)} € / {fmt(total)} €
              </span>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
