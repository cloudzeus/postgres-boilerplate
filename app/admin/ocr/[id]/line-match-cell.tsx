'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  FiBriefcase, FiCrosshair, FiDollarSign, FiEdit2, FiLayers, FiLink, FiLoader, FiPackage,
  FiTag, FiTool, FiX,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RegistrySearch } from '@/components/admin/registry-search';
import { AnalyticsPicker, type AnalyticsValue } from '@/components/admin/analytics-picker';
import { emitDocLinesChanged } from '@/components/admin/doc-lines-events';
import type { MatchKind } from '@/lib/ocr/line-match';
import { cn } from '@/lib/utils';

/** Η αντιστοίχιση μιας γραμμής όπως τη γράφει η βάση (`OcrInvoiceItem`). */
export interface LineMatch {
  mtrl: number | null;
  expn: number | null;
  lin: number | null;
  code: string | null;
  name: string | null;
  isService: boolean | null;
  matchedBy: string | null;
}

/** Η αναλυτική μιας γραμμής: κέντρο κόστους, έργο, κατηγορία δραστηριότητας. */
export interface LineAnalyticsState {
  costCntr: AnalyticsValue;
  prjc: AnalyticsValue;
  prjcStage: AnalyticsValue;
}

/** Μία κατηγορία δαπάνης (LINCATEGORY) — στενεύει τη λίστα χρεοπιστώσεων. */
export interface LineCategoryOption { id: number; label: string }

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

/** Σε ποια κατηγορία ανήκει μια ήδη γραμμένη αντιστοίχιση. `null` = καμία. */
export function matchKindOf(m: LineMatch | null | undefined): MatchKind | null {
  if (!m) return null;
  if (m.lin != null) return 'lineitem';
  if (m.expn != null) return 'expense';
  if (m.mtrl != null) return m.isService ? 'service' : 'product';
  return null;
}

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
}: {
  lineId: string;
  docId: string;
  match: LineMatch | null;
  analytics: LineAnalyticsState;
  /** `ocr.categorize` — χωρίς αυτό το κελί είναι μόνο για ανάγνωση. */
  canManage: boolean;
  /** Η κατηγορία που ανοίγει ο picker όταν η γραμμή δεν είναι ακόμη αντιστοιχισμένη. */
  defaultKind: MatchKind;
  lineCategories: LineCategoryOption[];
  /** TRDR του εκδότη — δείχνει ΠΡΩΤΑ τα έργα του, όπως και η ουρά. */
  trdr: number | null;
}) {
  const router = useRouter();
  const [match, setMatch] = React.useState<LineMatch | null>(initial);
  const [analytics, setAnalytics] = React.useState<LineAnalyticsState>(initialAnalytics);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [projectScopeAll, setProjectScopeAll] = React.useState(false);
  const current = matchKindOf(match);
  const [kind, setKind] = React.useState<MatchKind>(current ?? defaultKind);
  const [lineCategory, setLineCategory] = React.useState<number | null>(null);

  // Ο server ξαναέδωσε τη γραμμή (π.χ. μετά από `router.refresh()`): η στήλη είναι η αλήθεια.
  React.useEffect(() => { setMatch(initial); }, [initial]);
  React.useEffect(() => { setAnalytics(initialAnalytics); }, [initialAnalytics]);
  // Άνοιγμα: ξεκίνα από ό,τι είναι ήδη αντιστοιχισμένο, αλλιώς από την κατηγορία του εγγράφου.
  React.useEffect(() => { if (open) setKind(matchKindOf(match) ?? defaultKind); }, [open, match, defaultKind]);

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
    <div className="flex min-w-0 items-start gap-1.5">
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
            Είδος / έξοδο
          </p>
          <div role="group" aria-label="Κατηγορία μητρώου" className="flex rounded-lg border border-border p-0.5">
            {SEGMENTS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => { setKind(k); if (k !== 'lineitem') setLineCategory(null); }}
                className={cn(
                  'flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md px-1 py-1 text-[11px] font-semibold outline-none',
                  'cx-transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-sisyphus-500',
                  kind === k ? 'text-foreground' : 'text-muted-foreground hover:bg-[var(--cx-hover)]',
                )}
                style={kind === k ? { backgroundColor: KIND_META[k].bg, color: KIND_META[k].fg } : undefined}
              >
                {KIND_META[k].icon} {KIND_META[k].label}
              </button>
            ))}
          </div>

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

          <RegistrySearch
            kind={kind}
            disabled={busy}
            id={`line-registry-${lineId}`}
            category={lineCategory}
            label={KIND_META[kind].label}
            onPick={async (p) => { await pick(p.id, p.kind, p.code, p.name); }}
          />

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
                trdr={trdr}
                scopeAll={projectScopeAll}
                onScopeAll={setProjectScopeAll}
              />
              <AnalyticsPicker
                id={`an-ps-${lineId}`} kind="projectstages" label="Κατηγορία δραστηριότητας"
                value={analytics.prjcStage} disabled={busy || !analyticsSupported}
                onChange={(v) => void setAnalytic('prjcStage', v)}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
