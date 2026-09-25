'use client';

import * as React from 'react';
import { FiAlertTriangle, FiChevronDown, FiLoader } from 'react-icons/fi';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Option = { code: string; descr: string; rate: number | null };

/**
 * Λύνει το `no_vat_category` **επί τόπου**: αντιστοιχίζει έναν συντελεστή γραμμής σε κατηγορία
 * ΦΠΑ του SoftOne.
 *
 * ΓΙΑΤΙ ΧΡΕΙΑΖΕΤΑΙ ΑΝΘΡΩΠΟΣ. Δεν είναι κενό συγχρονισμού — το μητρώο είναι ενημερωμένο. Οι
 * **μηδενικές** κατηγορίες του SoftOne («Μηδενικός Συντελεστής ΦΠΑ 0 %», «Άρθρο 39α 0 %») απλώς
 * δεν δηλώνουν ποσοστό, οπότε καμία αυτόματη αντιστοίχιση δεν μπορεί να βγάλει κλειδί `0`. Και
 * δεν είναι μία: ποια ισχύει για τη συγκεκριμένη χρέωση είναι **φορολογική** απόφαση, όχι
 * αριθμητική. Ρωτάμε μία φορά, το θυμόμαστε για κάθε επόμενο παραστατικό, και δεν εφευρίσκουμε
 * ποτέ κωδικό: οι επιλογές είναι αυτούσιο το συγχρονισμένο μητρώο.
 */
export function VatMapFix({
  docId, missing, onFixed,
}: {
  docId: string;
  /** Οι συντελεστές χωρίς κωδικό. `null` = γραμμή χωρίς τυπωμένο συντελεστή. */
  missing: (number | null)[];
  onFixed: () => void;
}) {
  const rates = missing.filter((r): r is number => r != null);
  const hasNullRate = missing.some((r) => r == null);
  const [rate, setRate] = React.useState<number | null>(rates[0] ?? null);
  const [options, setOptions] = React.useState<Option[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => { setRate(rates[0] ?? null); }, [missing.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open || rate == null) return;
    let ignore = false;
    setOptions(null);
    fetch(`/api/admin/ocr/vat-map?rate=${rate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { options?: Option[] } | null) => { if (!ignore) setOptions(d?.options ?? []); })
      .catch(() => { if (!ignore) setOptions([]); });
    return () => { ignore = true; };
  }, [open, rate]);

  const save = async (code: string) => {
    if (rate == null) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/vat-map', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate, code }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message ?? 'Η αντιστοίχιση απέτυχε.'); return; }
      toast.success(`ΦΠΑ ${rate} % → κατηγορία ${code}`, {
        description: 'Θα ισχύει σε κάθε παραστατικό, όχι μόνο σε αυτό.',
      });
      setOpen(false);
      onFixed();
    } catch {
      toast.error('Σφάλμα δικτύου');
    } finally {
      setBusy(false);
    }
  };

  // Γραμμή χωρίς κανέναν συντελεστή δεν λύνεται με αντιστοίχιση — λύνεται διορθώνοντας τη γραμμή.
  if (rates.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[length:var(--fs-11)] font-medium" title="Διόρθωσε τον συντελεστή στη γραμμή">
        <FiAlertTriangle aria-hidden className="size-3" /> Γραμμή χωρίς ΦΠΑ
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="vat-map-fix"
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[length:var(--fs-11)] font-semibold hover:bg-current/5">
          Αντιστοίχισε <FiChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] space-y-2">
        <p className="text-caption text-muted-foreground">
          Το μητρώο ΦΠΑ είναι συγχρονισμένο, αλλά οι κατηγορίες αυτού του συντελεστή δεν δηλώνουν
          ποσοστό στο SoftOne — γι' αυτό δεν βρίσκεται μόνο του. Διάλεξε ποια ισχύει· η επιλογή
          θυμάται και ισχύει για όλα τα παραστατικά.
        </p>

        {rates.length > 1 && (
          <label className="grid gap-1">
            <span className="text-caption font-medium text-muted-foreground">Συντελεστής</span>
            <select value={rate ?? ''} onChange={(e) => setRate(Number(e.target.value))}
              className="h-9 w-full cursor-pointer rounded-lg border border-input bg-background px-2.5 text-[length:var(--fs-13)]">
              {rates.map((r) => <option key={r} value={r}>{r} %</option>)}
            </select>
          </label>
        )}

        <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          Κατηγορία ΦΠΑ για {rate} %
        </p>
        {options == null ? (
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <FiLoader aria-hidden className="size-3 animate-spin motion-reduce:animate-none" /> Φόρτωση μητρώου…
          </p>
        ) : options.length === 0 ? (
          <p className="text-caption" style={{ color: '#B45309' }}>
            Το μητρώο ΦΠΑ είναι άδειο — συγχρόνισέ το πρώτα (Ρυθμίσεις → SoftOne).
          </p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-auto" aria-label="Κατηγορίες ΦΠΑ">
            {options.map((o) => (
              <li key={o.code}>
                <button type="button" disabled={busy} onClick={() => void save(o.code)}
                  className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md border border-border px-2 py-1.5 text-left outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="text-[length:var(--fs-13)] font-medium text-foreground">{o.descr || o.code}</span>
                  <span className="text-caption text-muted-foreground">
                    κωδικός <span className="font-mono">{o.code}</span>
                    {o.rate != null ? ` · δηλώνει ${o.rate} %` : ' · χωρίς δηλωμένο ποσοστό'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {hasNullRate && (
          <p className="flex items-start gap-1 text-caption" style={{ color: '#B45309' }}>
            <FiAlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
            Υπάρχει και γραμμή <strong>χωρίς</strong> τυπωμένο συντελεστή — αυτή διορθώνεται στη
            γραμμή, όχι εδώ.
          </p>
        )}
        <p className="sr-only">Παραστατικό {docId}</p>
      </PopoverContent>
    </Popover>
  );
}
