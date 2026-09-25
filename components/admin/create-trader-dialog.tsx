'use client';

import * as React from 'react';
import { FiAlertTriangle, FiCheckCircle, FiDownloadCloud, FiUser } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { TRADER_KIND_TEXT, type TraderKindName } from '@/lib/ocr/posting-target';
import type { TaxOfficeMapping } from '@/lib/tax-office';
import { cn } from '@/lib/utils';

type Preview = {
  afm: string; name: string;
  doyDescr: string | null; doyCode: string | null;
  softoneDoy: TaxOfficeMapping;
  profession: string | null; address: string | null; zip: string | null; city: string | null;
  legalForm: string | null; isActive: boolean;
};

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
  open, onOpenChange, afm, kind, fallbackName, reason, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  afm: string;
  /** Ο τύπος που **επιβάλλει** η σειρά του παραστατικού. */
  kind: TraderKindName;
  fallbackName?: string | null;
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
  const [submitting, setSubmitting] = React.useState(false);
  const [dryRun, setDryRun] = React.useState(true);
  const [dryPayload, setDryPayload] = React.useState<unknown>(null);
  const [suggestion, setSuggestion] = React.useState<CodeSuggestion | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [codeOffer, setCodeOffer] = React.useState<string | null>(null);
  const proposed = React.useRef<string | null>(null);

  const cleanAfm = afmInput.replace(/\D/g, '');
  const isGreek = /^\d{9}$/.test(cleanAfm);

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
    const initAfm = (afm || '').replace(/\D/g, '');
    setAfmInput(initAfm);
    setName(fallbackName || '');
    // Η «Δοκιμή» ξεκινά ΑΝΟΙΧΤΗ μέχρι να μάθουμε τον διακόπτη — ποτέ δεν υποθέτουμε «στείλ' το».
    setCode(''); setData(null); setError(null); setDryPayload(null); setDryRun(true);
    setCodeError(null); setCodeOffer(null); setSuggestion(null);
    proposed.current = null;
    if (/^\d{9}$/.test(initAfm)) void runLookup(initAfm);
    else setError('Το ΑΦΜ του παραστατικού δεν είναι ελληνικό 9ψήφιο — διόρθωσέ το για άντληση ΑΑΔΕ ή συμπλήρωσε χειροκίνητα.');
  }, [open, afm, fallbackName, runLookup]);

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
    setSubmitting(true);
    setCodeError(null); setCodeOffer(null);
    try {
      const res = await fetch(`/api/admin/ocr/new-traders/${cleanAfm}/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          code: code.trim() || null,
          country: 'GR',
          irsData: data?.softoneDoy?.office?.key ?? null,
          profession: data?.profession ?? null,
          address: data?.address ?? null,
          zip: data?.zip ?? null,
          city: data?.city ?? null,
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
      toast.success(`Δημιουργήθηκε ${text.nom}: ${d.name}${d.code ? ` (${d.code})` : ''}`, {
        description: d.docsUpdated > 1 ? `Συνδέθηκε σε ${d.docsUpdated} παραστατικά του ίδιου ΑΦΜ.` : undefined,
      });
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
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 border-b border-border px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2.5 text-[length:var(--fs-15)]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600"><FiUser className="h-4 w-4" /></span>
            Νέος {text.nom} {isGreek ? 'από ΑΑΔΕ' : ''}
          </DialogTitle>
          <DialogDescription className="text-[length:var(--fs-12)]">
            Ο τύπος καρτέλας δεν επιλέγεται: τον ορίζει η σειρά του παραστατικού.
            {reason ? ` ${reason}.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-auto px-5 py-4">
          <div className="grid gap-1.5">
            <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">ΑΦΜ <span className="text-destructive">*</span></span>
            <div className="flex gap-2">
              <Input value={afmInput} onChange={(e) => setAfmInput(e.target.value)} placeholder="9ψήφιο ελληνικό ΑΦΜ" className="h-9 font-mono text-[length:var(--fs-13)]" />
              <Button variant="outline" className="h-9 shrink-0 text-[length:var(--fs-12)]" disabled={!isGreek || loading} onClick={() => runLookup(afmInput)}>
                <FiDownloadCloud className="mr-1.5 h-3.5 w-3.5" /> {loading ? 'Άντληση…' : 'Άντληση ΑΑΔΕ'}
              </Button>
            </div>
            {!isGreek && afmInput && (
              <span className="text-[length:var(--fs-11)] text-amber-700">Μη ελληνικό/μη έγκυρο ΑΦΜ — η ΑΑΔΕ δεν είναι διαθέσιμη. Μπορείς να δημιουργήσεις χειροκίνητα.</span>
            )}
          </div>

          <label className="grid gap-1.5">
            <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">Επωνυμία <span className="text-destructive">*</span></span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Επωνυμία ${text.acc}`} className="h-9 text-[length:var(--fs-13)]" />
          </label>

          {loading && <div className="py-2 text-center text-[length:var(--fs-12)] text-muted-foreground">Άντληση από ΑΑΔΕ…</div>}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border p-3 text-[length:var(--fs-12)]" style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}>
              <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {data && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Νομική μορφή" value={data.legalForm} />
                <Field
                  label="Δ.Ο.Υ."
                  value={data.doyDescr ? `${data.doyDescr}${data.doyCode ? ` (${data.doyCode})` : ''}` : null}
                  hint={data.softoneDoy?.office
                    ? <span className="text-emerald-700">→ SoftOne: {data.softoneDoy.office.name} ({data.softoneDoy.office.code})</span>
                    : data.softoneDoy?.note
                      ? <span className="text-amber-700">{data.softoneDoy.note} Θα μείνει κενή.</span>
                      : null}
                />
              </div>
              <Field label="Επάγγελμα (ΚΑΔ)" value={data.profession} />
              <Field label="Διεύθυνση" value={[data.address, data.zip, data.city].filter(Boolean).join(', ') || null} />
              {!data.isActive && (
                <div className="rounded-md border p-2.5 text-[length:var(--fs-12)]" style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}>
                  Προσοχή: η ΑΑΔΕ δηλώνει το ΑΦΜ ως ανενεργό.
                </div>
              )}
            </div>
          )}

          <label className="grid gap-1.5">
            <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">
              Κωδικός SoftOne <span className="text-destructive">*</span>
            </span>
            <Input
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeError(null); }}
              placeholder={`κωδικός ${text.acc}`}
              aria-invalid={codeError ? true : undefined}
              className="h-9 font-mono text-[length:var(--fs-13)]"
            />
            {codeError ? (
              <span className="text-[length:var(--fs-11)]" style={{ color: '#B91C1C' }}>
                {codeError}
                {codeOffer && (
                  <button type="button" onClick={() => { setCode(codeOffer); setCodeError(null); }}
                    className="ml-1.5 cursor-pointer font-semibold underline">
                    Χρήση του {codeOffer}
                  </button>
                )}
              </span>
            ) : suggestion ? (
              <span className="text-[length:var(--fs-11)] text-muted-foreground">
                {suggestion.code
                  ? `Προτεινόμενος από τη σειρά κωδικών ${text.acc} (${suggestion.taken} υπάρχοντες).`
                  : 'Δεν υπάρχει αρκετό δείγμα για πρόταση — συμπλήρωσε κωδικό.'}
                {suggestion.stale && ' Προσοχή: το SoftOne δεν απάντησε, η πρόταση βγήκε από τον τοπικό καθρέφτη και μπορεί να είναι πιασμένη.'}
              </span>
            ) : null}
          </label>

          {dryPayload != null && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[length:var(--fs-11)] font-medium text-emerald-700">Object από τον server (dry-run) — αυτό ακριβώς θα σταλεί στο SoftOne:</p>
              <pre className="overflow-auto rounded-xl border border-border bg-[#0E1626] p-4 font-mono text-[length:var(--fs-11)] leading-relaxed text-[#d6e2f5]">{JSON.stringify(dryPayload, null, 2)}</pre>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
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

function Field({ label, value, hint }: { label: string; value: string | null; hint?: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">{label}</span>
      <span className="text-[length:var(--fs-13)] text-foreground">{value || <span className="text-muted-foreground">—</span>}</span>
      {hint && <span className="text-[length:var(--fs-11)]">{hint}</span>}
    </div>
  );
}
