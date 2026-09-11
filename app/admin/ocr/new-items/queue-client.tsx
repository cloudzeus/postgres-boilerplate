'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiCheckCircle } from 'react-icons/fi';
import { toast } from 'sonner';
import { QueueEmpty, QueueLayout, type QueueLayoutHandle } from '@/components/admin/queue-layout';
import type { ItemQueueGroup, QueueSuggestion } from '@/lib/ocr/queues';
import type { MatchKind } from '@/lib/ocr/line-match';
import { CATEGORY_META, ItemPanel, docLabel, lineLabel, type UnitOption, type VatOption } from './item-panel';

const FILTERS = [
  { key: 'all', label: 'Όλα' },
  { key: 'product', label: 'Προϊόντα' },
  { key: 'service', label: 'Υπηρεσίες' },
  { key: 'expense', label: 'Έξοδα' },
  { key: 'none', label: 'Χωρίς πρόταση' },
] as const;

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

  const match = React.useCallback(async (target: { mtrl?: number; expn?: number }, isService: boolean) => {
    if (!selected || busy || !canManage) return;
    const g = selected;
    setBusy(true);
    try {
      const d = await post<ActionResult>('/api/admin/ocr/new-items/match', {
        afm: g.afm,
        pattern: g.pattern,
        target: target.expn != null ? { expn: target.expn } : { mtrl: target.mtrl },
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

  /** Enter στη λίστα = αντιστοίχιση με την πρώτη πρόταση της κατηγορίας. */
  const onPrimary = React.useCallback((id: string) => {
    if (!selected || selected.key !== id || !canManage) return;
    const first = shownSuggestions[0];
    if (!first) { toast.info('Καμία πρόταση — διάλεξε από το μητρώο ή δημιούργησε νέο.'); return; }
    void match(
      first.expn != null ? { expn: first.expn } : { mtrl: first.mtrl ?? undefined },
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
