'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiSend, FiSave, FiExternalLink, FiAlertCircle, FiPlus, FiTrash2, FiRotateCcw, FiCheck, FiPlusCircle, FiMaximize2, FiChevronLeft, FiChevronRight, FiFileText, FiList, FiEdit3, FiGitBranch } from 'react-icons/fi';
import { CreateRegistryEntryModal } from '@/components/admin/create-registry-entry-modal';
import { cn } from '@/lib/utils';
import { SerialChips } from '@/components/admin/serial-chips';
import { extractSerials } from '@/lib/ocr/serials';
import { DOC_CATEGORY_OPTIONS } from '@/lib/ocr/doc-category';
import { reconcileInvoice, analyzeLine } from '@/lib/ocr/invoice-math';
import { toLineItems, EMPTY_LINE, type LineItem } from '@/lib/ocr/line-items';
import { docTypeOf } from '@/lib/ocr/canonical';
import { objectsForSosource, defaultPostingTarget } from '@/lib/ocr/posting-target';
import { registryKindForSeries, LINE_KIND_LABEL } from '@/lib/ocr/resolution-plan';
import { LineAllocations, type AllocationRow } from './[id]/line-allocations';
import { emitStartSplit } from '@/components/admin/doc-lines-events';
import type { AllocationKind } from '@/lib/ocr/line-allocation';
import type { MatchKind } from '@/lib/ocr/line-match';
import { SoftoneChecksStrip } from '@/components/admin/softone-checks-strip';
import { ZoomablePreview } from '@/components/admin/zoomable-preview';
import { CustomFieldsBlock, LineCustomFields, hasLineCustomFields } from '@/components/admin/custom-fields';
import { type OcrRow, type SeriesOption } from './ocr-table';

/* ------------------------------------------------------------------ */
/* Field specs — same standardized layout for every document          */
/* ------------------------------------------------------------------ */

type Group = 'issuer' | 'meta' | 'totals' | 'main';

/**
 * `span` = ΠΟΣΑ ΔΩΔΕΚΑΤΑ πιάνει το πεδίο στη γραμμή του.
 *
 * Πριν υπήρχε μόνο `wide` (= «δύο στήλες») πάνω σε πλέγμα τριών στηλών. Αποτέλεσμα: η
 * «Διεύθυνση» έπιανε 2/3 και το τρίτο κελί έμενε ΚΕΝΟ· το ίδιο και η «Δραστηριότητα». Δύο
 * ολόκληρα κενά κελιά σε μια κάρτα επτά πεδίων. Με ρητά δωδέκατα κάθε σειρά αθροίζει ΑΚΡΙΒΩΣ
 * 12 και δεν περισσεύει τίποτα — το πλάτος το ορίζει το περιεχόμενο (ΑΦΜ στενό, επωνυμία φαρδιά),
 * όχι η τύχη της σειράς.
 */
interface FieldSpec { key: string; label: string; required?: boolean; numeric?: boolean; span?: number; textarea?: boolean; group?: Group }

/**
 * Στατικές κλάσεις, ΟΧΙ δυναμικές (`lg:col-span-${n}`): ο JIT του Tailwind σαρώνει κείμενο και
 * ό,τι φτιάχνεται με interpolation δεν παράγεται ποτέ — το πλέγμα θα κατέρρεε σιωπηλά.
 * Στο `sm` υπάρχουν μόνο δύο πλάτη (μισό / ολόκληρο), γιατί σε 640px τα δωδέκατα είναι ψίχουλα.
 */
// ΜΕ ΒΑΣΗ ΤΟ ΠΛΑΤΟΣ ΤΗΣ ΦΟΡΜΑΣ, ΟΧΙ ΤΗΣ ΟΘΟΝΗΣ: με το πρωτότυπο ανοιχτό, σε οθόνη 1024 η φόρμα έχει
// ~310px — το `lg:grid-cols-12` έβαζε ΑΦΜ και ΔΟΥ σε κουτάκια των 50px. Το πλάτος το μετρά
// `useElementWidth` (Tailwind 3.4 χωρίς container queries)· οι κλάσεις είναι στατικές.
type FormSize = 'narrow' | 'mid' | 'wide';
const formSizeOf = (w: number): FormSize => (w >= 768 ? 'wide' : w >= 448 ? 'mid' : 'narrow');
const SPAN_CLS: Record<FormSize, Record<number, string>> = {
  narrow: { 3: 'col-span-full', 4: 'col-span-full', 5: 'col-span-full', 6: 'col-span-full', 7: 'col-span-full', 12: 'col-span-full' },
  mid: { 3: 'col-span-3', 4: 'col-span-3', 5: 'col-span-3', 6: 'col-span-6', 7: 'col-span-6', 12: 'col-span-full' },
  wide: { 3: 'col-span-3', 4: 'col-span-4', 5: 'col-span-5', 6: 'col-span-6', 7: 'col-span-7', 12: 'col-span-full' },
};
/** Το πλέγμα που διαβάζουν οι παραπάνω κλάσεις. Ένα σημείο, για να μη διαφωνήσουν ποτέ. */
const GRID_CLS: Record<FormSize, string> = {
  narrow: 'grid grid-cols-1 gap-x-3 gap-y-2',
  mid: 'grid grid-cols-6 gap-x-3 gap-y-2',
  wide: 'grid grid-cols-12 gap-x-3 gap-y-2',
};

/** Το πλάτος ενός στοιχείου, ζωντανά (ResizeObserver). */
function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(1200);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const FIELD_SPECS: Record<string, FieldSpec[]> = {
  // Σειρά ΑΝΑΓΝΩΣΗΣ τιμολογίου: πρώτα ΤΙ είναι το χαρτί (αριθμός/ημερομηνία), μετά ΠΟΙΟΣ το
  // έκοψε. Κάθε σειρά αθροίζει 12.
  INVOICE: [
    { key: 'invoiceNumber',      label: 'Αρ. Τιμολογίου', required: true, span: 4, group: 'meta' },
    { key: 'date',               label: 'Ημερομηνία',   required: true, span: 4, group: 'meta' },
    { key: 'aadeMark',           label: 'ΜΑΡΚ ΑΑΔΕ',    span: 4, group: 'meta' },

    { key: 'companyName',        label: 'Επωνυμία',     required: true, span: 6, group: 'issuer' },
    { key: 'vatNumber',          label: 'ΑΦΜ',          required: true, span: 3, group: 'issuer' },
    { key: 'companyDoy',         label: 'ΔΟΥ',          span: 3, group: 'issuer' },
    { key: 'companyAddress',     label: 'Διεύθυνση',    span: 7, group: 'issuer' },
    { key: 'companyProfession',  label: 'Δραστηριότητα', span: 5, group: 'issuer' },
    { key: 'companyPhone',       label: 'Τηλέφωνο',     span: 5, group: 'issuer' },
    { key: 'companyEmail',       label: 'Email',        span: 7, group: 'issuer' },
    // Ο ΛΗΠΤΗΣ δεν είναι πεδίο φόρμας: είναι πάντα η εταιρεία που τρέχει την εφαρμογή.
    // Τα `customer*` εξακολουθούν να εξάγονται και να αποθηκεύονται — απλώς δεν ζητούνται εδώ.
    { key: 'subtotal',           label: 'Καθαρή αξία',  required: true, numeric: true, group: 'totals' },
    { key: 'vatAmount',          label: 'ΦΠΑ',          required: true, numeric: true, group: 'totals' },
    { key: 'totalAmount',        label: 'Γενικό Σύνολο', required: true, numeric: true, group: 'totals' },
  ],
  RECEIPT: [
    { key: 'companyName',    label: 'Κατάστημα / Εκδότης', required: true, span: 6, group: 'main' },
    { key: 'vatNumber',      label: 'ΑΦΜ',          required: true, span: 3, group: 'main' },
    { key: 'companyDoy',     label: 'ΔΟΥ',          span: 3, group: 'main' },
    { key: 'companyAddress', label: 'Διεύθυνση',    span: 7, group: 'main' },
    { key: 'companyPhone',   label: 'Τηλέφωνο',     span: 5, group: 'main' },
    { key: 'companyEmail',   label: 'Email',        span: 5, group: 'main' },
    { key: 'invoiceNumber',  label: 'Αρ. Αποδείξεως', required: true, span: 4, group: 'main' },
    { key: 'date',           label: 'Ημερομηνία',   required: true, span: 3, group: 'main' },
    { key: 'time',           label: 'Ώρα',          span: 6, group: 'main' },
    { key: 'itemsCount',     label: 'Πλήθος ειδών', numeric: true, span: 6, group: 'main' },
    { key: 'subtotal',       label: 'Καθαρή αξία',  numeric: true, group: 'totals' },
    { key: 'vatAmount',      label: 'ΦΠΑ',          numeric: true, group: 'totals' },
    { key: 'totalAmount',    label: 'Σύνολο',       required: true, numeric: true, group: 'totals' },
  ],
  GENERAL_TEXT: [
    { key: 'title',    label: 'Τίτλος',    required: true, span: 12, group: 'main' },
    { key: 'summary',  label: 'Περίληψη',  span: 12, textarea: true, group: 'main' },
    { key: 'keywords', label: 'Keywords (χωρισμένα με κόμμα)', span: 12, group: 'main' },
    { key: 'fullText', label: 'Verbatim',  span: 12, textarea: true, group: 'main' },
  ],
};

// Κοινές με τη σελίδα του παραστατικού — `lib/ocr/doc-category.ts`.
const CATEGORY_OPTIONS = DOC_CATEGORY_OPTIONS;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toNum(v: unknown): number | null {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function fmtMoney(v: unknown): string {
  const n = toNum(v);
  if (n == null) return '—';
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n);
}
function fmt2(v: unknown): string {
  const n = toNum(v);
  return n == null ? '' : n.toFixed(2).replace('.', ',');
}
/* ------------------------------------------------------------------ */
/* High-contrast input primitives (12px, solid, dark text on white)   */
/* ------------------------------------------------------------------ */

const LABEL_CLS = 'text-[length:var(--fs-11)] font-semibold text-muted-foreground';
/** Ένα ανενεργό κουμπί δεν είναι «ξεθωριασμένο χρωματιστό» — είναι ουδέτερο. */
const DISABLED_CLS =
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none ' +
  'disabled:hover:bg-muted';
const INPUT_CLS =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-[length:var(--fs-12)] text-foreground ' +
  'placeholder:text-muted-foreground/60 transition focus:border-sisyphus-500 focus:outline-none ' +
  'focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60';

function CellInput({
  value, onChange, onBlur, disabled, align = 'left', numeric, className,
}: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; disabled?: boolean;
  align?: 'left' | 'right'; numeric?: boolean; className?: string;
}) {
  return (
    <input
      type="text" inputMode={numeric ? 'decimal' : undefined} disabled={disabled}
      value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
      className={cn(INPUT_CLS, align === 'right' && 'text-right tabular-nums', numeric && 'font-mono', className)}
    />
  );
}

/** Pass/neutral/fail reconciliation row. Colors are inline (hex) so they never
 * depend on whether a given Tailwind palette is generated in this build. */
const BADGE_STYLE = {
  ok:      { backgroundColor: '#dcfce7', color: '#14532d', borderColor: '#4ade80' }, // green-100 / green-900 / green-400
  fail:    { backgroundColor: '#fef3c7', color: '#78350f', borderColor: '#fbbf24' }, // amber-100 / amber-900 / amber-400
  neutral: { backgroundColor: '#f3f4f6', color: '#374151', borderColor: '#d1d5db' }, // gray-100 / gray-700 / gray-300
} as const;

/**
 * ΑΠΟ ΠΟΥ ΕΡΧΕΤΑΙ ΚΑΘΕ ΠΟΣΟ. Τρεις πηγές, τρία χρώματα — και ΠΑΝΤΑ εικονίδιο + λέξη, ποτέ μόνο χρώμα:
 *   scan   — διαβάστηκε από το χαρτί (μπλε)·
 *   lines  — υπολογίστηκε από τις γραμμές (μωβ): είτε έλεγχος, είτε σύνολο που έλειπε από το χαρτί·
 *   edited — το άλλαξε ο χρήστης σε αυτή την καρτέλα (πορτοκαλί).
 * Πριν, ένα σύνολο που η εφαρμογή ΣΥΜΠΛΗΡΩΣΕ από τις γραμμές φαινόταν ίδιο με ένα τυπωμένο.
 */
type AmountSource = 'scan' | 'lines' | 'edited';
const SOURCE_META: Record<AmountSource, { label: string; short: string; icon: React.ReactNode; chip: string; bar: string }> = {
  scan: {
    label: 'Διαβάστηκε από το παραστατικό', short: 'από το χαρτί', icon: <FiFileText aria-hidden className="size-3" />,
    chip: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-200',
    bar: 'border-l-sky-500',
  },
  lines: {
    label: 'Υπολογίστηκε από τις γραμμές', short: 'από τις γραμμές', icon: <FiList aria-hidden className="size-3" />,
    chip: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200',
    bar: 'border-l-violet-500',
  },
  edited: {
    label: 'Το άλλαξες εσύ — δεν έχει αποθηκευτεί', short: 'διόρθωση', icon: <FiEdit3 aria-hidden className="size-3" />,
    chip: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
    bar: 'border-l-amber-500',
  },
};

function SourceChip({ source, className }: { source: AmountSource; className?: string }) {
  const m = SOURCE_META[source];
  return (
    <span title={m.label} className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[length:var(--fs-10)] font-semibold normal-case tracking-normal', m.chip, className)}>
      {m.icon}{m.short}
    </span>
  );
}

/** Ποσό με την πηγή του, για τους ελέγχους συμφωνίας. */
function SourcedAmount({ source, value }: { source: AmountSource; value: string }) {
  return (
    <span title={SOURCE_META[source].label} className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono tabular-nums', SOURCE_META[source].chip)}>
      {SOURCE_META[source].icon}{value}
    </span>
  );
}

function CheckRow({ ok, label, got, exp }: { ok: boolean | null | undefined; label: string; got: string; exp: string }) {
  const style = ok == null ? BADGE_STYLE.neutral : ok ? BADGE_STYLE.ok : BADGE_STYLE.fail;
  return (
    <div style={style} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-[length:var(--fs-11)] font-semibold">
      <span className="inline-flex items-center gap-1.5">
        {ok ? <FiCheck className="size-3.5" /> : <FiAlertCircle className={cn('size-3.5', ok == null && 'opacity-60')} />}
        {label}
      </span>
      <span className="inline-flex flex-wrap items-center gap-1">
        <SourcedAmount source="lines" value={got} />
        {ok === false && <><span aria-hidden>≠</span><SourcedAmount source="scan" value={exp} /></>}
      </span>
    </div>
  );
}

/**
 * Η ΜΟΝΑΔΙΚΗ κεφαλίδα ενότητας της καρτέλας.
 *
 * Πριν κάθε ενότητα έγραφε τη δική της `<header>` με ελαφρώς διαφορετικές κλάσεις (άλλη
 * απόχρωση, άλλο padding, άλλο περίγραμμα) — πέντε παραλλαγές του ίδιου πράγματος στην ίδια
 * οθόνη. Μία συνάρτηση, μία εμφάνιση: `accent` μόνο εκεί που χρειάζεται έμφαση.
 */
function Section({
  title, accent, right, children, className,
}: {
  title: string; accent?: boolean; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-card', accent ? 'border-sisyphus-500/40' : 'border-border', className)}>
      <header className={cn(
        'flex min-h-[1.75rem] items-center justify-between gap-2 border-b px-3 py-1.5 text-[length:var(--fs-11)] font-bold uppercase tracking-wide',
        accent ? 'border-sisyphus-500/30 bg-sisyphus-500/10 text-sisyphus-700 dark:text-sisyphus-300' : 'border-border bg-muted/50 text-foreground',
      )}>
        <span className="truncate">{title}</span>
        {right}
      </header>
      {children}
    </section>
  );
}

/** Σήμα «λείπουν ν υποχρεωτικά» — αριθμός ΚΑΙ εικονίδιο, ποτέ μόνο χρώμα. */
function MissingBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[length:var(--fs-10)] font-bold normal-case text-amber-700 dark:text-amber-300">
      <FiAlertCircle className="size-3" aria-hidden />
      {n} υποχρεωτικ{n === 1 ? 'ό' : 'ά'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function OcrRowDetail({
  row, canCategorize, canPost, seriesOptions = [], fullscreen = false, onOpenFull,
}: {
  row: OcrRow; canCategorize: boolean; canPost: boolean; seriesOptions?: SeriesOption[];
  /**
   * Η ίδια καρτέλα μέσα σε modal: το ύψος δεν είναι πια το σταθερό των 480px της γραμμής αλλά
   * ό,τι δίνει το παράθυρο. ΜΟΝΟ ύψη αλλάζουν — το περιεχόμενο και η λογική μένουν ίδια, ώστε
   * να μην υπάρχουν δύο εκδοχές του επεξεργαστή που ξεφεύγουν η μία από την άλλη.
   */
  fullscreen?: boolean;
  /** Όταν δίνεται, εμφανίζεται το «Πλήρης προβολή» δίπλα στις καρτέλες. */
  onOpenFull?: () => void;
}) {
  const router = useRouter();
  const data = (row.extractedData ?? {}) as Record<string, any>;
  const ro = !canCategorize;

  // The user can re-classify the document after the scan; the full field set is
  // always extracted, so switching type only changes which fields are shown.
  const [docType, setDocType] = React.useState<string>(row.docType);
  const specs = FIELD_SPECS[docType] ?? [];
  const isInvoice = docType === 'INVOICE';

  // Union of every key across all types — so values survive a type switch and the
  // editor always has the full extracted payload in hand.
  const ALL_SPECS = React.useMemo(() => {
    const m = new Map<string, FieldSpec>();
    for (const list of Object.values(FIELD_SPECS)) for (const s of list) if (!m.has(s.key)) m.set(s.key, s);
    return [...m.values()];
  }, []);

  const initialForm = React.useMemo(() => {
    const f: Record<string, string> = {};
    for (const s of ALL_SPECS) {
      // Receipts used to store `storeName`; the unified schema uses `companyName`.
      const raw = s.key === 'companyName' ? (data.companyName ?? data.storeName) : data[s.key];
      if (s.group === 'totals' || s.numeric) f[s.key] = fmt2(raw);
      else if (s.key === 'keywords' && Array.isArray(raw)) f[s.key] = raw.join(', ');
      else f[s.key] = raw != null ? String(raw) : '';
    }
    return f;
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialItems = React.useMemo(() => toLineItems(data.items), [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = React.useState<Record<string, string>>(initialForm);
  const [items, setItems] = React.useState<LineItem[]>(initialItems);
  const [category, setCategory] = React.useState(row.category ?? '');
  // Ταυτότητα σειράς = «SOSOURCE:κωδικός»: ο ίδιος κωδικός υπάρχει και στις αγορές (1251) και
  // στους πιστωτές (1653), οπότε ο κωδικός μόνος του δεν διαλέγει γραμμή.
  const initialSeriesKey = row.softoneSeries ? `${row.seriesSource ?? 1251}:${row.softoneSeries}` : '';
  const [seriesKey, setSeriesKey] = React.useState(initialSeriesKey);
  const [saving, setSaving] = React.useState(false);
  const [posting, setPosting] = React.useState(false);

  const dirty =
    JSON.stringify(form) !== JSON.stringify(initialForm) ||
    JSON.stringify(items) !== JSON.stringify(initialItems) ||
    category !== (row.category ?? '') || seriesKey !== initialSeriesKey || docType !== row.docType;

  // Οι «Γραμμές» ΔΕΝ είναι προνόμιο του τιμολογίου: μια απόδειξη έχει κι αυτή είδη, και από τότε
  // που ο τύπος αποφασίζεται «Αυτόματα» οι αποδείξεις είναι ο κανόνας — με το παλιό
  // `docType === 'INVOICE'` η καρτέλα τους δεν είχε καν καρτέλα γραμμών, άρα ΟΥΤΕ ΦΠΑ ούτε μονάδα
  // μπορούσε να διορθωθεί. Κρύβεται μόνο σε γνήσιο ελεύθερο κείμενο — κι εκεί μόνο όσο δεν έχει
  // γραμμές.
  const showLines = docTypeOf(docType) !== 'general_text' || items.length > 0;

  /**
   * ΜΟΝΟ οι σειρές που μπορούν ΠΡΑΓΜΑΤΙΚΑ να δεχτούν εισερχόμενο παραστατικό.
   *
   * Ο επιλογέας πρόσφερε ΟΛΕΣ τις ενεργοποιημένες σειρές — μαζί και εννέα από τα «Άρθρα Γενικής
   * Λογιστικής» (ενότητα 1089), που δεν καταχωρούν παραστατικό προμηθευτή. Ο χρήστης διάλεγε μία
   * τέτοια και το μάθαινε ΜΕΤΑ, από τεχνικό μήνυμα «η ενότητα δεν υποστηρίζεται». Μια επιλογή που
   * η ίδια η εφαρμογή απορρίπτει δεν πρέπει να προσφέρεται καθόλου.
   *
   * Η σειρά που ΗΔΗ κουβαλά το παραστατικό μένει ορατή ακόμη κι αν δεν είναι καταχωρήσιμη —
   * αλλιώς το πεδίο θα φαινόταν άδειο και κανείς δεν θα καταλάβαινε τι είναι ρυθμισμένο.
   */
  const postableSeries = React.useMemo(
    () => seriesOptions.filter(
      (o) => objectsForSosource(o.sosource).length > 0 || `${o.sosource}:${o.code}` === initialSeriesKey,
    ),
    [seriesOptions, initialSeriesKey],
  );

  const fileUrl = `/api/admin/ocr/${row.id}/file`;
  const isPdf = row.mimeType === 'application/pdf';

  /**
   * ΤΟ ΠΡΩΤΟΤΥΠΟ ΚΛΕΙΝΕΙ. Σε laptop 1280 το PDF έτρωγε 380px από τον editor και η δουλειά
   * (γραμμές, λογαριασμοί) στριμωχνόταν. Η επιλογή ΜΕΝΕΙ: ο χρήστης δεν θέλει να την ξαναπατά σε
   * κάθε γραμμή που ανοίγει. `localStorage` και όχι state του γονέα, γιατί αφορά τον χρήστη, όχι
   * το παραστατικό — και διαβάζεται σε effect ώστε το SSR markup να μην διαφέρει από το client.
   */
  /**
   * ΟΙ ΑΠΟΘΗΚΕΥΜΕΝΕΣ ΓΡΑΜΜΕΣ, για τη λωρίδα «Λογαριασμός δαπάνης».
   *
   * Ο επεξεργαστής εδώ δουλεύει πάνω στο κανονικό JSON, που ΔΕΝ έχει ids — και ο επιμερισμός
   * αποθηκεύεται ανά `OcrInvoiceItem.id`. Τα φέρνουμε όταν ανοίγει η γραμμή (ένα αίτημα, μόνο για
   * το παραστατικό που κοιτάει ο χρήστης) αντί να βαραίνει η λίστα των 200 με γραμμές και
   * επιμερισμούς που κανείς δεν ζήτησε.
   */
  const [saved, setSaved] = React.useState<Map<number, { id: string; allocations: AllocationRow[] }>>(new Map());
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/admin/ocr/${row.id}`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (!alive || !Array.isArray(d?.items)) return;
        setSaved(new Map(d.items.map((it: any) => [it.rowIndex, {
          id: it.id,
          allocations: (it.allocations ?? []).map((a: any): AllocationRow => ({
            order: a.order, registryMtrl: a.registryMtrl,
            kind: a.kind === 'SXACCOUNT' ? 'SXACCOUNT' : 'LINEITEM',
            accountCode: a.accountCode, percent: Number(a.percent), amount: Number(a.amount),
          })),
        }])));
      } catch { /* η λωρίδα απλώς δεν εμφανίζεται */ }
    })();
    return () => { alive = false; };
  }, [row.id]);

  /** Ο κόσμος του επιμερισμού τον ορίζει η ΣΕΙΡΑ, όπως και στη σελίδα του παραστατικού. */
  const allocKind: AllocationKind = React.useMemo(() => {
    const sep = seriesKey.indexOf(':');
    if (sep < 0) return 'LINEITEM';
    const target = defaultPostingTarget({ sosource: Number(seriesKey.slice(0, sep)) });
    return target.lines === 'SXDOCLINES' ? 'SXACCOUNT' : 'LINEITEM';
  }, [seriesKey]);

  const [showPdf, setShowPdf] = React.useState(true);
  React.useEffect(() => {
    try { setShowPdf(localStorage.getItem('admin.ocr.rowdetail.pdf') !== '0'); } catch { /* ιδιωτική περιήγηση */ }
  }, []);
  const togglePdf = React.useCallback(() => {
    setShowPdf((v) => {
      const next = !v;
      try { localStorage.setItem('admin.ocr.rowdetail.pdf', next ? '1' : '0'); } catch { /* αδιάφορο */ }
      return next;
    });
  }, []);
  const linesNet = items.reduce((sum, it) => sum + (toNum(it.total) ?? 0), 0);

  const [formRef, formW] = useElementWidth<HTMLDivElement>();
  const formSize = formSizeOf(formW);

  /** Τα σύνολα που η εξαγωγή ΣΥΜΠΛΗΡΩΣΕ από τις γραμμές (`totals.derived` του κανονικού JSON). */
  const fromLines = React.useMemo(
    () => new Set<string>(Array.isArray(data.totalsFromLines) ? data.totalsFromLines : []),
    [row.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sourceOf = (key: string): AmountSource | null => {
    if ((form[key] ?? '') !== (initialForm[key] ?? '')) return 'edited';
    if (!String(form[key] ?? '').trim()) return null;
    return fromLines.has(key) ? 'lines' : 'scan';
  };


  const tNet = toNum(form.subtotal), tVat = toNum(form.vatAmount), tTotal = toNum(form.totalAmount);
  const tSum = (tNet ?? 0) + (tVat ?? 0);
  const totalsBothPresent = tNet != null && tVat != null;
  const totalsOk = totalsBothPresent && tTotal != null && Math.abs(tSum - tTotal) <= 0.02;

  // Full invoice reconciliation: lines→net, VAT per rate (multi-VAT), grand total.
  const recon = React.useMemo(
    () => reconcileInvoice({ items, subtotal: form.subtotal, vatAmount: form.vatAmount, totalAmount: form.totalAmount }),
    [items, form.subtotal, form.vatAmount, form.totalAmount],
  );

  function setField(key: string, v: string) { setForm((f) => ({ ...f, [key]: v })); }
  function blurFmt(key: string) { setForm((f) => ({ ...f, [key]: fmt2(f[key]) })); }
  function setLine(idx: number, key: keyof LineItem, v: string) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [key]: v } : it)));
  }
  function addLine() { setItems((arr) => [...arr, { ...EMPTY_LINE }]); }
  function removeLine(idx: number) { setItems((arr) => arr.filter((_, i) => i !== idx)); }
  const [createLine, setCreateLine] = React.useState<{ code: string; name: string; kind: MatchKind; vat: string } | null>(null);

  /**
   * ΤΙ ΜΗΤΡΩΟ ΘΕΛΕΙ **ΑΥΤΟ** ΤΟ ΠΑΡΑΣΤΑΤΙΚΟ. Το κουμπί ήταν ένα γυμνό «+» που δημιουργούσε
   * ΠΑΝΤΑ είδος — και σε σειρά πιστωτών (1653), που δέχεται μόνο ΧΡΕΟΠΙΣΤΩΣΗ, έφτιαχνε κάτι που
   * η καταχώριση θα απέρριπτε. Ο προορισμός είναι γνωστός από τη σειρά· ας τον ακολουθεί.
   */
  const lineKind: MatchKind | null = React.useMemo(() => {
    const sep = seriesKey.indexOf(':');
    return sep < 0 ? null : registryKindForSeries(Number(seriesKey.slice(0, sep)));
  }, [seriesKey]);
  function reset() { setForm(initialForm); setItems(initialItems); setCategory(row.category ?? ''); setSeriesKey(initialSeriesKey); setDocType(row.docType); }

  function buildExtractedData() {
    const out: Record<string, any> = { ...data };
    // Write every known key (not just the visible subset) so edits survive a type switch.
    for (const s of ALL_SPECS) {
      if (!(s.key in form)) continue;
      const v = form[s.key];
      if (s.key === 'keywords') out.keywords = String(v ?? '').split(',').map((k) => k.trim()).filter(Boolean);
      else if (s.numeric || s.group === 'totals') out[s.key] = toNum(v);
      else out[s.key] = String(v ?? '').trim() || null;
    }
    if (showLines) {
      // Κάθε πεδίο της γραμμής βγαίνει από την ΙΔΙΑ τη γραμμή της φόρμας — όχι από το `data.items[i]`:
      // μετά από μια προσθήκη ή διαγραφή γραμμής οι δείκτες δεν ταιριάζουν πια, και η μονάδα ή τα
      // ειδικά πεδία θα κατέληγαν σε λάθος είδος.
      out.items = items.map((it) => ({
        code: it.code.trim() || null, name: it.name.trim(),
        ...(it.unit.trim() ? { unit: it.unit.trim() } : {}),
        quantity: toNum(it.quantity), price: toNum(it.price), discount: toNum(it.discount),
        vatRate: toNum(it.vatRate), total: toNum(it.total),
        ...(it.customFields && Object.keys(it.customFields).length ? { customFields: it.customFields } : {}),
      // Κρατάμε κάθε γραμμή που κουβαλάει ΕΣΤΩ ΕΝΑ στοιχείο. Το παλιό φίλτρο ζητούσε περιγραφή,
      // κωδικό ή σύνολο — και έσβηνε σιωπηλά γραμμή με μόνο ποσότητα και τιμή (ή μόνο μονάδα),
      // δηλαδή ακριβώς ό,τι μόλις είχε πληκτρολογήσει ο χρήστης. Φεύγει μόνο η ΕΝΤΕΛΩΣ κενή.
      })).filter((it) =>
        it.name || it.code || it.unit || it.total != null
        || it.quantity != null || it.price != null || it.discount != null || it.vatRate != null,
      );
    }
    return out;
  }

  async function save() {
    setSaving(true);
    try {
      const extractedData = buildExtractedData();
      const body: any = { category: category || null, extractedData, docType };
      // Η σειρά μπαίνει στο PATCH ΜΟΝΟ όταν ο χρήστης την άλλαξε: το API σφραγίζει κάθε
      // `softoneSeries` ως «χειροκίνητη επιλογή», οπότε μια απλή διόρθωση συνόλου θα
      // κλείδωνε άδικα το έγγραφο έξω από τον αυτόματο ταξινομητή.
      if (seriesKey !== initialSeriesKey) {
        // Στέλνουμε ΚΑΙ την ενότητα: το API δεν χρειάζεται να μαντέψει σε ποιο μητρώο ανήκει ο κωδικός.
        const sep = seriesKey.indexOf(':');
        body.softoneSeries = seriesKey ? seriesKey.slice(sep + 1) : null;
        body.seriesSource = seriesKey ? Number(seriesKey.slice(0, sep)) : null;
      }
      if (showLines) body.items = extractedData.items;
      const res = await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      toast.success('Αποθηκεύτηκε');
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally { setSaving(false); }
  }

  async function post() {
    if (!category) { toast.error('Όρισε κατηγορία πρώτα.'); return; }
    setPosting(true);
    try {
      const extractedData = buildExtractedData();
      await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, extractedData, ...(showLines ? { items: extractedData.items } : {}) }),
      });
      const res = await fetch(`/api/admin/ocr/${row.id}/post-softone`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Αναρτήθηκε (ref: ${json.ref})`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally { setPosting(false); }
  }

  /* ---- render helpers ---- */
  const field = (s: FieldSpec) => {
    const invalid = s.required && !String(form[s.key] ?? '').trim();
    return (
      <label key={s.key} className={cn('flex min-w-0 flex-col gap-0.5', SPAN_CLS[formSize][s.span ?? 12] ?? SPAN_CLS[formSize][12])}>
        <span className={LABEL_CLS}>{s.label}{s.required && <span className="ml-0.5 text-dg-red-500">*</span>}</span>
        {s.textarea ? (
          <textarea rows={s.key === 'fullText' ? 8 : 2} disabled={ro}
            value={form[s.key] ?? ''} onChange={(e) => setField(s.key, e.target.value)}
            className={cn(INPUT_CLS, 'h-auto resize-y py-1')} />
        ) : (
          <CellInput value={form[s.key] ?? ''} onChange={(v) => setField(s.key, v)}
            disabled={ro} numeric={s.numeric} align={s.numeric ? 'right' : 'left'}
            className={cn(invalid && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30')} />
        )}
      </label>
    );
  };
  const byGroup = (g: Group) => specs.filter((s) => s.group === g);
  /** Πόσα υποχρεωτικά λείπουν ΣΕ ΑΥΤΗ την ενότητα — το σήμα μπαίνει στη δική της κεφαλίδα,
      όχι σε μια καρτέλα μακριά από τα πεδία που φταίνε. */
  const missingIn = (g: Group) => byGroup(g).filter((s) => s.required && !String(form[s.key] ?? '').trim()).length;

  const totalsBox = byGroup('totals').length > 0 ? (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border bg-muted/50 px-3 py-1.5 text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground">
        Σύνολα παραστατικού
      </header>
      <div className="space-y-1 p-3">
        {byGroup('totals').map((s) => {
          const grand = s.key === 'totalAmount';
          const src = sourceOf(s.key);
          return (
            <React.Fragment key={s.key}>
              {grand && <div className="my-1.5 border-t border-dotted border-muted-foreground/50" />}
              <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1', grand && 'bg-sisyphus-500/10')}>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className={cn('text-[length:var(--fs-12)]', grand ? 'font-bold text-sisyphus-700 dark:text-sisyphus-300' : 'font-medium text-foreground')}>
                    {s.label}
                  </span>
                  {src && <SourceChip source={src} />}
                </span>
                <input
                  type="text" inputMode="decimal" disabled={ro}
                  aria-label={`${s.label}${src ? ` — ${SOURCE_META[src].label}` : ''}`}
                  value={form[s.key] ?? ''} onChange={(e) => setField(s.key, e.target.value)} onBlur={() => blurFmt(s.key)}
                  className={cn(
                    'h-9 w-[140px] rounded-md border border-input border-l-4 bg-background px-2 text-right font-mono text-[length:var(--fs-13)] tabular-nums text-foreground transition',
                    'focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60',
                    src ? SOURCE_META[src].bar : 'border-l-input',
                    grand && 'font-bold text-sisyphus-700 dark:text-sisyphus-300',
                  )}
                />
              </div>
            </React.Fragment>
          );
        })}
        {[...fromLines].some((k) => sourceOf(k) === 'lines') && (
          <p className="pt-1 text-[length:var(--fs-11)] text-muted-foreground">
            Τα σύνολα με <SourceChip source="lines" className="mx-0.5 align-middle" /> δεν βρέθηκαν στο χαρτί — η εφαρμογή τα υπολόγισε από τις γραμμές. Έλεγξέ τα με το πρωτότυπο.
          </p>
        )}
        {totalsBothPresent && (
          <div style={totalsOk ? BADGE_STYLE.ok : BADGE_STYLE.fail}
            className="mt-1 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[length:var(--fs-11)] font-semibold">
            <span className="inline-flex items-center gap-1">
              {totalsOk ? <FiCheck className="size-3.5" /> : <FiAlertCircle className="size-3.5" />}
              Καθαρή + ΦΠΑ {totalsOk ? '= Σύνολο ✓' : tTotal != null ? '≠ Σύνολο' : ''}
            </span>
            <span className="font-mono tabular-nums">{fmt2(tSum)}{!totalsOk && tTotal != null && ` / ${fmt2(tTotal)}`}</span>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="bg-muted/30 p-3">
      {onOpenFull && (
        <div className="mb-3">
          <button
            type="button"
            onClick={onOpenFull}
            className="inline-flex items-center gap-1.5 rounded-md border border-sisyphus-500/40 bg-sisyphus-500/10 px-3 py-1.5 text-[length:var(--fs-12)] font-semibold text-sisyphus-700 transition hover:bg-sisyphus-500/20 dark:text-sisyphus-300"
          >
            <FiMaximize2 className="size-3.5" />
            Πλήρης προβολή
            <span className="font-normal opacity-70">— όλο το παράθυρο, χωρίς πλάγιο σκρολ</span>
          </button>
        </div>
      )}

      {row.status === 'FAILED' && row.errorMessage && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[length:var(--fs-12)]">
          <p className="mb-0.5 font-semibold text-destructive">Σφάλμα εκτέλεσης OCR</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[length:var(--fs-11)] text-destructive/90">{row.errorMessage}</pre>
        </div>
      )}

      {/* Consolidated SoftOne checks — the decision surface, first thing the user sees. */}
      {row.status === 'COMPLETED' && (
        <div className="mb-3">
          <SoftoneChecksStrip docId={row.id} />
        </div>
      )}

      {/* ΚΛΕΙΣΤΟ ΠΡΩΤΟΤΥΠΟ: λεπτή κάθετη λαβή που το ξαναφέρνει. Μένει ΠΑΝΤΑ ορατή, αλλιώς το
          κλείσιμο θα ήταν μονόδρομος και ο χρήστης δεν θα ήξερε πώς να το ανοίξει. */}
      {!showPdf && (
        <button
          type="button" onClick={togglePdf}
          className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[length:var(--fs-11)] font-semibold text-foreground shadow-sm transition hover:bg-muted"
        >
          <FiChevronRight className="size-3.5" /> Εμφάνιση πρωτοτύπου
        </button>
      )}

      {/* Η στήλη του PDF συρρικνώνεται σε 0 με μετάβαση — «συρτό» άνοιγμα/κλείσιμο. Το πλάτος ζει
          σε CSS variable ώστε να μένει responsive (κάτω από `lg` η διάταξη είναι μονόστηλη).
          ΣΤΑΘΕΡΟ px, ΟΧΙ `minmax()`: το `minmax(300px,380px)` → `0px` ΔΕΝ παρεμβάλλεται — ο browser
          πηδά κατευθείαν στο τέλος και η κίνηση χάνεται (μετρημένο: στα 150 ms ήταν ήδη στο 0).
          Δύο τιμές ίδιου τύπου κινούνται κανονικά. */}
      <div
        style={{ '--pdf-col': showPdf ? '380px' : '0px' } as React.CSSProperties}
        className="grid grid-cols-1 gap-3 lg:grid-cols-[var(--pdf-col)_1fr] lg:items-stretch lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out"
      >
        {/* ---- PERSISTENT preview ---- */}
        <aside
          aria-hidden={!showPdf}
          className={cn(
            'flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-opacity duration-200',
            !showPdf && 'pointer-events-none max-lg:hidden lg:h-0 lg:overflow-hidden lg:border-0 lg:opacity-0',
          )}
        >
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
            <span className="text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground">Πρωτότυπο</span>
            <div className="flex items-center gap-2">
              <a href={fileUrl} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 text-[length:var(--fs-11)] font-semibold text-sisyphus-600 hover:underline">
                <FiExternalLink className="size-3" /> Άνοιγμα
              </a>
              <button
                type="button" onClick={togglePdf} title="Κλείσιμο πρωτοτύπου — περισσότερος χώρος για τη δουλειά"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[length:var(--fs-11)] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <FiChevronLeft className="size-3.5" /> Κλείσιμο
              </button>
            </div>
          </div>
          {isPdf ? (
            // Native PDF viewer — crisp vector zoom for verification, no dependency
            // on server-side rasterization (which can OOM on large scans).
            <iframe
              src={fileUrl}
              title={row.fileName}
              className={cn('w-full flex-1 border-0 bg-white', fullscreen ? 'min-h-[60vh]' : 'min-h-[440px]')}
            />
          ) : (
            <ZoomablePreview
              src={fileUrl}
              alt={row.fileName}
              fallbackHref={fileUrl}
              className={cn('flex-1 bg-muted', fullscreen ? 'min-h-[60vh]' : 'min-h-[440px]')}
            />
          )}
        </aside>

        {/* ---- Editor ---- */}
        {/* ΧΩΡΙΣ `overflow-hidden`. Το `overflow-hidden` έκανε ΑΥΤΗΝ την κάρτα τον πλησιέστερο
            «scrollable» πρόγονο του footer — και επειδή η κάρτα δεν κυλάει ποτέ (ύψος = περιεχόμενο),
            το `sticky bottom-0` του footer ήταν ΑΚΥΡΟ: η μπάρα με τον τύπο παραστατικού, την
            κατηγορία και τα «Αποθήκευση/Ανάρτηση» έφευγε 133px κάτω από το ορατό παράθυρο. Χωρίς
            αυτό, το sticky λύνεται σωστά πάνω στον πραγματικό scroller και η μπάρα μένει πάντα
            ορατή. Οι στρογγυλές γωνίες που έκοβε το overflow τις κρατούν τώρα τα ίδια τα άκρα. */}
        <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-sm">
          {/* ΕΝΑ ΣΥΝΕΧΕΣ ΦΥΛΛΟ, ΟΧΙ ΚΑΡΤΕΛΕΣ.
              Οι τρεις καρτέλες (Πεδία / Γραμμές / JSON) έσπαγαν ΕΝΑ παραστατικό σε τρία κομμάτια
              που δεν μπορούσες να δεις μαζί: για να συγκρίνεις το «Γενικό Σύνολο» με το άθροισμα
              των γραμμών έπρεπε να αλλάξεις καρτέλα και να το θυμάσαι. Τώρα η καρτέλα διαβάζεται
              όπως το ίδιο το χαρτί, από πάνω προς τα κάτω: ΤΙ είναι → ΠΟΙΟΣ το έκοψε → ΤΙ λέει →
              ΠΟΣΟ κάνει. */}
          <div ref={formRef} className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            {isInvoice ? (
              <>
                {/* Ο αριθμός και η ημερομηνία ΠΑΝΩ από τον εκδότη — έτσι είναι και το χαρτί. */}
                <Section title="Παραστατικό" right={<MissingBadge n={missingIn('meta')} />}>
                  <div className={cn(GRID_CLS[formSize], 'p-3')}>{byGroup('meta').map(field)}</div>
                </Section>
                {/* Εκδότης — ΜΟΝΟΣ του. Ο λήπτης είναι ΠΑΝΤΑ η εταιρεία που τρέχει την εφαρμογή
                    (το σύστημα καταχωρεί μόνο εισερχόμενα), οπότε μια κάρτα «Πελάτης» ζητούσε από
                    τον χρήστη να επιβεβαιώνει τον ίδιο του τον εαυτό — και δύο από τα πεδία της
                    ήταν υποχρεωτικά, άρα κουβαλούσε και μόνιμο σήμα «λείπουν πεδία». Τα δεδομένα
                    του λήπτη ΕΞΑΚΟΛΟΥΘΟΥΝ να εξάγονται και να αποθηκεύονται: πάνω τους στηρίζεται
                    η διάκριση τιμολογίου/απόδειξης (`lib/ocr/canonical.ts`) και ο εντοπισμός
                    αντιστροφής εκδότη/λήπτη στη λίστα. */}
                <Section title="Εκδότης" accent right={<MissingBadge n={missingIn('issuer')} />}>
                  <div className={cn(GRID_CLS[formSize], 'p-3')}>{byGroup('issuer').map(field)}</div>
                </Section>
              </>
            ) : (
              <Section title="Στοιχεία" accent right={<MissingBadge n={missingIn('main')} />}>
                <div className={cn(GRID_CLS[formSize], 'p-3')}>{byGroup('main').map(field)}</div>
              </Section>
            )}

            <CustomFieldsBlock data={data} />

            {/* ---------- Γραμμές ---------- */}
            {showLines && (
              <Section
                title={`Γραμμές (${items.length})`}
                right={!ro && (
                  <button type="button" onClick={addLine}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sisyphus-500/40 bg-sisyphus-500/10 px-2 py-0.5 text-[length:var(--fs-11)] font-semibold normal-case text-sisyphus-700 transition hover:bg-sisyphus-500/20 dark:text-sisyphus-300">
                    <FiPlus className="size-3.5" /> Προσθήκη γραμμής
                  </button>
                )}
              >
                {/* ΠΡΟΣΑΡΜΟΣΤΙΚΗ ΔΙΑΤΑΞΗ ΜΕ ΒΑΣΗ ΤΟ ΠΛΑΤΟΣ ΤΟΥ ΚΟΥΤΙΟΥ (container query, όχι της οθόνης —
                    η ίδια καρτέλα ζει σε πλήρη σελίδα και σε στενή λίστα):
                      • tablet/desktop (≥40rem): ΜΙΑ σειρά ανά είδος, όλες οι στήλες (φαρδύτερες από 56rem)·
                      • στενό: ΔΥΟ σειρές ανά είδος — η περιγραφή σε όλο το πλάτος (χωρίς κόψιμο) με το
                        σύνολο δίπλα, και από κάτω τα αριθμητικά με μικρή ετικέτα.
                    Ποτέ κάρτες και ποτέ οριζόντια κύλιση: ένα τιμολόγιο μπορεί να έχει 200 γραμμές.
                    Οι ενέργειες της γραμμής είναι μικρά γράμματα κάτω από την περιγραφή, όχι στήλη. */}
                {(() => {
                  const showCode = items.some((it) => it.code.trim());
                  // Μία σειρά από 640px (tablet) — στενές στήλες· από 896px (desktop) φαρδύτερες.
                  // Κάτω από 640px: δύο σειρές ανά είδος. Στατικές κλάσεις, επιλογή σε JS.
                  const row = formW >= 640;
                  const wide = formW >= 896;
                  const wideCols = !row ? (formW >= 384 ? 'grid-cols-6' : 'grid-cols-6')
                    : showCode
                      ? (wide ? 'grid-cols-[7rem_minmax(0,1fr)_4.5rem_4.5rem_6rem_5rem_4rem_6.5rem]' : 'grid-cols-[5rem_minmax(0,1fr)_3.5rem_4rem_5rem_4rem_3.5rem_5.5rem]')
                      : (wide ? 'grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_6rem_5rem_4rem_6.5rem]' : 'grid-cols-[minmax(0,1fr)_3.5rem_4rem_5rem_4rem_3.5rem_5.5rem]');
                  const CAP = cn('block text-[length:var(--fs-10)] font-semibold uppercase tracking-wide text-muted-foreground', row && 'sr-only');
                  const SMALL = row ? 'col-span-1 row-start-1' : cn(formW >= 384 ? 'col-span-1' : 'col-span-2', 'order-3');
                  // Ρητή στήλη για ΚΑΘΕ πεδίο στο φαρδύ — η αυτόματη τοποθέτηση του grid έβαζε τη μονάδα
                  // στη θέση της περιγραφής. Στατικές κλάσεις (ο JIT δεν βλέπει δυναμικές).
                  const COL = ['', 'col-start-1', 'col-start-2', 'col-start-3', 'col-start-4', 'col-start-5', 'col-start-6', 'col-start-7', 'col-start-8'];
                  const at = (n: number) => (row ? COL[showCode ? n : n - 1] : '');
                  const ICON_BTN = 'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:bg-sisyphus-500/10 hover:text-sisyphus-700 focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-sisyphus-300';
                  const TEXT_BTN = 'inline-flex min-h-6 cursor-pointer items-center gap-0.5 rounded px-1 font-medium hover:bg-sisyphus-500/10 hover:text-sisyphus-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-sisyphus-300';
                  /** Οι ενέργειες μιας γραμμής: εικονίδια (tablet/desktop) ή λέξεις (κινητό). */
                  const lineActions = (it: LineItem, i: number, iconOnly: boolean) => {
                    const createLabel = lineKind == null
                      ? 'Διάλεξε πρώτα σειρά παραστατικού — αυτή ορίζει σε ποιο μητρώο πρέπει να δείχνει η γραμμή'
                      : `Νέα ${LINE_KIND_LABEL[lineKind].toLowerCase()} στο SoftOne από αυτή τη γραμμή`;
                    const la = analyzeLine(it);
                    return (
                      <>
                        <button type="button" disabled={lineKind == null} title={createLabel} aria-label={createLabel}
                          onClick={() => lineKind && setCreateLine({ code: it.code, name: it.name, kind: lineKind, vat: it.vatRate })}
                          className={iconOnly ? ICON_BTN : TEXT_BTN}>
                          <FiPlusCircle aria-hidden className="size-3.5" />
                          {!iconOnly && <>Νέα {lineKind ? LINE_KIND_LABEL[lineKind].toLowerCase() : 'εγγραφή'}</>}
                        </button>
                        {saved.get(i) && (
                          <>
                            {!iconOnly && <span aria-hidden>·</span>}
                            <button type="button" disabled={toNum(it.total) == null}
                              onClick={() => emitStartSplit(saved.get(i)!.id)}
                              title="Μοίρασμα σε κατηγορίες εξόδου" aria-label="Μοίρασμα σε κατηγορίες εξόδου"
                              className={iconOnly ? ICON_BTN : TEXT_BTN}>
                              <FiGitBranch aria-hidden className="size-3.5" />
                              {!iconOnly && 'Μοίρασμα'}
                            </button>
                          </>
                        )}
                        {!iconOnly && <span aria-hidden>·</span>}
                        <button type="button" onClick={() => removeLine(i)} title="Διαγραφή γραμμής" aria-label={`Διαγραφή γραμμής ${i + 1}`}
                          className={cn(iconOnly ? ICON_BTN : TEXT_BTN, 'hover:bg-dg-red-500/10 hover:text-dg-red-500')}>
                          <FiTrash2 aria-hidden className="size-3.5" />
                          {!iconOnly && 'Διαγραφή'}
                        </button>
                        {!la.consistent && (
                          <span title="Ποσότητα × τιμή − έκπτωση δεν δίνει το σύνολο" className={cn('inline-flex items-center gap-0.5 font-semibold text-amber-800 dark:text-amber-300', iconOnly ? 'size-7 justify-center' : 'ml-1')}>
                            <FiAlertCircle aria-hidden className="size-3.5" />{!iconOnly && 'ποσότητα × τιμή ≠ σύνολο'}
                            {iconOnly && <span className="sr-only">Ποσότητα × τιμή ≠ σύνολο</span>}
                          </span>
                        )}
                      </>
                    );
                  };
                  return (
                    <div>
                      {/* Κεφαλίδα μόνο στο φαρδύ — στο στενό κάθε πεδίο έχει τη δική του ετικέτα. */}
                      <div className={cn('gap-1.5 border-b border-border bg-sisyphus-500/10 px-3 py-1.5 text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-sisyphus-700 dark:text-sisyphus-300', row ? 'grid' : 'hidden', wideCols)}>
                        {showCode && <span>Κωδ.</span>}
                        <span>Περιγραφή</span>
                        <span>Μον.</span>
                        <span className="text-right">Ποσ.</span>
                        <span className="text-right">Τιμή</span>
                        <span className="text-right">Έκπτ.</span>
                        <span className="text-right">ΦΠΑ%</span>
                        <span className="text-right">Σύνολο</span>
                      </div>
                      {items.length === 0 ? (
                        <p className="px-3 py-5 text-center text-[length:var(--fs-12)] text-muted-foreground">Δεν υπάρχουν γραμμές.</p>
                      ) : (
                        <ol className={cn('divide-y divide-border [&_input]:px-1.5 [&_input]:text-[length:var(--fs-12)] [&_textarea]:text-[length:var(--fs-12)]', row ? '[&_input]:h-7' : '[&_input]:h-8')}>
                          {items.map((it, i) => {
                            const la = analyzeLine(it);
                            const dTitle = la.discountKind === 'percent' ? 'Έκπτωση επί τοις %' : la.discountKind === 'amount' ? 'Έκπτωση ως ποσό' : undefined;
                            const lineCf = (it.customFields ?? null) as Record<string, unknown> | null;
                            return (
                              <li key={i} className={cn('px-2', row ? 'py-0.5' : 'py-1.5', !la.consistent ? 'bg-amber-500/5' : i % 2 ? 'bg-muted/20' : '')}>
                                <div className={cn('grid grid-cols-6 items-start gap-x-1.5 gap-y-1', wideCols)}>
                                  {/* Περιγραφή: πρώτη στο στενό, δεύτερη (μετά τον κωδικό) στο φαρδύ. */}
                                  <label className={cn('min-w-0', row ? 'col-span-1 row-start-1' : 'order-1 col-span-4', at(2))}>
                                    <span className={CAP}>Περιγραφή · γραμμή {i + 1}</span>
                                    <span className="flex items-start gap-0.5">
                                      <textarea
                                        rows={1} value={it.name} disabled={ro}
                                        aria-label={`Περιγραφή γραμμής ${i + 1}`}
                                        onChange={(e) => setLine(i, 'name', e.target.value)}
                                        className={cn(INPUT_CLS, 'h-auto min-w-0 flex-1 resize-none py-[0.3rem] leading-snug [field-sizing:content]', row ? 'min-h-7' : 'min-h-8')}
                                      />
                                      {/* Tablet/desktop: οι ενέργειες ΣΤΗΝ ΙΔΙΑ ΣΕΙΡΑ, ως μικρά εικονίδια — μια
                                          δεύτερη σειρά κάτω από κάθε είδος διπλασίαζε το ύψος σε τιμολόγια 200 γραμμών. */}
                                      {row && !ro && lineActions(it, i, true)}
                                    </span>
                                    <SerialChips serials={extractSerials(it.name)} />
                                  </label>
                                  <label className={cn(row ? 'col-span-1 row-start-1' : 'order-2 col-span-2', at(8))}>
                                    <span className={cn(CAP, 'text-right')}>Σύνολο</span>
                                    <CellInput value={it.total} onChange={(v) => setLine(i, 'total', v)} disabled={ro} numeric align="right"
                                      className={cn('font-semibold', !la.consistent && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30')} />
                                  </label>
                                  {showCode && (
                                    <label className={cn(SMALL, at(1))}>
                                      <span className={CAP}>Κωδ.</span>
                                      <CellInput value={it.code} onChange={(v) => setLine(i, 'code', v)} disabled={ro} className="font-mono" />
                                    </label>
                                  )}
                                  <label className={cn(SMALL, at(3))}>
                                    <span className={CAP}>Μον.</span>
                                    <CellInput value={it.unit} onChange={(v) => setLine(i, 'unit', v)} disabled={ro} />
                                  </label>
                                  <label className={cn(SMALL, at(4))}>
                                    <span className={cn(CAP, 'text-right')}>Ποσ.</span>
                                    <CellInput value={it.quantity} onChange={(v) => setLine(i, 'quantity', v)} disabled={ro} numeric align="right" />
                                  </label>
                                  <label className={cn(SMALL, at(5))}>
                                    <span className={cn(CAP, 'text-right')}>Τιμή</span>
                                    <CellInput value={it.price} onChange={(v) => setLine(i, 'price', v)} disabled={ro} numeric align="right" />
                                  </label>
                                  <label className={cn(SMALL, at(6))} title={dTitle}>
                                    <span className={cn(CAP, 'text-right')}>Έκπτ.</span>
                                    <CellInput value={it.discount} onChange={(v) => setLine(i, 'discount', v)} disabled={ro} numeric align="right"
                                      className={cn(la.discountKind === 'percent' && 'text-sisyphus-700 dark:text-sisyphus-300')} />
                                  </label>
                                  <label className={cn(SMALL, at(7))}>
                                    <span className={cn(CAP, 'text-right')}>ΦΠΑ%</span>
                                    <CellInput value={it.vatRate} onChange={(v) => setLine(i, 'vatRate', v)} disabled={ro} numeric align="right" />
                                  </label>
                                  {/* Κινητό: οι ενέργειες σε δική τους μικρή σειρά, με λέξεις. */}
                                  {!row && !ro && (
                                    <div className="order-4 col-span-full flex flex-wrap items-center gap-x-1 text-[length:var(--fs-10)] text-muted-foreground">
                                      {lineActions(it, i, false)}
                                    </div>
                                  )}
                                </div>
                                {saved.get(i) && (
                                  <div className="mt-1">
                                    <LineAllocations
                                      key={`${saved.get(i)!.id}-alloc`}
                                      lineId={saved.get(i)!.id}
                                      lineTotal={toNum(it.total) ?? null}
                                      canManage={!ro}
                                      colSpan={8}
                                      kind={allocKind}
                                      layout="block"
                                      hideIdle
                                      initial={saved.get(i)!.allocations}
                                    />
                                  </div>
                                )}
                                {hasLineCustomFields(lineCf) && (
                                  <div className="mt-1 rounded bg-sisyphus-500/5 px-2 py-1 text-[length:var(--fs-11)] text-muted-foreground">
                                    <LineCustomFields cf={lineCf} />
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                      <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/50 px-3 py-1.5 text-[length:var(--fs-12)]">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">Άθροισμα γραμμών (καθαρό) <SourceChip source="lines" /></span>
                        <span className="font-bold tabular-nums text-violet-800 dark:text-violet-200">{fmtMoney(linesNet)}</span>
                      </div>
                    </div>
                  );
                })()}
              </Section>
            )}

            {/* ---------- ΣΥΝΟΛΑ & ΣΥΜΦΩΝΙΑ, ΔΙΠΛΑ-ΔΙΠΛΑ ----------
                Τα «Σύνολα» στέκονταν μόνα τους στοιχισμένα δεξιά (`ml-auto max-w-md`): μισή σειρά
                ΚΕΝΗ σε κάθε παραστατικό. Και οι τρεις έλεγχοι συμφωνίας ήταν κρυμμένοι στην
                καρτέλα «Γραμμές» — δηλαδή ο αριθμός και ο έλεγχός του δεν φαίνονταν ποτέ μαζί.
                Τώρα το κενό γεμίζει με αυτό ακριβώς που ελέγχει τα σύνολα. */}
            {/* Υπόμνημα: τα ίδια τα σήματα λένε την πηγή («από το χαρτί», «από τις γραμμές»), οπότε μία
                γραμμή αρκεί — η πλήρης εξήγηση είναι στο tooltip του καθενός. */}
            <p className="flex flex-wrap items-center gap-1.5 text-[length:var(--fs-11)] text-muted-foreground" aria-label="Υπόμνημα χρωμάτων">
              <span className="font-semibold text-foreground">Πηγή ποσών:</span>
              <SourceChip source="scan" /><SourceChip source="lines" /><SourceChip source="edited" />
            </p>
            {/* Δύο στήλες με βάση το πλάτος του ΚΟΥΤΙΟΥ, όχι της οθόνης: με το πρωτότυπο ανοιχτό η φόρμα
                έχει ~310px σε οθόνη 1024 και το `lg:grid-cols-2` τη στρίμωχνε σε δύο στήλες των 150px. */}
            <div className={cn('grid items-start gap-3', formW >= 704 ? 'grid-cols-2' : 'grid-cols-1')}>
              <div className="space-y-3">
                {recon.vatGroups.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground">
                      <span>ΦΠΑ ανά συντελεστή{recon.hasMultipleRates && <span className="ml-1.5 font-semibold text-sisyphus-600">• πολλαπλά</span>}</span>
                      <SourceChip source="lines" />
                    </header>
                    <table className="w-full text-[length:var(--fs-12)]">
                      <thead className="text-left text-[length:var(--fs-11)] text-muted-foreground">
                        <tr><th className="px-3 py-1 font-semibold">Συντ/στής</th><th className="px-3 py-1 text-right font-semibold">Καθαρή</th><th className="px-3 py-1 text-right font-semibold">ΦΠΑ</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {recon.vatGroups.map((g) => (
                          <tr key={g.rate}>
                            <td className="px-3 py-1 tabular-nums">{g.rate}%</td>
                            <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(g.net)}</td>
                            <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(g.vat)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-border bg-muted/30 font-semibold">
                        <tr><td className="px-3 py-1">Σύνολο ΦΠΑ από τις γραμμές</td><td /><td className="px-3 py-1 text-right tabular-nums text-violet-800 dark:text-violet-200">{fmtMoney(recon.vatComputed)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                <div className="space-y-1.5">
                  <CheckRow ok={recon.linesVsSubtotal?.ok ?? null} label="Άθροισμα γραμμών = Καθαρή αξία"
                    got={fmtMoney(recon.sumNet)} exp={recon.subtotal != null ? fmtMoney(recon.subtotal) : '—'} />
                  <CheckRow ok={recon.vatOk} label="ΦΠΑ γραμμών = ΦΠΑ παραστατικού"
                    got={fmtMoney(recon.vatComputed)} exp={recon.vatField != null ? fmtMoney(recon.vatField) : '—'} />
                  <CheckRow ok={recon.totalOk} label="Καθαρή + ΦΠΑ = Γενικό Σύνολο"
                    got={recon.totalComputed != null ? fmtMoney(recon.totalComputed) : '—'} exp={recon.totalField != null ? fmtMoney(recon.totalField) : '—'} />
                </div>
              </div>
              {totalsBox}
            </div>

            {/* ---------- JSON ---------- */}
            {/* ---------- JSON: ΚΛΕΙΣΤΟ, όχι καρτέλα ----------
                Είναι εργαλείο ελέγχου, όχι δουλειά του λογιστή. Ως καρτέλα κατείχε ίσο βάρος με
                τα πεδία και τις γραμμές· ως `<details>` είναι μία γραμμή όσο δεν το χρειάζεσαι. */}
            <details className="group overflow-hidden rounded-lg border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/50 px-3 py-1.5 text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground transition hover:bg-muted">
                <FiChevronRight className="size-3.5 shrink-0 transition-transform duration-200 group-open:rotate-90" aria-hidden />
                JSON εξαγωγής
                <span className="font-normal normal-case text-muted-foreground">— για έλεγχο</span>
              </summary>
              {/* Το JSON μπορεί να είναι τεράστιο: εδώ το `overflow-auto` είναι σωστό, αλλά χωρίς
                  ύψος-φυλακή — μέχρι 70vh, και μόνο όταν είναι ανοιχτό. */}
              <pre className="max-h-[70vh] overflow-auto border-t border-border bg-muted p-3 text-[length:var(--fs-11)] font-mono leading-relaxed text-foreground">
{JSON.stringify(buildExtractedData(), null, 2)}
              </pre>
            </details>
          </div>

          {/* ---- Footer (sticky action bar — always visible) ---- */}
          <div className="sticky bottom-0 z-20 flex flex-col gap-2 rounded-b-xl border-t border-border bg-card/95 px-3 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur lg:flex-row lg:items-end lg:justify-between">
            {/* ΧΩΡΙΣ `lg:max-w-xl`: η μπάρα είχε χώρο, αλλά τα δύο combo ήταν κλεισμένα σε 36rem
                και η επιλεγμένη σειρά («ΤΥΠΥΠ · Τιμολόγιο Παροχής Υπηρεσιών») κοβόταν στη μέση —
                ο χρήστης δεν έβλεπε ΤΙ είχε διαλέξει. Η σειρά παίρνει διπλάσιο πλάτος από την
                κατηγορία, γιατί τα ονόματά της είναι τριπλάσια. `title` για ολόκληρη την τιμή. */}
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className={LABEL_CLS}>Είδος παραστατικού στο SoftOne</span>
                <select value={seriesKey} disabled={ro} onChange={(e) => setSeriesKey(e.target.value)}
                  title={postableSeries.find((o) => `${o.sosource}:${o.code}` === seriesKey)?.name ?? 'Δεν έχει επιλεγεί σειρά'}
                  className={cn(INPUT_CLS, 'w-full cursor-pointer')}>
                  <option value="">— Επιλογή σειράς —</option>
                  {/* Ομαδοποίηση όπως στο SoftOne: μία ομάδα ανά ΕΝΟΤΗΤΑ, με το όνομά της. */}
                  {[...new Set(postableSeries.map((o) => o.family))].map((family) => {
                    const group = postableSeries.filter((o) => o.family === family);
                    if (!group.length) return null;
                    return (
                      <optgroup key={family} label={family}>
                        {group.map((o) => (
                          // Ανενεργή σειρά: μπαίνει μόνο επειδή τη δείχνει ήδη το παραστατικό —
                          // φαίνεται, αλλά δεν ξαναεπιλέγεται.
                          <option key={`${o.sosource}-${o.code}`} value={`${o.sosource}:${o.code}`} disabled={!o.enabled}>
                            {o.abbrev ? `${o.abbrev} · ` : ''}{o.name}{o.enabled ? '' : ' (ανενεργή)'}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className={LABEL_CLS}>Κατηγορία</span>
                <select value={category} disabled={ro} onChange={(e) => setCategory(e.target.value)}
                  title={CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? 'Δεν έχει επιλεγεί κατηγορία'}
                  className={cn(INPUT_CLS, 'w-full cursor-pointer')}>
                  <option value="">— Επιλογή —</option>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {dirty && !ro && (
                <button type="button" onClick={reset}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[length:var(--fs-12)] font-semibold text-foreground transition hover:bg-muted">
                  <FiRotateCcw className="size-3.5" /> Επαναφορά
                </button>
              )}
              {/* ΑΠΕΝΕΡΓΟΠΟΙΗΜΕΝΟ = ΟΥΔΕΤΕΡΟ, ποτέ ξεθωριασμένο χρώμα μάρκας.
                  Το `disabled:opacity-50` πάνω σε μπλε/πράσινο έβγαζε ένα λασπωμένο παστέλ που
                  ούτε διαβαζόταν ούτε έλεγε «ανενεργό» — έμοιαζε με χαλασμένο κουμπί. Γκρι φόντο
                  και σβησμένο κείμενο το λένε καθαρά, και το ενεργό χρώμα μένει πλήρες. */}
              <button type="button" disabled={ro || saving || !dirty} onClick={save}
                className={cn(DISABLED_CLS, 'inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3.5 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 active:bg-sisyphus-700')}>
                <FiSave className="size-3.5" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </button>
              <button type="button"
                disabled={!canPost || posting || row.status !== 'COMPLETED' || !category || row.postStatus === 'POSTED'}
                onClick={post}
                className={cn(DISABLED_CLS, 'inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition hover:bg-emerald-700')}>
                <FiSend className="size-3.5" /> {posting ? 'Ανάρτηση…' : row.postStatus === 'POSTED' ? 'Αναρτήθηκε' : 'Ανάρτηση'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Ο ΠΡΟΟΡΙΣΜΟΣ ΕΙΝΑΙ ΓΝΩΣΤΟΣ ΚΑΙ ΕΔΩ: η σειρά είναι πάνω στη φόρμα (`seriesKey`), άρα η
          λίστα δεν χρειάζεται να μαντεύει «είδος». Ο δημιουργός είναι ο ΙΔΙΟΣ και στα δύο σημεία
          — ένας κώδικας, ένας κανόνας. */}
      <CreateRegistryEntryModal
        open={createLine != null}
        onOpenChange={(o: boolean) => { if (!o) setCreateLine(null); }}
        kind={createLine?.kind ?? 'product'}
        initialCode={createLine?.code}
        initialName={createLine?.name}
        initialVatRate={createLine?.vat}
        onCreated={() => { setCreateLine(null); router.refresh(); }}
      />
    </div>
  );
}
