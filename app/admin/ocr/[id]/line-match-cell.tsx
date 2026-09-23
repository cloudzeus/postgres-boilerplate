'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  FiBriefcase, FiCrosshair, FiDollarSign, FiEdit2, FiLayers, FiLink, FiLoader, FiPackage,
  FiTag, FiTool, FiX, FiPlusCircle, FiAlertTriangle,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RegistrySearch } from '@/components/admin/registry-search';
import { AnalyticsPicker, type AnalyticsValue } from '@/components/admin/analytics-picker';
import { emitDocLinesChanged, useFocusLine } from '@/components/admin/doc-lines-events';
import { CreateRegistryEntryModal } from '@/components/admin/create-registry-entry-modal';
import { lineKindFits, lineKindsReason } from '@/lib/ocr/resolution-plan';
import type { PostingTarget } from '@/lib/ocr/posting-target';
import { matchKindOf, type LineCategoryOption, type LineMatch } from './line-match-kind';
import type { MatchKind } from '@/lib/ocr/line-match';
import { cn } from '@/lib/utils';

/** Η αναλυτική μιας γραμμής: κέντρο κόστους, έργο, κατηγορία δραστηριότητας. */
export interface LineAnalyticsState {
  costCntr: AnalyticsValue;
  prjc: AnalyticsValue;
  prjcStage: AnalyticsValue;
}

/**
 * Ίδια χρώματα/ετικέτες με την ουρά «Είδη & έξοδα» (`CATEGORY_META` του item-panel):
 * η ίδια αντιστοίχιση δεν επιτρέπεται να φαίνεται διαφορετική στις δύο σελίδες.
 */
const KIND_META: Record<MatchKind, { label: string; bg: string; fg: string; icon: React.ReactNode }> = {
  product: { label: 'Είδος', bg: '#EAF4FC', fg: '#0078D4', icon: <FiPackage aria-hidden className="size-3" /> },
  service: { label: 'Υπηρεσία', bg: '#E8F7F0', fg: '#047857', icon: <FiTool aria-hidden className="size-3" /> },
  expense: { label: 'Έξοδο', bg: '#FDF3E3', fg: '#B45309', icon: <FiDollarSign aria-hidden className="size-3" /> },
  lineitem: { label: 'Χρεοπίστωση', bg: '#F3EEFF', fg: '#6D28D9', icon: <FiTag aria-hidden className="size-3" /> },
};

const SEGMENTS: MatchKind[] = ['product', 'service', 'expense', 'lineitem'];

/** Γιατί αντιστοιχίστηκε — το `softoneMatchedBy` της στήλης σε ανθρώπινα ελληνικά. */
const MATCHED_BY: Record<string, string> = {
  manual: 'χειροκίνητα',
  memory: 'από μνήμη',
  code: 'ίδιος κωδικός',
  code1: 'barcode',
  code2: 'κωδικός εργοστασίου',
};

const ANALYTICS_ICON = {
  costCntr: <FiCrosshair aria-hidden className="size-3" />,
  prjc: <FiBriefcase aria-hidden className="size-3" />,
  prjcStage: <FiLayers aria-hidden className="size-3" />,
} as const;

const EXPENSE_NOTE = 'Η γραμμή καταχωρείται σε «Ανάλυση εξόδων», που δεν έχει αναλυτική.';

const EMPTY: AnalyticsValue = { id: null, label: null, source: null };

/**
 * Το κελί «SoftOne» του πίνακα γραμμών: δείχνει σε τι αντιστοιχεί η γραμμή
 * (`κωδικός — περιγραφή` + chip κατηγορίας) και ποια αναλυτική κουβαλά, ή «χωρίς
 * αντιστοίχιση». Με δικαίωμα `ocr.categorize` ο χρήστης τα διαλέγει ΕΔΩ, γραμμή-γραμμή,
 * χωρίς να φύγει από το παραστατικό: είδος / υπηρεσία / έξοδο / χρεοπίστωση, και κέντρο
 * κόστους / έργο / δραστηριότητα.
 *
 * Γράφει μέσω του ΥΠΑΡΧΟΝΤΟΣ `POST /api/admin/ocr/match-line`, που κρατά και τη μνήμη
 * (`LineMatchRule`: ΑΦΜ εκδότη + κανονικοποιημένο κείμενο) — την ίδια που γράφει η ουρά
 * «Είδη & έξοδα». Γι' αυτό το επόμενο παραστατικό του ίδιου εκδότη έρχεται συμπληρωμένο.
 */
export function LineMatchCell({
  lineId, docId, match: initial, analytics: initialAnalytics, canManage, defaultKind, lineCategories, trdr,
  target, lineCode, lineName, lineVatRate, lineUnit,
}: {
  lineId: string;
  docId: string;
  match: LineMatch | null;
  analytics: LineAnalyticsState;
  /** `ocr.categorize` — χωρίς αυτό το κελί είναι μόνο για ανάγνωση. */
  canManage: boolean;
  /**
   * Η κατηγορία που ανοίγει ο picker όταν η γραμμή δεν είναι ακόμη αντιστοιχισμένη.
   * **`null` = δεν ξέρουμε** και δεν μαντεύουμε: ο χρήστης διαλέγει πρώτος μητρώο.
   */
  defaultKind: MatchKind | null;
  lineCategories: LineCategoryOption[];
  /** TRDR του εκδότη — δείχνει ΠΡΩΤΑ τα έργα του, όπως και η ουρά. */
  trdr: number | null;
  /** Πού καταχωρείται το παραστατικό — ορίζει ΠΟΙΑ μητρώα χωράνε. `null` = άγνωστη σειρά. */
  target: PostingTarget | null;
  /** Η γραμμή όπως τυπώθηκε — προσυμπληρώνει τη δημιουργία νέας εγγραφής. */
  lineCode?: string | null;
  lineName?: string | null;
  lineVatRate?: string | number | null;
  lineUnit?: string | null;
}) {
  const router = useRouter();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [match, setMatch] = React.useState<LineMatch | null>(initial);
  const [analytics, setAnalytics] = React.useState<LineAnalyticsState>(initialAnalytics);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [projectScopeAll, setProjectScopeAll] = React.useState(false);
  const current = matchKindOf(match);
  const [kind, setKind] = React.useState<MatchKind | null>(current ?? defaultKind);
  const [lineCategory, setLineCategory] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);

  // Ο server ξαναέδωσε τη γραμμή (π.χ. μετά από `router.refresh()`): η στήλη είναι η αλήθεια.
  React.useEffect(() => { setMatch(initial); }, [initial]);
  React.useEffect(() => { setAnalytics(initialAnalytics); }, [initialAnalytics]);
  // Άνοιγμα: ξεκίνα από ό,τι είναι ήδη αντιστοιχισμένο, αλλιώς από την κατηγορία του εγγράφου.
  React.useEffect(() => { if (open) setKind(matchKindOf(match) ?? defaultKind); }, [open, match, defaultKind]);
  // Η λωρίδα ελέγχων ζήτησε «λύσε ΑΥΤΗ τη γραμμή»: ανοίγουμε τον ΕΝΑΝ picker, εδώ.
  useFocusLine(lineId, () => {
    if (!canManage) return;
    setOpen(true);
    rootRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  async function send(body: Record<string, unknown>, done: (d: Record<string, unknown>) => void) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/match-line', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { toast.error((d.message as string) ?? 'Η ενέργεια απέτυχε.'); return false; }
      done(d);
      // Τα σύνολα του παραστατικού ξαναγράφτηκαν στον server· οι κάρτες «Έλεγχοι» και
      // «Προεπισκόπηση καταχώρισης» φορτώνουν μόνες τους και χρειάζονται ρητό σήμα.
      router.refresh();
      emitDocLinesChanged(docId);
      return true;
    } catch {
      toast.error('Σφάλμα δικτύου — η ενέργεια δεν ολοκληρώθηκε.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const pick = (id: number, picked: MatchKind, code: string, name: string) =>
    send(
      {
        lineId,
        ...(picked === 'expense' ? { expn: id } : picked === 'lineitem' ? { lin: id } : { mtrl: id }),
        isService: picked === 'service',
        // Η αναλυτική που ΒΛΕΠΕΙ ο χρήστης ταξιδεύει μαζί — ίδια σύμβαση με την ουρά
        // (`new-items/queue-client.tsx`). Χωρίς αυτήν, μια «Αλλαγή» είδους έστελνε σιωπηλά
        // κενή αναλυτική: έσβηνε το κέντρο κόστους της γραμμής ΚΑΙ το ξε-μάθαινε από τον
        // κανόνα μνήμης του εκδότη — δηλαδή ακριβώς το αντίθετο από το «να το θυμάται».
        // Έξοδο → EXPANAL, που δεν έχει αναλυτική: δεν στέλνουμε τιμές που θα πετιόνταν.
        analytics: picked === 'expense' ? undefined : {
          costCntr: analytics.costCntr.id, prjc: analytics.prjc.id, prjcStage: analytics.prjcStage.id,
        },
      },
      (d) => {
        const m = (d.match ?? {}) as Partial<LineMatch>;
        setMatch({
          mtrl: m.mtrl ?? null, expn: m.expn ?? null, lin: m.lin ?? null,
          code: m.code ?? code, name: m.name ?? name,
          isService: m.isService ?? (picked === 'service'), matchedBy: 'manual',
        });
        // Έξοδο ⇒ EXPANAL: ο server δεν κράτησε αναλυτική, οπότε ούτε η οθόνη τη δείχνει.
        if (picked === 'expense') setAnalytics({ costCntr: EMPTY, prjc: EMPTY, prjcStage: EMPTY });
        toast.success(`Αντιστοιχίστηκε: ${name}`, {
          description: d.remembered === false
            ? undefined
            : 'Θα συμπληρωθεί μόνη της στην ίδια περιγραφή του ίδιου εκδότη.',
        });
      },
    );

  const clear = () => send({ lineId, mtrl: null }, () => {
    setMatch(null);
    setAnalytics({ costCntr: EMPTY, prjc: EMPTY, prjcStage: EMPTY });
    toast.success('Η αντιστοίχιση αφαιρέθηκε — η γραμμή γύρισε στα «Είδη & έξοδα».');
  });

  /** Μία αλλαγή αναλυτικής γράφεται αμέσως — αισιόδοξα στην οθόνη, με επαναφορά σε αποτυχία. */
  const setAnalytic = async (key: keyof LineAnalyticsState, v: AnalyticsValue) => {
    const before = analytics;
    const next = { ...analytics, [key]: v };
    setAnalytics(next);
    const ok = await send(
      {
        lineId,
        analyticsOnly: true,
        analytics: { costCntr: next.costCntr.id, prjc: next.prjc.id, prjcStage: next.prjcStage.id },
      },
      (d) => {
        toast.success('Η αναλυτική αποθηκεύτηκε.', {
          description: d.remembered ? 'Θα προταθεί ξανά στην ίδια περιγραφή του ίδιου εκδότη.' : undefined,
        });
      },
    );
    if (!ok) setAnalytics(before);
  };

  const kindsReason = React.useMemo(() => lineKindsReason(target), [target]);
  const meta = current ? KIND_META[current] : null;
  const label = match?.code || match?.name ? [match.code, match.name].filter(Boolean).join(' — ') : null;
  const analyticsSupported = current !== 'expense';
  const shown = ([
    ['costCntr', analytics.costCntr], ['prjc', analytics.prjc], ['prjcStage', analytics.prjcStage],
  ] as const).filter(([, v]) => v.id != null);

  const display = (
    <span className="flex min-w-0 flex-col gap-0.5">
      {meta && label ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: meta.bg, color: meta.fg }}
          >
            {meta.icon} {meta.label}
          </span>
          <span className="min-w-0 truncate text-[12px] text-foreground" title={label}>{label}</span>
          {match?.matchedBy && MATCHED_BY[match.matchedBy] && (
            <span className="shrink-0 text-[10px] text-muted-foreground">· {MATCHED_BY[match.matchedBy]}</span>
          )}
        </span>
      ) : (
        <span className="text-[12px] text-muted-foreground">Χωρίς αντιστοίχιση</span>
      )}
      {shown.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {shown.map(([k, v]) => (
            <span key={k} className="inline-flex min-w-0 items-center gap-1">
              {ANALYTICS_ICON[k]}
              <span className="truncate" title={v.label ?? String(v.id)}>{v.label ?? v.id}</span>
              {v.source && v.source !== 'manual' && <span style={{ color: '#B45309' }}>(από μνήμη)</span>}
            </span>
          ))}
        </span>
      )}
    </span>
  );

  if (!canManage) return <div className="flex min-w-0 items-center">{display}</div>;

  return (
    <div ref={rootRef} className="flex min-w-0 items-start gap-1.5">
      <div className="min-w-0 flex-1">{display}</div>
      {match && (
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          title="Αφαίρεση αντιστοίχισης"
          aria-label="Αφαίρεση αντιστοίχισης"
          className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-[var(--cx-hover)] hover:text-destructive focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FiX aria-hidden className="size-3.5" />
        </button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-input px-2 text-[11px] font-semibold text-foreground outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <FiLoader aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
              : match ? <FiEdit2 aria-hidden className="size-3" /> : <FiLink aria-hidden className="size-3" />}
            {match ? 'Αλλαγή' : 'Αντιστοίχιση'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[22rem] max-h-[70vh] overflow-y-auto">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
            Μητρώο SoftOne
          </p>
          {/* Τα μητρώα που ΔΕΝ χωράνε στον πίνακα γραμμών της σειράς απενεργοποιούνται αντί να
              κρυφτούν: ο χρήστης πρέπει να βλέπει ότι υπάρχουν ΚΑΙ γιατί δεν επιτρέπονται εδώ. */}
          <div role="group" aria-label="Κατηγορία μητρώου" className="flex rounded-lg border border-border p-0.5">
            {SEGMENTS.map((k) => {
              const fits = lineKindFits(target, k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  disabled={!fits}
                  title={fits ? undefined : `Ο προορισμός «${target?.lines}» δεν δέχεται ${KIND_META[k].label.toLowerCase()}.`}
                  onClick={() => { setKind(k); if (k !== 'lineitem') setLineCategory(null); }}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1 text-[11px] font-semibold outline-none',
                    'cx-transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-sisyphus-500',
                    fits ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                    kind === k ? 'text-foreground' : 'text-muted-foreground hover:bg-[var(--cx-hover)]',
                  )}
                  style={kind === k ? { backgroundColor: KIND_META[k].bg, color: KIND_META[k].fg } : undefined}
                >
                  {KIND_META[k].icon} {KIND_META[k].label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-caption text-muted-foreground">{kindsReason}</p>

          {/* Η κατηγορία δαπάνης είναι ΤΟ κλειδί για να βρεθεί η σωστή χρεοπίστωση. */}
          {kind === 'lineitem' && (
            <div>
              <label htmlFor={`lc-${lineId}`} className="text-caption font-medium text-muted-foreground">
                Κατηγορία δαπάνης
              </label>
              <select
                id={`lc-${lineId}`}
                value={lineCategory ?? ''}
                disabled={busy || lineCategories.length === 0}
                onChange={(e) => setLineCategory(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-input bg-background px-2.5 text-[13px]"
              >
                <option value="">Όλες οι κατηγορίες</option>
                {lineCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {lineCategories.length === 0 && (
                <p className="mt-1 text-caption text-muted-foreground">
                  Δεν έχουν συγχρονιστεί κατηγορίες δαπανών — Είδη → «Κατηγορίες δαπανών».
                </p>
              )}
            </div>
          )}

          {kind == null ? (
            <p className="flex items-start gap-1 rounded-lg border p-2 text-caption"
              style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}>
              <FiAlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
              Διάλεξε πρώτα μητρώο. Δεν προτείνουμε «Είδος» στην τύχη — μια λάθος επιλογή εδώ
              γράφει στο SoftOne εγγραφή που το παραστατικό δεν μπορεί να χρησιμοποιήσει.
            </p>
          ) : (
            <>
              <RegistrySearch
                kind={kind}
                disabled={busy}
                id={`line-registry-${lineId}`}
                category={lineCategory}
                label={KIND_META[kind].label}
                onPick={async (p) => { await pick(p.id, p.kind, p.code, p.name); }}
              />
              {/* Ο ΕΝΑΣ δημιουργός — στο μητρώο που μόλις διάλεξε ο χρήστης, όχι πάντα «είδος». */}
              <button
                type="button"
                disabled={busy}
                onClick={() => { setOpen(false); setCreating(true); }}
                className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md border border-sisyphus-500/30 px-2 py-1 text-[11px] font-semibold text-sisyphus-600 outline-none hover:bg-sisyphus-50 focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FiPlusCircle aria-hidden className="size-3" /> Δημιουργία νέας εγγραφής «{KIND_META[kind].label}»
              </button>
            </>
          )}

          <div className="border-t border-border pt-2">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
              Αναλυτική γραμμής
            </p>
            <p className="mb-1.5 text-caption text-muted-foreground">
              Προαιρετικά — δεν εμποδίζουν ποτέ την καταχώριση. Ό,τι επιβεβαιώσεις θα{' '}
              <strong>θυμάται</strong> για την ίδια περιγραφή.
            </p>
            <div className="space-y-2">
              <AnalyticsPicker
                id={`an-cc-${lineId}`} kind="costcenters" label="Κέντρο κόστους"
                value={analytics.costCntr} disabled={busy || !analyticsSupported}
                onChange={(v) => void setAnalytic('costCntr', v)}
                note={!analyticsSupported ? EXPENSE_NOTE : undefined}
              />
              <AnalyticsPicker
                id={`an-pj-${lineId}`} kind="projects" label="Έργο"
                value={analytics.prjc} disabled={busy || !analyticsSupported}
                onChange={(v) => void setAnalytic('prjc', v)}
                note={!analyticsSupported ? EXPENSE_NOTE : undefined}
                trdr={trdr}
                scopeAll={projectScopeAll}
                onScopeAll={setProjectScopeAll}
              />
              <AnalyticsPicker
                id={`an-ps-${lineId}`} kind="projectstages" label="Κατηγορία δραστηριότητας"
                value={analytics.prjcStage} disabled={busy || !analyticsSupported}
                onChange={(v) => void setAnalytic('prjcStage', v)}
                note={!analyticsSupported ? EXPENSE_NOTE : undefined}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Ο δημιουργός ζει ΕΞΩ από το popover: το popover κλείνει με το που ανοίγει ο διάλογος,
          αλλιώς το outside-click του ενός έκλεινε το άλλο. */}
      {kind && (
        <CreateRegistryEntryModal
          open={creating}
          onOpenChange={setCreating}
          kind={kind}
          lineId={lineId}
          initialCode={lineCode ?? null}
          initialName={lineName ?? match?.name ?? null}
          initialVatRate={lineVatRate ?? null}
          initialUnit={lineUnit ?? null}
          onCreated={(m) => {
            setCreating(false);
            setMatch({
              mtrl: m.mtrl, expn: m.expn, lin: m.lin,
              code: m.code, name: m.name,
              isService: m.kind === 'service', matchedBy: 'manual',
            });
            router.refresh();
            emitDocLinesChanged(docId);
          }}
        />
      )}
    </div>
  );
}
