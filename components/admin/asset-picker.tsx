'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiAlertTriangle, FiLoader, FiPlusCircle, FiSearch } from 'react-icons/fi';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_GHOST, BTN_PRIMARY } from '@/components/admin/bulk-ui';
import { guessAssetCategories } from '@/lib/ocr/asset-code';
import { DEPRECIATION_SOURCE, LOW_VALUE_LIMIT, depreciationAdvice, legalClassForGl, legalClassForLine } from '@/lib/ocr/depreciation';
import { Term } from '@/components/admin/help/term';

const eur = (n: number) => `${n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export interface AssetPick { mtrl: number; code: string; name: string }

const INPUT = 'h-10 w-full rounded-md border border-input bg-background px-3 text-[length:var(--fs-14)]';
const LABEL = 'text-[length:var(--fs-12)] font-medium text-muted-foreground';

/** Αναζήτηση στο μητρώο παγίων (τοπικός καθρέφτης). */
export function AssetSearch({ id, disabled, onPick }: { id: string; disabled?: boolean; onPick: (a: AssetPick) => void | Promise<void> }) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<(AssetPick & { acnmsk: string | null })[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/admin/softone/assets?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results ?? []))
        .catch(() => { /* ακυρώθηκε */ })
        .finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>Υπάρχον πάγιο</label>
      <div className="relative">
        <FiSearch aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id} value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled}
          placeholder="Κωδικός ή περιγραφή παγίου…"
          className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-[length:var(--fs-13)]"
        />
        {loading && <FiLoader aria-hidden className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" />}
      </div>
      {results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-border">
          {results.map((r) => (
            <li key={r.mtrl}>
              <button
                type="button" disabled={disabled} onClick={() => void onPick(r)}
                className="flex min-h-9 w-full items-center gap-2 px-2.5 text-left text-[length:var(--fs-12)] hover:bg-[var(--cx-hover)] disabled:opacity-60"
              >
                <span className="font-mono text-[length:var(--fs-11)] text-muted-foreground">{r.code}</span>
                <span className="min-w-0 truncate">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !loading && results.length === 0 && (
        <p className="text-caption text-muted-foreground">Κανένα πάγιο — δημιούργησε νέο.</p>
      )}
    </div>
  );
}

type FormData = {
  glCategories: { mtrAcn: number; code: string; name: string; acnmsk: string | null; depreciation: number | null }[];
  categories: { mtrCategory: number; code: string; name: string }[];
  proposedCode: Record<number, string>;
  vats: { code: string; label: string; rate: number | null }[];
  vatByRate: Record<number, number>;
  whouse: number | null;
};

/**
 * Νέο πάγιο στο SoftOne από μια γραμμή παραστατικού. Η λογιστική κατηγορία ορίζει απόσβεση και
 * λογαριασμούς· ο κωδικός προτείνεται ως «λογαριασμός αγορών + αύξων». Τίποτα δεν φεύγει χωρίς το
 * ρητό «Δημιουργία στο SoftOne».
 */
export function CreateAssetDialog({ open, onOpenChange, lineId, lineName, lineVatRate, lineAmount, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lineId: string;
  lineName: string | null;
  lineVatRate: string | number | null;
  /** Η αξία κτήσης (σύνολο γραμμής) — για την ετήσια απόσβεση και το όριο των 1.500 €. */
  lineAmount?: number | null;
  onCreated: (a: AssetPick) => void;
}) {
  const [data, setData] = React.useState<FormData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState('');
  const [mtrAcn, setMtrAcn] = React.useState<number | null>(null);
  const [mtrCategory, setMtrCategory] = React.useState<number | null>(null);
  const [code, setCode] = React.useState('');
  const [codeTouched, setCodeTouched] = React.useState(false);
  const [vat, setVat] = React.useState('');
  /** Φορολογικός συντελεστής για ΑΥΤΟ το πάγιο — προτείνεται του νόμου, ο χρήστης τον αλλάζει. */
  const [rate, setRate] = React.useState('');
  const [rateTouched, setRateTouched] = React.useState(false);
  const [immediate, setImmediate] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError(null); setName(lineName ?? ''); setCodeTouched(false); setRateTouched(false); setImmediate(false);
    fetch('/api/admin/softone/assets/lookups')
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.message ?? 'Οι κατηγορίες δεν φορτώθηκαν.'); return d as FormData; })
      .then((d) => {
        setData(d);
        const g = guessAssetCategories(lineName, d.glCategories, d.categories);
        // Χωρίς οικογένεια από την περιγραφή: η κατηγορία του ΝΟΜΟΥ διαλέγει λογιστική κατηγορία (π.χ. φορτηγό → ΦΙΧ).
        const cls = legalClassForLine(lineName);
        setMtrAcn(g.mtrAcn ?? (cls ? d.glCategories.find((x) => legalClassForGl(x.name, x.acnmsk) === cls)?.mtrAcn ?? null : null));
        setMtrCategory(g.mtrCategory);
        const rate = lineVatRate == null || lineVatRate === '' ? null : Number(lineVatRate);
        const v = rate != null && Number.isFinite(rate) ? d.vatByRate[rate] : undefined;
        setVat(v != null ? String(v) : '');
      })
      .catch((e: Error) => setError(e.message));
  }, [open, lineName, lineVatRate]);

  // Νέα λογιστική κατηγορία ⇒ νέος προτεινόμενος κωδικός, εκτός αν ο χρήστης τον έγραψε ο ίδιος.
  React.useEffect(() => {
    if (!data || codeTouched) return;
    setCode(mtrAcn != null ? data.proposedCode[mtrAcn] ?? '' : '');
  }, [data, mtrAcn, codeTouched]);

  const gl = data?.glCategories.find((g) => g.mtrAcn === mtrAcn);
  const advice = React.useMemo(
    () => (data ? depreciationAdvice({ lineName: name || lineName, amount: lineAmount, gl }) : null),
    [data, name, lineName, lineAmount, gl],
  );
  // Νέα πρόταση (άλλη κατηγορία/περιγραφή) ⇒ νέος συντελεστής, εκτός αν ο χρήστης τον έγραψε ο ίδιος.
  React.useEffect(() => {
    if (rateTouched) return;
    setRate(advice ? String(advice.rate) : gl?.depreciation != null ? String(gl.depreciation) : '');
  }, [advice, gl, rateTouched]);
  const rateNum = rate.trim() === '' ? null : Number(rate.replace(',', '.'));
  const rateOk = rateNum == null || (Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100);
  const amount = lineAmount != null && Number.isFinite(lineAmount) ? Math.abs(lineAmount) : null;
  const lowValue = amount != null && amount > 0 && amount < LOW_VALUE_LIMIT;
  const ready = !!name.trim() && mtrAcn != null && !!code.trim() && !!vat && rateOk && !busy;

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/admin/softone/assets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(), name: name.trim(), mtrAcn, mtrCategory, vat, lineId,
          depreciationRate: rateNum, immediateDepreciation: lowValue && immediate,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message ?? 'Η δημιουργία απέτυχε.'); return; }
      toast.success(`Δημιουργήθηκε το πάγιο ${d.asset.code} «${d.asset.name}»`, {
        description: `Η γραμμή αντιστοιχίστηκε στο νέο πάγιο.${d.asset.depreciation?.rate != null ? ` Συντελεστής απόσβεσης στο SoftOne: ${d.asset.depreciation.rate}%.` : ''}`,
      });
      if (d.asset.depreciationWarning) toast.warning(d.asset.depreciationWarning);
      onCreated(d.asset);
    } catch {
      setError('Σφάλμα δικτύου — το πάγιο δεν δημιουργήθηκε.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Νέο πάγιο στο SoftOne</DialogTitle>
          <DialogDescription>Η γραμμή θα καταχωριστεί ως αγορά αυτού του παγίου (γραμμή παγίων του παραστατικού αγορών).</DialogDescription>
        </DialogHeader>
        {!data && !error && <p className="flex items-center gap-2 text-[length:var(--fs-13)] text-muted-foreground"><FiLoader className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Φόρτωση κατηγοριών…</p>}
        {data && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="asset-name" className={LABEL}>Περιγραφή</label>
              <input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={INPUT} />
            </div>
            <div className="space-y-1">
              <label htmlFor="asset-gl" className={LABEL}>Λογιστική κατηγορία</label>
              <select id="asset-gl" value={mtrAcn ?? ''} onChange={(e) => setMtrAcn(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
                <option value="">— Διάλεξε —</option>
                {data.glCategories.map((g) => (
                  <option key={g.mtrAcn} value={g.mtrAcn}>{g.name}{g.acnmsk ? ` · ${g.acnmsk}` : ''}{g.depreciation ? ` · απόσβεση ${g.depreciation}%` : ''}</option>
                ))}
              </select>
              <p className="text-caption text-muted-foreground">Ορίζει τον λογαριασμό παγίου και τον προεπιλεγμένο συντελεστή απόσβεσης.</p>
            </div>

            {/* ── Απόσβεση: ο συντελεστής του ΝΟΜΟΥ, σε ευρώ και χρόνια, όχι μόνο ποσοστό ── */}
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-[length:var(--fs-12)] font-semibold text-foreground">
                <Term k="apostesi" /> (φορολογική)
              </legend>
              {advice ? (
                <p className="text-[length:var(--fs-12)] text-foreground">
                  Ο νόμος ορίζει <strong>{advice.rate}%</strong> τον χρόνο για «{advice.label}»
                  <span className="text-muted-foreground"> ({DEPRECIATION_SOURCE})</span>.
                  {advice.annual != null && advice.years != null && (
                    <> Για αξία {eur(amount ?? 0)}: <strong>≈ {eur(advice.annual)} τον χρόνο</strong>, σε περίπου {advice.years} χρόνια.</>
                  )}
                </p>
              ) : (
                <p className="text-[length:var(--fs-12)] text-muted-foreground">
                  Δεν αναγνωρίσαμε την κατηγορία του νόμου — ισχύει ο συντελεστής της λογιστικής κατηγορίας. Ρώτα τον λογιστή αν δεν είσαι σίγουρος.
                </p>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className={LABEL}>Συντελεστής για αυτό το πάγιο</span>
                  <span className="relative block w-32">
                    <input
                      inputMode="decimal" value={rate}
                      onChange={(e) => { setRate(e.target.value); setRateTouched(true); }}
                      aria-invalid={!rateOk}
                      className={`${INPUT} pr-7 text-right font-mono tabular-nums`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[length:var(--fs-13)] text-muted-foreground">%</span>
                  </span>
                </label>
                {advice && rateTouched && rateNum !== advice.rate && (
                  <button type="button" onClick={() => { setRate(String(advice.rate)); setRateTouched(false); }}
                    className="min-h-10 cursor-pointer rounded-md px-2 text-[length:var(--fs-12)] font-semibold text-sisyphus-700 hover:bg-sisyphus-500/10 dark:text-sisyphus-300">
                    Επαναφορά στο {advice.rate}% του νόμου
                  </button>
                )}
              </div>
              {!rateOk && <p role="alert" className="text-[length:var(--fs-12)] text-rose-700">Γράψε ποσοστό από 0 έως 100.</p>}
              {gl?.depreciation != null && rateNum != null && rateOk && gl.depreciation !== rateNum && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[length:var(--fs-12)] text-amber-900">
                  <FiAlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Η κατηγορία «{gl.name}» στο SoftOne έχει <strong>{gl.depreciation}%</strong>
                    {advice && gl.depreciation !== advice.rate ? ' (παλιός συντελεστής, πριν τον Ν.4172/2013)' : ''}.
                    Σε αυτό το πάγιο θα γραφτεί <strong>{rateNum}%</strong> — η κατηγορία δεν αλλάζει.
                  </span>
                </p>
              )}
              {lowValue && (
                <label className="flex cursor-pointer items-start gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-[length:var(--fs-12)] text-foreground">
                  <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} className="mt-0.5 size-4" />
                  <span>
                    <strong>Εφάπαξ απόσβεση φέτος.</strong> Η αξία είναι κάτω από {eur(LOW_VALUE_LIMIT)}: ο νόμος επιτρέπει να αποσβεστεί
                    ολόκληρη στη χρήση απόκτησης (άρθρο 24 παρ. 7 ΚΦΕ). Προαιρετικό — ρώτα τον λογιστή.
                  </span>
                </label>
              )}
            </fieldset>
            <div className="space-y-1">
              <label htmlFor="asset-cat" className={LABEL}>Εμπορική κατηγορία (προαιρετικά)</label>
              <select id="asset-cat" value={mtrCategory ?? ''} onChange={(e) => setMtrCategory(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
                <option value="">—</option>
                {data.categories.map((c) => <option key={c.mtrCategory} value={c.mtrCategory}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="asset-code" className={LABEL}>Κωδικός</label>
                <input id="asset-code" value={code} onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }} maxLength={30} className={`${INPUT} font-mono`} />
              </div>
              <div className="space-y-1">
                <label htmlFor="asset-vat" className={LABEL}>ΦΠΑ</label>
                <select id="asset-vat" value={vat} onChange={(e) => setVat(e.target.value)} className={INPUT}>
                  <option value="">— Διάλεξε —</option>
                  {data.vats.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                </select>
              </div>
            </div>
            {gl?.acnmsk && <p className="text-caption text-muted-foreground">Λογαριασμός αγορών: <span className="font-mono">{gl.acnmsk}</span>{data.whouse != null ? ` · αποθήκη παγίων ${data.whouse}` : ''}</p>}
            {data.whouse == null && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-800">
                Δεν είναι γνωστή η αποθήκη παγίων — τρέξε τον συγχρονισμό «Πάγια» πριν την καταχώριση.
              </p>
            )}
          </div>
        )}
        {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[length:var(--fs-12)] text-rose-700">{error}</p>}
        <DialogFooter className="mx-0 mb-0">
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => onOpenChange(false)}>Άκυρο</button>
          <button type="button" className={BTN_PRIMARY} disabled={!ready} onClick={() => void create()}>
            {busy ? <FiLoader className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <FiPlusCircle className="size-4" aria-hidden />}
            Δημιουργία στο SoftOne
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
