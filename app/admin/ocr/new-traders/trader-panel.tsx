'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  FiAlertTriangle, FiCheck, FiCheckCircle, FiCopy, FiExternalLink, FiEyeOff,
  FiGlobe, FiLink2, FiLoader, FiMapPin, FiRefreshCw, FiUploadCloud, FiX,
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
import type { TraderGroup } from '@/lib/ocr/queues';

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
}

type TraderKind = 'supplier' | 'creditor';

/** Επιλογές χώρας της φόρμας: όσες αναγνωρίζει το VAT normalization + «Άλλη». */
const COUNTRY_ITEMS = [
  { value: '', label: 'Άλλη / καμία' },
  { value: 'GR', label: countryLabel('GR') },
  // Το «XI» είναι πρόθεμα VAT, όχι χώρα: η Β. Ιρλανδία δηλώνεται ως GB.
  ...[...VAT_COUNTRY_CODES].filter((c) => c !== 'XI')
    .map((c) => ({ value: c as string, label: countryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'el')),
];

const KIND_LABEL: Record<TraderKind, string> = { supplier: 'Προμηθευτής', creditor: 'Πιστωτής' };
const KINDS: readonly TraderKind[] = ['supplier', 'creditor'];
/** Χρώματα chip ανά τύπο (inline hex — ο JIT δεν κρατά δυναμικές κλάσεις). */
export const KIND_COLORS: Record<TraderKind, { bg: string; fg: string }> = {
  supplier: { bg: '#EAF4FC', fg: '#0078D4' },
  creditor: { bg: '#F3E8FF', fg: '#6D28D9' },
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
  group, taxOffices, canManage, onResolved, onIgnored, primaryRef,
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
  const kindRefs = React.useRef<Partial<Record<TraderKind, HTMLButtonElement | null>>>({});

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
    setGeo(null); setGeoBusy(false); setGeoMiss(false);
  }, [group, taxOffices]);

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
  const errorOf = (k: FieldKey) => ((touched[k] || submitted) ? errors[k] : undefined);
  const set = (k: FieldKey, v: string) => setForm((f) => ({ ...f, [k]: v }));
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

  /** Διεύθυνση → χώρα / πόλη / Τ.Κ. Δεν γράφει ΤΙΠΟΤΑ μόνο του: προτείνει. */
  const runGeocode = async () => {
    const address = form.address.trim();
    if (!address || geoBusy) return;
    setGeoBusy(true); setGeo(null); setGeoMiss(false);
    try {
      const res = await fetch('/api/admin/geocode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, countryHint: form.country || group.country || null }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.found) setGeo(d as GeoParts);
      else setGeoMiss(true);
    } catch {
      setGeoMiss(true);
    } finally {
      setGeoBusy(false);
    }
  };

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
  const applyAll = () => {
    if (!aade) return;
    setForm((f) => ({
      ...f,
      name: aade.name || f.name,
      doyCode: aade.doyCode || matchDoy(aade.doyDescr, taxOffices) || f.doyCode,
      profession: aade.profession || f.profession,
      address: aade.address || f.address,
      zip: aade.zip || f.zip,
      city: aade.city || f.city,
    }));
    toast.success('Συμπληρώθηκαν τα στοιχεία της ΑΑΔΕ');
  };

  const doyItems = React.useMemo(
    () => taxOffices.map((o) => ({ value: o.code, label: `${o.name} (${o.code})` })),
    [taxOffices],
  );
  const kindColor = KIND_COLORS[form.kind];

  const isForeign = group.isForeign;
  const viesCountry = viesPrefix(group.afm);
  // Το ΑΦΜ όπως θα αποθηκευτεί: αν το OCR διάβασε γυμνά ψηφία αλλά η χώρα (από τη
  // διεύθυνση, το VIES ή την επιλογή του χρήστη) δεν είναι η Ελλάδα, μπαίνει το
  // πρόθεμά της. Ελληνικό ΑΦΜ δεν προθεματίζεται ποτέ.
  const activeCountry = form.country || group.country || 'GR';
  const effectiveAfm = applyVatPrefix(group.afm, activeCountry);
  const addedPrefix = effectiveAfm !== group.afm ? vatPrefixFor(activeCountry) : null;

  const rows: { key: FieldKey; label: string; ocr: string | null; aadeValue: string | null; apply?: () => void }[] = [
    { key: 'name', label: 'Επωνυμία', ocr: group.name, aadeValue: aade?.name || null, apply: () => aade?.name && set('name', aade.name) },
    {
      key: 'doyCode', label: 'Δ.Ο.Υ.', ocr: group.doy, aadeValue: aade?.doyDescr ?? null,
      apply: () => {
        const code = aade?.doyCode ?? matchDoy(aade?.doyDescr ?? null, taxOffices);
        if (code) set('doyCode', code);
        else toast.error('Η Δ.Ο.Υ. της ΑΑΔΕ δεν βρέθηκε στο μητρώο SoftOne.');
      },
    },
    { key: 'profession', label: 'Επάγγελμα', ocr: group.profession, aadeValue: aade?.profession ?? null, apply: () => aade?.profession && set('profession', aade.profession) },
    { key: 'address', label: 'Διεύθυνση', ocr: group.address, aadeValue: aade?.address ?? null, apply: () => aade?.address && set('address', aade.address) },
    { key: 'zip', label: 'Τ.Κ.', ocr: null, aadeValue: aade?.zip ?? null, apply: () => aade?.zip && set('zip', aade.zip) },
    { key: 'city', label: 'Πόλη', ocr: null, aadeValue: aade?.city ?? null, apply: () => aade?.city && set('city', aade.city) },
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
                      onClick={() => r.value && set(r.key, r.value)}
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

          <Field label="Κωδικός" id="tp-code" error={errorOf('code')} hint="Κενό = αυτόματος από SoftOne.">
            <Input {...bind('code', 'tp-code')} className="h-8 text-[13px]" />
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
          </Field>
          )}

          <Field label="Επάγγελμα" id="tp-prof" error={errorOf('profession')} className="sm:col-span-2">
            <Input {...bind('profession', 'tp-prof')} className="h-8 text-[13px]" />
          </Field>

          <Field label="Διεύθυνση" id="tp-addr" error={errorOf('address')} className="sm:col-span-2">
            <div className="flex items-center gap-2">
              <Input {...bind('address', 'tp-addr')} className="h-8 flex-1 text-[13px]" />
              <Button
                type="button" variant="outline" size="sm"
                className="h-8 shrink-0 cursor-pointer"
                disabled={!form.address.trim() || geoBusy}
                onClick={() => void runGeocode()}
              >
                {geoBusy
                  ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
                  : <FiMapPin aria-hidden className="size-3.5" />}
                Συμπλήρωση από διεύθυνση
              </Button>
            </div>
          </Field>

          {/* Οι προτάσεις του geocoder ΔΕΝ γράφονται μόνες τους: ο χρήστης τις εφαρμόζει. */}
          {geoMiss && (
            <p className="text-[12px] text-muted-foreground sm:col-span-2" role="status">
              Η διεύθυνση δεν αναγνωρίστηκε — συμπλήρωσε χώρα/πόλη/Τ.Κ. χειροκίνητα.
            </p>
          )}
          {geo && (
            <div className="rounded-lg border border-border sm:col-span-2" role="group" aria-label="Προτάσεις από τη διεύθυνση">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-neutral-4 px-2 py-1">
                <span className="truncate text-[11px] text-muted-foreground" title={geo.formatted}>
                  {geo.formatted}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      country: geo.countryCode && COUNTRY_NAMES_EL[geo.countryCode] ? geo.countryCode : f.country,
                      city: geo.city || f.city,
                      zip: geo.zip || f.zip,
                    }));
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
              </ul>
            </div>
          )}

          <Field label="Τ.Κ." id="tp-zip" error={errorOf('zip')}>
            <Input {...bind('zip', 'tp-zip')} inputMode="numeric" className="h-8 text-[13px]" />
          </Field>

          <Field label="Πόλη" id="tp-city" error={errorOf('city')}>
            <Input {...bind('city', 'tp-city')} className="h-8 text-[13px]" />
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
