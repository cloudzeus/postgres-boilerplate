'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { LineSuggestion, SuggestionCandidate } from '@/lib/ocr/line-suggestions';
import {
  FiBriefcase, FiCrosshair, FiDollarSign, FiEdit2, FiLayers, FiLink, FiLoader, FiPackage,
  FiTag, FiTool, FiX, FiPlusCircle, FiAlertTriangle,
  FiCheck, FiHardDrive, FiArrowLeft, FiChevronDown, FiPieChart, FiHelpCircle,
  FiDatabase, FiInfo, FiSearch, FiSliders, FiZap,
} from 'react-icons/fi';
import { ItemSupplierDialog } from '@/components/admin/item-supplier-dialog';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RegistrySearch } from '@/components/admin/registry-search';
import { AnalyticsPicker, type AnalyticsValue } from '@/components/admin/analytics-picker';
import { emitDocLinesChanged, emitStartSplit, useFocusLine } from '@/components/admin/doc-lines-events';
import { Term } from '@/components/admin/help/term';
import {
  PURPOSE_OUTCOME, TILES, availableTiles, purposeOfMatch, registryKindFor, suggestTile, tileForPurpose, type Tile,
} from '@/lib/ocr/purchase-purpose';
import type { PurposeAiAnswer } from '@/lib/ocr/purpose-ai';
import { PurposeStep } from './purpose-step';
import { depreciationAdvice } from '@/lib/ocr/depreciation';
import { CreateRegistryEntryModal } from '@/components/admin/create-registry-entry-modal';
import { AssetSearch, CreateAssetDialog, type AssetPick } from '@/components/admin/asset-picker';
import { lineKindFits, lineKindsReason } from '@/lib/ocr/resolution-plan';
import { assetFits, POST_LINES_LABEL, type PostingTarget } from '@/lib/ocr/posting-target';
import { matchKindOf, type LineCategoryOption, type LineMatch } from './line-match-kind';
import type { MatchKind } from '@/lib/ocr/line-match';
import { cn } from '@/lib/utils';
import { Field, FormSection, RowHint, fieldCls } from '@/components/admin/form-kit';

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
  expense: { label: 'Κατηγορία εξόδου', bg: '#FDF3E3', fg: '#B45309', icon: <FiDollarSign aria-hidden className="size-3" /> },
  lineitem: { label: 'Κατηγορία εξόδου', bg: '#F3EEFF', fg: '#6D28D9', icon: <FiTag aria-hidden className="size-3" /> },
};

const SEGMENTS: MatchKind[] = ['product', 'service', 'expense', 'lineitem'];

/** Το πάγιο ζει ΕΚΤΟΣ των τεσσάρων μητρώων (δεν μαθαίνεται από τη μνήμη) — ίδια μορφή chip. */
const ASSET_META = { label: 'Πάγιο', bg: '#EEF2F7', fg: '#334155', icon: <FiHardDrive aria-hidden className="size-3" /> };

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
  target, lineCode, lineName, lineVatRate, lineUnit, lineTotal, lineEan, lineMfrCode, lineQty, linePrice, suggestion,
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
  /** Barcode (EAN) και κωδικός κατασκευαστή της γραμμής — για τη δημιουργία είδους. */
  lineEan?: string | null;
  lineMfrCode?: string | null;
  /** Ποσότητα / τιμή μονάδας — για την προεπισκόπηση μονάδων στη δημιουργία είδους. */
  lineQty?: number | null;
  linePrice?: number | null;
  /** Το σύνολο της γραμμής — βοηθά να ξεχωρίσει ο εξοπλισμός (πάγιο) από τα μικροαντικείμενα. */
  lineTotal?: number | null;
  /** Έτοιμη πρόταση στόχου (οικογένεια δαπάνης / είδος χρέωσης) — ένα κλικ, και μαθαίνεται. */
  suggestion?: LineSuggestion | null;
}) {
  const router = useRouter();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [match, setMatch] = React.useState<LineMatch | null>(initial);
  const [analytics, setAnalytics] = React.useState<LineAnalyticsState>(initialAnalytics);
  const [open, setOpen] = React.useState(false);
  const [supplierOpen, setSupplierOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [projectScopeAll, setProjectScopeAll] = React.useState(false);
  const current = matchKindOf(match);
  const [kind, setKind] = React.useState<MatchKind | null>(current ?? defaultKind);
  const [lineCategory, setLineCategory] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [creatingAsset, setCreatingAsset] = React.useState(false);
  /** Ο οδηγός: 1 = «τι αφορά;», 2 = «ποια κατηγορία;». */
  const [step, setStep] = React.useState<1 | 2>(1);
  const [tile, setTile] = React.useState<Tile | null>(null);
  const [advanced, setAdvanced] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  /** Η πρόταση AI για «τι αφορά» — ζητιέται με κλικ, κρατιέται όσο ζει η γραμμή στην οθόνη. */
  const [ai, setAi] = React.useState<PurposeAiAnswer | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const askAi = async () => {
    setAiBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/line-purpose-ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId, allowed: availableTiles(target).filter((t) => !t.blocked || t.tile === 'equipment').map((t) => t.tile) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.message ?? 'Το AI δεν απάντησε.'); return; }
      setAi(d as PurposeAiAnswer);
    } catch {
      toast.error('Σφάλμα δικτύου — το AI δεν ρωτήθηκε.');
    } finally { setAiBusy(false); }
  };
  /** Η πρόταση που ισχύει (AI πρώτα, μετά κανόνες) — για να προειδοποιήσουμε αν ο χρήστης διαλέξει κάτι άλλο. */
  const advised = React.useMemo<{ tile: Tile; reason: string } | null>(() => {
    if (ai && ai.confidence >= 0.6) return { tile: ai.tile, reason: ai.reason };
    const r = suggestTile({ lineName, amount: lineTotal, hasRegistrySuggestion: !!suggestion?.candidates.length, defaultKind, target });
    return r && !r.blocked ? { tile: r.tile, reason: r.reason } : null;
  }, [ai, lineName, lineTotal, suggestion, defaultKind, target]);

  // Ο server ξαναέδωσε τη γραμμή (π.χ. μετά από `router.refresh()`): η στήλη είναι η αλήθεια.
  React.useEffect(() => { setMatch(initial); }, [initial]);
  React.useEffect(() => { setAnalytics(initialAnalytics); }, [initialAnalytics]);
  // Άνοιγμα: ξεκίνα από ό,τι είναι ήδη αντιστοιχισμένο, αλλιώς από την κατηγορία του εγγράφου.
  React.useEffect(() => { if (open) setKind(matchKindOf(match) ?? defaultKind); }, [open, match, defaultKind]);
  // Κάθε άνοιγμα ξεκινά από την ερώτηση «τι αφορά;» — με την τωρινή κατηγορία σημειωμένη.
  React.useEffect(() => { if (open) { setStep(1); setTile(null); setAdvanced(false); } }, [open]);
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

  /** Αποδοχή πρότασης: (ενεργοποίηση αν είναι ανενεργή χρεοπίστωση) → αντιστοίχιση → μνήμη. */
  const acceptSuggestion = async (c: SuggestionCandidate) => {
    if (c.inactive) {
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/softone/lineitems/${c.id}/activate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowCreditors: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok && d.error !== 'nothing_to_do') { toast.error(d.message ?? 'Η ενεργοποίηση απέτυχε.'); return; }
      } catch {
        toast.error('Σφάλμα δικτύου — η χρεοπίστωση δεν ενεργοποιήθηκε.');
        return;
      } finally { setBusy(false); }
    }
    await pick(c.id, c.kind, c.code, c.name);
  };

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
        // Λογαριασμός κοινής ωφέλειας: η απόφαση μαθεύτηκε ανά ΕΙΔΟΣ ΧΡΕΩΣΗΣ, όχι ανά κείμενο.
        const utility = d.utility as { label: string; propagated: number } | null | undefined;
        toast.success(`Αντιστοιχίστηκε: ${name}`, {
          description: utility
            ? `Κανόνας «${utility.label}»: θα εφαρμόζεται αυτόματα σε κάθε επόμενο παραστατικό, από οποιονδήποτε εκδότη.${utility.propagated > 0 ? ` Συμπληρώθηκαν ήδη ${utility.propagated} ακόμη γραμμές.` : ''}`
            : d.remembered === false
              ? undefined
              : Number(d.sameIssuerFilled) > 0
                ? `Συμπληρώθηκαν ήδη ${d.sameIssuerFilled} ακόμη γραμμές με την ίδια περιγραφή του ίδιου εκδότη.`
                : 'Θα συμπληρωθεί μόνη της στην ίδια περιγραφή του ίδιου εκδότη.',
        });
      },
    );

  /** Αντιστοίχιση σε ΠΑΓΙΟ: τοπικά μόνο, χωρίς μνήμη (κάθε πάγιο είναι μοναδικό). */
  const pickAsset = async (a: AssetPick) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/line-asset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId, asset: a.mtrl }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.message ?? 'Η αντιστοίχιση απέτυχε.'); return; }
      assetPicked(a);
      toast.success(`Αντιστοιχίστηκε στο πάγιο ${a.code}`, { description: 'Θα καταχωριστεί ως γραμμή παγίων του παραστατικού αγορών.' });
    } catch {
      toast.error('Σφάλμα δικτύου — η ενέργεια δεν ολοκληρώθηκε.');
    } finally {
      setBusy(false);
    }
  };
  const assetPicked = (a: AssetPick) => {
    setOpen(false);
    setMatch({ mtrl: null, expn: null, lin: null, asset: a.mtrl, code: a.code, name: a.name, isService: null, matchedBy: 'manual' });
    router.refresh();
    emitDocLinesChanged(docId);
  };

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
  /** Τα μητρώα που ΟΝΤΩΣ χωράνε εδώ — αν είναι ένα, δεν υπάρχει τίποτα να διαλέξει ο χρήστης. */
  const allowedHere = React.useMemo(() => SEGMENTS.filter((k) => lineKindFits(target, k)), [target]);
  const isAsset = match?.asset != null;
  const meta = isAsset ? ASSET_META : current ? KIND_META[current] : null;
  const assetsHere = assetFits(target);
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
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[length:var(--fs-10)] font-semibold"
            style={{ backgroundColor: meta.bg, color: meta.fg }}
          >
            {meta.icon} {meta.label}
          </span>
          <span className="min-w-0 truncate text-[length:var(--fs-12)] text-foreground" title={label}>{label}</span>
          {match?.matchedBy && MATCHED_BY[match.matchedBy] && (
            <span className="shrink-0 text-[length:var(--fs-10)] text-muted-foreground">· {MATCHED_BY[match.matchedBy]}</span>
          )}
        </span>
      ) : (
        <span className="text-[length:var(--fs-12)] text-muted-foreground">Χωρίς αντιστοίχιση</span>
      )}
      {!match && canManage && suggestion && suggestion.candidates.length > 0 && (
        <span className="flex flex-col gap-1 rounded-md border border-sisyphus-500/25 bg-sisyphus-500/[0.05] px-2 py-1.5">
          <span className="text-[length:var(--fs-10)] font-semibold uppercase tracking-wide text-sisyphus-700">Πρόταση · {suggestion.label}</span>
          {suggestion.candidates.map((c) => (
            <button
              key={`${c.kind}-${c.id}`} type="button" disabled={busy}
              onClick={() => void acceptSuggestion(c)}
              className="flex min-h-8 items-center gap-1.5 rounded px-1.5 text-left text-[length:var(--fs-12)] text-foreground hover:bg-sisyphus-500/10 disabled:opacity-60"
            >
              <FiCheck className="size-3.5 shrink-0 text-sisyphus-600" aria-hidden />
              <span className="font-mono text-[length:var(--fs-11)]">{c.code}</span>
              <span className="min-w-0 truncate">{c.name}</span>
              {c.inactive && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[length:var(--fs-10)] font-semibold text-amber-800">ανενεργή</span>}
            </button>
          ))}
        </span>
      )}
      {shown.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--fs-10)] text-muted-foreground">
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
      <div className="min-w-0 flex-1">
        {display}
        {/* ΕΙΔΟΣ ΑΠΟ ΠΟΛΛΟΥΣ ΠΡΟΜΗΘΕΥΤΕΣ: ο κωδικός και η τιμή ΑΥΤΟΥ του προμηθευτή στο ίδιο είδος. */}
        {match?.mtrl != null && !match.isService && trdr != null && (
          <button
            type="button" onClick={() => setSupplierOpen(true)}
            className="mt-0.5 inline-flex min-h-6 cursor-pointer items-center gap-1 rounded text-[length:var(--fs-11)] font-medium text-sisyphus-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500"
          >
            <FiTag aria-hidden className="size-3" /> Κωδικός & τιμή προμηθευτή
          </button>
        )}
      </div>
      {supplierOpen && <ItemSupplierDialog open={supplierOpen} onOpenChange={setSupplierOpen} lineId={lineId} />}
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
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-input px-2 text-[length:var(--fs-11)] font-semibold text-foreground outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <FiLoader aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
          : match ? <FiEdit2 aria-hidden className="size-3" /> : <FiLink aria-hidden className="size-3" />}
        {match ? 'Αλλαγή' : 'Αντιστοίχιση'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="shrink-0 flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15">
              <FiLink className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[length:var(--fs-15)]">
                {step === 1 || !tile ? 'Τι αφορά αυτή η αγορά;' : TILES[tile].title}
              </DialogTitle>
              <DialogDescription className="flex min-w-0 items-baseline gap-x-2 text-[length:var(--fs-11)]">
                <span className="min-w-0 truncate font-medium text-foreground" title={lineName || undefined}>{lineName || 'Γραμμή χωρίς περιγραφή'}</span>
                {lineTotal != null && <span className="shrink-0 tabular-nums">{lineTotal.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ol aria-label="Βήματα" className="hidden items-center gap-2 text-[length:var(--fs-11)] font-semibold sm:flex">
                {(['Τι αφορά', 'Κατηγορία'] as const).map((t, i) => (
                  <li key={t} className={cn('flex items-center gap-1.5', step === i + 1 ? 'text-sisyphus-700 dark:text-sisyphus-300' : 'text-muted-foreground')}
                    aria-current={step === i + 1 ? 'step' : undefined}>
                    <span className={cn('inline-flex size-5 items-center justify-center rounded-full text-[length:var(--fs-10)]',
                      step === i + 1 ? 'bg-sisyphus-500 text-white' : step > i + 1 ? 'bg-emerald-500 text-white' : 'bg-muted')}>
                      {step > i + 1 ? <FiCheck aria-hidden className="size-3" /> : i + 1}
                    </span>
                    {t}
                    {i === 0 && <span aria-hidden className="ml-0.5 h-px w-5 bg-border" />}
                  </li>
                ))}
              </ol>
              <a href="/wiki/ocr/line-purpose" target="_blank" rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[length:var(--fs-12)] font-semibold text-sisyphus-700 outline-none hover:bg-sisyphus-500/10 focus-visible:ring-2 focus-visible:ring-sisyphus-500 dark:text-sisyphus-300">
                <FiHelpCircle aria-hidden className="size-3.5" /> Βοήθεια
              </a>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-muted/20 px-4 py-3">
            {/* Γρήγορη λύση: η μνήμη ξέρει ήδη πού πήγε ίδια γραμμή — ένα κλικ, χωρίς οδηγό. */}
            {step === 1 && !match && suggestion && suggestion.candidates.length > 0 && (
              <FormSection tone="emerald" icon={<FiZap />} title="Γρήγορη λύση" aside={suggestion.label}>
                <RowHint>Έτσι καταχωρίστηκαν παρόμοιες γραμμές στο παρελθόν.</RowHint>
                <div className="-mx-3 -mb-2.5 divide-y divide-border border-t border-border">
                  {suggestion.candidates.map((c) => (
                    <button
                      key={`${c.kind}-${c.id}`} type="button" disabled={busy}
                      onClick={async () => { await acceptSuggestion(c); setOpen(false); }}
                      className="flex min-h-9 w-full cursor-pointer items-center gap-2 px-3 text-left text-[length:var(--fs-13)] text-foreground outline-none hover:bg-emerald-500/10 focus-visible:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sisyphus-500 disabled:opacity-60"
                    >
                      <FiCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 font-mono text-[length:var(--fs-11)] text-muted-foreground">{c.code}</span>
                      {c.inactive && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[length:var(--fs-10)] font-semibold text-amber-800 dark:text-amber-300">θα ενεργοποιηθεί</span>}
                    </button>
                  ))}
                </div>
              </FormSection>
            )}

            {step === 1 || !tile ? (
              <PurposeStep
                lineName={lineName}
                amount={lineTotal}
                target={target}
                defaultKind={defaultKind}
                hasRegistrySuggestion={!!suggestion && suggestion.candidates.length > 0}
                current={(() => { const p = purposeOfMatch(match); return p ? tileForPurpose(p) : null; })()}
                onChoose={(t) => { setTile(t); setStep(2); }}
                ai={ai}
                aiBusy={aiBusy}
                onAskAi={() => void askAi()}
              />
            ) : (
              <>
                {/* Διάλεξε κάτι διαφορετικό από την πρόταση: δεν το απαγορεύουμε — το λέμε, με ένα κλικ επιστροφή.
                    (Ένα laptop στο «Αυτοκίνητο» θα γινόταν έξοδο καυσίμων αντί για πάγιο.) */}
                {advised && advised.tile !== tile && (TILES[advised.tile].purpose !== TILES[tile].purpose || advised.tile === 'equipment') && (
                  <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-[length:var(--fs-12)] text-foreground">
                    <FiAlertTriangle aria-hidden className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <span className="min-w-0 flex-1">
                      <strong>Σίγουρα;</strong> Η γραμμή μοιάζει με «{TILES[advised.tile].title}». {advised.reason}
                    </span>
                    <button type="button" onClick={() => setTile(advised.tile)}
                      className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md bg-sisyphus-500 px-3 font-semibold text-white outline-none hover:bg-sisyphus-600 focus-visible:ring-2 focus-visible:ring-sisyphus-500 focus-visible:ring-offset-1">
                      Πέρασέ το ως «{TILES[advised.tile].title}»
                    </button>
                  </div>
                )}

                <FormSection tone="blue" icon={<FiInfo />} title="Τι θα γίνει">
                  <div className="space-y-1 text-[length:var(--fs-12)] leading-snug text-foreground">
                    <p>{PURPOSE_OUTCOME[TILES[tile].purpose]}</p>
                    {TILES[tile].accountingNote && <p className="text-muted-foreground">{TILES[tile].accountingNote}</p>}
                    {TILES[tile].purpose === 'asset' && (() => {
                      const dep = depreciationAdvice({ lineName, amount: lineTotal, gl: null });
                      return (
                        <>
                          {dep && (
                            <p className="text-foreground">
                              <strong>Απόσβεση:</strong> {dep.rate}% τον χρόνο, όπως ορίζει ο νόμος για «{dep.label}»
                              {dep.annual != null && dep.years != null && <> — ≈ {dep.annual.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € τον χρόνο, για περίπου {dep.years} χρόνια</>}.
                              {dep.lowValue && <> Αξία κάτω από 1.500 €: μπορεί να αποσβεστεί και ολόκληρη φέτος.</>}
                            </p>
                          )}
                          <p className="text-muted-foreground">
                            Τι σημαίνει <Term k="pagio" /> και <Term k="apostesi" />;
                          </p>
                        </>
                      );
                    })()}
                  </div>
                </FormSection>

                {TILES[tile].purpose === 'asset' && (
                  <FormSection tone="amber" icon={<FiHardDrive />} title="Εξοπλισμός (πάγιο)">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 text-[length:var(--fs-12)] leading-snug text-foreground">
                        Είναι <strong>καινούργια</strong> αγορά; Δημιούργησε τον εξοπλισμό — τα στοιχεία συμπληρώνονται από το τιμολόγιο.
                      </p>
                      <button
                        type="button" disabled={busy}
                        onClick={() => { setOpen(false); setCreatingAsset(true); }}
                        className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[length:var(--fs-12)] font-semibold text-white outline-none hover:bg-sisyphus-600 focus-visible:ring-2 focus-visible:ring-sisyphus-500 focus-visible:ring-offset-1 disabled:opacity-50"
                      >
                        <FiPlusCircle aria-hidden className="size-4" /> Νέος εξοπλισμός (πάγιο)
                      </button>
                    </div>
                    <div className="space-y-1.5 border-t border-border pt-2">
                      <RowHint>Ή, αν είναι ήδη καταχωρισμένος (π.χ. δεύτερο τιμολόγιο για το ίδιο μηχάνημα), βρες τον:</RowHint>
                      <AssetSearch id={`asset-${lineId}`} disabled={busy} onPick={pickAsset} />
                    </div>
                  </FormSection>
                )}

                {(TILES[tile].purpose === 'expense' || TILES[tile].purpose === 'goods') && (() => {
                  const rk = registryKindFor(TILES[tile].purpose, target);
                  if (!rk) return null;
                  const hint = (ai?.tile === tile ? ai.searchHint : null) || TILES[tile].searchHint || null;
                  const isGoods = rk === 'product';
                  return (
                    <FormSection tone="blue" icon={isGoods ? <FiPackage /> : <FiSearch />} title={isGoods ? 'Είδος από τον κατάλογο' : 'Κατηγορία εξόδου'}>
                      <p className="text-[length:var(--fs-12)] font-medium leading-snug text-foreground">
                        {isGoods ? 'Βρες το είδος στον κατάλογο' : <>Βρες την <Term k={rk === 'lineitem' ? 'xreopistosi' : 'eksodo'}>κατηγορία εξόδου</Term></>}
                        {hint && <span className="font-normal text-muted-foreground"> — γράψε μια λέξη, π.χ. «{hint}»</span>}
                      </p>
                      {rk === 'lineitem' && lineCategories.length > 0 && (
                        <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                          <Field label="Ομάδα εξόδων (προαιρετικό φίλτρο)" htmlFor={`line-cat-${lineId}`} className="col-span-12 sm:col-span-6">
                            <select
                              id={`line-cat-${lineId}`}
                              value={lineCategory ?? ''}
                              disabled={busy}
                              onChange={(e) => setLineCategory(e.target.value ? Number(e.target.value) : null)}
                              className={cn('w-full cursor-pointer rounded-md border border-input bg-background px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500', fieldCls)}
                            >
                              <option value="">Όλες</option>
                              {lineCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </Field>
                        </div>
                      )}
                      <RegistrySearch
                        key={`${tile}-${rk}-${hint ?? ''}`}
                        kind={rk}
                        disabled={busy}
                        id={`line-registry-${lineId}`}
                        category={rk === 'lineitem' ? lineCategory : null}
                        initialQuery={hint}
                        label={isGoods ? 'Είδος' : 'Κατηγορία εξόδου'}
                        onPick={async (p) => { if (await pick(p.id, p.kind, p.code, p.name)) setOpen(false); }}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setKind(rk); setOpen(false); setCreating(true); }}
                        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-sisyphus-500/40 px-3 text-[length:var(--fs-12)] font-semibold text-sisyphus-700 outline-none hover:bg-sisyphus-500/10 focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:opacity-50 dark:text-sisyphus-300"
                      >
                        <FiPlusCircle aria-hidden className="size-3.5" /> Δεν υπάρχει; {isGoods ? 'Νέο είδος' : 'Νέα κατηγορία εξόδου'}
                      </button>
                    </FormSection>
                  );
                })()}

                {TILES[tile].purpose === 'split' && (
                  <FormSection tone="violet" icon={<FiPieChart />} title="Μοίρασμα σε κατηγορίες">
                    <p className="text-[length:var(--fs-12)] leading-snug text-foreground">
                      Κάτω από τη γραμμή θα εμφανιστούν δύο κομμάτια (50% – 50%). Διάλεξε την κατηγορία εξόδου
                      του καθενός και γράψε ποσό <strong>ή</strong> ποσοστό — το τελευταίο κομμάτι κλείνει μόνο του.
                      Δες τι σημαίνει <Term k="epimerismos" />.
                    </p>
                    <button
                      type="button"
                      disabled={lineTotal == null}
                      onClick={() => { setOpen(false); emitStartSplit(lineId); }}
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[length:var(--fs-12)] font-semibold text-white outline-none hover:bg-sisyphus-600 focus-visible:ring-2 focus-visible:ring-sisyphus-500 focus-visible:ring-offset-1 disabled:opacity-50"
                    >
                      <FiPieChart aria-hidden className="size-4" /> Ξεκίνα το μοίρασμα
                    </button>
                    {lineTotal == null && <RowHint>Η γραμμή δεν έχει σύνολο — δεν μπορεί να μοιραστεί.</RowHint>}
                  </FormSection>
                )}
              </>
            )}

            {/* ── Για προχωρημένους: τα μητρώα του SoftOne, απευθείας (π.χ. «Υπηρεσία» με κωδικό) ── */}
            <section className="overflow-hidden rounded-lg border border-violet-500/25 bg-card">
              <button
                type="button" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}
                className="flex min-h-8 w-full cursor-pointer items-center gap-2 bg-violet-50/70 px-3 py-1.5 text-left text-[length:var(--fs-12)] font-semibold text-violet-800 outline-none hover:bg-violet-100/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sisyphus-500 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/15"
              >
                <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded bg-violet-500/15 text-violet-700 dark:text-violet-300 [&_svg]:size-3"><FiDatabase /></span>
                <span className="min-w-0 flex-1 truncate">Για λογιστές: επιλογή μητρώου SoftOne απευθείας</span>
                <FiChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', advanced && 'rotate-180')} />
              </button>
              {advanced && (
                <div className="space-y-2.5 border-t border-violet-500/20 px-3 py-2.5">
                  {allowedHere.length <= 1 ? (
                    <RowHint>
                      {allowedHere.length === 1
                        ? <>Η σειρά του παραστατικού δέχεται <strong className="text-foreground">{KIND_META[allowedHere[0]].label}</strong>.</>
                        : 'Η σειρά του παραστατικού δεν δέχεται καμία εγγραφή μητρώου.'}
                    </RowHint>
                  ) : (
                    <div role="group" aria-label="Κατηγορία μητρώου" className="flex rounded-md border border-border bg-muted/50 p-0.5">
                      {SEGMENTS.map((k) => {
                        const fits = lineKindFits(target, k);
                        return (
                          <button
                            key={k}
                            type="button"
                            aria-pressed={kind === k}
                            disabled={!fits}
                            title={fits ? undefined : `Ο προορισμός «${target ? POST_LINES_LABEL[target.lines] : '—'}» δεν δέχεται ${KIND_META[k].label.toLowerCase()}.`}
                            onClick={() => { setKind(k); if (k !== 'lineitem') setLineCategory(null); }}
                            className={cn(
                              'flex h-7 flex-1 items-center justify-center gap-1 rounded px-1 text-[length:var(--fs-11)] font-semibold outline-none',
                              'cx-transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-sisyphus-500',
                              fits ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                              kind === k ? 'text-foreground shadow-sm' : 'text-muted-foreground hover:bg-[var(--cx-hover)]',
                            )}
                            style={kind === k ? { backgroundColor: KIND_META[k].bg, color: KIND_META[k].fg } : undefined}
                          >
                            {KIND_META[k].icon} {KIND_META[k].label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {allowedHere.length > 1 && <RowHint>{kindsReason}</RowHint>}
                  {kind == null ? (
                    <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[length:var(--fs-11)] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      <FiAlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
                      Διάλεξε πρώτα μητρώο — μια λάθος επιλογή γράφει στο SoftOne εγγραφή που το παραστατικό δεν μπορεί να χρησιμοποιήσει.
                    </p>
                  ) : (
                    <>
                      <RegistrySearch
                        kind={kind}
                        disabled={busy}
                        id={`line-registry-adv-${lineId}`}
                        category={kind === 'lineitem' ? lineCategory : null}
                        label={KIND_META[kind].label}
                        onPick={async (p) => { if (await pick(p.id, p.kind, p.code, p.name)) setOpen(false); }}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setOpen(false); setCreating(true); }}
                        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-sisyphus-500/30 px-2.5 text-[length:var(--fs-11)] font-semibold text-sisyphus-600 outline-none hover:bg-sisyphus-50 focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-sisyphus-300 dark:hover:bg-sisyphus-500/10"
                      >
                        <FiPlusCircle aria-hidden className="size-3" /> Δημιουργία νέας εγγραφής «{KIND_META[kind].label}»
                      </button>
                    </>
                  )}
                  {assetsHere && (
                    <div className="space-y-1.5 border-t border-border pt-2">
                      <p className="flex items-center gap-1 text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground">
                        <FiHardDrive aria-hidden className="size-3" /> Πάγιο
                      </p>
                      <AssetSearch id={`asset-adv-${lineId}`} disabled={busy} onPick={pickAsset} />
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ── Περισσότερα: αναλυτική (προαιρετική) ── */}
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <button
                type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((a) => !a)}
                className="flex min-h-8 w-full cursor-pointer items-center gap-2 bg-muted/50 px-3 py-1.5 text-left text-[length:var(--fs-12)] font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sisyphus-500"
              >
                <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded bg-muted text-muted-foreground [&_svg]:size-3"><FiSliders /></span>
                <span className="min-w-0 flex-1 truncate">
                  Περισσότερα (προαιρετικά): κέντρο κόστους, έργο
                  {shown.length > 0 && <span className="ml-1.5 rounded-full bg-sisyphus-500/15 px-1.5 text-sisyphus-700 dark:text-sisyphus-300">{shown.length}</span>}
                </span>
                <FiChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', moreOpen && 'rotate-180')} />
              </button>
              {moreOpen && (
                <div className="space-y-2.5 border-t border-border px-3 py-2.5">
                  <RowHint>
                    Συμπλήρωσέ τα μόνο αν σου το έχει ζητήσει ο λογιστής — δεν εμποδίζουν ποτέ την καταχώριση. Τι είναι το{' '}
                    <Term k="kentro_kostous" />; Ό,τι επιβεβαιώσεις θα το <strong>θυμάται</strong> για την ίδια περιγραφή.
                  </RowHint>
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
              )}
            </section>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-card px-4 py-2.5">
            {step === 2 ? (
              <button type="button" onClick={() => setStep(1)}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[length:var(--fs-13)] font-semibold text-foreground outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500">
                <FiArrowLeft aria-hidden className="size-4" /> Πίσω
              </button>
            ) : <span />}
            <button type="button" onClick={() => setOpen(false)}
              className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input px-4 text-[length:var(--fs-13)] font-semibold text-foreground outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500">
              Κλείσιμο
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateAssetDialog
        open={creatingAsset}
        onOpenChange={setCreatingAsset}
        lineId={lineId}
        lineName={lineName ?? null}
        lineVatRate={lineVatRate ?? null}
        lineAmount={lineTotal ?? null}
        onCreated={(a) => { setCreatingAsset(false); assetPicked(a); }}
      />

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
          initialEan={lineEan ?? null}
          initialMfrCode={lineMfrCode ?? null}
          initialQty={lineQty ?? null}
          initialPrice={linePrice ?? null}
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
