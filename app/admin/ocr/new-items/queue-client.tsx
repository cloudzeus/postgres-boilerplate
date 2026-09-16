'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiCheckCircle, FiCpu, FiLoader } from 'react-icons/fi';
import { toast } from 'sonner';
import { QueueEmpty, QueueLayout, type QueueLayoutHandle } from '@/components/admin/queue-layout';
import type { ItemQueueGroup, QueueSuggestion } from '@/lib/ocr/queues';
import type { MatchKind } from '@/lib/ocr/line-match';
import { applyAiCategories, needsAi } from '@/lib/ocr/ai-apply';
import {
  CATEGORY_META, EMPTY_ANALYTICS, ItemPanel, UNCLASSIFIED_META, docLabel, lineLabel,
  type AnalyticsState, type ClassOption, type CreateOutcome, type LineCategoryOption,
  type UnitOption, type VatOption,
} from './item-panel';
import { Button } from '@/components/ui/button';

const FILTERS = [
  { key: 'all', label: 'Όλα' },
  { key: 'product', label: 'Προϊόντα' },
  { key: 'service', label: 'Υπηρεσίες' },
  { key: 'expense', label: 'Έξοδα' },
  { key: 'lineitem', label: 'Χρεοπιστώσεις' },
  // Ομάδες που ΔΕΝ κατηγοριοποιήθηκαν: ρητή κατάσταση, όχι σιωπηλό «Προϊόν».
  { key: 'unclassified', label: 'Χωρίς κατηγορία' },
  { key: 'none', label: 'Χωρίς πρόταση' },
] as const;

/** Πόσες αναπάντητες ομάδες ρωτάμε το μοντέλο με μία κλήση. */
const AI_BATCH = 20;

/** Η τελευταία κατηγορία δαπάνης που διάλεξε ο χρήστης — κρατιέται όσο ζει η καρτέλα. */
const CATEGORY_STORAGE_KEY = 'ocr.newItems.lineCategory';

/** Ό,τι επιστρέφουν και οι τρεις ενέργειες της ουράς. */
interface ActionResult { linesUpdated: number; name?: string | null; code?: string | null }

/** Το «θυμάται» μήνυμα του toast: ο κανόνας είναι ανά εκδότη ή γενικός. */
function memoryNote(g: ItemQueueGroup): string {
  return g.afm
    ? `Θα εφαρμόζεται αυτόματα στον εκδότη ${g.supplier ?? g.afm}.`
    : 'Θα εφαρμόζεται αυτόματα σε όλους τους εκδότες.';
}

/**
 * Ουρά «Είδη & έξοδα»: master–detail με ομάδες γραμμών αριστερά και το panel
 * απόφασης δεξιά. Κάθε ενέργεια (αντιστοίχιση / δημιουργία / παράλειψη) αφορά
 * ΟΛΗ την ομάδα, βγάζει τη γραμμή από την ουρά και προχωρά στην επόμενη.
 */
export function NewItemsClient({
  header,
  initialGroups,
  total,
  truncated,
  suggestedFor,
  canManage,
  vats,
  units,
  itemGroups,
  itemCategories,
  lineCategories,
}: {
  /** Έτοιμο `PageHeader` από τον server (κρατά το wiki `?` icon). */
  header: React.ReactNode;
  initialGroups: ItemQueueGroup[];
  total: number;
  /** Η ουρά κόπηκε στο πλαφόν γραμμών του server. */
  truncated: boolean;
  suggestedFor: number;
  /** `ocr.categorize` — χωρίς αυτό καμία ενέργεια δεν είναι διαθέσιμη. */
  canManage: boolean;
  vats: VatOption[];
  units: UnitOption[];
  /** Ομάδες ειδών (`MTRGROUP`) — μόνο επιλογή. */
  itemGroups: ClassOption[];
  /** Εμπορικές κατηγορίες (`MTRCATEGORY`) — με inline δημιουργία. */
  itemCategories: ClassOption[];
  lineCategories: LineCategoryOption[];
}) {
  const router = useRouter();
  const layout = React.useRef<QueueLayoutHandle | null>(null);
  const [groups, setGroups] = React.useState(initialGroups);
  // Μια κατηγορία που μόλις δημιουργήθηκε πρέπει να είναι ΑΜΕΣΩΣ επιλέξιμη, χωρίς reload:
  // ο server την έχει ήδη γράψει και στο SoftOne και στον καθρέφτη.
  const [classOptions, setClassOptions] = React.useState<ClassOption[]>(itemCategories);
  React.useEffect(() => { setClassOptions(itemCategories); }, [itemCategories]);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(initialGroups[0]?.key ?? null);
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<string>('all');
  const [done, setDone] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  // Οι ομάδες πέρα από τις πρώτες `suggestedFor` δεν έχουν προτάσεις από τον
  // server — τις ζητάμε όταν επιλεγούν (skeleton στο panel).
  const [loaded, setLoaded] = React.useState<Set<string>>(
    () => new Set(initialGroups.slice(0, suggestedFor).map((g) => g.key)),
  );
  const [loadingSuggest, setLoadingSuggest] = React.useState<string | null>(null);
  // Ομάδες που η lazy φόρτωση προτάσεων απέτυχε: ΔΕΝ μετράνε ως «φορτωμένες»
  // (θα φαίνονταν «χωρίς πρόταση») και δεν ξαναζητιούνται χωρίς ρητό retry.
  const [failedSuggest, setFailedSuggest] = React.useState<Set<string>>(() => new Set());

  // Η επιλεγμένη κατηγορία ανά ομάδα (segmented) — ξεκινά από την προεπιλογή
  // του server και κρατιέται όσο ο χρήστης γυρίζει πάνω-κάτω στην ουρά.
  const [categories, setCategories] = React.useState<Record<string, MatchKind>>({});
  // Η κατηγορία δαπάνης που διάλεξε ο χρήστης — στενεύει ΚΑΙ την αναζήτηση χρεοπιστώσεων ΚΑΙ
  // τους υποψηφίους που στέλνονται στο μοντέλο. Θυμάται την τελευταία επιλογή μέσα στη συνεδρία·
  // είναι ευκολία, όχι κρίσιμη κατάσταση, γι' αυτό κάθε πρόσβαση στο storage είναι σε try/catch.
  // Η αναλυτική ανά ομάδα. Ξεκινά από ό,τι θυμάται ο κανόνας (πρόταση, με ορατή σήμανση) και
  // αλλάζει μόνο όταν το κάνει ο χρήστης ή όταν έρθει πρόταση AI.
  const [analyticsByKey, setAnalyticsByKey] = React.useState<Record<string, AnalyticsState>>({});
  const analyticsFor = React.useCallback((g: ItemQueueGroup): AnalyticsState => {
    const saved = analyticsByKey[g.key];
    if (saved) return saved;
    const r = g.remembered;
    if (!r) return EMPTY_ANALYTICS;
    return {
      costCntr: { id: r.costCntr, label: r.labels.costCntr, source: r.costCntr != null ? 'memory' : null },
      prjc: { id: r.prjc, label: r.labels.prjc, source: r.prjc != null ? 'memory' : null },
      prjcStage: { id: r.prjcStage, label: r.labels.prjcStage, source: r.prjcStage != null ? 'memory' : null },
    };
  }, [analyticsByKey]);

  const [lineCategory, setLineCategoryState] = React.useState<number | null>(null);
  React.useEffect(() => {
    try {
      const n = Number(sessionStorage.getItem(CATEGORY_STORAGE_KEY));
      if (Number.isFinite(n) && n > 0) setLineCategoryState(n);
    } catch { /* private mode / αποκλεισμένο storage: το φίλτρο ξεκινά κενό */ }
  }, []);
  const setLineCategory = React.useCallback((v: number | null) => {
    setLineCategoryState(v);
    try {
      if (v == null) sessionStorage.removeItem(CATEGORY_STORAGE_KEY);
      else sessionStorage.setItem(CATEGORY_STORAGE_KEY, String(v));
    } catch { /* το φίλτρο ισχύει ούτως ή άλλως για την τρέχουσα επιλογή */ }
  }, []);

  /** «Χωρίς πρόταση» μόνο για ομάδες που έχουν όντως υπολογιστεί. */
  const noSuggestion = React.useCallback(
    (g: ItemQueueGroup) => loaded.has(g.key) && g.suggestions.length === 0,
    [loaded],
  );

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (filter === 'none') { if (!noSuggestion(g)) return false; }
      else if (filter === 'unclassified') { if (g.category !== null) return false; }
      else if (filter !== 'all' && g.category !== filter) return false;
      if (!q) return true;
      return (
        g.sample.toLowerCase().includes(q) ||
        g.pattern.includes(q) ||
        (g.supplier ?? '').toLowerCase().includes(q) ||
        g.afm.includes(q) ||
        (g.code ?? '').toLowerCase().includes(q)
      );
    });
  }, [groups, filter, search, noSuggestion]);

  const counts = React.useMemo(() => ({
    all: groups.length,
    product: groups.filter((g) => g.category === 'product').length,
    service: groups.filter((g) => g.category === 'service').length,
    expense: groups.filter((g) => g.category === 'expense').length,
    lineitem: groups.filter((g) => g.category === 'lineitem').length,
    unclassified: groups.filter((g) => g.category === null).length,
    none: groups.filter(noSuggestion).length,
  }), [groups, noSuggestion]);

  const selected = visible.find((g) => g.key === selectedKey) ?? null;

  // Αν το φίλτρο/η αναζήτηση έκρυψε την επιλογή, διάλεξε την πρώτη ορατή.
  React.useEffect(() => {
    if (visible.length === 0) { if (selectedKey !== null) setSelectedKey(null); return; }
    if (!visible.some((g) => g.key === selectedKey)) setSelectedKey(visible[0].key);
  }, [visible, selectedKey]);

  // Lazy προτάσεις για την επιλεγμένη ομάδα.
  React.useEffect(() => {
    if (!selected || loaded.has(selected.key) || failedSuggest.has(selected.key)) return;
    const g = selected;
    let ignore = false;
    setLoadingSuggest(g.key);
    const params = new URLSearchParams({ afm: g.afm, pattern: g.pattern });
    if (g.code) params.set('code', g.code);
    if (g.sample) params.set('sample', g.sample);
    fetch(`/api/admin/ocr/new-items/suggest?${params}`)
      .then(async (r) => {
        // 4xx/5xx δεν είναι «καμία πρόταση» — η ομάδα μένει αφόρτωτη.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { suggestions?: QueueSuggestion[] };
      })
      .then((d) => {
        if (ignore) return;
        const suggestions = d.suggestions ?? [];
        setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, suggestions } : x)));
        setLoaded((prev) => new Set(prev).add(g.key));
      })
      .catch(() => {
        if (!ignore) setFailedSuggest((prev) => new Set(prev).add(g.key));
      })
      .finally(() => { if (!ignore) setLoadingSuggest(null); });
    return () => { ignore = true; };
  }, [selected, loaded, failedSuggest]);

  /** «Δοκίμασε ξανά» στο panel: βγάζει την ομάδα από τις αποτυχημένες ⇒ το effect ξαναχτυπά. */
  const retrySuggestions = React.useCallback(() => {
    const key = selectedKey;
    if (!key) return;
    setFailedSuggest((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, [selectedKey]);

  // `null` = «χωρίς κατηγορία»: ο server δεν βρήκε απόδειξη και δεν τη μαντεύει.
  const category: MatchKind | null = selected ? (categories[selected.key] ?? selected.category) : null;
  const setCategory = (k: MatchKind) => {
    if (selected) setCategories((prev) => ({ ...prev, [selected.key]: k }));
  };

  /**
   * Οι προτάσεις της τρέχουσας κατηγορίας — η πρώτη είναι η ενέργεια του Enter. Όσο η ομάδα
   * είναι αταξινόμητη δείχνουμε **όλες** τις προτάσεις: είναι ακριβώς η πληροφορία που βοηθά
   * τον χρήστη να διαλέξει κατηγορία.
   */
  const shownSuggestions = React.useMemo(
    () => (selected ? (category ? selected.suggestions.filter((s) => s.kind === category) : selected.suggestions) : []),
    [selected, category],
  );
  const hiddenSuggestions = (selected?.suggestions.length ?? 0) - shownSuggestions.length;

  /** Η ομάδα έφυγε από την ουρά: πέρασε στην επόμενη ορατή και μέτρα πρόοδο. */
  const retire = React.useCallback((key: string) => {
    const at = visible.findIndex((g) => g.key === key);
    const next = visible[at + 1]?.key ?? visible[at - 1]?.key ?? null;
    setGroups((prev) => prev.filter((g) => g.key !== key));
    setSelectedKey(next);
    setDone((d) => d + 1);
    // Το κουμπί που πατήθηκε μόλις ξεχάστηκε — η εστίαση πάει στη λίστα, στη νέα επιλογή.
    if (next) requestAnimationFrame(() => layout.current?.focusList());
    // Ο server είναι η πηγή αλήθειας (badges του sidebar, μετρητές άλλων σελίδων).
    router.refresh();
  }, [visible, router]);

  async function post<T>(url: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as T & { message?: string };
      if (!res.ok) {
        toast.error(data.message ?? 'Η ενέργεια απέτυχε.');
        return null;
      }
      return data;
    } catch {
      toast.error('Σφάλμα δικτύου — η ενέργεια δεν ολοκληρώθηκε.');
      return null;
    }
  }

  const match = React.useCallback(async (target: { mtrl?: number; expn?: number; lin?: number }, isService: boolean) => {
    if (!selected || busy || !canManage) return;
    const g = selected;
    const an = analyticsFor(g);
    setBusy(true);
    try {
      const d = await post<ActionResult>('/api/admin/ocr/new-items/match', {
        afm: g.afm,
        pattern: g.pattern,
        target: target.lin != null ? { lin: target.lin } : target.expn != null ? { expn: target.expn } : { mtrl: target.mtrl },
        isService,
        // Έξοδο → EXPANAL, που δεν έχει αναλυτική: δεν στέλνουμε τιμές που θα πετιόνταν.
        analytics: target.expn != null ? undefined : {
          costCntr: an.costCntr.id, prjc: an.prjc.id, prjcStage: an.prjcStage.id,
        },
      });
      if (!d) return;
      toast.success(
        `${d.linesUpdated === 1 ? 'Αντιστοιχίστηκε' : 'Αντιστοιχίστηκαν'} ${lineLabel(d.linesUpdated)} → ${d.name}`,
        { description: memoryNote(g) },
      );
      retire(g.key);
    } finally {
      setBusy(false);
    }
  }, [selected, busy, canManage, retire, analyticsFor]);

  /**
   * Δημιουργία νέας εγγραφής μητρώου. Το **409 `code_taken`** ΔΕΝ είναι γενική αποτυχία: δεν
   * δημιουργήθηκε τίποτα και ο server επιστρέφει νέα πρόταση. Την παραδίδουμε στο panel, που τη
   * δείχνει πάνω στο πεδίο «Κωδικός» — καμία αυτόματη επανάληψη, καμία διπλή εγγραφή.
   */
  const create = React.useCallback(async (input: {
    kind: MatchKind; code: string; name: string; vat: string | null; unit: string | null;
    price: number | null; supplierCode: string | null;
  }): Promise<void | CreateOutcome> => {
    if (!selected || busy || !canManage) return;
    const g = selected;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/new-items/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afm: g.afm, pattern: g.pattern, ...input }),
      });
      const d = (await res.json().catch(() => ({}))) as ActionResult & {
        message?: string; error?: string; suggestion?: string | null; stale?: boolean;
      };
      if (res.status === 409 && d.error === 'code_taken') {
        return {
          codeTaken: {
            message: d.message || 'Ο κωδικός υπάρχει ήδη στο SoftOne.',
            suggestion: d.suggestion ? String(d.suggestion) : null,
            // Ο server λέει αν η νέα πρόταση βγήκε από τον καθρέφτη· το panel το επαναλαμβάνει.
            stale: d.stale === true,
          },
        };
      }
      if (!res.ok) {
        toast.error(d.message ?? 'Η ενέργεια απέτυχε.');
        return;
      }
      toast.success(
        `Δημιουργήθηκε «${d.name}» — ${d.linesUpdated === 1 ? 'αντιστοιχίστηκε' : 'αντιστοιχίστηκαν'} ${lineLabel(d.linesUpdated)}`,
        { description: memoryNote(g) },
      );
      retire(g.key);
    } catch {
      toast.error('Σφάλμα δικτύου — η ενέργεια δεν ολοκληρώθηκε.');
    } finally {
      setBusy(false);
    }
  }, [selected, busy, canManage, retire]);

  const skip = React.useCallback(async () => {
    if (!selected || busy || !canManage) return;
    const g = selected;
    setBusy(true);
    try {
      const d = await post<ActionResult>('/api/admin/ocr/new-items/skip', { afm: g.afm, pattern: g.pattern });
      if (!d) return;
      toast.success(`${d.linesUpdated === 1 ? 'Παραλείφθηκε' : 'Παραλείφθηκαν'} ${lineLabel(d.linesUpdated)}`, {
        description: 'Μπορείς να τις επαναφέρεις από την καρτέλα του παραστατικού.',
      });
      retire(g.key);
    } finally {
      setBusy(false);
    }
  }, [selected, busy, canManage, retire]);

  // ── Πρόταση δαπάνης με AI ────────────────────────────────────────────
  // Τρέχει ΜΟΝΟ με κλικ, ΜΟΝΟ για ομάδες που δεν έλυσε το string-matching, και προτείνει:
  // η αντιστοίχιση γίνεται πάντα με ρητή επιβεβαίωση του χρήστη (και τότε γράφεται ο κανόνας).
  // Ό,τι έχει ήδη αποφασιστεί (χρήστης ή δομή του ERP) ούτε ρωτιέται ούτε ξαναγράφεται.
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiAsked, setAiAsked] = React.useState(0);
  const aiSuggest = React.useCallback(async () => {
    if (aiBusy || !canManage) return;
    // ΜΟΝΟ οι ομάδες που είναι πραγματικά άλυτες — όχι ό,τι φαίνεται στη λίστα. Μια ομάδα που
    // έχει ήδη κατηγορία (από τη μνήμη, από τη δομή του ERP ή από τον ίδιο τον χρήστη) ΚΑΙ
    // σίγουρη πρόταση κωδικού δεν έχει ερώτημα: θα πληρώναμε για απάντηση που υπάρχει, με
    // κίνδυνο να την αντικαταστήσει μια εικασία βεβαιότητας 0,6.
    const askable = visible.filter((g) => needsAi({
      category: categories[g.key] ?? g.category, suggestions: g.suggestions,
    }));
    const batch = askable.slice(0, AI_BATCH).map((g) => ({
      key: g.key, afm: g.afm, pattern: g.pattern, sample: g.sample, code: g.code,
      // Ο εκδότης είναι συμφραζόμενο για τον συλλογισμό: «ΤΑΒΕΡΝΑ» δεν πουλά αποθέματα σε γραφείο.
      supplier: g.supplier,
    }));
    if (batch.length === 0) {
      toast.info('Καμία άλυτη ομάδα στη λίστα — όλες έχουν ήδη κατηγορία και σίγουρη πρόταση.');
      return;
    }
    // Η ντετερμινιστική κατηγορία της κάθε ομάδας, όπως ισχύει ΤΩΡΑ: ο φύλακας που δεν αφήνει
    // την απάντηση του μοντέλου να πατήσει απόδειξη (δες `lib/ocr/ai-apply.ts`).
    const deterministic = new Map(askable.map((g) => [g.key, g.category] as const));
    setAiBusy(true);
    setAiAsked(batch.length);
    try {
      const d = await post<{
        suggestions: {
          key: string; kind: MatchKind | null; lin: number | null; code: string | null;
          name: string | null; confidence: number; reason: string;
        }[];
        analytics: {
          key: string; costCntr: number | null; prjc: number | null; prjcStage: number | null;
          labels: { costCntr: string | null; prjc: string | null; prjcStage: string | null };
        }[];
        asked: number; skipped: number; cached: number; analyticsAsked: number; degraded: boolean;
      }>('/api/admin/ocr/new-items/ai-suggest', {
        groups: batch,
        categoryId: lineCategory,
        trdr: visible[0]?.trdr ?? null,
      });
      if (!d) return;
      if (d.degraded) {
        toast.info('Το μοντέλο δεν είναι διαθέσιμη αυτή τη στιγμή — καμία πρόταση.');
        return;
      }
      // Η αναλυτική είναι ΠΡΟΤΑΣΗ: μπαίνει στα πεδία σημαδεμένη ως «πρόταση AI», ο χρήστης τη
      // δέχεται ή τη σβήνει, και μόνο η επιβεβαίωση τη γράφει (και τη διδάσκει στη μνήμη).
      const an = d.analytics ?? [];
      if (an.length > 0) {
        setAnalyticsByKey((prev) => {
          const next = { ...prev };
          for (const a of an) {
            const cur = next[a.key] ?? EMPTY_ANALYTICS;
            const take = (
              id: number | null, lbl: string | null, old: AnalyticsState['costCntr'],
            ): AnalyticsState['costCntr'] => (
              // Ό,τι έχει ήδη επιλέξει ο ΧΡΗΣΤΗΣ δεν το πατάει η πρόταση.
              old.source === 'manual' || id == null ? old : { id, label: lbl, source: 'ai' }
            );
            next[a.key] = {
              costCntr: take(a.costCntr, a.labels.costCntr, cur.costCntr),
              prjc: take(a.prjc, a.labels.prjc, cur.prjc),
              prjcStage: take(a.prjcStage, a.labels.prjcStage, cur.prjcStage),
            };
          }
          return next;
        });
      }

      if (d.suggestions.length === 0 && an.length === 0) {
        toast.info(
          d.skipped > 0
            ? `Καμία νέα πρόταση — ${d.skipped} ${d.skipped === 1 ? 'ομάδα λύθηκε' : 'ομάδες λύθηκαν'} χωρίς AI.`
            : 'Το μοντέλο δεν βρήκε δαπάνη που να ταιριάζει.',
        );
        return;
      }
      // Η πρόταση μπαίνει ΠΡΩΤΗ στην ομάδα της, ως υποψήφια εγγραφή προς επιβεβαίωση. Το μοντέλο
      // μπορεί να προτείνει ΜΟΝΟ τύπο (χωρίς κωδικό): τότε δεν υπάρχει γραμμή πρότασης, αλλά η
      // κατηγορία της ομάδας παύει να είναι «χωρίς κατηγορία».
      const byKey = new Map(d.suggestions.map((x) => [x.key, x]));
      setGroups((prev) => prev.map((g) => {
        const a = byKey.get(g.key);
        if (!a) return g;
        const next = { ...g, aiReason: a.reason || null };
        if (a.lin == null || !a.code || !a.name) return next;
        const suggestion: QueueSuggestion = {
          mtrl: null, expn: null, lin: a.lin, kind: a.kind ?? 'lineitem',
          code: a.code, name: a.name, score: a.confidence, by: 'ai',
        };
        const rest = g.suggestions.filter((x) => x.lin !== a.lin);
        return { ...next, suggestions: [suggestion, ...rest] };
      }));
      // Η κατηγορία ακολουθεί ΤΟΝ ΤΥΠΟ που πρότεινε το μοντέλο — και μόνο όταν τον πρότεινε
      // (χαμηλή βεβαιότητα γυρίζει `kind: null`) ΚΑΙ μόνο όπου δεν υπάρχει ήδη απόφαση:
      // ό,τι διάλεξε ο χρήστης ή όρισε η δομή του ERP δεν το πατά ποτέ αυτόματη πηγή.
      setCategories((prev) => applyAiCategories(prev, d.suggestions, deterministic));
      // Ο μετρητής λέει τι ΕΓΙΝΕ, όχι τι ζητήθηκε: τύπος που μπλοκαρίστηκε από υπάρχουσα
      // απόφαση δεν είναι κατηγοριοποίηση — ίδιος έλεγχος με το `applyAiCategories`.
      const settles = (x: { key: string; kind: MatchKind | null }): boolean =>
        x.kind != null && categories[x.key] == null && deterministic.get(x.key) == null;
      const withKind = d.suggestions.filter(settles).length;
      const withCode = d.suggestions.filter((x) => x.lin != null).length;
      // Απάντηση που δεν επιλέγει τίποτα (τυπικά «μοιάζει με πάγιο») = ΠΑΡΑΤΗΡΗΣΗ: ο χρήστης
      // πρέπει να ξέρει ότι ήρθε και πού να τη διαβάσει.
      const notes = d.suggestions.filter((x) => !settles(x) && x.lin == null).length;
      const parts = [
        withKind ? `${withKind} κατηγοριοποιήσεις` : null,
        withCode ? `${withCode} δαπάνες` : null,
        notes ? `${notes} ${notes === 1 ? 'παρατήρηση' : 'παρατηρήσεις'}` : null,
        an.length ? `${an.length} αναλυτικές` : null,
      ].filter(Boolean).join(' · ');
      toast.success(
        `Προτάσεις από το AI: ${parts}`,
        { description: 'Έλεγξέ τες και επιβεβαίωσε — η επιβεβαίωση διδάσκει τον κανόνα για την επόμενη φορά.' },
      );
    } finally {
      setAiBusy(false);
      setAiAsked(0);
    }
  }, [aiBusy, canManage, visible, categories, lineCategory]);

  /** Enter στη λίστα = αντιστοίχιση με την πρώτη πρόταση της κατηγορίας. */
  const onPrimary = React.useCallback((id: string) => {
    if (!selected || selected.key !== id || !canManage) return;
    const first = shownSuggestions[0];
    if (!first) { toast.info('Καμία πρόταση — διάλεξε από το μητρώο ή δημιούργησε νέο.'); return; }
    void match(
      first.lin != null ? { lin: first.lin } : first.expn != null ? { expn: first.expn } : { mtrl: first.mtrl ?? undefined },
      first.kind === 'service',
    );
  }, [selected, canManage, shownSuggestions, match]);

  return (
    <QueueLayout<ItemQueueGroup>
      header={header}
      handleRef={layout}
      notice={truncated
        ? `Εμφανίζονται οι πρώτες ${total} εγγραφές — ολοκλήρωσε αυτές και ανανέωσε.`
        : undefined}
      items={visible}
      getId={(g) => g.key}
      selectedId={selectedKey}
      onSelect={setSelectedKey}
      filters={FILTERS.map((f) => ({ ...f, count: counts[f.key] }))}
      filter={filter}
      onFilter={setFilter}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Αναζήτηση κειμένου, προμηθευτή, ΑΦΜ…"
      // Το `total` είναι server prop και μικραίνει με κάθε `router.refresh()`· ο μετρητής
      // πρέπει να ανεβαίνει, άρα σύνολο = όσα ολοκληρώθηκαν + όσα απομένουν στην ουρά.
      progress={{ done, total: done + groups.length }}
      // Χωρίς `ocr.categorize` το Enter δεν κλέβεται καν από την ουρά.
      onPrimary={canManage ? onPrimary : undefined}
      keysEnabled={!busy}
      listLabel="Ουρά γραμμών"
      listActions={canManage ? (
        <Button
          type="button" variant="outline" size="sm"
          disabled={aiBusy || visible.length === 0}
          onClick={() => void aiSuggest()}
          className="h-8 w-full cursor-pointer"
          title="Ρωτά το μοντέλο μόνο για τις γραμμές που δεν λύθηκαν αυτόματα"
        >
          {aiBusy
            ? <><FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> Ερώτηση για {aiAsked}…</>
            : <><FiCpu aria-hidden className="size-3.5" /> Πρόταση με AI</>}
        </Button>
      ) : undefined}
      empty={
        groups.length === 0 ? (
          <QueueEmpty
            icon={<FiCheckCircle />}
            title="Καμία εκκρεμής γραμμή"
            hint="Όλες οι γραμμές των παραστατικών αντιστοιχούν σε είδος, υπηρεσία ή έξοδο του SoftOne."
          />
        ) : (
          <QueueEmpty
            title="Καμία ομάδα με αυτά τα κριτήρια"
            hint="Δοκίμασε άλλο φίλτρο ή καθάρισε την αναζήτηση."
          />
        )
      }
      renderItem={(g) => <GroupRow group={g} noSuggestion={noSuggestion(g)} />}
    >
      {selected ? (
        <ItemPanel
          group={selected}
          category={category}
          onCategory={setCategory}
          suggestions={shownSuggestions}
          hiddenSuggestions={hiddenSuggestions}
          loadingSuggestions={loadingSuggest === selected.key}
          suggestionsFailed={failedSuggest.has(selected.key)}
          onRetrySuggestions={retrySuggestions}
          canManage={canManage}
          busy={busy}
          onMatch={match}
          onCreate={create}
          onSkip={skip}
          vats={vats}
          units={units}
          itemGroups={itemGroups}
          itemCategories={classOptions}
          onCategoryCreated={(opt) => setClassOptions((prev) => (
            prev.some((c) => c.code === opt.code) ? prev : [...prev, opt]
          ))}
          lineCategories={lineCategories}
          lineCategory={lineCategory}
          onLineCategory={setLineCategory}
          analytics={analyticsFor(selected)}
          onAnalytics={(v) => setAnalyticsByKey((prev) => ({ ...prev, [selected.key]: v }))}
          // Μια γραμμή αντιστοιχισμένη σε ΕΞΟΔΟ καταλήγει στην «Ανάλυση εξόδων» (EXPANAL), που
          // δεν έχει κέντρο κόστους / έργο / δραστηριότητα. Το λέμε αντί να δεχτούμε τιμή που θα χανόταν.
          analyticsSupported={category !== 'expense'}
        />
      ) : (
        <QueueEmpty
          icon={<FiCheckCircle />}
          title="Δεν υπάρχει επιλεγμένη ομάδα"
          hint="Διάλεξε μια ομάδα από την ουρά (J/K) για να δεις τις προτάσεις."
        />
      )}
    </QueueLayout>
  );
}

/** Γραμμή ουράς: κείμενο γραμμής, εκδότης, πλήθη, κατηγορία. */
function GroupRow({ group, noSuggestion }: { group: ItemQueueGroup; noSuggestion: boolean }) {
  // Αταξινόμητη ομάδα: ρητό, ουδέτερο chip — όχι ψεύτικο «Προϊόν».
  const cat = group.category ? CATEGORY_META[group.category] : UNCLASSIFIED_META;
  return (
    <div className="min-w-0 flex-1 py-0.5">
      <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">{group.sample}</p>
      <p className="mt-0.5 truncate text-caption text-muted-foreground">
        {group.supplier ?? (group.afm ? `ΑΦΜ ${group.afm}` : 'Άγνωστος εκδότης')}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="rounded-sm bg-neutral-6 px-1.5 py-0.5 text-caption tabular-nums text-muted-foreground">
          {lineLabel(group.lineCount)} · {docLabel(group.docCount)}
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 text-caption font-medium"
          style={{ backgroundColor: cat.bg, color: cat.fg }}
        >
          {cat.label}
        </span>
        {noSuggestion && (
          <span className="rounded-sm bg-neutral-8 px-1.5 py-0.5 text-caption text-muted-foreground">
            χωρίς πρόταση
          </span>
        )}
      </div>
    </div>
  );
}
