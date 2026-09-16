'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiCheckCircle, FiCpu, FiLoader } from 'react-icons/fi';
import { toast } from 'sonner';
import { QueueEmpty, QueueLayout, type QueueLayoutHandle } from '@/components/admin/queue-layout';
import type { ItemQueueGroup, QueueSuggestion } from '@/lib/ocr/queues';
import type { MatchKind } from '@/lib/ocr/line-match';
import {
  CATEGORY_META, ItemPanel, docLabel, lineLabel,
  type LineCategoryOption, type UnitOption, type VatOption,
} from './item-panel';
import { Button } from '@/components/ui/button';

const FILTERS = [
  { key: 'all', label: 'Όλα' },
  { key: 'product', label: 'Προϊόντα' },
  { key: 'service', label: 'Υπηρεσίες' },
  { key: 'expense', label: 'Έξοδα' },
  { key: 'lineitem', label: 'Χρεοπιστώσεις' },
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
  lineCategories: LineCategoryOption[];
}) {
  const router = useRouter();
  const layout = React.useRef<QueueLayoutHandle | null>(null);
  const [groups, setGroups] = React.useState(initialGroups);
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
      if (filter === 'none' ? !noSuggestion(g) : filter !== 'all' && g.category !== filter) return false;
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

  const category: MatchKind = selected ? (categories[selected.key] ?? selected.category) : 'product';
  const setCategory = (k: MatchKind) => {
    if (selected) setCategories((prev) => ({ ...prev, [selected.key]: k }));
  };

  /** Οι προτάσεις της τρέχουσας κατηγορίας — η πρώτη είναι η ενέργεια του Enter. */
  const shownSuggestions = React.useMemo(
    () => (selected ? selected.suggestions.filter((s) => s.kind === category) : []),
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
    setBusy(true);
    try {
      const d = await post<ActionResult>('/api/admin/ocr/new-items/match', {
        afm: g.afm,
        pattern: g.pattern,
        target: target.lin != null ? { lin: target.lin } : target.expn != null ? { expn: target.expn } : { mtrl: target.mtrl },
        isService,
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
  }, [selected, busy, canManage, retire]);

  const create = React.useCallback(async (input: {
    kind: MatchKind; code: string; name: string; vat: string | null; unit: string | null; price: number | null;
  }) => {
    if (!selected || busy || !canManage) return;
    const g = selected;
    setBusy(true);
    try {
      const d = await post<ActionResult>('/api/admin/ocr/new-items/create', { afm: g.afm, pattern: g.pattern, ...input });
      if (!d) return;
      toast.success(
        `Δημιουργήθηκε «${d.name}» — ${d.linesUpdated === 1 ? 'αντιστοιχίστηκε' : 'αντιστοιχίστηκαν'} ${lineLabel(d.linesUpdated)}`,
        { description: memoryNote(g) },
      );
      retire(g.key);
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
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiAsked, setAiAsked] = React.useState(0);
  const aiSuggest = React.useCallback(async () => {
    if (aiBusy || !canManage) return;
    // Στέλνουμε τις ορατές ομάδες που έχουν ήδη υπολογισμένες (ή καθόλου) προτάσεις.
    const batch = visible.slice(0, AI_BATCH).map((g) => ({
      key: g.key, afm: g.afm, pattern: g.pattern, sample: g.sample, code: g.code,
    }));
    if (batch.length === 0) return;
    setAiBusy(true);
    setAiAsked(batch.length);
    try {
      const d = await post<{
        suggestions: { key: string; lin: number; code: string; name: string; confidence: number; reason: string }[];
        asked: number; skipped: number; cached: number; degraded: boolean;
      }>('/api/admin/ocr/new-items/ai-suggest', { groups: batch, categoryId: lineCategory });
      if (!d) return;
      if (d.degraded) {
        toast.info('Το μοντέλο δεν είναι διαθέσιμη αυτή τη στιγμή — καμία πρόταση.');
        return;
      }
      if (d.suggestions.length === 0) {
        toast.info(
          d.skipped > 0
            ? `Καμία νέα πρόταση — ${d.skipped} ${d.skipped === 1 ? 'ομάδα λύθηκε' : 'ομάδες λύθηκαν'} χωρίς AI.`
            : 'Το μοντέλο δεν βρήκε δαπάνη που να ταιριάζει.',
        );
        return;
      }
      // Η πρόταση μπαίνει ΠΡΩΤΗ στην ομάδα της, ως υποψήφια χρεοπίστωση προς επιβεβαίωση.
      const byKey = new Map(d.suggestions.map((x) => [x.key, x]));
      setGroups((prev) => prev.map((g) => {
        const a = byKey.get(g.key);
        if (!a) return g;
        const suggestion: QueueSuggestion = {
          mtrl: null, expn: null, lin: a.lin, kind: 'lineitem',
          code: a.code, name: a.name, score: a.confidence, by: 'ai',
        };
        const rest = g.suggestions.filter((x) => x.lin !== a.lin);
        return { ...g, suggestions: [suggestion, ...rest] };
      }));
      // Οι ομάδες με πρόταση δείχνουν «Χρεοπίστωση» — αλλιώς η πρόταση θα κρυβόταν από το segmented.
      setCategories((prev) => {
        const next = { ...prev };
        for (const k of byKey.keys()) next[k] = 'lineitem';
        return next;
      });
      toast.success(
        `${d.suggestions.length} ${d.suggestions.length === 1 ? 'πρόταση' : 'προτάσεις'} από το AI`,
        { description: 'Έλεγξέ τες και επιβεβαίωσε — η επιβεβαίωση διδάσκει τον κανόνα για την επόμενη φορά.' },
      );
    } finally {
      setAiBusy(false);
      setAiAsked(0);
    }
  }, [aiBusy, canManage, visible, lineCategory]);

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
          lineCategories={lineCategories}
          lineCategory={lineCategory}
          onLineCategory={setLineCategory}
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
  const cat = CATEGORY_META[group.category];
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
