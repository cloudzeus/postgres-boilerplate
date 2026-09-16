'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  FiAlertTriangle, FiCheck, FiCheckCircle, FiCopy, FiCreditCard, FiExternalLink, FiEyeOff,
  FiGlobe, FiInfo, FiLink2, FiLoader, FiMapPin, FiPlusCircle, FiRefreshCw, FiUploadCloud, FiX,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { TraderSearch } from '@/components/admin/trader-search';
import { cn } from '@/lib/utils';
import { COUNTRY_NAMES_EL, countryLabel } from '@/lib/countries';
import { VAT_COUNTRY_CODES, viesPrefix } from '@/lib/ocr/validate';
import { applyVatPrefix, vatPrefixFor } from '@/lib/ocr/vat-prefix';
import { validCoords, formatCoords } from '@/lib/coords';
import { planRegistryFill, registryValue, type FieldSource } from '@/lib/ocr/registry-fill';
import type { TraderCodeSamples, TraderGroup } from '@/lib/ocr/queues';

export interface TaxOffice { code: string; name: string }

/** Τα στοιχεία που επιστρέφει το `POST /api/admin/ocr/supplier-preview`. */
interface AadePreview {
  afm: string | null;
  name: string;
  doyDescr: string | null;
  doyCode: string | null;
  profession: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  legalForm: string | null;
  isActive: boolean;
}

/** Ό,τι επιστρέφει το `GET /api/admin/vies` (ξένοι εκδότες — αντί ΑΑΔΕ). */
interface ViesResult {
  /** `true` έγκυρο, `false` άκυρο, `null` δεν απάντησε το VIES. */
  valid: boolean | null;
  name: string | null;
  address: string | null;
  error?: string;
}

/** Ό,τι επιστρέφει το `POST /api/admin/geocode`. */
interface GeoParts {
  /** `null` όταν ο πάροχος δεν αναγνώρισε τη χώρα. */
  countryCode: string | null;
  country: string;
  city: string | null;
  zip: string | null;
  formatted: string;
  /** Συντεταγμένες — `null` όταν ο πάροχος δεν έδωσε σημείο. Ποτέ 0 για «άγνωστο». */
  lat: number | null;
  lng: number | null;
  /** `true` = ήρθε από τη μνήμη του server, χωρίς κλήση (και χρέωση) στον πάροχο. */
  cached?: boolean;
  /** `true` = ο πάροχος δεν απάντησε· δεν είναι «δεν βρέθηκε» και αξίζει νέα προσπάθεια. */
  unavailable?: boolean;
}

/** Οι συντεταγμένες που θα γραφούν στο SoftOne — δεν ζουν στο `FormState`: δεν πληκτρολογούνται. */
type Coords = { lat: number; lng: number } | null;

type TraderKind = 'supplier' | 'creditor' | 'debtor';

/** Επιλογές χώρας της φόρμας: όσες αναγνωρίζει το VAT normalization + «Άλλη». */
const COUNTRY_ITEMS = [
  { value: '', label: 'Άλλη / καμία' },
  { value: 'GR', label: countryLabel('GR') },
  // Το «XI» είναι πρόθεμα VAT, όχι χώρα: η Β. Ιρλανδία δηλώνεται ως GB.
  ...[...VAT_COUNTRY_CODES].filter((c) => c !== 'XI')
    .map((c) => ({ value: c as string, label: countryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'el')),
];

const KIND_LABEL: Record<TraderKind, string> = {
  supplier: 'Προμηθευτής', creditor: 'Πιστωτής', debtor: 'Χρεώστης',
};
const KINDS: readonly TraderKind[] = ['supplier', 'creditor', 'debtor'];

/**
 * Τύποι για τους οποίους αυτή η εγκατάσταση ΑΠΑΙΤΕΙ κωδικό — δηλαδή όλοι.
 *
 * Επιβεβαιωμένο ζωντανά (2026-09-16): `POST …/create` για **πιστωτή** χωρίς κωδικό
 * γύρισε το μήνυμα του ίδιου του SoftOne «Δεν έχετε συμπληρώσει το πεδίο 'Κωδικός'»
 * και δεν δημιουργήθηκε τίποτα. Το ίδιο λέει και το schema του object: το `CODE` του
 * `TRDR` είναι `required: true`, `readOnly: false`, `calculated: false`, με default
 * `""` σε **SUPPLIER**, **CREDITOR** και **CUSTOMER** — και ο DEBTOR μοιράζεται τον
 * ίδιο `TRDR`. Δεν έχει νόημα να στείλουμε προμηθευτή ή χρεώστη σε ένα ταξίδι μέχρι
 * τον ERP για να γυρίσει με το ίδιο 422: το ζητάμε από την αρχή, στη φόρμα.
 */
const CODE_REQUIRED_KINDS: readonly TraderKind[] = ['supplier', 'creditor', 'debtor'];

/** Ό,τι επιστρέφει το `GET /api/admin/ocr/new-traders/next-code`. */
interface CodeSuggestion {
  /** Ο επόμενος ελεύθερος κωδικός — `null` όταν δεν υπάρχει βάση για πρόταση. */
  code: string | null;
  source: 'pattern' | 'mask' | 'none';
  prefix?: string;
  width?: number;
  /** Πόσοι κωδικοί του τύπου λήφθηκαν υπόψη. */
  taken: number;
  /** `true` = το SoftOne δεν απάντησε· η πρόταση βγήκε από τον τοπικό καθρέφτη. */
  stale: boolean;
}

/**
 * Τι λέει το πεδίο «Κωδικός». Καμία υπόσχεση που δεν μπορούμε να στηρίξουμε: το
 * SoftOne ΔΕΝ αποδίδει κωδικό μόνο του σε αυτή την εγκατάσταση (`CODE` = required,
 * calculated: false, χωρίς default) — τον προτείνουμε εμείς από ό,τι ήδη υπάρχει.
 */
function codeHint(kind: TraderKind, s: CodeSuggestion | null, busy: boolean): string {
  if (busy) return 'Αναζήτηση επόμενου ελεύθερου κωδικού…';
  const of = KIND_GENITIVE[kind];
  if (!s) return `Το SoftOne δεν αποδίδει κωδικό μόνο του — συμπλήρωσε τον κωδικό ${of}.`;
  const stale = s.stale ? ' (από τον τοπικό καθρέφτη — το SoftOne δεν απάντησε, μπορεί να έχει πιαστεί)' : '';
  if (s.source === 'pattern') {
    return `Προτεινόμενος: ο επόμενος ελεύθερος μετά τους ${s.taken} υπάρχοντες κωδικούς ${of}. Άλλαξέ τον ελεύθερα${stale}.`;
  }
  if (s.source === 'mask') {
    return `Δεν υπάρχει ακόμη κανένας κωδικός ${of} — η πρόταση έρχεται από τη μάσκα των Ρυθμίσεων${stale}.`;
  }
  return `Δεν βρέθηκε κανένας υπάρχων κωδικός ${of} ούτε μάσκα: χρειάζεται ο κωδικός του λογιστή (Ρυθμίσεις → Διασυνδέσεις → «Μάσκα κωδικού»).`;
}

/** Ετικέτα γενικής για το δείγμα κωδικών («κωδικοί πιστωτών»). */
const KIND_GENITIVE: Record<TraderKind, string> = {
  supplier: 'προμηθευτών', creditor: 'πιστωτών', debtor: 'χρεωστών',
};
/** Ετικέτα αιτιατικής («υποχρεωτικός για πιστωτή»). */
const KIND_ACCUSATIVE: Record<TraderKind, string> = {
  supplier: 'προμηθευτή', creditor: 'πιστωτή', debtor: 'χρεώστη',
};
/** Χρώματα chip ανά τύπο (inline hex — ο JIT δεν κρατά δυναμικές κλάσεις). */
export const KIND_COLORS: Record<TraderKind, { bg: string; fg: string }> = {
  supplier: { bg: '#EAF4FC', fg: '#0078D4' },
  creditor: { bg: '#F3E8FF', fg: '#6D28D9' },
  debtor: { bg: '#FEF3C7', fg: '#B45309' },
};

/** Σε ποια κατάσταση βρίσκεται η άντληση στοιχείων από την ΑΑΔΕ. */
type AadeState = 'loading' | 'ready' | 'missing' | 'invalid' | 'forbidden' | 'error' | 'foreign';

/** Τι λέμε στον χρήστη ανά κατάσταση — μόνο το `error` έχει νόημα να ξαναδοκιμαστεί. */
const AADE_MESSAGE: Record<Exclude<AadeState, 'loading' | 'ready' | 'foreign'>, string> = {
  missing: 'Το ΑΦΜ δεν βρέθηκε στην ΑΑΔΕ — συμπλήρωσε τα στοιχεία χειροκίνητα.',
  invalid: 'Μη έγκυρο ΑΦΜ (9 ψηφία) — συμπλήρωσε τα στοιχεία χειροκίνητα.',
  forbidden: 'Χρειάζεται δικαίωμα «ocr.categorize».',
  error: 'Η ΑΑΔΕ δεν απάντησε.',
};

export function fmtEuro(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n);
}
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('el-GR');
}

/** Κανονικοποίηση ελληνικού κειμένου για ταίριασμα Δ.Ο.Υ. (χωρίς τόνους/σημεία). */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-ZΑ-Ω0-9]+/g, ' ')
    .trim();
}

/** Ο κωδικός Δ.Ο.Υ. που αντιστοιχεί σε μια περιγραφή — αλλιώς `''`. */
function matchDoy(descr: string | null, offices: TaxOffice[]): string {
  const target = norm(descr ?? '');
  if (!target) return '';
  const exact = offices.find((o) => norm(o.name) === target);
  if (exact) return exact.code;
  const partial = offices.find((o) => norm(o.name).includes(target) || target.includes(norm(o.name)));
  return partial?.code ?? '';
}

interface FormState {
  kind: TraderKind;
  code: string;
  name: string;
  /** ISO-2 χώρα έδρας· κενό = «Άλλη» (το SoftOne κρατά την προεπιλογή του). */
  country: string;
  doyCode: string;
  profession: string;
  address: string;
  zip: string;
  city: string;
  phone: string;
  email: string;
}

type FieldKey = keyof Omit<FormState, 'kind'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[\d+()\s./-]{5,}$/;

/** Έλεγχοι πεδίων — τρέχουν σε blur και πριν την υποβολή (spec §2, ui-ux-pro-max). */
function validate(f: FormState): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  if (!f.name.trim()) e.name = 'Η επωνυμία είναι υποχρεωτική.';
  else if (f.name.trim().length > 200) e.name = 'Έως 200 χαρακτήρες.';
  if (f.code.trim().length > 30) e.code = 'Έως 30 χαρακτήρες.';
  // Δεν εφευρίσκουμε κωδικό· απλώς δεν στέλνουμε αίτημα που ξέρουμε ότι θα απορριφθεί.
  else if (!f.code.trim() && CODE_REQUIRED_KINDS.includes(f.kind)) {
    e.code = `Ο κωδικός είναι υποχρεωτικός για ${KIND_ACCUSATIVE[f.kind]} — το SoftOne δεν τον αποδίδει μόνο του εδώ.`;
  }
  // Ο κανόνας «5 ψηφία» είναι ΕΛΛΗΝΙΚΟΣ: ένας ξένος Τ.Κ. (π.χ. «EC1A 1BB») δεν τον περνά.
  const zip = f.zip.trim();
  if (zip) {
    const greekZip = !f.country || f.country === 'GR';
    if (greekZip && !/^\d{5}$/.test(zip)) e.zip = 'Ταχυδρομικός κώδικας 5 ψηφίων.';
    else if (!greekZip && zip.length > 20) e.zip = 'Έως 20 χαρακτήρες.';
  }
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Μη έγκυρη διεύθυνση email.';
  if (f.phone.trim() && !PHONE_RE.test(f.phone.trim())) e.phone = 'Μη έγκυρος αριθμός τηλεφώνου.';
  if (f.profession.trim().length > 200) e.profession = 'Έως 200 χαρακτήρες.';
  if (f.address.trim().length > 200) e.address = 'Έως 200 χαρακτήρες.';
  if (f.city.trim().length > 100) e.city = 'Έως 100 χαρακτήρες.';
  return e;
}

export interface TraderPanelProps {
  group: TraderGroup;
  taxOffices: TaxOffice[];
  /** Υπάρχοντες κωδικοί ανά τύπο (τοπικός καθρέφτης) — δείγμα μορφής, όχι πρόταση. */
  codeSamples: TraderCodeSamples;
  canManage: boolean;
  /** Μετά από δημιουργία ή σύνδεση — ο εκδότης φεύγει από την ουρά. */
  onResolved: (afm: string, message: string) => void;
  /** Μετά από «Αγνόηση» — ο γονέας δείχνει toast με «Αναίρεση». */
  onIgnored: (afm: string, reason: string | null) => void;
  /** Η κύρια ενέργεια του panel, ώστε το Enter της ουράς να τη ζητά. */
  primaryRef: React.RefObject<(() => void) | null>;
}

/**
 * Λεπτομέρεια ενός εκδότη: στοιχεία ΑΑΔΕ με σύγκριση, φόρμα δημιουργίας
 * προμηθευτή/πιστωτή, παραστατικά της ομάδας και οι τρεις ενέργειες
 * (δημιουργία / σύνδεση σε υπάρχοντα / αγνόηση) — χωρίς modal (spec §2, §4).
 */
export function TraderPanel({
  group, taxOffices, codeSamples, canManage, onResolved, onIgnored, primaryRef,
}: TraderPanelProps) {
  const [form, setForm] = React.useState<FormState>(() => seed(group, taxOffices));
  const [touched, setTouched] = React.useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState<null | 'create' | 'link' | 'ignore'>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const [aade, setAade] = React.useState<AadePreview | null>(null);
  const [aadeState, setAadeState] = React.useState<AadeState>('loading');
  const [aadeReload, setAadeReload] = React.useState(0);

  // Ξένος εκδότης: VIES αντί ΑΑΔΕ + ανάλυση διεύθυνσης.
  const [vies, setVies] = React.useState<ViesResult | null>(null);
  const [viesBusy, setViesBusy] = React.useState(false);
  const [geo, setGeo] = React.useState<GeoParts | null>(null);
  const [geoBusy, setGeoBusy] = React.useState(false);
  const [geoMiss, setGeoMiss] = React.useState(false);
  /** `true` = ο πάροχος δεν απάντησε (δίκτυο/quota). ΔΕΝ σημαίνει «δεν βρέθηκε». */
  const [geoDown, setGeoDown] = React.useState(false);
  /** Συντεταγμένες που θα σταλούν στο SoftOne. `null` ⇒ τα δύο πεδία παραλείπονται. */
  const [coords, setCoords] = React.useState<Coords>(null);
  /** Το ΑΥΤΟΥΣΙΟ μήνυμα του SoftOne όταν απαίτησε ή απέρριψε κωδικό — κολλάει στο πεδίο. */
  const [erpCodeError, setErpCodeError] = React.useState<string | null>(null);
  /** Κωδικός που προτείνει ο server ΜΕΤΑ από άρνηση — ο χρήστης τον δέχεται ρητά. */
  const [codeOffer, setCodeOffer] = React.useState<string | null>(null);
  /** Ο επόμενος ελεύθερος κωδικός για τον επιλεγμένο τύπο. */
  const [codeSuggestion, setCodeSuggestion] = React.useState<CodeSuggestion | null>(null);
  const [codeBusy, setCodeBusy] = React.useState(false);
  /** Η τελευταία πρόταση που γράψαμε εμείς — για να ξέρουμε τι επιτρέπεται να αλλάξουμε. */
  const lastProposal = React.useRef<string>('');
  const kindRefs = React.useRef<Partial<Record<TraderKind, HTMLButtonElement | null>>>({});
  const codeRef = React.useRef<HTMLInputElement | null>(null);
  /** Ποια διεύθυνση έχει ήδη ζητηθεί αυτόματα — καμία επανάληψη σε re-render. */
  const autoGeo = React.useRef<string | null>(null);

  /**
   * Πεδία που **κατέχει ο χρήστης**: ό,τι πληκτρολόγησε ή επέλεξε ρητά. Δεν τα ξαναγράφει ποτέ
   * το μητρώο. Δηλώνεται ΡΗΤΑ και δεν συμπεραίνεται από σύγκριση τιμών — δύο πηγές μπορεί
   * κάλλιστα να συμφωνούν κατά λέξη.
   */
  const [userOwned, setUserOwned] = React.useState<Set<FieldKey>>(() => new Set());
  /** Η προέλευση όσων πεδίων κρατούν αυτή τη στιγμή τιμή μητρώου — για τη σήμανση στο UI. */
  const [fieldSource, setFieldSource] = React.useState<Partial<Record<FieldKey, FieldSource>>>({});

  const [showSearch, setShowSearch] = React.useState(false);
  const [ignoring, setIgnoring] = React.useState(false);
  const [reason, setReason] = React.useState('');

  const [dryOpen, setDryOpen] = React.useState(false);
  const [dryPayload, setDryPayload] = React.useState<string | null>(null);
  const [dryError, setDryError] = React.useState<string | null>(null);

  // Κάθε εκδότης ξεκινά καθαρός.
  React.useEffect(() => {
    setForm(seed(group, taxOffices));
    setTouched({}); setSubmitted(false); setFailure(null); setBusy(null);
    setShowSearch(false); setIgnoring(false); setReason('');
    setDryOpen(false); setDryPayload(null); setDryError(null);
    setVies(null); setViesBusy(false);
    setGeo(null); setGeoBusy(false); setGeoMiss(false); setGeoDown(false);
    setCoords(null); setErpCodeError(null); setCodeOffer(null);
    setUserOwned(new Set()); setFieldSource({});
    lastProposal.current = '';
  }, [group, taxOffices]);

  // Μόλις ο χρήστης αγγίξει τον κωδικό (ή αλλάξει τύπο), το μήνυμα του ERP παύει να ισχύει.
  React.useEffect(() => { setErpCodeError(null); setCodeOffer(null); }, [form.code, form.kind]);

  /**
   * Ο **επόμενος ελεύθερος κωδικός** για τον επιλεγμένο τύπο, με φρέσκα δεδομένα από
   * το SoftOne (read-only `GetTable`). Ξανατρέχει σε κάθε αλλαγή τύπου: ένας πιστωτής
   * δεν κληρονομεί ποτέ την αρίθμηση των προμηθευτών.
   *
   * Η πρόταση ΔΕΝ κλειδώνει το πεδίο: γράφεται μόνο όταν αυτό είναι άδειο ή κρατά
   * ακόμη προηγούμενη πρόταση. Ό,τι πληκτρολόγησε ο χρήστης μένει ανέγγιχτο.
   */
  React.useEffect(() => {
    let ignore = false;
    setCodeBusy(true);
    fetch(`/api/admin/ocr/new-traders/next-code?kind=${form.kind}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CodeSuggestion | null) => {
        if (ignore) return;
        setCodeSuggestion(d);
        const proposal = d?.code ? String(d.code) : '';
        setForm((f) => {
          const cur = f.code.trim();
          if (cur !== '' && cur !== lastProposal.current) return f;
          lastProposal.current = proposal;
          return { ...f, code: proposal };
        });
      })
      .catch(() => { if (!ignore) setCodeSuggestion(null); })
      .finally(() => { if (!ignore) setCodeBusy(false); });
    return () => { ignore = true; };
  }, [group.afm, form.kind]);

  // Τα στοιχεία ΑΑΔΕ φορτώνονται αυτόματα για τον επιλεγμένο ΑΦΜ. ΟΧΙ όμως για
  // εκδότη εκτός Ελλάδας: το ελληνικό μητρώο δεν τον ξέρει — εκεί ρωτάμε VIES.
  React.useEffect(() => {
    let ignore = false;
    setAade(null);
    if (group.isForeign) { setAadeState('foreign'); return; }
    setAadeState('loading');
    fetch('/api/admin/ocr/supplier-preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afm: group.afm }),
    })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as (AadePreview & { error?: string }) | null;
        if (ignore) return;
        if (r.ok && d) { setAade(d); setAadeState('ready'); return; }
        // Ο κωδικός του route ξεχωρίζει «άκυρο ΑΦΜ» / «χωρίς δικαίωμα» / «δεν
        // βρέθηκε» από μια πραγματική αποτυχία της ΑΑΔΕ (μόνο αυτή ξαναδοκιμάζεται).
        if (r.status === 403 || r.status === 401) { setAadeState('forbidden'); return; }
        if (d?.error === 'invalid_afm') { setAadeState('invalid'); return; }
        if (d?.error === 'not_found' || r.status === 404) { setAadeState('missing'); return; }
        setAadeState('error');
      })
      .catch(() => { if (!ignore) setAadeState('error'); });
    return () => { ignore = true; };
  }, [group.afm, group.isForeign, aadeReload]);

  const errors = validate(form);
  // Το μήνυμα του ίδιου του SoftOne υπερισχύει: είναι η τελευταία λέξη για το πεδίο.
  const errorOf = (k: FieldKey) =>
    (k === 'code' && erpCodeError) ? erpCodeError : ((touched[k] || submitted) ? errors[k] : undefined);
  /**
   * Αλλαγή πεδίου **από τον χρήστη** (πληκτρολόγηση, «Χρήση», «Εφαρμογή», «Επαναφορά»): το πεδίο
   * γίνεται δικό του και το μητρώο δεν το ακουμπά ξανά.
   */
  const set = (k: FieldKey, v: string, source: FieldSource | null = null) => {
    setForm((f) => ({ ...f, [k]: v }));
    setUserOwned((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
    setFieldSource((prev) => {
      if (prev[k] === source) return prev;
      const next = { ...prev };
      if (source) next[k] = source; else delete next[k];
      return next;
    });
  };
  const blur = (k: FieldKey) => setTouched((t) => ({ ...t, [k]: true }));
  /** Κοινά props πεδίου: τιμή, blur-validation και σύνδεση με το μήνυμα σφάλματος. */
  const bind = (k: FieldKey, id: string) => ({
    id,
    value: form[k],
    'aria-invalid': !!errorOf(k),
    'aria-describedby': errorOf(k) ? `${id}-err` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
    onBlur: () => blur(k),
  });

  /**
   * **Αυτόματη εφαρμογή του μητρώου.** Μόλις απαντήσει η ΑΑΔΕ (ή το VIES για ξένο εκδότη), τα
   * πεδία της φόρμας γεμίζουν από εκεί — χωρίς κλικ ανά πεδίο.
   *
   * Δεν είναι σιωπηλή αντικατάσταση: κάθε πεδίο που γράφεται σημαδεύεται με την προέλευσή του,
   * ο πίνακας σύγκρισης μένει ορατός, και δίπλα σε κάθε πεδίο υπάρχει «Επαναφορά τιμής
   * παραστατικού». Ό,τι έχει αγγίξει ο χρήστης (`userOwned`) ΔΕΝ ξαναγράφεται ποτέ.
   *
   * ΑΦΜ που δεν βρέθηκε, ανενεργό, ή υπηρεσία που δεν απάντησε: **τίποτα δεν γράφεται και
   * τίποτα δεν σβήνεται** — οι τιμές του OCR μένουν στη θέση τους (το `planRegistryFill`
   * αγνοεί κενές τιμές μητρώου).
   */
  React.useEffect(() => {
    if (aadeState !== 'ready' || !aade) return;
    const plan = planRegistryFill<FieldKey>({
      userOwned,
      registry: {
        name: aade.name,
        // Η Δ.Ο.Υ. γράφεται ως ΚΩΔΙΚΟΣ SoftOne: ό,τι έδωσε η ΑΑΔΕ, αλλιώς ταίριασμα περιγραφής.
        doyCode: aade.doyCode || matchDoy(aade.doyDescr ?? null, taxOffices) || null,
        profession: aade.profession,
        address: aade.address,
        zip: aade.zip,
        city: aade.city,
      },
    });
    if (plan.applied.length === 0) return;
    setForm((f) => ({ ...f, ...plan.values }));
    setFieldSource((prev) => {
      const next = { ...prev };
      for (const k of plan.applied) next[k] = 'aade';
      return next;
    });
    // `userOwned` ΔΕΝ μπαίνει στα deps: η εφαρμογή τρέχει όταν έρθει το μητρώο, όχι κάθε φορά
    // που ο χρήστης αγγίζει ένα πεδίο (κάτι που θα ξαναέγραφε τα υπόλοιπα κάτω από τα χέρια του).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aade, aadeState, taxOffices]);

  /** Το ίδιο για ξένο εκδότη: ό,τι επιστρέφει το VIES. Το «---» δεν είναι τιμή. */
  React.useEffect(() => {
    if (!vies || vies.valid !== true) return;
    const plan = planRegistryFill<FieldKey>({
      userOwned,
      registry: { name: vies.name, address: vies.address },
    });
    if (plan.applied.length === 0) return;
    setForm((f) => ({ ...f, ...plan.values }));
    setFieldSource((prev) => {
      const next = { ...prev };
      for (const k of plan.applied) next[k] = 'vies';
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vies]);

  /** Η τιμή που διάβασε το OCR για ένα πεδίο — `null` όταν το παραστατικό δεν έδινε τίποτα. */
  const ocrValueOf = (k: FieldKey): string | null => {
    if (k === 'name') return registryValue(group.name);
    if (k === 'profession') return registryValue(group.profession);
    if (k === 'address') return registryValue(group.address);
    // Δ.Ο.Υ.: το OCR δίνει ΠΕΡΙΓΡΑΦΗ· επαναφέρουμε τον κωδικό της, αν αναγνωρίζεται.
    if (k === 'doyCode') return matchDoy(group.doy ?? null, taxOffices) || null;
    // Τ.Κ. και πόλη δεν υπάρχουν καθόλου στην ομάδα: το OCR δίνει μόνο ελεύθερη διεύθυνση.
    return null;
  };

  /**
   * Η σήμανση προέλευσης κάτω από ένα πεδίο: από πού ήρθε η τιμή και πώς γυρνά πίσω σε αυτήν
   * του παραστατικού. Χωρίς αυτό, η αυτόματη εφαρμογή θα ήταν σιωπηλή αντικατάσταση.
   */
  const RegistryMark = ({ k }: { k: FieldKey }) => {
    const src = fieldSource[k];
    if (!src) return null;
    const ocr = ocrValueOf(k);
    const label = src === 'aade' ? 'από την ΑΑΔΕ' : 'από το VIES';
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: '#EAF4FC', color: '#0078D4' }}
        >
          {label}
        </span>
        {ocr && ocr !== form[k] && (
          <Button
            type="button" variant="ghost" size="xs"
            className="cursor-pointer"
            onClick={() => set(k, ocr, 'ocr')}
            title={ocr}
          >
            <FiRefreshCw aria-hidden className="size-3" /> Επαναφορά τιμής παραστατικού
          </Button>
        )}
      </div>
    );
  };

  const payload = () => ({
    kind: form.kind,
    name: form.name.trim(),
    code: form.code.trim() || null,
    country: form.country || null,
    // Δ.Ο.Υ. δεν υπάρχει για εκδότη εκτός Ελλάδας — δεν τη στέλνουμε καν.
    doyCode: (form.country && form.country !== 'GR' ? null : form.doyCode) || null,
    profession: form.profession.trim() || null,
    address: form.address.trim() || null,
    zip: form.zip.trim() || null,
    city: form.city.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    // Άγνωστο σημείο ⇒ `null` και στα δύο· το SoftOne δεν παίρνει ποτέ 0 για «δεν ξέρω».
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
  });

  const create = React.useCallback(async () => {
    if (!canManage || busy) return;
    setSubmitted(true);
    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setFailure('Διόρθωσε τα πεδία με σφάλμα και δοκίμασε ξανά.');
      return;
    }
    setFailure(null);
    setBusy('create');
    try {
      const res = await fetch(`/api/admin/ocr/new-traders/${group.afm}/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const d = await res.json().catch(() => null);
      // Το SoftOne ζήτησε κωδικό: σφάλμα ΠΕΔΙΟΥ, όχι banner. Δείχνουμε το δικό του
      // μήνυμα πάνω στο «Κωδικός» και εστιάζουμε εκεί — δεν συμπληρώνουμε εμείς τίποτα.
      if (res.status === 422 && d?.error === 'code_required') {
        setErpCodeError(String(d.message || 'Το SoftOne απαιτεί συμπληρωμένο κωδικό.'));
        setCodeOffer(d.suggestion ? String(d.suggestion) : null);
        setFailure(null);
        codeRef.current?.focus();
        return;
      }
      // Ο κωδικός πιάστηκε στο μεσοδιάστημα. ΚΑΜΙΑ αυτόματη επανάληψη: ο χρήστης
      // βλέπει τον νέο επόμενο ελεύθερο και πατά ο ίδιος ξανά «Δημιουργία».
      if (res.status === 409 && d?.error === 'code_taken') {
        setErpCodeError(String(d.message || 'Ο κωδικός υπάρχει ήδη στο SoftOne.'));
        setCodeOffer(d.suggestion ? String(d.suggestion) : null);
        setFailure(null);
        codeRef.current?.focus();
        return;
      }
      if (!res.ok || !d?.ok) {
        setFailure(d?.message ?? 'Η δημιουργία στο SoftOne απέτυχε.');
        return;
      }
      onResolved(
        group.afm,
        `Δημιουργήθηκε ${d.name}${d.code ? ` (κωδ. ${d.code})` : ''} — ενημερώθηκαν ${d.docsUpdated} παραστατικά`,
      );
    } catch {
      setFailure('Σφάλμα δικτύου — δοκίμασε ξανά.');
    } finally {
      setBusy(null);
    }
    // `payload` διαβάζει το τρέχον `form` — το useCallback ξαναχτίζεται μαζί του.
  }, [busy, canManage, form, group.afm, onResolved, payload]);

  // Enter στην ουρά = κύρια ενέργεια του panel (χωρίς dep array: πάντα το φρέσκο closure).
  React.useEffect(() => {
    primaryRef.current = create;
    return () => { primaryRef.current = null; };
  });

  const link = async (trdr: number, name: string) => {
    if (!canManage || busy) return;
    setFailure(null);
    setBusy('link');
    try {
      const res = await fetch(`/api/admin/ocr/new-traders/${group.afm}/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trdr, country: form.country || null }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setFailure(d?.message ?? 'Η σύνδεση απέτυχε.');
        return;
      }
      onResolved(group.afm, `Συνδέθηκε με ${d.name ?? name} — ενημερώθηκαν ${d.docsUpdated} παραστατικά`);
    } catch {
      setFailure('Σφάλμα δικτύου — δοκίμασε ξανά.');
    } finally {
      setBusy(null);
    }
  };

  const ignore = async () => {
    if (!canManage || busy) return;
    setFailure(null);
    setBusy('ignore');
    try {
      const res = await fetch(`/api/admin/ocr/new-traders/${group.afm}/ignore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) { setFailure('Η αγνόηση απέτυχε.'); return; }
      onIgnored(group.afm, reason.trim() || null);
    } catch {
      setFailure('Σφάλμα δικτύου — δοκίμασε ξανά.');
    } finally {
      setBusy(null);
    }
  };

  /** VIES lookup για ξένο ΑΦΜ — χειροκίνητο: η υπηρεσία είναι αργή και συχνά κάτω. */
  const runVies = async () => {
    if (viesBusy) return;
    setViesBusy(true);
    setVies(null);
    try {
      const res = await fetch(`/api/admin/vies?vat=${encodeURIComponent(group.afm)}`);
      const d = (await res.json().catch(() => null)) as ViesResult | null;
      setVies(d ?? { valid: null, name: null, address: null, error: 'vies_unreachable' });
    } catch {
      setVies({ valid: null, name: null, address: null, error: 'vies_unreachable' });
    } finally {
      setViesBusy(false);
    }
  };

  /**
   * Διεύθυνση → χώρα / πόλη / Τ.Κ. / συντεταγμένες. Δεν γράφει ΤΙΠΟΤΑ πάνω σε ό,τι
   * πληκτρολόγησε ο χρήστης: χώρα/πόλη/Τ.Κ. μένουν ΠΡΟΤΑΣΕΙΣ με «Εφαρμογή».
   *
   * ΠΡΟΤΕΡΑΙΟΤΗΤΑ ΑΝΑΜΕΣΑ ΣΤΙΣ ΔΥΟ ΑΥΤΟΜΑΤΕΣ ΠΗΓΕΣ (πόλη / Τ.Κ. / χώρα): **μόνο το μητρώο
   * (ΑΑΔΕ/VIES) εφαρμόζεται αυτόματα**· ο geocoder ποτέ. Έτσι δεν υπάρχει περίπτωση δύο
   * αυτόματες πηγές να διεκδικούν το ίδιο πεδίο. Ο geocoder είναι η ΜΟΝΗ πηγή για ξένους
   * εκδότες (όπου η ΑΑΔΕ δεν ισχύει) και για πόλη/Τ.Κ. που η ΑΑΔΕ δεν έδωσε — και εκεί
   * χρειάζεται ένα κλικ, το οποίο κάνει το πεδίο κτήμα του χρήστη.
   *
   * Εξαίρεση οι **συντεταγμένες**: δεν είναι πεδίο που γράφει άνθρωπος, οπότε
   * συμπληρώνονται μόνο ΟΤΑΝ ΕΙΝΑΙ ΑΔΕΙΕΣ (`cur ?? c`) — ποτέ πάνω σε υπάρχουσα τιμή.
   *
   * Το route είναι μνημονικό: η ίδια διεύθυνση δεν ξαναρωτά τον πάροχο ποτέ.
   */
  const runGeocode = React.useCallback(async (address: string) => {
    const q = address.trim();
    if (!q) return;
    setGeoBusy(true); setGeo(null); setGeoMiss(false); setGeoDown(false);
    try {
      const res = await fetch('/api/admin/geocode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Χωρίς hint: ο σκοπός της κλήσης είναι να ΒΡΕΘΕΙ η χώρα. Η προεπιλογή «Ελλάδα» της
        // φόρμας θα περιόριζε την αναζήτηση στην Ελλάδα και μια ξένη διεύθυνση δεν θα έβγαινε ποτέ.
        // Μόνο μια χώρα που προκύπτει από το πρόθεμα ΑΦΜ (ξένη) στέλνεται ως hint.
        body: JSON.stringify({ address: q, countryHint: group.country && group.country !== 'GR' ? group.country : null }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.found) {
        setGeo(d as GeoParts);
        const c = validCoords(d.lat, d.lng);
        if (c) setCoords((cur) => cur ?? c);
      } else if (d?.unavailable || (!res.ok && res.status !== 400)) {
        // Ο πάροχος δεν μίλησε: τίποτα δεν μπήκε στη μνήμη του server, άρα το
        // «Νέα αναζήτηση» έχει πραγματικό νόημα. Δεν το λέμε «δεν βρέθηκε».
        // Το 400 εξαιρείται: εκεί φταίει η ΔΙΕΥΘΥΝΣΗ (κενή / υπερμεγέθης), όχι ο πάροχος.
        setGeoDown(true);
      } else setGeoMiss(true);
    } catch {
      setGeoDown(true);
    } finally {
      setGeoBusy(false);
    }
  }, [group.country]);

  /**
   * ΑΥΤΟΜΑΤΟ geocoding: μόλις ανοίξει εκδότης που έχει διεύθυνση αλλά του λείπουν
   * πόλη / Τ.Κ. / χώρα, ρωτάμε χωρίς να περιμένουμε κλικ. Μία φορά ανά (ΑΦΜ,
   * διεύθυνση) — ο `autoGeo` κρατά το κλειδί ώστε ένα re-render ή ένα refresh της
   * λίστας να μη ξαναστείλει τίποτα. Το κουμπί μένει για re-run μετά από αλλαγή.
   */
  React.useEffect(() => {
    const address = (group.address ?? '').trim();
    if (!address) return;
    const key = `${group.afm}|${address}`;
    if (autoGeo.current === key) return;
    // Πόλη / Τ.Κ. ΔΕΝ υπάρχουν στην ομάδα (το OCR δίνει μόνο ελεύθερη διεύθυνση) και η
    // φόρμα ξεκινά με κενά — άρα κάθε εκδότης με διεύθυνση έχει κάτι να κερδίσει.
    // Αν κάποτε η ομάδα αποκτήσει πόλη/Τ.Κ., ο έλεγχος μπαίνει εδώ.
    autoGeo.current = key;
    void runGeocode(address);
  }, [group.afm, group.address, runGeocode]);

  // Το dry-run δεν γράφει τίποτα: το ζητάμε κάθε φορά που ανοίγει η προεπισκόπηση.
  const loadDryRun = async () => {
    setDryPayload(null); setDryError(null);
    try {
      const res = await fetch(`/api/admin/ocr/new-traders/${group.afm}/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), name: form.name.trim() || '—', dryRun: true }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.dryRun) { setDryError(d?.message ?? 'Δεν ήταν δυνατή η προεπισκόπηση.'); return; }
      setDryPayload(JSON.stringify(d.payload, null, 2));
    } catch {
      setDryError('Σφάλμα δικτύου.');
    }
  };

  // Σημασιολογία `||` παντού: μια κενή τιμή της ΑΑΔΕ ΔΕΝ σβήνει ό,τι έφερε το OCR.
  /**
   * «Χρήση όλων από ΑΑΔΕ»: πλέον είναι ΕΠΑΝΑΛΗΨΗ της αυτόματης εφαρμογής — χρήσιμο μετά από
   * «Επαναφορά τιμής παραστατικού» σε ένα ή περισσότερα πεδία. Επειδή το πατά ο χρήστης,
   * παρακάμπτει το `userOwned`: το ζήτησε ρητά.
   */
  const applyAll = () => {
    if (!aade) return;
    const plan = planRegistryFill<FieldKey>({
      registry: {
        name: aade.name,
        doyCode: aade.doyCode || matchDoy(aade.doyDescr ?? null, taxOffices) || null,
        profession: aade.profession,
        address: aade.address,
        zip: aade.zip,
        city: aade.city,
      },
    });
    if (plan.applied.length === 0) {
      toast.info('Η ΑΑΔΕ δεν έδωσε καμία τιμή για αυτά τα πεδία.');
      return;
    }
    setForm((f) => ({ ...f, ...plan.values }));
    setUserOwned((prev) => {
      const next = new Set(prev);
      for (const k of plan.applied) next.add(k);
      return next;
    });
    setFieldSource((prev) => {
      const next = { ...prev };
      for (const k of plan.applied) next[k] = 'aade';
      return next;
    });
    toast.success('Συμπληρώθηκαν τα στοιχεία της ΑΑΔΕ');
  };

  const doyItems = React.useMemo(
    () => taxOffices.map((o) => ({ value: o.code, label: `${o.name} (${o.code})` })),
    [taxOffices],
  );
  const kindColor = KIND_COLORS[form.kind];
  // Το πεδίο κρατά ακόμη ΑΚΡΙΒΩΣ ό,τι προτείναμε — μόλις το αλλάξει ο χρήστης, το chip φεύγει.
  const isProposedCode = !!lastProposal.current && form.code.trim() === lastProposal.current;

  const isForeign = group.isForeign;
  const viesCountry = viesPrefix(group.afm);
  // Το ΑΦΜ όπως θα αποθηκευτεί: αν το OCR διάβασε γυμνά ψηφία αλλά η χώρα (από τη
  // διεύθυνση, το VIES ή την επιλογή του χρήστη) δεν είναι η Ελλάδα, μπαίνει το
  // πρόθεμά της. Ελληνικό ΑΦΜ δεν προθεματίζεται ποτέ.
  const activeCountry = form.country || group.country || 'GR';
  const effectiveAfm = applyVatPrefix(group.afm, activeCountry);
  const addedPrefix = effectiveAfm !== group.afm ? vatPrefixFor(activeCountry) : null;

  const rows: { key: FieldKey; label: string; ocr: string | null; aadeValue: string | null; apply?: () => void }[] = [
    { key: 'name', label: 'Επωνυμία', ocr: group.name, aadeValue: aade?.name || null, apply: () => aade?.name && set('name', aade.name, 'aade') },
    {
      key: 'doyCode', label: 'Δ.Ο.Υ.', ocr: group.doy, aadeValue: aade?.doyDescr ?? null,
      apply: () => {
        const code = aade?.doyCode ?? matchDoy(aade?.doyDescr ?? null, taxOffices);
        if (code) set('doyCode', code, 'aade');
        else toast.error('Η Δ.Ο.Υ. της ΑΑΔΕ δεν βρέθηκε στο μητρώο SoftOne.');
      },
    },
    { key: 'profession', label: 'Επάγγελμα', ocr: group.profession, aadeValue: aade?.profession ?? null, apply: () => aade?.profession && set('profession', aade.profession, 'aade') },
    { key: 'address', label: 'Διεύθυνση', ocr: group.address, aadeValue: aade?.address ?? null, apply: () => aade?.address && set('address', aade.address, 'aade') },
    { key: 'zip', label: 'Τ.Κ.', ocr: null, aadeValue: aade?.zip ?? null, apply: () => aade?.zip && set('zip', aade.zip, 'aade') },
    { key: 'city', label: 'Πόλη', ocr: null, aadeValue: aade?.city ?? null, apply: () => aade?.city && set('city', aade.city, 'aade') },
  ];

  return (
    <div className="flex flex-col divide-y divide-border">
      {/* 1 — Κεφαλίδα */}
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-foreground">
            {group.name ?? 'Χωρίς επωνυμία'}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">ΑΦΜ {group.afm}</span>
            <CopyAfm afm={group.afm} />
            <span aria-hidden>·</span>
            <span>{group.docCount} παραστατικά</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">Σύνολο {fmtEuro(group.total)}</span>
            <span aria-hidden>·</span>
            <span>Τελευταίο {fmtDate(group.lastDate)}</span>
          </div>
        </div>
        <span
          className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: kindColor.bg, color: kindColor.fg }}
        >
          {KIND_LABEL[form.kind]}
        </span>
      </header>

      {/* 2 — Μητρώο: ΑΑΔΕ για την Ελλάδα, VIES για εκδότη εκτός Ελλάδας */}
      {isForeign ? (
        <section className="px-4 py-3" aria-label="Στοιχεία VIES">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              Μητρώο VIES
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: '#EAF4FC', color: '#0078D4' }}
              >
                <FiGlobe aria-hidden className="size-3" />
                Εκτός Ελλάδας · {group.country}
              </span>
            </h3>
            {viesCountry && (
              <Button
                type="button" variant="outline" size="sm"
                className="cursor-pointer"
                disabled={viesBusy}
                onClick={() => void runVies()}
              >
                {viesBusy
                  ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
                  : <FiRefreshCw aria-hidden className="size-3.5" />}
                {vies ? 'Έλεγχος ξανά' : 'Έλεγχος στο VIES'}
              </Button>
            )}
          </div>

          <p className="mb-2 text-[12px] text-muted-foreground">
            Δεν γίνεται αναζήτηση στην ΑΑΔΕ — ο εκδότης δεν είναι ελληνικός. Το ΑΦΜ
            κρατά το πρόθεμα της χώρας ({countryLabel(group.country)}).
          </p>

          {!viesCountry && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px]"
              style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}
              role="status"
            >
              <FiAlertTriangle aria-hidden className="size-4 shrink-0" />
              <span>Το VIES καλύπτει μόνο χώρες της ΕΕ — συμπλήρωσε τα στοιχεία χειροκίνητα.</span>
            </div>
          )}

          {vies && vies.valid === null && (
            <p
              className="rounded-lg border px-3 py-2 text-[12px]"
              style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}
              role="status"
            >
              Το VIES δεν απάντησε — δοκίμασε ξανά ή συμπλήρωσε χειροκίνητα.
            </p>
          )}

          {vies && vies.valid === false && (
            <p
              className="rounded-lg border px-3 py-2 text-[12px]"
              style={{ borderColor: '#F5C2C7', backgroundColor: '#FDF2F2', color: '#A4262C' }}
              role="status"
            >
              Το ΑΦΜ {group.afm} ΔΕΝ είναι έγκυρο στο VIES.
            </p>
          )}

          {vies && vies.valid === true && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-neutral-4 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                <span>Πεδίο</span><span>OCR</span><span>VIES</span><span className="sr-only">Ενέργεια</span>
              </div>
              <ul className="divide-y divide-border">
                {([
                  { key: 'name' as FieldKey, label: 'Επωνυμία', ocr: group.name, value: vies.name },
                  { key: 'address' as FieldKey, label: 'Διεύθυνση', ocr: group.address, value: vies.address },
                ]).map((r) => (
                  <li
                    key={r.key}
                    className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[12px]"
                  >
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="truncate text-muted-foreground" title={r.ocr ?? ''}>{r.ocr ?? '—'}</span>
                    {/* Το VIES γράφει «---» όταν το κράτος-μέλος κρύβει το πεδίο. */}
                    <span className="truncate text-foreground" title={r.value ?? ''}>{r.value ?? '— (κρυφό)'}</span>
                    <Button
                      type="button" variant="ghost" size="xs"
                      className="cursor-pointer"
                      disabled={!r.value}
                      aria-label={`Χρήση τιμής VIES για «${r.label}»`}
                      onClick={() => r.value && set(r.key, r.value, 'vies')}
                    >
                      Χρήση
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
      <section className="px-4 py-3" aria-label="Στοιχεία ΑΑΔΕ">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            Στοιχεία ΑΑΔΕ
            {/* Το μητρώο λέει ρητά ότι ο ΑΦΜ είναι ανενεργός — χρήσιμο πριν τη δημιουργία. */}
            {aadeState === 'ready' && aade?.isActive === false && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: '#FFF8EE', color: '#92400E' }}
              >
                <FiAlertTriangle aria-hidden className="size-3" /> Ανενεργό στην ΑΑΔΕ
              </span>
            )}
          </h3>
          {aadeState === 'ready' && (
            <button
              type="button"
              onClick={applyAll}
              className="cursor-pointer rounded-sm text-[12px] font-medium text-sisyphus-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sisyphus-500"
            >
              Χρήση όλων από ΑΑΔΕ
            </button>
          )}
        </div>

        {aadeState === 'loading' && (
          <div className="space-y-1.5" role="status" aria-live="polite">
            <span className="sr-only">Άντληση στοιχείων από την ΑΑΔΕ…</span>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded-md bg-neutral-8 motion-reduce:animate-none" />
            ))}
          </div>
        )}

        {aadeState !== 'loading' && aadeState !== 'ready' && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px]"
            style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}
            role="status"
          >
            <FiAlertTriangle aria-hidden className="size-4 shrink-0" />
            <span>{AADE_MESSAGE[aadeState as Exclude<AadeState, 'loading' | 'ready' | 'foreign'>]}</span>
            {aadeState === 'error' && (
              <Button
                type="button" variant="outline" size="sm"
                className="ml-auto cursor-pointer"
                onClick={() => setAadeReload((n) => n + 1)}
              >
                <FiRefreshCw aria-hidden className="size-3.5" /> Δοκίμασε ξανά
              </Button>
            )}
          </div>
        )}

        {aadeState === 'ready' && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-neutral-4 px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <span>Πεδίο</span><span>OCR</span><span>ΑΑΔΕ</span><span className="sr-only">Ενέργεια</span>
            </div>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.key}
                  className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[12px]"
                >
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="truncate text-muted-foreground" title={r.ocr ?? ''}>{r.ocr ?? '—'}</span>
                  <span className="truncate text-foreground" title={r.aadeValue ?? ''}>{r.aadeValue ?? '—'}</span>
                  <Button
                    type="button" variant="ghost" size="xs"
                    className="cursor-pointer"
                    disabled={!r.aadeValue}
                    aria-label={`Χρήση τιμής ΑΑΔΕ για «${r.label}»`}
                    onClick={r.apply}
                  >
                    Χρήση
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      )}

      {/* 2β — Καρτέλες του ΑΦΜ στο SoftOne: τι υπάρχει ήδη και τι λείπει */}
      <section className="px-4 py-3" aria-label="Καρτέλες στο SoftOne">
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <FiCreditCard aria-hidden className="size-3.5" /> Καρτέλες στο SoftOne
        </h3>

        {group.cards.length === 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-neutral-6 px-3 py-2 text-[12px] text-muted-foreground">
            <FiInfo aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Καμία καρτέλα για αυτό το ΑΦΜ — θα δημιουργηθεί η πρώτη.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {group.cards.map((c) => (
              <li
                key={c.trdr}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px]"
              >
                <span
                  className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={c.kind
                    ? { backgroundColor: KIND_COLORS[c.kind].bg, color: KIND_COLORS[c.kind].fg }
                    : { backgroundColor: '#EEE', color: '#555' }}
                >
                  {c.label}
                </span>
                <span className="font-mono text-muted-foreground">{c.code ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate text-foreground" title={c.name}>{c.name}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Ο τύπος που ΛΕΙΠΕΙ: ο λόγος σε ελληνικά και ένα κλικ που προεπιλέγει τη φόρμα. */}
        {group.missing.length > 0 && (
          <ul className="mt-2 grid gap-1.5">
            {group.missing.map((m) => (
              <li
                key={m.kind}
                className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 text-[12px]"
                style={{ borderColor: '#F0C36D', backgroundColor: '#FDF6E7' }}
              >
                <FiAlertTriangle aria-hidden className="size-3.5 shrink-0" style={{ color: '#B45309' }} />
                <span className="min-w-0 flex-1 text-foreground">
                  {m.reason} — {m.docCount === 1 ? '1 παραστατικό' : `${m.docCount} παραστατικά`}.
                </span>
                <Button
                  type="button" variant="outline" size="xs"
                  className="shrink-0 cursor-pointer"
                  disabled={!canManage}
                  onClick={() => {
                    setForm((f) => ({ ...f, kind: m.kind }));
                    kindRefs.current[m.kind]?.focus();
                  }}
                >
                  <FiPlusCircle aria-hidden className="size-3" /> Δημιουργία {KIND_ACCUSATIVE[m.kind]}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Τα έγγραφα που δεν ξέρουμε πού καταχωρούνται δεν ζητούν συγκεκριμένο τύπο. */}
        {group.unknownSeriesDocs > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <FiInfo aria-hidden className="mt-0.5 size-3 shrink-0" />
            {group.unknownSeriesDocs === 1 ? '1 παραστατικό δεν έχει' : `${group.unknownSeriesDocs} παραστατικά δεν έχουν`}
            {' '}αναγνωρισμένη σειρά: δεν προκύπτει από αυτά ποιος τύπος καρτέλας χρειάζεται.
          </p>
        )}
      </section>

      {/* 3 — Φόρμα */}
      <section className="px-4 py-3" aria-label="Στοιχεία συναλλασσομένου">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Τύπος</span>
          <div
            role="radiogroup"
            aria-label="Τύπος συναλλασσομένου"
            className="inline-flex rounded-lg border border-border p-0.5"
            // ←/→ μετακινούν την ΕΠΙΛΟΓΗ (roving tabindex), όπως ορίζει το WAI-ARIA
            // για radiogroup· το stopPropagation κρατά τα πλήκτρα μακριά από την ουρά.
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              e.stopPropagation();
              const at = KINDS.indexOf(form.kind);
              const next = KINDS[(at + (e.key === 'ArrowRight' ? 1 : -1) + KINDS.length) % KINDS.length];
              setForm((f) => ({ ...f, kind: next }));
              kindRefs.current[next]?.focus();
            }}
          >
            {KINDS.map((k) => {
              const active = form.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  ref={(el) => { kindRefs.current[k] = el; }}
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                  className={cn(
                    'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium outline-none cx-transition',
                    'focus-visible:ring-2 focus-visible:ring-sisyphus-500',
                    active ? 'bg-sisyphus-50 text-sisyphus-700' : 'text-muted-foreground hover:bg-[var(--cx-hover)]',
                  )}
                >
                  {active && <FiCheck aria-hidden className="size-3.5" />}
                  {KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Επωνυμία" required error={errorOf('name')} id="tp-name" className="sm:col-span-2">
            <Input {...bind('name', 'tp-name')} className="h-8 text-[13px]" />
            <RegistryMark k="name" />
          </Field>

          <Field
            label="ΑΦΜ" id="tp-afm"
            hint={addedPrefix
              ? `Προστέθηκε πρόθεμα ${addedPrefix} — ${countryLabel(activeCountry)}.`
              : 'Κλειδωμένο — προέρχεται από τα παραστατικά.'}
          >
            {/* `readOnly` (όχι `disabled`): το πεδίο μένει εστιάσιμο και αναγνώσιμο από screen reader. */}
            <Input
              id="tp-afm" value={effectiveAfm} readOnly aria-readonly
              className="h-8 bg-neutral-4 font-mono text-[13px]"
            />
          </Field>

          <Field
            label="Κωδικός" id="tp-code"
            required={CODE_REQUIRED_KINDS.includes(form.kind)}
            error={errorOf('code')}
            hint={codeHint(form.kind, codeSuggestion, codeBusy)}
          >
            <div className="flex items-center gap-2">
              <Input {...bind('code', 'tp-code')} ref={codeRef} className="h-8 flex-1 font-mono text-[13px]" />
              {/* Ο κωδικός είναι ΠΡΟΤΑΣΗ, όχι κλειδαριά: το chip το λέει, το πεδίο μένει ανοιχτό. */}
              {isProposedCode && (
                <span
                  className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: '#EAF4FC', color: '#0078D4' }}
                >
                  προτεινόμενος — επόμενος ελεύθερος
                </span>
              )}
            </div>
            {/* Μετά από άρνηση του SoftOne: ο ΝΕΟΣ επόμενος ελεύθερος, με ρητή αποδοχή. */}
            {codeOffer && codeOffer !== form.code.trim() && (
              <Button
                type="button" variant="outline" size="xs"
                className="w-fit cursor-pointer"
                onClick={() => { set('code', codeOffer); lastProposal.current = codeOffer; }}
              >
                <FiRefreshCw aria-hidden className="size-3" /> Χρήση του {codeOffer}
              </Button>
            )}
            {/* Δείγμα από τα ΥΠΑΡΧΟΝΤΑ δεδομένα — δείχνει τη μορφή, δεν την επιβάλλει. */}
            {codeSamples[form.kind].length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Υπάρχοντες κωδικοί {KIND_GENITIVE[form.kind]}:{' '}
                <span className="font-mono">{codeSamples[form.kind].join(', ')}</span>
              </p>
            )}
          </Field>

          <Field
            label="Χώρα" id="tp-country" plainLabel
            hint={isForeign ? 'Από το πρόθεμα του ΑΦΜ — άλλαξέ την αν χρειάζεται.' : undefined}
            className="sm:col-span-2"
          >
            <Combobox
              value={form.country}
              items={COUNTRY_ITEMS}
              placeholder="Επίλεξε χώρα…"
              onSelect={(v) => set('country', v)}
            />
          </Field>

          {/* Δ.Ο.Υ. δεν υπάρχει εκτός Ελλάδας — το πεδίο κρύβεται τελείως. */}
          {!isForeign && (
          <Field label="Δ.Ο.Υ." id="tp-doy" plainLabel={taxOffices.length > 0} className="sm:col-span-2">
            {taxOffices.length > 0 ? (
              <Combobox
                value={form.doyCode || null}
                items={doyItems}
                placeholder="Επίλεξε Δ.Ο.Υ.…"
                onSelect={(v) => set('doyCode', v)}
              />
            ) : (
              <Input
                id="tp-doy" value={form.doyCode} className="h-8 text-[13px]"
                placeholder="Κωδικός Δ.Ο.Υ."
                onChange={(e) => set('doyCode', e.target.value)}
              />
            )}
            <RegistryMark k="doyCode" />
          </Field>
          )}

          <Field label="Επάγγελμα" id="tp-prof" error={errorOf('profession')} className="sm:col-span-2">
            <Input {...bind('profession', 'tp-prof')} className="h-8 text-[13px]" />
            <RegistryMark k="profession" />
          </Field>

          <Field label="Διεύθυνση" id="tp-addr" error={errorOf('address')} className="sm:col-span-2">
            <RegistryMark k="address" />
            <div className="flex items-center gap-2">
              <Input {...bind('address', 'tp-addr')} className="h-8 flex-1 text-[13px]" />
              <Button
                type="button" variant="outline" size="sm"
                className="h-8 shrink-0 cursor-pointer"
                disabled={!form.address.trim() || geoBusy}
                onClick={() => void runGeocode(form.address)}
              >
                {geoBusy
                  ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
                  : <FiMapPin aria-hidden className="size-3.5" />}
                {geo || geoMiss || geoDown ? 'Νέα αναζήτηση' : 'Συμπλήρωση από διεύθυνση'}
              </Button>
            </div>
          </Field>

          {/* Οι προτάσεις του geocoder ΔΕΝ γράφονται μόνες τους: ο χρήστης τις εφαρμόζει. */}
          {geoMiss && (
            <p className="text-[12px] text-muted-foreground sm:col-span-2" role="status">
              Η διεύθυνση δεν αναγνωρίστηκε — συμπλήρωσε χώρα/πόλη/Τ.Κ. χειροκίνητα.
            </p>
          )}
          {geoDown && (
            <p className="text-[12px] text-amber-700 sm:col-span-2" role="status">
              Η υπηρεσία διευθύνσεων δεν απάντησε — δοκίμασε «Νέα αναζήτηση» ή συμπλήρωσε
              χώρα/πόλη/Τ.Κ. χειροκίνητα. Τίποτα δεν αποθηκεύτηκε ως «δεν βρέθηκε».
            </p>
          )}
          {geo && (
            <div className="rounded-lg border border-border sm:col-span-2" role="group" aria-label="Προτάσεις από τη διεύθυνση">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-neutral-4 px-2 py-1">
                <span className="truncate text-[11px] text-muted-foreground" title={geo.formatted}>
                  {geo.formatted}
                  {geo.cached && <span className="ml-1 opacity-70">· από τη μνήμη</span>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Ρητή επιλογή χρήστη: τα πεδία γίνονται ΔΙΚΑ ΤΟΥ (`set`), οπότε ούτε η ΑΑΔΕ
                    // ούτε το VIES θα τα ξαναγράψουν μετά. Δύο αυτόματες πηγές δεν μαλώνουν ποτέ
                    // για το ίδιο πεδίο: ο geocoder ΔΕΝ εφαρμόζει μόνος του κείμενο — μόνο προτείνει.
                    if (geo.countryCode && COUNTRY_NAMES_EL[geo.countryCode]) set('country', geo.countryCode);
                    if (geo.city) set('city', geo.city);
                    if (geo.zip) set('zip', geo.zip);
                    const c = validCoords(geo.lat, geo.lng);
                    if (c) setCoords(c);
                    toast.success('Συμπληρώθηκαν τα στοιχεία της διεύθυνσης');
                  }}
                  className="shrink-0 cursor-pointer rounded-sm text-[12px] font-medium text-sisyphus-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sisyphus-500"
                >
                  Εφαρμογή όλων
                </button>
              </div>
              <ul className="divide-y divide-border">
                {([
                  { key: 'country' as const, label: 'Χώρα', value: geo.countryCode, shown: countryLabel(geo.countryCode) },
                  { key: 'city' as const, label: 'Πόλη', value: geo.city, shown: geo.city },
                  { key: 'zip' as const, label: 'Τ.Κ.', value: geo.zip, shown: geo.zip },
                ]).map((r) => (
                  <li key={r.key} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[12px]">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="truncate text-foreground">{r.shown ?? '—'}</span>
                    <Button
                      type="button" variant="ghost" size="xs"
                      className="cursor-pointer"
                      disabled={!r.value}
                      aria-label={`Εφαρμογή τιμής «${r.label}» από τη διεύθυνση`}
                      onClick={() => r.value && set(r.key, r.value)}
                    >
                      Εφαρμογή
                    </Button>
                  </li>
                ))}
                {/* Οι συντεταγμένες μπαίνουν μόνες τους όταν το πεδίο είναι άδειο·
                    η «Εφαρμογή» εδώ χρειάζεται για re-run μετά από αλλαγή διεύθυνσης. */}
                <li className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[12px]">
                  <span className="text-muted-foreground">Συντεταγμένες</span>
                  <span className="truncate font-mono text-foreground">
                    {formatCoords(validCoords(geo.lat, geo.lng)) || '—'}
                  </span>
                  <Button
                    type="button" variant="ghost" size="xs"
                    className="cursor-pointer"
                    disabled={!validCoords(geo.lat, geo.lng)}
                    aria-label="Εφαρμογή συντεταγμένων από τη διεύθυνση"
                    onClick={() => { const c = validCoords(geo.lat, geo.lng); if (c) setCoords(c); }}
                  >
                    Εφαρμογή
                  </Button>
                </li>
              </ul>
            </div>
          )}

          <Field label="Τ.Κ." id="tp-zip" error={errorOf('zip')}>
            <Input {...bind('zip', 'tp-zip')} inputMode="numeric" className="h-8 text-[13px]" />
            <RegistryMark k="zip" />
          </Field>

          <Field label="Πόλη" id="tp-city" error={errorOf('city')}>
            <Input {...bind('city', 'tp-city')} className="h-8 text-[13px]" />
            <RegistryMark k="city" />
          </Field>

          <Field
            label="Συντεταγμένες" id="tp-coords" className="sm:col-span-2"
            hint={coords
              ? 'Θα γραφούν στα πεδία «Γεωγραφικό πλάτος» / «Γεωγραφικό μήκος» του SoftOne.'
              : 'Άγνωστες — τα δύο πεδία του SoftOne δεν θα σταλούν καθόλου (ποτέ 0).'}
          >
            <div className="flex items-center gap-2">
              <Input
                id="tp-coords" readOnly aria-readonly
                value={formatCoords(coords)} placeholder="—"
                className="h-8 flex-1 bg-neutral-4 font-mono text-[13px]"
              />
              {coords && (
                <Button
                  type="button" variant="ghost" size="sm"
                  className="h-8 shrink-0 cursor-pointer"
                  onClick={() => setCoords(null)}
                >
                  <FiX aria-hidden className="size-3.5" /> Αφαίρεση
                </Button>
              )}
            </div>
          </Field>

          <Field label="Τηλέφωνο" id="tp-phone" error={errorOf('phone')}>
            <Input {...bind('phone', 'tp-phone')} inputMode="tel" className="h-8 text-[13px]" />
          </Field>

          <Field label="Email" id="tp-email" error={errorOf('email')}>
            <Input {...bind('email', 'tp-email')} type="email" className="h-8 text-[13px]" />
          </Field>
        </div>
      </section>

      {/* 4 — Παραστατικά της ομάδας */}
      <section className="px-4 py-3" aria-label="Παραστατικά">
        <h3 className="mb-1.5 text-[13px] font-semibold text-foreground">
          Παραστατικά{' '}
          <span className="font-normal text-muted-foreground">
            ({Math.min(group.docs.length, group.docCount)} από {group.docCount})
          </span>
        </h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {group.docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-[12px]">
              <Link
                href={`/admin/ocr/${d.id}`}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-sisyphus-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sisyphus-500"
              >
                <FiExternalLink aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{d.fileName}</span>
              </Link>
              {d.series && <span className="shrink-0 text-muted-foreground">{d.series}</span>}
              <span className="shrink-0 text-muted-foreground">{fmtDate(d.date)}</span>
              <span className="shrink-0 tabular-nums text-foreground">{fmtEuro(d.total)}</span>
            </li>
          ))}
          {group.docs.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-muted-foreground">Κανένα παραστατικό.</li>
          )}
        </ul>
      </section>

      {/* 5 — Ενέργειες */}
      <section className="space-y-2.5 px-4 py-3" aria-label="Ενέργειες">
        {failure && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[12px]"
            style={{ borderColor: '#F5C2C7', backgroundColor: '#FDF2F2', color: '#A4262C' }}
          >
            <FiAlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" /> {failure}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="cursor-pointer"
            disabled={!canManage || busy !== null}
            onClick={() => void create()}
          >
            {busy === 'create'
              ? <FiLoader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              : <FiUploadCloud aria-hidden className="size-4" />}
            {busy === 'create' ? 'Δημιουργία…' : 'Δημιουργία στο SoftOne'}
          </Button>

          <Button
            type="button" variant="outline"
            className="cursor-pointer"
            disabled={!canManage || busy !== null}
            aria-expanded={showSearch}
            onClick={() => { setShowSearch((s) => !s); setIgnoring(false); }}
          >
            {busy === 'link'
              ? <FiLoader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              : <FiLink2 aria-hidden className="size-4" />}
            Είναι υπάρχων…
          </Button>

          <Button
            type="button" variant="ghost"
            className="cursor-pointer text-muted-foreground"
            disabled={!canManage || busy !== null}
            aria-expanded={ignoring}
            onClick={() => { setIgnoring((s) => !s); setShowSearch(false); }}
          >
            <FiEyeOff aria-hidden className="size-4" /> Αγνόηση
          </Button>

          {!canManage && (
            <span className="text-[11px] text-muted-foreground">
              Χρειάζεται δικαίωμα «ocr.categorize».
            </span>
          )}
        </div>

        {showSearch && (
          <div className="rounded-lg border border-border bg-neutral-4 p-2.5">
            <TraderSearch
              id="tp-existing"
              autoFocus
              initialQuery={group.name ?? ''}
              disabled={busy !== null}
              onPick={(hit) => { setShowSearch(false); void link(hit.id, hit.name); }}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Όλα τα παραστατικά του ΑΦΜ {group.afm} θα συνδεθούν με τον επιλεγμένο συναλλασσόμενο.
            </p>
          </div>
        )}

        {ignoring && (
          <div className="rounded-lg border border-border bg-neutral-4 p-2.5">
            <label htmlFor="tp-reason" className="text-[11px] font-medium text-muted-foreground">
              Λόγος (προαιρετικό)
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Input
                id="tp-reason" value={reason} autoFocus
                placeholder="π.χ. ιδιώτης, δεν χρειάζεται καταχώριση"
                className="h-8 min-w-[200px] flex-1 text-[13px]"
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void ignore(); } }}
              />
              <Button type="button" variant="outline" className="cursor-pointer" disabled={busy !== null} onClick={() => void ignore()}>
                {busy === 'ignore'
                  ? <FiLoader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                  : <FiEyeOff aria-hidden className="size-4" />}
                Αγνόηση εκδότη
              </Button>
              <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => { setIgnoring(false); setReason(''); }}>
                <FiX aria-hidden className="size-4" /> Άκυρο
              </Button>
            </div>
          </div>
        )}

        <details
          open={dryOpen}
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            setDryOpen(open);
            if (open) void loadDryRun();
          }}
          className="rounded-lg border border-border"
        >
          <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500">
            Προεπισκόπηση setData
          </summary>
          <div className="border-t border-border px-2.5 py-2">
            {dryError && <p className="text-[12px] text-danger-500">{dryError}</p>}
            {!dryError && !dryPayload && <p className="text-[12px] text-muted-foreground">Φόρτωση…</p>}
            {dryPayload && (
              <pre className="max-h-56 overflow-auto rounded-md bg-neutral-8 p-2 text-[11px] leading-relaxed">
                {dryPayload}
              </pre>
            )}
          </div>
        </details>
      </section>
    </div>
  );
}

/** Αρχικές τιμές φόρμας από τα στοιχεία OCR της ομάδας. */
function seed(group: TraderGroup, offices: TaxOffice[]): FormState {
  return {
    kind: group.suggestedKind,
    code: '',
    name: group.name ?? '',
    // Η χώρα βγαίνει από το ίδιο το ΑΦΜ· άγνωστη ⇒ Ελλάδα, όπως και σήμερα.
    country: group.country ?? 'GR',
    doyCode: group.isForeign ? '' : matchDoy(group.doy, offices),
    profession: group.profession ?? '',
    address: group.address ?? '',
    zip: '',
    city: '',
    phone: group.phone ?? '',
    email: group.email ?? '',
  };
}

/** Ετικέτα + πεδίο + μήνυμα σφάλματος κάτω από το πεδίο. */
function Field({
  label, id, required, error, hint, plainLabel, className, children,
}: {
  label: string; id: string; required?: boolean; error?: string; hint?: string;
  /** Για controls χωρίς `input` (π.χ. combobox): ετικέτα ως κείμενο + `role="group"`. */
  plainLabel?: boolean;
  className?: string; children: React.ReactNode;
}) {
  const labelNode = (
    <>{label}{required && <span className="text-destructive"> *</span>}</>
  );
  return (
    <div className={cn('grid gap-1', className)} role={plainLabel ? 'group' : undefined} aria-label={plainLabel ? label : undefined}>
      {plainLabel ? (
        <span className="text-[11px] font-medium text-muted-foreground">{labelNode}</span>
      ) : (
        <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">{labelNode}</label>
      )}
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="flex items-center gap-1 text-[11px] text-danger-500">
          <FiAlertTriangle aria-hidden className="size-3" /> {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Αντιγραφή ΑΦΜ με οπτική επιβεβαίωση (εικονίδιο + κείμενο). */
function CopyAfm({ afm }: { afm: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(afm);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Η αντιγραφή δεν ήταν δυνατή.');
        }
      }}
      aria-label={`Αντιγραφή ΑΦΜ ${afm}`}
      className="inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 text-[11px] text-muted-foreground outline-none cx-transition hover:bg-[var(--cx-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-sisyphus-500"
    >
      {copied ? <FiCheckCircle aria-hidden className="size-3 text-success-500" /> : <FiCopy aria-hidden className="size-3" />}
      {copied ? 'Αντιγράφηκε' : 'Αντιγραφή'}
    </button>
  );
}
