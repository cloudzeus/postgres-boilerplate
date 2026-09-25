'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  FiAlertCircle, FiAlertTriangle, FiCheck, FiCornerDownLeft, FiDollarSign, FiExternalLink,
  FiCpu, FiInfo, FiLoader, FiPackage, FiPlus, FiPlusCircle, FiRefreshCw, FiSkipForward, FiTag, FiTool,
} from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RegistrySearch } from '@/components/admin/registry-search';
import { AnalyticsPicker, type AnalyticsValue } from '@/components/admin/analytics-picker';
import type { ItemQueueGroup, QueueSuggestion } from '@/lib/ocr/queues';
import type { MatchKind } from '@/lib/ocr/line-match';
import { cn } from '@/lib/utils';

export interface VatOption { code: string; label: string; rate: number | null }
export interface UnitOption { code: string; label: string }
/** Ομάδα ή εμπορική κατηγορία είδους (`ITEM.MTRGROUP` / `ITEM.MTRCATEGORY`). */
export interface ClassOption { code: string; label: string }

/** Χρώματα κατηγορίας — inline hex, όπως και στις υπόλοιπες σελίδες δεδομένων. */
export const CATEGORY_META: Record<MatchKind, { label: string; bg: string; fg: string }> = {
  product: { label: 'Προϊόν', bg: '#EAF4FC', fg: '#0078D4' },
  service: { label: 'Υπηρεσία', bg: '#E8F7F0', fg: '#047857' },
  expense: { label: 'Έξοδο', bg: '#FDF3E3', fg: '#B45309' },
  // Χρεοπίστωση (LINEITEM): ό,τι δέχεται η γραμμή «Ειδικών συναλλαγών» (LINLINES).
  lineitem: { label: 'Χρεοπίστωση', bg: '#F3EEFF', fg: '#6D28D9' },
};

/**
 * Το chip μιας ομάδας που ΔΕΝ κατηγοριοποιήθηκε. Ουδέτερο χρώμα επίτηδες: δεν είναι σφάλμα,
 * είναι «δεν ξέρουμε ακόμη» — και δεν πρέπει να μοιάζει με καμία από τις τέσσερις κατηγορίες.
 */
export const UNCLASSIFIED_META = { label: 'Χωρίς κατηγορία', bg: '#EDEDED', fg: '#5A5A5A' };

/** Μία κατηγορία δαπάνης (LINCATEGORY) για το φίλτρο των χρεοπιστώσεων. */
export interface LineCategoryOption { id: number; label: string }

/** Η αναλυτική μιας ομάδας: κέντρο κόστους, έργο, κατηγορία δραστηριότητας. */
export interface AnalyticsState {
  costCntr: AnalyticsValue;
  prjc: AnalyticsValue;
  prjcStage: AnalyticsValue;
}
export const EMPTY_ANALYTICS: AnalyticsState = {
  costCntr: { id: null, label: null, source: null },
  prjc: { id: null, label: null, source: null },
  prjcStage: { id: null, label: null, source: null },
};

const eur = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });
export const money = (v: number | null) => (v == null ? '—' : eur.format(v));

const qty = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 3 });
/** Ποσότητα με ελληνικούς διαχωριστές (1.250,5) — ποτέ ωμό `toString()`. */
export const quantity = (v: number | null) => (v == null ? '—' : qty.format(v));

/** «1 γραμμή» / «5 γραμμές» — κοινός ενικός/πληθυντικός για όλη την ουρά. */
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const lineLabel = (n: number) => plural(n, 'γραμμή', 'γραμμές');
export const docLabel = (n: number) => plural(n, 'παραστατικό', 'παραστατικά');

/** Γιατί προτάθηκε — το `by` του server σε ανθρώπινα ελληνικά. */
const REASON: Record<string, string> = {
  memory: 'μνήμη',
  code: 'ίδιος κωδικός',
  code1: 'barcode',
  code2: 'κωδικός εργοστασίου',
  name: 'ομοιότητα ονόματος',
  ai: 'πρόταση AI',
};

/** Πόσο περιμένουμε μετά την τελευταία πληκτρολόγηση πριν ξαναζητήσουμε dry-run. */
const DRY_DEBOUNCE_MS = 400;

const KIND_ICON: Record<MatchKind, React.ReactNode> = {
  product: <FiPackage aria-hidden className="size-3.5" />,
  service: <FiTool aria-hidden className="size-3.5" />,
  expense: <FiDollarSign aria-hidden className="size-3.5" />,
  lineitem: <FiTag aria-hidden className="size-3.5" />,
};

const SEGMENTS: MatchKind[] = ['product', 'service', 'expense', 'lineitem'];


/**
 * Ό,τι επιστρέφει το `GET /api/admin/ocr/new-items/next-code` — η ΠΡΟΤΑΣΗ κωδικού για τη νέα
 * εγγραφή. Δύο κανόνες: ο κωδικός του προμηθευτή αν είναι ελεύθερος, αλλιώς ο επόμενος
 * ελεύθερος της δικής μας αρίθμησης. Ποτέ slug της περιγραφής.
 */
interface CodeProposal {
  code: string | null;
  source: 'supplier' | 'pattern' | 'mask' | 'none';
  /** `true` = η γραμμή είχε κωδικό προμηθευτή αλλά είναι ήδη πιασμένος. */
  supplierCodeTaken: boolean;
  supplierCode: string | null;
  /** Πόσοι κωδικοί του μητρώου λήφθηκαν υπόψη. */
  taken: number;
  /** `true` = το SoftOne δεν απάντησε· η πρόταση βγήκε από τον τοπικό καθρέφτη. */
  stale: boolean;
}

/** Το chip δίπλα στο πεδίο: ΠΟΙΟΣ από τους δύο κανόνες έδωσε τον κωδικό. */
const CODE_CHIP: Record<CodeProposal['source'], string | null> = {
  supplier: 'κωδικός προμηθευτή — ελεύθερος',
  pattern: 'προτεινόμενος — επόμενος ελεύθερος',
  mask: 'προτεινόμενος — από τη μάσκα',
  none: null,
};

/** Τι λέει το πεδίο «Κωδικός»: από πού ήρθε η πρόταση και τι σημαίνει. */
function codeHint(kind: MatchKind | null, p: CodeProposal | null, busy: boolean): string {
  if (busy) return 'Αναζήτηση προτεινόμενου κωδικού…';
  if (!kind) return 'Διάλεξε πρώτα κατηγορία — ο κωδικός εξαρτάται από το μητρώο.';
  const of = KIND_GENITIVE[kind];
  if (!p) return `Το SoftOne δεν αποδίδει κωδικό μόνο του — συμπλήρωσε τον κωδικό ${of}.`;
  const stale = p.stale ? ' (από τον τοπικό καθρέφτη — το SoftOne δεν απάντησε, μπορεί να έχει πιαστεί)' : '';
  if (p.source === 'supplier') {
    return `Ο κωδικός του προμηθευτή από τη γραμμή είναι ελεύθερος στο μητρώο ${of} — τον κρατάμε${stale}.`;
  }
  const why = p.supplierCodeTaken
    ? `Ο κωδικός «${p.supplierCode}» της γραμμής είναι ήδη πιασμένος: `
    : '';
  if (p.source === 'pattern') {
    return `${why}ο επόμενος ελεύθερος μετά τους ${p.taken} υπάρχοντες κωδικούς ${of}. Άλλαξέ τον ελεύθερα${stale}.`;
  }
  if (p.source === 'mask') {
    return `${why}δεν υπάρχει ακόμη κανένας κωδικός ${of} — η πρόταση έρχεται από τη μάσκα των Ρυθμίσεων${stale}.`;
  }
  return `${why}δεν βρέθηκε κανένας υπάρχων κωδικός ${of} ούτε μάσκα: χρειάζεται η αρίθμηση του λογιστή (Ρυθμίσεις → Διασυνδέσεις → «Μάσκα κωδικού»).`;
}

/** Γενική του μητρώου, για τα μηνύματα του πεδίου «Κωδικός». */
const KIND_GENITIVE: Record<MatchKind, string> = {
  product: 'ειδών', service: 'υπηρεσιών', expense: 'εξόδων', lineitem: 'χρεοπιστώσεων',
};

/**
 * Η ετικέτα του κουμπιού που **ΑΝΟΙΓΕΙ** τη φόρμα δημιουργίας. Ονομάζει ρητά το μητρώο και
 * τελειώνει σε «…» ώστε να διαβάζεται ως «θα ανοίξει κάτι», όχι ως η ίδια η υποβολή.
 */
const NEW_ENTITY_LABEL: Record<MatchKind, string> = {
  product: 'Νέο είδος…',
  service: 'Νέα υπηρεσία…',
  expense: 'Νέο έξοδο…',
  lineitem: 'Νέα χρεοπίστωση…',
};

/** Τι επιστρέφει το `onCreate` όταν το SoftOne απέρριψε τον κωδικό ως πιασμένο. */
export interface CreateOutcome {
  /** `stale` = η νέα πρόταση βγήκε από τον τοπικό καθρέφτη· μπορεί κι αυτή να είναι πιασμένη. */
  codeTaken: { message: string; suggestion: string | null; stale: boolean };
}

function defaultVat(vats: VatOption[]): string {
  return vats.find((v) => v.rate === 24)?.code ?? vats[0]?.code ?? '';
}
function defaultUnit(units: UnitOption[]): string {
  return units.find((u) => /τεμ/i.test(u.label))?.code ?? units[0]?.code ?? '';
}

/**
 * Panel απόφασης για μία ομάδα γραμμών: δείγμα γραμμών, κατηγορία, προτάσεις με
 * ποσοστό, ελεύθερη αναζήτηση στο μητρώο, inline φόρμα δημιουργίας στο SoftOne
 * (με dry-run προεπισκόπηση) και παράλειψη.
 */
export function ItemPanel({
  group, category, onCategory, suggestions, hiddenSuggestions, loadingSuggestions,
  suggestionsFailed, onRetrySuggestions, canManage, busy, onMatch, onCreate, onSkip, vats, units,
  itemGroups = [], itemCategories = [], onCategoryCreated,
  lineCategories = [], lineCategory, onLineCategory, analytics, onAnalytics, analyticsSupported,
}: {
  group: ItemQueueGroup;
  /** `null` = «χωρίς κατηγορία»: καμία απόδειξη ακόμη — ο χρήστης (ή το AI) αποφασίζει. */
  category: MatchKind | null;
  onCategory: (k: MatchKind) => void;
  suggestions: QueueSuggestion[];
  hiddenSuggestions: number;
  loadingSuggestions: boolean;
  /** Η lazy φόρτωση προτάσεων απέτυχε — άλλο από «καμία πρόταση». */
  suggestionsFailed: boolean;
  onRetrySuggestions: () => void;
  /** `ocr.categorize` — χωρίς αυτό το panel είναι μόνο για ανάγνωση. */
  canManage: boolean;
  busy: boolean;
  onMatch: (target: { mtrl?: number; expn?: number; lin?: number }, isService: boolean) => void | Promise<void>;
  onCreate: (input: {
    kind: MatchKind; code: string; name: string; vat: string | null; unit: string | null;
    /** Τιμή **χονδρικής** (καθαρή) — γράφεται στο `PRICEW`. */
    price: number | null;
    /** Ο κωδικός της γραμμής — ο server τον χρειάζεται για να ξαναπροτείνει σωστά μετά από 409. */
    supplierCode: string | null;
    group: string | null;
    category: string | null;
  }) => void | Promise<void | CreateOutcome>;
  onSkip: () => void | Promise<void>;
  vats: VatOption[];
  units: UnitOption[];
  /** Ομάδες ειδών (`MTRGROUP`) — ΜΟΝΟ επιλογή: το SoftOne δεν δέχεται νέα ομάδα από WS. */
  itemGroups?: ClassOption[];
  /** Εμπορικές κατηγορίες (`MTRCATEGORY`) — με inline δημιουργία (object `ITECATEGORY`). */
  itemCategories?: ClassOption[];
  /** Μια νέα κατηγορία δημιουργήθηκε: ο γονέας την προσθέτει στη λίστα. */
  onCategoryCreated?: (option: ClassOption) => void;
  /** Κατηγορίες δαπανών (LINCATEGORY) για το φίλτρο των χρεοπιστώσεων. */
  lineCategories?: LineCategoryOption[];
  /** Η επιλεγμένη κατηγορία δαπάνης (ελέγχεται από την ουρά: τη χρειάζεται και το AI). */
  lineCategory: number | null;
  onLineCategory: (v: number | null) => void;
  /** Αναλυτική της τρέχουσας ομάδας (κέντρο κόστους / έργο / δραστηριότητα). */
  analytics: AnalyticsState;
  onAnalytics: (v: AnalyticsState) => void;
  /**
   * `false` όταν η σειρά του παραστατικού καταχωρεί σε «Ανάλυση εξόδων» (EXPANAL), που ΔΕΝ έχει
   * πεδία αναλυτικής. Τότε τα δείχνουμε ανενεργά με εξήγηση αντί να δεχτούμε τιμή που θα χανόταν.
   */
  analyticsSupported?: boolean;
}) {
  const cat = category ? CATEGORY_META[category] : UNCLASSIFIED_META;
  const needsUnit = category === 'product' || category === 'service';
  const locked = busy || !canManage;
  // Χρεοπιστώσεις: η δημιουργία γίνεται ΜΟΝΟ στο SoftOne — η εφαρμογή δεν γράφει ποτέ μητρώο
  // χρεοπιστώσεων, οπότε η φόρμα «Δημιουργία» δεν εμφανίζεται εκεί. Χωρίς κατηγορία δεν ξέρουμε
  // καν ΠΟΙΟ μητρώο θα γραφτεί: ζητάμε πρώτα επιλογή.
  const canCreate = category != null && category !== 'lineitem';
  // Τα έργα του εκδότη είναι η χρήσιμη προεπιλογή· ο χρήστης βλέπει όλα με ένα κλικ.
  const [projectScopeAll, setProjectScopeAll] = React.useState(false);
  React.useEffect(() => setProjectScopeAll(false), [group.key]);


  const [creating, setCreating] = React.useState(false);
  const segmentRefs = React.useRef<Partial<Record<MatchKind, HTMLButtonElement | null>>>({});
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  /** Ο προτεινόμενος κωδικός για το τρέχον (ομάδα, μητρώο) — φορτώνεται από τον server. */
  const [codeProposal, setCodeProposal] = React.useState<CodeProposal | null>(null);
  const [codeBusy, setCodeBusy] = React.useState(false);
  /** Το ΑΥΤΟΥΣΙΟ μήνυμα του SoftOne όταν απέρριψε τον κωδικό — κολλάει στο πεδίο. */
  const [erpCodeError, setErpCodeError] = React.useState<string | null>(null);
  /** Ο ΝΕΟΣ κωδικός που προτείνει ο server μετά από 409 — ο χρήστης τον δέχεται ρητά. */
  const [codeOffer, setCodeOffer] = React.useState<string | null>(null);
  /** Η επαναπρόταση μετά από 409 ήρθε από τον καθρέφτη (το SoftOne δεν απάντησε). */
  const [codeOfferStale, setCodeOfferStale] = React.useState(false);
  /** Η τελευταία πρόταση που γράψαμε ΕΜΕΙΣ — για να ξέρουμε τι επιτρέπεται να αντικατασταθεί. */
  const lastProposal = React.useRef<string>('');

  const [form, setForm] = React.useState(() => ({
    // Ο κωδικός δεν «μαντεύεται» από την περιγραφή: μένει κενός ώσπου να απαντήσει ο server.
    code: '',
    name: group.sample.trim().slice(0, 200),
    vat: defaultVat(vats),
    unit: defaultUnit(units),
    price: group.lines.find((l) => l.price != null)?.price?.toString() ?? '',
    itemGroup: '',
    itemCategory: '',
  }));
  const [dryPayload, setDryPayload] = React.useState<unknown>(null);
  const [dryLoading, setDryLoading] = React.useState(false);
  const [dryError, setDryError] = React.useState<string | null>(null);
  const [dryOpen, setDryOpen] = React.useState(false);

  // Νέα ομάδα ⇒ καθαρή φόρμα με νέα προσυμπλήρωση.
  React.useEffect(() => {
    setCreating(false);
    setTouched({});
    setDryPayload(null);
    setDryError(null);
    setDryOpen(false);
    setErpCodeError(null);
    setCodeOffer(null);
    lastProposal.current = '';
    setForm({
      code: '',
      name: group.sample.trim().slice(0, 200),
      vat: defaultVat(vats),
      unit: defaultUnit(units),
      price: group.lines.find((l) => l.price != null)?.price?.toString() ?? '',
      itemGroup: '',
      itemCategory: '',
    });
  }, [group.key, group.code, group.sample, group.lines, vats, units]);

  // Μόλις ο χρήστης αγγίξει τον κωδικό (ή αλλάξει μητρώο), το μήνυμα του ERP παύει να ισχύει.
  React.useEffect(() => { setErpCodeError(null); setCodeOffer(null); }, [form.code, category]);

  /**
   * Ο **προτεινόμενος κωδικός** για (ομάδα, μητρώο), με φρέσκα δεδομένα από το SoftOne
   * (read-only `GetTable`). Ξανατρέχει σε κάθε αλλαγή κατηγορίας: μια υπηρεσία (MTRL 52) δεν
   * κληρονομεί ποτέ την αρίθμηση των ειδών (MTRL 51), ούτε των εξόδων.
   *
   * Η πρόταση ΔΕΝ κλειδώνει το πεδίο: γράφεται μόνο όταν αυτό είναι άδειο ή κρατά ακόμη
   * προηγούμενη πρόταση. Ό,τι πληκτρολόγησε ο χρήστης μένει ανέγγιχτο.
   */
  React.useEffect(() => {
    // Οι χρεοπιστώσεις δεν δημιουργούνται από εδώ — καμία πρόταση, καμία κλήση.
    if (category == null || category === 'lineitem') { setCodeProposal(null); return; }
    let ignore = false;
    setCodeBusy(true);
    const qs = new URLSearchParams({ kind: category });
    if (group.code) qs.set('supplierCode', group.code);
    fetch(`/api/admin/ocr/new-items/next-code?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CodeProposal | null) => {
        if (ignore) return;
        setCodeProposal(d);
        const proposal = d?.code ? String(d.code) : '';
        setForm((f) => {
          const cur = f.code.trim();
          if (cur !== '' && cur !== lastProposal.current) return f;
          lastProposal.current = proposal;
          return { ...f, code: proposal };
        });
      })
      .catch(() => { if (!ignore) setCodeProposal(null); })
      .finally(() => { if (!ignore) setCodeBusy(false); });
    return () => { ignore = true; };
  }, [group.key, group.code, category]);

  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const errors: Record<string, string | null> = {
    code: form.code.trim() ? null : 'Ο κωδικός είναι υποχρεωτικός.',
    name: form.name.trim() ? null : 'Η περιγραφή είναι υποχρεωτική.',
    vat: form.vat ? null : 'Επίλεξε κατηγορία ΦΠΑ.',
    unit: !needsUnit || form.unit ? null : 'Επίλεξε μονάδα μέτρησης.',
  };
  const invalid = Object.values(errors).some(Boolean);
  // Το πεδίο κρατά ακόμη ΑΚΡΙΒΩΣ ό,τι προτείναμε — μόλις το αλλάξει ο χρήστης, το chip φεύγει.
  const isProposedCode = !!lastProposal.current && form.code.trim() === lastProposal.current;
  const codeChip = codeProposal ? CODE_CHIP[codeProposal.source] : null;


  const body = React.useMemo(() => ({
    afm: group.afm,
    pattern: group.pattern,
    kind: category ?? 'product',
    code: form.code.trim(),
    name: form.name.trim(),
    vat: form.vat || null,
    unit: needsUnit ? form.unit || null : null,
    price: form.price.trim() ? Number(form.price.replace(',', '.')) : null,
    supplierCode: group.code ?? null,
    group: needsUnit ? form.itemGroup || null : null,
    category: needsUnit ? form.itemCategory || null : null,
  }), [
    group.afm, group.pattern, group.code, category, form.code, form.name, form.vat, form.unit,
    form.price, form.itemGroup, form.itemCategory, needsUnit,
  ]);

  // Όσο η προεπισκόπηση είναι ανοιχτή ακολουθεί τη φόρμα: κάθε αλλαγή ξαναζητά
  // το dry-run μετά από {@link DRY_DEBOUNCE_MS}, ώστε να μη δείχνει παλιό payload.
  React.useEffect(() => {
    if (!dryOpen) return;
    if (invalid) { setDryPayload(null); setDryError(null); setDryLoading(false); return; }
    let ignore = false;
    setDryLoading(true);
    const h = setTimeout(() => {
      fetch('/api/admin/ocr/new-items/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, dryRun: true }),
      })
        .then(async (res) => {
          const d = (await res.json().catch(() => ({}))) as { payload?: unknown; message?: string };
          if (ignore) return;
          if (!res.ok) { setDryError(d?.message ?? 'Η προεπισκόπηση απέτυχε.'); return; }
          setDryError(null);
          setDryPayload(d.payload ?? d);
        })
        .catch(() => { if (!ignore) setDryError('Σφάλμα δικτύου στην προεπισκόπηση.'); })
        .finally(() => { if (!ignore) setDryLoading(false); });
    }, DRY_DEBOUNCE_MS);
    return () => { ignore = true; clearTimeout(h); };
  }, [dryOpen, invalid, body]);

  // ── Inline δημιουργία εμπορικής κατηγορίας (object ITECATEGORY) ───────
  const [newCat, setNewCat] = React.useState<{ name: string; code: string } | null>(null);
  const [catBusy, setCatBusy] = React.useState(false);
  const [catError, setCatError] = React.useState<string | null>(null);

  const submitCategory = async () => {
    if (!newCat || catBusy) return;
    const name = newCat.name.trim();
    if (!name) { setCatError('Η περιγραφή είναι υποχρεωτική.'); return; }
    setCatBusy(true);
    setCatError(null);
    try {
      const res = await fetch('/api/admin/ocr/new-items/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code: newCat.code.trim() || null }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; category?: ClassOption };
      // ΑΠΟΤΥΧΙΑ = ΤΙΠΟΤΑ ΔΕΝ ΔΗΜΙΟΥΡΓΗΘΗΚΕ. Ο server πετά και όταν το `setData` γυρίσει
      // «επιτυχία» αλλά η ανάγνωση πίσω δεν βρει τη γραμμή — εδώ φαίνεται ως σφάλμα πεδίου, η
      // λίστα ΔΕΝ αλλάζει και καμία κατηγορία δεν επιλέγεται.
      if (!res.ok || !d.ok || !d.category) {
        setCatError(d.message ?? 'Η κατηγορία δεν δημιουργήθηκε.');
        return;
      }
      onCategoryCreated?.(d.category);
      set('itemCategory', d.category.code);
      setNewCat(null);
    } catch {
      setCatError('Σφάλμα δικτύου — η κατηγορία δεν δημιουργήθηκε.');
    } finally {
      setCatBusy(false);
    }
  };

  const codeRef = React.useRef<HTMLInputElement | null>(null);

  const submitCreate = async () => {
    setTouched({ code: true, name: true, vat: true, unit: true });
    if (invalid) return;
    if (!category) return;
    const outcome = await onCreate({
      kind: category, code: body.code, name: body.name, vat: body.vat, unit: body.unit,
      price: body.price, supplierCode: body.supplierCode,
      group: body.group, category: body.category,
    });
    // Ο κωδικός πιάστηκε στο μεσοδιάστημα (άλλος χρήστης / άλλη καρτέλα). ΚΑΜΙΑ αυτόματη
    // επανάληψη: ο χρήστης βλέπει τη νέα πρόταση και πατά ο ίδιος ξανά «Δημιουργία».
    if (outcome && 'codeTaken' in outcome) {
      setErpCodeError(outcome.codeTaken.message);
      setCodeOffer(outcome.codeTaken.suggestion);
      setCodeOfferStale(outcome.codeTaken.stale);
      codeRef.current?.focus();
    }
  };

  return (
    <div className="divide-y divide-border">
      {/* ── Κεφαλίδα ομάδας ─────────────────────────────────────────── */}
      <header className="px-4 py-3">
        <h2 className="text-[length:var(--fs-15)] font-semibold leading-snug text-foreground">{group.sample}</h2>
        <p className="mt-0.5 text-body-sm text-muted-foreground">
          {group.supplier ?? 'Άγνωστος εκδότης'}
          {group.afm && <span className="font-mono"> · ΑΦΜ {group.afm}</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-sm bg-neutral-6 px-1.5 py-0.5 text-caption tabular-nums text-muted-foreground">
            {lineLabel(group.lineCount)} · {docLabel(group.docCount)}
          </span>
          {group.code && (
            <span className="rounded-sm bg-neutral-6 px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
              κωδ. γραμμής {group.code}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption font-medium"
            style={{ backgroundColor: cat.bg, color: cat.fg }}
          >
            {category ? KIND_ICON[category] : <FiAlertCircle aria-hidden className="size-3.5" />} {cat.label}
          </span>
        </div>
        {/* Η αιτιολόγηση του μοντέλου δίπλα στην κατηγορία: ο χρήστης κρίνει σε ένα δευτερόλεπτο
            αν ο συλλογισμός στέκει, αντί να εμπιστευτεί ένα chip. */}
        {group.aiReason && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-neutral-4 px-2 py-1 text-caption text-muted-foreground">
            <FiCpu aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>
              {/* Χωρίς κατηγορία η απάντηση του μοντέλου ΔΕΝ επέλεξε τίποτα: είναι σχόλιο —
                  τυπικά «μοιάζει με πάγιο», που η εφαρμογή δεν καταχωρεί ακόμη. Το λέμε ρητά,
                  ώστε να μη διαβαστεί ως αιτιολόγηση κατηγορίας που δεν υπάρχει. */}
              {!category && <strong className="font-semibold">Παρατήρηση: </strong>}
              {group.aiReason}
            </span>
          </p>
        )}
      </header>

      {/* ── Δείγμα γραμμών ──────────────────────────────────────────── */}
      <section className="px-4 py-3">
        <h3 className="mb-1.5 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          Γραμμές όπως τυπώθηκαν
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[length:var(--fs-12)]">
            <thead>
              <tr className="border-b border-border text-left text-caption text-muted-foreground">
                <th scope="col" className="py-1 pr-2 font-medium">Περιγραφή</th>
                <th scope="col" className="py-1 px-2 text-right font-medium">Ποσότητα</th>
                <th scope="col" className="py-1 px-2 text-right font-medium">Τιμή</th>
                <th scope="col" className="py-1 px-2 text-right font-medium">Αξία</th>
                <th scope="col" className="py-1 pl-2 font-medium">Παραστατικό</th>
              </tr>
            </thead>
            <tbody>
              {group.lines.map((l) => (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="max-w-[220px] truncate py-1 pr-2 text-foreground">{l.name}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{quantity(l.quantity)}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{money(l.price)}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{money(l.total)}</td>
                  <td className="py-1 pl-2">
                    <Link
                      href={`/admin/ocr/${l.docId}`}
                      className="inline-flex max-w-[160px] cursor-pointer items-center gap-1 truncate rounded-sm text-sisyphus-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sisyphus-500"
                    >
                      <FiExternalLink aria-hidden className="size-3 shrink-0" />
                      <span className="truncate">{l.fileName ?? l.docId.slice(0, 8)}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {group.lineCount > group.lines.length && (
          <p className="mt-1 text-caption text-muted-foreground">
            …και {plural(group.lineCount - group.lines.length, 'ακόμη όμοια γραμμή', 'ακόμη όμοιες γραμμές')} στην ίδια ομάδα.
          </p>
        )}
      </section>

      {/* ── Κατηγορία ───────────────────────────────────────────────── */}
      <section className="px-4 py-3">
        <h3 className="mb-1.5 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          Κατηγορία
        </h3>
        <div
          role="radiogroup"
          aria-label="Κατηγορία ομάδας"
          className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-6 p-1"
          // ←/→ αλλάζουν την επιλεγμένη κατηγορία (roving tabindex, WAI-ARIA radiogroup).
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            e.stopPropagation();
            // Χωρίς επιλεγμένη κατηγορία το ←/→ ξεκινά από την αρχή, δεν «μαντεύει» θέση.
            const at = category ? SEGMENTS.indexOf(category) : -1;
            const next = SEGMENTS[(at + (e.key === 'ArrowRight' ? 1 : -1) + SEGMENTS.length) % SEGMENTS.length];
            onCategory(next);
            segmentRefs.current[next]?.focus();
          }}
        >
          {SEGMENTS.map((k) => {
            const active = k === category;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                ref={(el) => { segmentRefs.current[k] = el; }}
                onClick={() => onCategory(k)}
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[length:var(--fs-12)] font-medium',
                  'cx-transition motion-reduce:transition-none',
                  'outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500',
                  active
                    ? 'bg-card text-sisyphus-700 shadow-fluent-2'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {KIND_ICON[k]} {CATEGORY_META[k].label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Προτάσεις ───────────────────────────────────────────────── */}
      <section className="px-4 py-3">
        <h3 className="mb-1.5 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          Προτάσεις από το μητρώο
        </h3>

        {loadingSuggestions ? (
          <ul aria-busy className="space-y-1.5">
            <li className="sr-only">Φόρτωση προτάσεων…</li>
            {[0, 1, 2].map((i) => (
              <li key={i} aria-hidden className="h-12 animate-pulse rounded-lg bg-neutral-6 motion-reduce:animate-none" />
            ))}
            <li className="flex items-center gap-1.5 text-caption text-muted-foreground" aria-hidden>
              <FiLoader className="size-3.5 animate-spin motion-reduce:animate-none" /> Φόρτωση προτάσεων…
            </li>
          </ul>
        ) : suggestionsFailed ? (
          // Αποτυχία φόρτωσης ≠ «καμία πρόταση»: δεν αφήνουμε τον χρήστη να νομίσει
          // ότι το μητρώο δεν έχει τίποτα, του δίνουμε κουμπί επανάληψης.
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-body-sm"
            style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}
          >
            <FiAlertTriangle aria-hidden className="size-4 shrink-0" />
            <span>Σφάλμα φόρτωσης προτάσεων.</span>
            <Button
              type="button" variant="outline" size="sm"
              className="ml-auto h-8 cursor-pointer"
              onClick={onRetrySuggestions}
            >
              <FiRefreshCw aria-hidden className="size-3.5" /> Δοκίμασε ξανά
            </Button>
          </div>
        ) : suggestions.length === 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-neutral-6 px-3 py-2 text-body-sm text-muted-foreground">
            <FiInfo aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Καμία πρόταση σε «{cat.label}». Ψάξε στο μητρώο ή δημιούργησε νέα εγγραφή.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <SuggestionRow
                key={`${s.mtrl ?? 'm'}-${s.expn ?? 'e'}-${s.lin ?? 'l'}-${s.code}`}
                suggestion={s}
                first={i === 0}
                disabled={locked}
                onMatch={onMatch}
              />
            ))}
          </ul>
        )}

        {hiddenSuggestions > 0 && !loadingSuggestions && !suggestionsFailed && (
          <p className="mt-1.5 text-caption text-muted-foreground">
            {hiddenSuggestions} ακόμη {hiddenSuggestions === 1 ? 'πρόταση' : 'προτάσεις'} σε άλλη κατηγορία — άλλαξε το segmented για να τις δεις.
          </p>
        )}

        <div className="mt-3 space-y-2">
          {/* Η κατηγορία δαπάνης είναι ΤΟ κλειδί για να βρεθεί η σωστή χρεοπίστωση:
              χωρίς αυτήν η λίστα είναι εκατοντάδες κωδικοί σε μία σειρά. */}
          {category === 'lineitem' && (
            <div>
              <label htmlFor="lineitem-category" className="text-caption font-medium text-muted-foreground">
                Κατηγορία δαπάνης
              </label>
              <select
                id="lineitem-category"
                value={lineCategory ?? ''}
                disabled={locked || lineCategories.length === 0}
                onChange={(e) => onLineCategory(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-input bg-background px-2.5 text-[length:var(--fs-13)]"
              >
                <option value="">Όλες οι κατηγορίες</option>
                {lineCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              {lineCategories.length === 0 && (
                <p className="mt-1 text-caption text-muted-foreground">
                  Δεν έχουν συγχρονιστεί κατηγορίες δαπανών — Είδη → «Κατηγορίες δαπανών» → «Συγχρονισμός από SoftOne».
                </p>
              )}
            </div>
          )}
          {/* Χωρίς κατηγορία δεν ξέρουμε ΠΟΙΟ μητρώο να ψάξουμε: το λέμε αντί να ψάξουμε λάθος. */}
          {category == null ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-neutral-6 px-3 py-2 text-body-sm text-muted-foreground">
              <FiInfo aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Διάλεξε κατηγορία για να ψάξεις στο αντίστοιχο μητρώο ή να δημιουργήσεις νέα εγγραφή.
            </p>
          ) : (
          <RegistrySearch
            kind={category}
            disabled={locked}
            id={`registry-${category}`}
            category={lineCategory}
            label={category === 'lineitem' ? 'Αναζήτηση χρεοπίστωσης…' : 'Άλλο είδος/έξοδο…'}
            onPick={(p) => onMatch(
              p.kind === 'expense' ? { expn: p.id } : p.kind === 'lineitem' ? { lin: p.id } : { mtrl: p.id },
              p.kind === 'service',
            )}
          />
          )}
        </div>
      </section>

      {/* ── Αναλυτική γραμμής ───────────────────────────────────────── */}
      <section className="px-4 py-3">
        <h3 className="mb-1.5 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          Αναλυτική γραμμής
        </h3>
        <p className="mb-2 text-caption text-muted-foreground">
          Προαιρετικά — δεν εμποδίζουν ποτέ την καταχώριση. Ό,τι επιβεβαιώσεις θα{' '}
          <strong>θυμάται</strong> για την ίδια περιγραφή την επόμενη φορά.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <AnalyticsPicker
            id="an-costcntr" kind="costcenters" label="Κέντρο κόστους"
            value={analytics.costCntr} disabled={locked || analyticsSupported === false}
            onChange={(v) => onAnalytics({ ...analytics, costCntr: v })}
            note={analyticsSupported === false ? 'Η σειρά καταχωρεί σε «Ανάλυση εξόδων», που δεν έχει αναλυτική.' : undefined}
          />
          <AnalyticsPicker
            id="an-prjc" kind="projects" label="Έργο"
            value={analytics.prjc} disabled={locked || analyticsSupported === false}
            onChange={(v) => onAnalytics({ ...analytics, prjc: v })}
            trdr={group.trdr}
            scopeAll={projectScopeAll}
            onScopeAll={setProjectScopeAll}
          />
          <AnalyticsPicker
            id="an-prjcstage" kind="projectstages" label="Κατηγορία δραστηριότητας"
            value={analytics.prjcStage} disabled={locked || analyticsSupported === false}
            onChange={(v) => onAnalytics({ ...analytics, prjcStage: v })}
          />
        </div>
      </section>

      {/* ── Δημιουργία στο SoftOne ──────────────────────────────────── */}
      <section className="px-4 py-3">
        {category == null ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-neutral-6 px-3 py-2 text-body-sm text-muted-foreground">
            <FiInfo aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Η ομάδα δεν έχει κατηγορία: δεν προκύπτει από τα παραστατικά της αν πρόκειται για είδος,
            υπηρεσία, έξοδο ή χρεοπίστωση. Διάλεξε κατηγορία πιο πάνω ή πάτα «Πρόταση με AI».
          </p>
        ) : !canCreate ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-neutral-6 px-3 py-2 text-body-sm text-muted-foreground">
            <FiInfo aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Νέα χρεοπίστωση δημιουργείται μόνο μέσα στο SoftOne («Χρεοπιστώσεις»). Μετά τη δημιουργία,
            τρέξε «Συγχρονισμός από SoftOne» στη σελίδα Είδη για να εμφανιστεί εδώ.
          </p>
        ) : !creating ? (
          <div className="space-y-1.5">
            {/* ΑΝΟΙΓΕΙ φόρμα, δεν καταχωρεί: η ετικέτα το λέει ρητά και ονομάζει το μητρώο.
                Με «Δημιουργία στο SoftOne» εδώ, ο χρήστης νόμιζε ότι πατώντας το θα γραφόταν
                κάτι — και δεν έβρισκε ποτέ τα πεδία ΦΠΑ / μονάδας / κωδικού. */}
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => setCreating(true)}
              className="h-9 w-full cursor-pointer"
            >
              <FiPlus aria-hidden /> {NEW_ENTITY_LABEL[category]}
            </Button>
            <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
              <FiInfo aria-hidden className="mt-0.5 size-3 shrink-0" />
              Ανοίγει φόρμα με κωδικό, ΦΠΑ και μονάδα. Δεν καταχωρείται τίποτα μέχρι να την υποβάλεις.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
              {NEW_ENTITY_LABEL[category]} — νέα εγγραφή μητρώου
            </h3>

            <Field id="ni-name" label="Περιγραφή" required error={touched.name ? errors.name : null}>
              <Input
                id="ni-name" value={form.name} disabled={locked}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                aria-invalid={touched.name && !!errors.name}
                className="h-9 text-[length:var(--fs-13)]"
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              {/* Ο κωδικός είναι ΠΡΟΤΑΣΗ, όχι κλειδαριά: το chip λέει ποιος κανόνας τον έδωσε
                  και το πεδίο μένει ανοιχτό. Το μήνυμα του ίδιου του SoftOne υπερισχύει. */}
              <Field
                id="ni-code" label="Κωδικός" required
                error={erpCodeError ?? (touched.code ? errors.code : null)}
                hint={codeHint(category, codeProposal, codeBusy)}
              >
                <div className="flex items-center gap-2">
                  <Input
                    id="ni-code" ref={codeRef} value={form.code} disabled={locked}
                    onChange={(e) => set('code', e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, code: true }))}
                    aria-invalid={!!erpCodeError || (touched.code && !!errors.code)}
                    className="h-9 flex-1 font-mono text-[length:var(--fs-13)]"
                  />
                  {isProposedCode && codeChip && (
                    <span
                      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[length:var(--fs-11)] font-medium"
                      style={{ backgroundColor: '#EAF4FC', color: '#0078D4' }}
                    >
                      {codeChip}
                    </span>
                  )}
                </div>
                {/* Μετά από άρνηση του SoftOne: ο ΝΕΟΣ προτεινόμενος, με ρητή αποδοχή. */}
                {codeOffer && codeOffer !== form.code.trim() && (
                  <>
                    <Button
                      type="button" variant="outline" size="sm"
                      className="h-7 w-fit cursor-pointer"
                      onClick={() => { set('code', codeOffer); lastProposal.current = codeOffer; }}
                    >
                      <FiRefreshCw aria-hidden className="size-3" /> Χρήση του {codeOffer}
                    </Button>
                    {/* Η ίδια επιφύλαξη με την αρχική πρόταση: καθρέφτης ≠ βεβαιότητα. */}
                    {codeOfferStale && (
                      <p className="text-caption text-muted-foreground">
                        Η πρόταση βγήκε από τον τοπικό καθρέφτη — το SoftOne δεν απάντησε, μπορεί
                        να έχει πιαστεί κι αυτός.
                      </p>
                    )}
                  </>
                )}
              </Field>

              <Field id="ni-vat" label="ΦΠΑ" required error={touched.vat ? errors.vat : null}>
                <select
                  id="ni-vat" value={form.vat} disabled={locked}
                  onChange={(e) => set('vat', e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, vat: true }))}
                  aria-invalid={touched.vat && !!errors.vat}
                  className="h-9 w-full cursor-pointer rounded-md border border-border bg-background px-2 text-[length:var(--fs-13)] outline-none focus-visible:border-sisyphus-500 focus-visible:ring-2 focus-visible:ring-sisyphus-100"
                >
                  <option value="">— επιλογή —</option>
                  {vats.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                </select>
              </Field>

              {needsUnit && (
                <Field id="ni-unit" label="Μονάδα" required error={touched.unit ? errors.unit : null}>
                  {units.length > 0 ? (
                    <select
                      id="ni-unit" value={form.unit} disabled={locked}
                      onChange={(e) => set('unit', e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, unit: true }))}
                      aria-invalid={touched.unit && !!errors.unit}
                      className="h-9 w-full cursor-pointer rounded-md border border-border bg-background px-2 text-[length:var(--fs-13)] outline-none focus-visible:border-sisyphus-500 focus-visible:ring-2 focus-visible:ring-sisyphus-100"
                    >
                      <option value="">— επιλογή —</option>
                      {units.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                    </select>
                  ) : (
                    <Input
                      id="ni-unit" value={form.unit} disabled={locked} placeholder="ΤΕΜ"
                      onChange={(e) => set('unit', e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, unit: true }))}
                      aria-invalid={touched.unit && !!errors.unit}
                      className="h-9 text-[length:var(--fs-13)]"
                    />
                  )}
                </Field>
              )}

              {needsUnit && (
                <Field
                  id="ni-price" label="Τιμή χονδρικής (προαιρετικό)" error={null}
                  hint="Καθαρή τιμή, χωρίς ΦΠΑ — όπως τη χρέωσε ο προμηθευτής. Γράφεται στο πεδίο «Χονδρικής». Τιμή λιανικής δεν στέλνεται: την ορίζει ο χρήστης στο SoftOne."
                >
                  <Input
                    id="ni-price" value={form.price} disabled={locked} inputMode="decimal" placeholder="0,00"
                    onChange={(e) => set('price', e.target.value)}
                    className="h-9 text-right text-[length:var(--fs-13)] tabular-nums"
                  />
                </Field>
              )}

            </div>

            {/* ── Ομάδα & εμπορική κατηγορία (μόνο για είδος/υπηρεσία → object ITEM) ── */}
            {needsUnit && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field
                  id="ni-group" label="Ομάδα (προαιρετικό)" error={null}
                  hint="Νέα ομάδα δημιουργείται μόνο μέσα στο SoftOne — το Web Service δεν τη γράφει."
                >
                  <select
                    id="ni-group" value={form.itemGroup} disabled={locked}
                    onChange={(e) => set('itemGroup', e.target.value)}
                    className="h-9 w-full cursor-pointer rounded-md border border-border bg-background px-2 text-[length:var(--fs-13)] outline-none focus-visible:border-sisyphus-500 focus-visible:ring-2 focus-visible:ring-sisyphus-100"
                  >
                    <option value="">— καμία —</option>
                    {itemGroups.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
                  </select>
                </Field>

                <Field id="ni-cat" label="Εμπορική κατηγορία (προαιρετικό)" error={null}>
                  <div className="flex items-center gap-2">
                    <select
                      id="ni-cat" value={form.itemCategory} disabled={locked}
                      onChange={(e) => set('itemCategory', e.target.value)}
                      className="h-9 flex-1 cursor-pointer rounded-md border border-border bg-background px-2 text-[length:var(--fs-13)] outline-none focus-visible:border-sisyphus-500 focus-visible:ring-2 focus-visible:ring-sisyphus-100"
                    >
                      <option value="">— καμία —</option>
                      {itemCategories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                    <Button
                      type="button" variant="outline" size="sm"
                      className="h-9 shrink-0 cursor-pointer"
                      disabled={locked || newCat != null}
                      onClick={() => { setNewCat({ name: '', code: '' }); setCatError(null); }}
                    >
                      <FiPlus aria-hidden className="size-3.5" /> Νέα
                    </Button>
                  </div>
                </Field>
              </div>
            )}

            {/* Η δημιουργία κατηγορίας γράφει ΠΡΑΓΜΑΤΙΚΑ στο SoftOne (object ITECATEGORY) και
                επιβεβαιώνεται με ανάγνωση πίσω: «success» χωρίς γραμμή δεν μετράει. */}
            {needsUnit && newCat && (
              <div className="grid gap-2 rounded-lg border border-border bg-neutral-4 px-2.5 py-2">
                <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                  Νέα εμπορική κατηγορία
                </p>
                <Field id="ni-newcat-name" label="Περιγραφή" required error={null}>
                  <Input
                    id="ni-newcat-name" value={newCat.name} disabled={catBusy}
                    onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                    className="h-9 text-[length:var(--fs-13)]"
                  />
                </Field>
                <Field
                  id="ni-newcat-code" label="Σύντμηση (προαιρετικό)" error={null}
                  hint="Κενό ⇒ παράγεται από την περιγραφή και ελέγχεται ότι είναι ελεύθερη."
                >
                  <Input
                    id="ni-newcat-code" value={newCat.code} disabled={catBusy}
                    onChange={(e) => setNewCat({ ...newCat, code: e.target.value })}
                    className="h-9 font-mono text-[length:var(--fs-13)]"
                  />
                </Field>
                {catError && (
                  <p className="flex items-center gap-1 text-caption text-destructive">
                    <FiAlertCircle aria-hidden className="size-3" /> {catError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={catBusy} onClick={() => void submitCategory()} className="h-8 cursor-pointer">
                    {catBusy ? <FiLoader aria-hidden className="animate-spin motion-reduce:animate-none" /> : <FiCheck aria-hidden />}
                    Δημιουργία κατηγορίας
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={catBusy} onClick={() => setNewCat(null)} className="h-8 cursor-pointer">
                    Άκυρο
                  </Button>
                </div>
              </div>
            )}

            <details
              open={dryOpen}
              className="rounded-lg border border-border bg-neutral-4 px-2.5 py-1.5"
              onToggle={(e) => setDryOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-caption font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500">
                Προεπισκόπηση setData (dry-run)
              </summary>
              {dryError ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-caption text-danger-500">
                  <FiAlertTriangle aria-hidden className="size-3.5" /> {dryError}
                </p>
              ) : dryLoading && dryPayload == null ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-caption text-muted-foreground">
                  <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> Προετοιμασία…
                </p>
              ) : dryPayload != null ? (
                <>
                  <pre className="mt-1.5 max-h-56 overflow-auto rounded-md bg-[#0E1626] p-2.5 font-mono text-[length:var(--fs-11)] leading-relaxed text-[#d6e2f5]">
                    {JSON.stringify(dryPayload, null, 2)}
                  </pre>
                  {dryLoading && (
                    <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
                      <FiLoader aria-hidden className="size-3 animate-spin motion-reduce:animate-none" /> Ενημέρωση…
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1.5 flex items-center gap-1.5 text-caption text-muted-foreground">
                  <FiAlertCircle aria-hidden className="size-3.5" /> Συμπλήρωσε τα υποχρεωτικά πεδία για προεπισκόπηση.
                </p>
              )}
            </details>

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={locked} onClick={() => void submitCreate()} className="h-9 cursor-pointer">
                {busy ? <FiLoader aria-hidden className="animate-spin motion-reduce:animate-none" /> : <FiCheck aria-hidden />}
                Δημιουργία στο SoftOne
              </Button>
              <Button
                type="button" variant="ghost" disabled={locked}
                onClick={() => { setCreating(false); setDryOpen(false); setDryPayload(null); setDryError(null); }}
                className="h-9 cursor-pointer"
              >
                Άκυρο
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
              <FiAlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Η δημιουργία γράφει πραγματικά στο SoftOne και αντιστοιχίζει αμέσως {lineLabel(group.lineCount)}.
            </p>
          </div>
        )}
      </section>

      {/* ── Παράλειψη ───────────────────────────────────────────────── */}
      <footer className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <p className="text-caption text-muted-foreground">
          {canManage ? (
            <>
              <kbd className="rounded-sm border border-border bg-neutral-0 px-1 font-sans">Enter</kbd> = πρώτη πρόταση
            </>
          ) : (
            'Χρειάζεται δικαίωμα «ocr.categorize».'
          )}
        </p>
        <Button
          type="button" variant="ghost" size="sm" disabled={locked}
          onClick={() => void onSkip()}
          className="cursor-pointer text-muted-foreground"
        >
          <FiSkipForward aria-hidden /> Παράλειψη
        </Button>
      </footer>
    </div>
  );
}

/** Ετικέτα + πεδίο + inline σφάλμα — ορατή ετικέτα παντού, ποτέ μόνο placeholder. */
function Field({
  id, label, required, error, hint, children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error: string | null;
  /** Επεξήγηση κάτω από το πεδίο — κρύβεται όσο υπάρχει σφάλμα (ένα μήνυμα τη φορά). */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-caption font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-caption text-destructive">
          <FiAlertCircle aria-hidden className="size-3" /> {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Μια πρόταση: κωδικός, όνομα, λόγος, μπάρα σκορ, κουμπί αντιστοίχισης. */
function SuggestionRow({
  suggestion: s, first, disabled, onMatch,
}: {
  suggestion: QueueSuggestion;
  first: boolean;
  /** Τρέχει ενέργεια ή λείπει το δικαίωμα `ocr.categorize`. */
  disabled: boolean;
  onMatch: (target: { mtrl?: number; expn?: number; lin?: number }, isService: boolean) => void | Promise<void>;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, s.score)) * 100);
  const meta = CATEGORY_META[s.kind];
  return (
    <li
      className={cn(
        'rounded-lg border px-2.5 py-2',
        first ? 'border-sisyphus-500 bg-sisyphus-50' : 'border-border bg-card',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[length:var(--fs-13)] font-medium text-foreground">{s.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-caption text-muted-foreground">
            <span className="font-mono">{s.code}</span>
            <span aria-hidden>·</span>
            <span
              className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium"
              style={{ backgroundColor: meta.bg, color: meta.fg }}
            >
              {KIND_ICON[s.kind]} {meta.label}
            </span>
            <span aria-hidden>·</span>
            <span>{REASON[s.by] ?? 'άλλο'}</span>
          </p>
          {/* Ο χαρακτηρισμός myDATA έρχεται από το ΜΗΤΡΩΟ στο SoftOne — δεν τον ορίζει η εφαρμογή
              και δεν αλλάζει ανά γραμμή. Λάθος χαρακτηρισμός διορθώνεται στο ίδιο το ERP. */}
          <p className="mt-0.5 text-caption" style={{ color: s.noClass ? '#B45309' : '#047857' }}>
            {s.noClass
              ? 'Χαρακτηρισμός myDATA: κανένας στο μητρώο — θα καταχωριστεί αχαρακτήριστη'
              : `Χαρακτηρισμός myDATA: ${s.myData}`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={first ? 'default' : 'outline'}
          disabled={disabled}
          onClick={() => void onMatch(
            s.lin != null ? { lin: s.lin } : s.expn != null ? { expn: s.expn } : { mtrl: s.mtrl ?? undefined },
            s.kind === 'service',
          )}
          className="h-8 shrink-0 cursor-pointer"
        >
          {first && <FiCornerDownLeft aria-hidden />} Αντιστοίχιση
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div
          role="progressbar"
          aria-label={`Βαθμός ομοιότητας ${pct}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-8"
        >
          <div className="h-full rounded-full bg-sisyphus-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-9 shrink-0 text-right text-caption tabular-nums text-muted-foreground">{pct} %</span>
      </div>
    </li>
  );
}
