'use client';

import * as React from 'react';
import { FiAlertTriangle, FiCheckCircle, FiDownloadCloud, FiGlobe, FiPhone, FiUser } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { TRADER_KIND_TEXT, type TraderKindName } from '@/lib/ocr/posting-target';
import type { TaxOfficeMapping } from '@/lib/tax-office';
import { cn } from '@/lib/utils';
import { Field as KitField, FormSection, FormSelect, RowHint, fieldCls } from '@/components/admin/form-kit';
import { VAT_COUNTRY_CODES, isValidAfm, vatCountry } from '@/lib/ocr/validate';
import { countryLabel } from '@/lib/countries';
import { EXTRA_COUNTRY_NAMES_EL } from '@/lib/country-detect';
import { applyVatPrefix } from '@/lib/ocr/vat-prefix';
import { ViesCheck } from '@/components/admin/vies-check';
import { KadField, kadPayload, useKadRemoved, type TraderKads } from '@/components/admin/kad-field';

type Preview = {
  afm: string; name: string;
  doyDescr: string | null; doyCode: string | null;
  softoneDoy: TaxOfficeMapping;
  softoneKad?: TraderKads;
  profession: string | null; address: string | null; zip: string | null; city: string | null;
  legalForm: string | null; isActive: boolean;
};

/** Οι χώρες με γνωστό πρόθεμα ΑΦΜ (εκτός Ελλάδας — αυτή δεν ζητείται εδώ). Το «XI» είναι πρόθεμα, όχι χώρα. */
const COUNTRY_OPTIONS = [...new Set([...VAT_COUNTRY_CODES, ...Object.keys(EXTRA_COUNTRY_NAMES_EL)])].filter((c) => c !== 'XI')
  .sort((a, b) => countryLabel(a).localeCompare(countryLabel(b), 'el'));

/** Τηλέφωνα / fax / email / ιστοσελίδα όπως τα γράφει το παραστατικό — γράφονται στην καρτέλα. */
export interface TraderContacts { phone?: string | null; phone2?: string | null; fax?: string | null; email?: string | null; webpage?: string | null }

type CodeSuggestion = { code: string | null; source: 'pattern' | 'mask' | 'none'; taken: number; stale: boolean };

/**
 * Δημιουργία **καρτέλας συναλλασσομένου του τύπου που ζητά το παραστατικό** — επί τόπου, από τη
 * σελίδα του παραστατικού.
 *
 * Η προηγούμενη έκδοση αυτού του αρχείου έφτιαχνε **μόνο προμηθευτή** και δεν την καλούσε κανείς.
 * Στο SoftOne όμως η ίδια εταιρεία υπάρχει πολλές φορές στον `TRDR`, μία γραμμή ανά τύπο
 * (12 προμηθευτής · 16 πιστωτής · 15 χρεώστης), και **ποια** από αυτές δέχεται η κεφαλίδα το
 * ορίζει η ΣΕΙΡΑ του παραστατικού, όχι ο εκδότης. Γι' αυτό ο τύπος εδώ είναι **δεδομένο**, όχι
 * επιλογή: έρχεται από τον προορισμό καταχώρισης και εξηγείται δίπλα του.
 *
 * Γράφει μέσω του ΥΠΑΡΧΟΝΤΟΣ `POST /api/admin/ocr/new-traders/{afm}/create` — του ίδιου route που
 * χρησιμοποιεί η ουρά «Νέοι συναλλασσόμενοι». Έτσι η καρτέλα συνδέεται αυτόματα σε **όλα** τα
 * εκκρεμή παραστατικά του ίδιου ΑΦΜ, καθένα με τον τύπο που ζητά η δική του σειρά, αντί να λυθεί
 * μόνο το ένα που κοιτά ο χρήστης.
 *
 * ⚠️ Το `setData` φεύγει **μόνο** όταν ο χρήστης ξετσεκάρει τη «Δοκιμή» και πατήσει «Δημιουργία».
 */
export function CreateTraderDialog({
  open, onOpenChange, afm, kind, fallbackName, reason, onCreated, countryHint, contacts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  afm: string;
  /** Ο τύπος που **επιβάλλει** η σειρά του παραστατικού. */
  kind: TraderKindName;
  fallbackName?: string | null;
  /** Η χώρα του εκδότη όπως τη γράφει το παραστατικό (διεύθυνση/«Χώρα») — προσυμπληρώνεται. */
  countryHint?: string | null;
  contacts?: TraderContacts | null;
  /** Η ελληνική αιτιολογία του προορισμού — γιατί αυτός ο τύπος. */
  reason?: string | null;
  onCreated?: (m: { trdr: number; code: string; name: string; docsUpdated: number }) => void;
}) {
  const text = TRADER_KIND_TEXT[kind];
  const [afmInput, setAfmInput] = React.useState('');
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<Preview | null>(null);
  const [kadRemoved, toggleKad] = useKadRemoved(data);
  const [submitting, setSubmitting] = React.useState(false);
  const [dryRun, setDryRun] = React.useState(true);
  const [dryPayload, setDryPayload] = React.useState<unknown>(null);
  const [suggestion, setSuggestion] = React.useState<CodeSuggestion | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [codeOffer, setCodeOffer] = React.useState<string | null>(null);
  const proposed = React.useRef<string | null>(null);

  const [countryPick, setCountryPick] = React.useState('');
  // Το ΑΦΜ ΜΕ το πρόθεμα χώρας (π.χ. «ATU12345678»). Πριν κρατούσαμε μόνο τα ψηφία: ένα ξένο ΑΦΜ
  // έχανε το πρόθεμά του, γινόταν «ελληνικό», έπεφτε στον έλεγχο της ΑΑΔΕ και ο διάλογος κολλούσε.
  const rawAfm = afmInput.toUpperCase().replace(/[\s.\-/]/g, '');
  const prefixCountry = vatCountry(rawAfm);
  // Η χώρα: από το πρόθεμα· αλλιώς ό,τι διάλεξε ο χρήστης.
  const country = prefixCountry ?? (countryPick || null);
  const isForeign = country != null && country !== 'GR';
  // Ελληνικό ΑΦΜ στέλνεται πάντα σκέτο (χωρίς «EL»).
  const cleanAfm = isForeign ? rawAfm : rawAfm.replace(/^(EL|GR)/, '').replace(/\D/g, '');
  const isGreek = !isForeign && /^\d{9}$/.test(cleanAfm);

  const runLookup = React.useCallback(async (theAfm: string) => {
    const clean = theAfm.replace(/\D/g, '');
    if (!/^\d{9}$/.test(clean)) { setError('Μη έγκυρο ελληνικό ΑΦΜ (9 ψηφία).'); return; }
    setLoading(true); setError(null); setData(null); setDryPayload(null);
    try {
      const res = await fetch('/api/admin/ocr/supplier-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afm: clean }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error === 'not_found' ? 'Δεν βρέθηκε στην ΑΑΔΕ.' : (d?.message ?? 'Αποτυχία άντλησης από ΑΑΔΕ.'));
      } else {
        setData(d);
        if (d?.name) setName(d.name);
      }
    } catch {
      setError('Σφάλμα δικτύου.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Άνοιγμα: καθάρισε, άντλησε ΑΑΔΕ και ζήτα προτεινόμενο κωδικό ΑΥΤΟΥ του τύπου.
  React.useEffect(() => {
    if (!open) return;
    const initAfm = (afm || '').toUpperCase().replace(/[\s.\-/]/g, '');
    setAfmInput(initAfm);
    setCountryPick(countryHint && countryHint !== 'GR' ? countryHint : '');
    setName(fallbackName || '');
    // Η «Δοκιμή» ξεκινά ΑΝΟΙΧΤΗ μέχρι να μάθουμε τον διακόπτη — ποτέ δεν υποθέτουμε «στείλ' το».
    setCode(''); setData(null); setError(null); setDryPayload(null); setDryRun(true);
    setCodeError(null); setCodeOffer(null); setSuggestion(null);
    proposed.current = null;
    // Ξένος εκδότης (πρόθεμα χώρας): η ΑΑΔΕ δεν έχει θέση — καμία κλήση, κανένα σφάλμα.
    const initCountry = vatCountry(initAfm);
    if (initCountry && initCountry !== 'GR') return;
    // Ξένος από τη διεύθυνση του παραστατικού (ΑΦΜ χωρίς πρόθεμα): επίσης χωρίς ΑΑΔΕ.
    if (countryHint && countryHint !== 'GR' && !isValidAfm(initAfm)) return;
    const greek = initAfm.replace(/^(EL|GR)/, '');
    if (/^\d{9}$/.test(greek) && isValidAfm(greek)) void runLookup(greek);
  }, [open, afm, fallbackName, countryHint, runLookup]);

  /**
   * Η «Δοκιμή» ΑΚΟΛΟΥΘΕΙ τον διακόπτη `softone.postingEnabled`.
   *
   * Πριν, ήταν καρφωτά `true`: σε εγκατάσταση που καταχωρεί κανονικά, ο χρήστης συμπλήρωνε
   * ΑΦΜ, επωνυμία, ΔΟΥ, ΚΑΔ, διεύθυνση και κωδικό, και το κουμπί έλεγε «Προετοιμασία object» —
   * δηλαδή η φόρμα δεν ολοκλήρωνε τίποτα κι έπρεπε να ξέρεις να ξετσεκάρεις ένα checkbox.
   * Τώρα: καταχώριση ανοιχτή → ο διάλογος ανοίγει έτοιμος να δημιουργήσει, με τη «Δοκιμή» ως
   * προαιρετική έξοδο· κλειστή → η «Δοκιμή» κλειδώνει και ο διάλογος ΛΕΕΙ γιατί, αντί να
   * φαίνεται σαν να μη δουλεύει.
   */
  const [postingEnabled, setPostingEnabled] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let ignore = false;
    setPostingEnabled(null);
    fetch('/api/admin/ocr/posting-enabled', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean } | null) => {
        if (ignore || d == null) return;
        setPostingEnabled(d.enabled === true);
        setDryRun(d.enabled !== true);
      })
      .catch(() => { if (!ignore) setPostingEnabled(null); });
    return () => { ignore = true; };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let ignore = false;
    fetch(`/api/admin/ocr/new-traders/next-code?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CodeSuggestion | null) => {
        if (ignore || !d) return;
        setSuggestion(d);
        // Γράφουμε ΜΟΝΟ σε κενό πεδίο ή πάνω στη δική μας προηγούμενη πρόταση.
        setCode((cur) => (cur === '' || cur === proposed.current ? (d.code ?? '') : cur));
        proposed.current = d.code ?? null;
      })
      .catch(() => null);
    return () => { ignore = true; };
  }, [open, kind]);

  const submit = async () => {
    if (!name.trim() || !cleanAfm) { toast.error('Συμπλήρωσε Επωνυμία και ΑΦΜ.'); return; }
    if (!country && !isValidAfm(cleanAfm)) { toast.error('Διάλεξε τη χώρα του εκδότη — το ΑΦΜ δεν είναι ελληνικό.'); return; }
    setSubmitting(true);
    setCodeError(null); setCodeOffer(null);
    try {
      const res = await fetch(`/api/admin/ocr/new-traders/${encodeURIComponent(cleanAfm)}/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          code: code.trim() || null,
          country: country ?? 'GR',
          // Δ.Ο.Υ./ΚΑΔ υπάρχουν μόνο για ελληνικό εκδότη με απάντηση ΑΑΔΕ.
          irsData: isForeign ? null : data?.softoneDoy?.office?.key ?? null,
          profession: isForeign ? null : data?.profession ?? null,
          ...(isForeign ? { kad: null, kad1: null } : kadPayload(data?.softoneKad, kadRemoved)),
          address: data?.address ?? null,
          zip: data?.zip ?? null,
          city: data?.city ?? null,
          phone: contacts?.phone ?? null, phone2: contacts?.phone2 ?? null, fax: contacts?.fax ?? null,
          email: contacts?.email ?? null, webpage: contacts?.webpage ?? null,
          dryRun,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Άρνηση του ERP για τον κωδικό: δείχνουμε το ΔΙΚΟ του μήνυμα και την πρότασή του.
        if (d?.field === 'code') {
          setCodeError(d.message ?? 'Ο κωδικός δεν έγινε δεκτός.');
          setCodeOffer(d.suggestion ?? null);
        }
        toast.error(d?.message ?? 'Αποτυχία δημιουργίας στο SoftOne');
        return;
      }
      if (d?.dryRun) {
        setDryPayload(d.payload);
        toast.success('Ετοιμάστηκε το object — δεν στάλθηκε τίποτα στο SoftOne.');
        return;
      }
      if (d.existing) {
        toast.info(`Υπήρχε ήδη ${text.nom}: ${d.name}${d.code ? ` (${d.code})` : ''}`, {
          description: 'Δεν δημιουργήθηκε δεύτερη καρτέλα για τον ίδιο ΑΦΜ — το παραστατικό συνδέθηκε στην υπάρχουσα.',
        });
      } else {
        toast.success(`Δημιουργήθηκε ${text.nom}: ${d.name}${d.code ? ` (${d.code})` : ''}`, {
          description: d.docsUpdated > 1 ? `Συνδέθηκε σε ${d.docsUpdated} παραστατικά του ίδιου ΑΦΜ.` : undefined,
        });
      }
      if (Array.isArray(d.warnings) && d.warnings.includes('country_not_found') && d.country && d.country !== 'GR') {
        toast.warning(`Η χώρα ${d.country} δεν υπάρχει στο μητρώο χωρών του SoftOne.`, {
          description: 'Η καρτέλα δημιουργήθηκε με την προεπιλεγμένη χώρα της SoftOne — διόρθωσέ τη μέσα στην καρτέλα ή πρόσθεσε τη χώρα στο μητρώο.',
          duration: 12000,
        });
      }
      if (Array.isArray(d.warnings) && d.warnings.includes('kad_not_saved')) {
        toast.warning('Ο ΚΑΔ δεν αποθηκεύτηκε στο SoftOne.', {
          description: 'Η καρτέλα δημιουργήθηκε· συμπλήρωσε τον ΚΑΔ μέσα στο SoftOne (Επιπλέον στοιχεία → Κ.Α.Δ.).',
        });
      }
      onCreated?.({ trdr: d.trdr, code: d.code, name: d.name, docsUpdated: d.docsUpdated ?? 0 });
      onOpenChange(false);
    } catch {
      toast.error('Σφάλμα δικτύου');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="gap-1 border-b border-border px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2.5 text-[length:var(--fs-15)]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600"><FiUser className="h-4 w-4" /></span>
            Νέος {text.nom} {isGreek ? 'από ΑΑΔΕ' : isForeign ? `— ${countryLabel(country)}` : ''}
          </DialogTitle>
          <DialogDescription className="text-[length:var(--fs-12)]">
            Ο τύπος καρτέλας δεν επιλέγεται: τον ορίζει η σειρά του παραστατικού.
            {reason ? ` ${reason}.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[66vh] space-y-3 overflow-auto bg-muted/20 px-4 py-3">
          {/* ── 1. ΤΑΥΤΟΤΗΤΑ: ΑΦΜ + κωδικός σε μία σειρά, επωνυμία από κάτω· οι βοήθειες κάτω από τη σειρά. */}
          <FormSection tone="blue" icon={<FiUser />} title="Ταυτότητα">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <KitField label="ΑΦΜ" required htmlFor="ct-afm" className="col-span-12 sm:col-span-7">
                <div className="flex min-w-0 gap-1.5">
                  <Input id="ct-afm" value={afmInput} onChange={(e) => { setAfmInput(e.target.value); setError(null); }} placeholder="ξένο με πρόθεμα, π.χ. DE123456789" className={cn(fieldCls, 'min-w-0 flex-1 font-mono')} />
                  {!isForeign && (
                    <Button variant="outline" className="h-8 shrink-0 px-2 text-[length:var(--fs-12)]" disabled={!isGreek || loading} onClick={() => runLookup(cleanAfm)}>
                      <FiDownloadCloud className="mr-1 size-3.5" /> {loading ? 'Άντληση…' : 'ΑΑΔΕ'}
                    </Button>
                  )}
                </div>
              </KitField>
              <KitField label="Κωδικός SoftOne" required htmlFor="ct-code" className="col-span-12 sm:col-span-5">
                <Input id="ct-code" value={code} onChange={(e) => { setCode(e.target.value); setCodeError(null); }}
                  placeholder={`κωδικός ${text.acc}`} aria-invalid={codeError ? true : undefined} className={cn(fieldCls, 'font-mono')} />
              </KitField>
              {!prefixCountry && afmInput && !isValidAfm(cleanAfm) && (
                <KitField
                  label={<>Χώρα εκδότη{countryHint && countryPick === countryHint && <span className="font-normal"> · από τη διεύθυνση</span>}</>}
                  required className="col-span-12 sm:col-span-7"
                >
                  <FormSelect value={countryPick} onChange={(v) => { setCountryPick(v); setError(null); setData(null); }}
                    opts={COUNTRY_OPTIONS.map((c) => ({ id: c, name: countryLabel(c) }))} placeholder="Διάλεξε χώρα" ariaLabel="Χώρα εκδότη" />
                </KitField>
              )}
              <KitField label="Επωνυμία" required htmlFor="ct-name" className="col-span-12">
                <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Επωνυμία ${text.acc}`} className={fieldCls} />
              </KitField>
            </div>
            {isForeign ? (
              <RowHint>Εκδότης από <strong className="text-foreground">{countryLabel(country)}</strong> — χωρίς ΑΑΔΕ. Θα γραφτεί ως <span className="font-mono text-foreground">{applyVatPrefix(cleanAfm, country ?? '')}</span>.</RowHint>
            ) : afmInput && !isValidAfm(cleanAfm) ? (
              <RowHint tone="warn">Δεν είναι έγκυρο ελληνικό ΑΦΜ. Αν ο εκδότης είναι από άλλη χώρα, διάλεξέ την· αλλιώς διόρθωσε το ΑΦΜ.</RowHint>
            ) : null}
            {codeError ? (
              <RowHint tone="bad">
                {codeError}
                {codeOffer && (
                  <button type="button" onClick={() => { setCode(codeOffer); setCodeError(null); }} className="ml-1.5 cursor-pointer font-semibold underline">Χρήση του {codeOffer}</button>
                )}
              </RowHint>
            ) : suggestion ? (
              <RowHint tone={suggestion.stale ? 'warn' : 'muted'}>
                {suggestion.code
                  ? `Κωδικός: ο επόμενος της σειράς ${text.acc} (${suggestion.taken} υπάρχοντες).`
                  : 'Δεν υπάρχει αρκετό δείγμα για πρόταση κωδικού — συμπλήρωσέ τον.'}
                {suggestion.stale && ' Η SoftOne δεν απάντησε — η πρόταση βγήκε από τον τοπικό καθρέφτη.'}
              </RowHint>
            ) : null}
          </FormSection>

          {isForeign && (
            <FormSection tone="emerald" icon={<FiGlobe />} title="Έλεγχος VIES" aside="μόνο όταν τον πατάς">
              <ViesCheck
                vat={applyVatPrefix(cleanAfm, country ?? '')}
                onResult={(r) => { if (r.valid && r.name && !name.trim()) setName(r.name); }}
              />
            </FormSection>
          )}

          {loading && <div className="space-y-1.5" role="status"><span className="sr-only">Άντληση από ΑΑΔΕ…</span>{[0, 1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}</div>}
          {error && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
              <FiAlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}

          {/* ── 2. ΑΠΟ ΤΗΝ ΑΑΔΕ: ό,τι θα γραφτεί, σε στοιχισμένες σειρές «ετικέτα · τιμή». */}
          {data && (
            <FormSection
              tone="emerald" icon={<FiDownloadCloud />} title="Από την ΑΑΔΕ"
              aside={data.isActive ? <span className="text-emerald-800 dark:text-emerald-300">ενεργό ΑΦΜ</span> : <span className="font-semibold text-destructive">ανενεργό ΑΦΜ</span>}
            >
              <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[length:var(--fs-12)]">
                <dt className="text-muted-foreground">Δ.Ο.Υ.</dt>
                <dd className="min-w-0">
                  {data.doyDescr ? `${data.doyDescr}${data.doyCode ? ` (${data.doyCode})` : ''}` : '—'}
                  {data.softoneDoy?.office
                    ? <span className="block text-[length:var(--fs-11)] text-emerald-700 dark:text-emerald-300">→ SoftOne: {data.softoneDoy.office.name} ({data.softoneDoy.office.code})</span>
                    : data.softoneDoy?.note ? <span className="block text-[length:var(--fs-11)] text-amber-800 dark:text-amber-300">{data.softoneDoy.note} Θα μείνει κενή.</span> : null}
                </dd>
                <dt className="text-muted-foreground">Επάγγελμα</dt><dd className="min-w-0">{data.profession || '—'}</dd>
                <dt className="text-muted-foreground">Διεύθυνση</dt><dd className="min-w-0">{[data.address, data.zip, data.city].filter(Boolean).join(', ') || '—'}</dd>
                <dt className="text-muted-foreground">Νομική μορφή</dt><dd className="min-w-0">{data.legalForm || '—'}</dd>
                {data.softoneKad && (data.softoneKad.primary || data.softoneKad.secondary) && (
                  <><dt className="pt-0.5 text-muted-foreground">ΚΑΔ</dt><dd className="min-w-0"><KadField kads={data.softoneKad} removed={kadRemoved} onToggle={toggleKad} /></dd></>
                )}
              </dl>
            </FormSection>
          )}

          {/* ── 3. ΑΠΟ ΤΟ ΠΑΡΑΣΤΑΤΙΚΟ: επικοινωνία (η ΑΑΔΕ δεν τη δίνει). */}
          {contacts && Object.values(contacts).some(Boolean) && (
            <FormSection tone="violet" icon={<FiPhone />} title="Επικοινωνία" aside="από το παραστατικό">
              <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[length:var(--fs-12)]">
                {([['Τηλέφωνο', contacts.phone], ['Τηλέφωνο 2', contacts.phone2], ['Fax', contacts.fax], ['Email', contacts.email], ['Ιστοσελίδα', contacts.webpage]] as const)
                  .filter(([, v]) => v)
                  .map(([k, v]) => <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 truncate">{v}</dd></React.Fragment>)}
              </dl>
            </FormSection>
          )}

          {dryPayload != null && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[length:var(--fs-11)] font-medium text-emerald-700">Object από τον server (dry-run) — αυτό ακριβώς θα σταλεί στο SoftOne:</p>
              <pre className="overflow-auto rounded-xl border border-border bg-[#0E1626] p-4 font-mono text-[length:var(--fs-11)] leading-relaxed text-[#d6e2f5]">{JSON.stringify(dryPayload, null, 2)}</pre>
            </div>
          )}
        </div>

        {/* `mx-0 mb-0`: το DialogFooter έχει `-mx-4 -mb-4` για modal με padding· εδώ είναι `p-0`. */}
        <DialogFooter className="mx-0 mb-0 flex-col gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className={cn('flex items-center gap-2 text-[length:var(--fs-12)] text-muted-foreground',
            postingEnabled === false ? 'cursor-not-allowed' : 'cursor-pointer')}>
            <input
              type="checkbox" checked={dryRun} disabled={postingEnabled === false}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-3.5 w-3.5 accent-sisyphus-600 disabled:opacity-50"
            />
            {postingEnabled === false
              ? 'Η καταχώριση στο SoftOne είναι κλειστή (Ρυθμίσεις → Διασυνδέσεις) — μόνο προετοιμασία object'
              : 'Δοκιμή — μόνο προετοιμασία object (χωρίς αποστολή)'}
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Άκυρο</Button>
            <Button onClick={submit} disabled={submitting || !name.trim() || !cleanAfm}>
              <FiCheckCircle className="mr-1.5 h-4 w-4" />
              {submitting ? '…' : dryRun ? 'Προετοιμασία object' : `Δημιουργία ${text.acc} στο SoftOne`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
