'use client';

// «Μονάδες μέτρησης» νέου είδους: βασική (αποθήκη) · αγοράζεται σε · πωλείται σε.
//
// Το πρόβλημα που λύνει: ο προμηθευτής πουλά ΚΙΒΩΤΙΟ των 100, εμείς πουλάμε ΤΕΜΑΧΙΟ. Χωρίς σχέση
// μονάδων, «2» στο τιμολόγιο γίνεται 2 τεμάχια στην αποθήκη. Με σχέση (1 κιβώτιο = 100 τεμάχια) η
// SoftOne γράφει 200 τεμάχια — και το κόστος ανά τεμάχιο βγαίνει σωστό.
//
// Διάταξη: ΜΙΑ σειρά ανά μονάδα (ετικέτα αριστερά, επιλογή + σχέση στην ίδια γραμμή) και από κάτω
// προεπισκόπηση με τα νούμερα της γραμμής του τιμολογίου — τι γράφει το χαρτί, τι θα μπει στη SoftOne.
import * as React from 'react';
import { FiArrowRight, FiPackage, FiZap } from 'react-icons/fi';
import { toBaseQty } from '@/lib/item-units';
import { FormSection, FormSelect, Segmented } from '@/components/admin/form-kit';

export interface UnitsValue {
  base: string;
  /** '' = ίδια με τη βασική */
  buy: string;
  buyRatio: string;
  sell: string;
  sellRatio: string;
}

type Opt = { id: string; name: string };

const fmt = (n: number, d = 2) => n.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const money = (n: number) => n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 });
const ratioOf = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

/** «Ίδια με τη βασική | Άλλη μονάδα» και, όταν «άλλη», `1 [μονάδα] = [N] βασικές` στην ίδια γραμμή. */
function AltRow({ id, unit, ratio, onUnit, onRatio, opts, base, baseName, suggestion, label, showErrors }: {
  id: string; label: string; unit: string; ratio: string; onUnit: (v: string) => void; onRatio: (v: string) => void;
  opts: Opt[]; base: string; baseName: string; suggestion?: number | null; showErrors: boolean;
}) {
  const [touched, setTouched] = React.useState(false);
  const other = unit !== '';
  const invalid = other && ratioOf(ratio) == null && (touched || showErrors);
  const choices = opts.filter((o) => o.id !== base);
  return (
    <>
      <span className="pt-1.5 text-[length:var(--fs-11)] font-medium text-muted-foreground" id={`${id}-l`}>{label}</span>
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Segmented
            ariaLabel={label}
            value={other ? 'other' : 'same'}
            onChange={(v) => { if (v === 'same') { onUnit(''); onRatio(''); } else onUnit(choices[0]?.id ?? ''); }}
            options={[{ value: 'same', label: 'Ίδια με τη βασική' }, { value: 'other', label: 'Άλλη μονάδα' }]}
          />
          {other && (
            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
              <span className="shrink-0 text-[length:var(--fs-13)] tabular-nums text-muted-foreground">1</span>
              <FormSelect value={unit} onChange={onUnit} opts={choices} ariaLabel={`${label}: μονάδα`} className="w-32 shrink-0" />
              <span aria-hidden className="shrink-0 text-[length:var(--fs-13)] text-muted-foreground">=</span>
              <input
                id={`${id}-ratio`} value={ratio} inputMode="decimal" placeholder="100"
                onChange={(e) => onRatio(e.target.value)} onBlur={() => setTouched(true)}
                aria-label={`Πόσα ${baseName || 'βασικές μονάδες'} έχει 1 μονάδα`} aria-invalid={invalid || undefined}
                className={`h-8 w-16 shrink-0 rounded-lg border bg-background px-2 text-right text-[length:var(--fs-13)] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-destructive' : 'border-input'}`}
              />
              <span className="truncate text-[length:var(--fs-13)] font-medium text-foreground">{baseName || 'βασικές'}</span>
            </span>
          )}
        </div>
        {other && suggestion != null && ratioOf(ratio) !== suggestion && (
          <button
            type="button" onClick={() => onRatio(String(suggestion))}
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full bg-amber-100 px-2 text-[length:var(--fs-11)] font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"
          >
            <FiZap aria-hidden className="size-3" /> Η περιγραφή λέει {suggestion} — Χρήση
          </button>
        )}
        {invalid && <p role="alert" className="text-[length:var(--fs-11)] text-destructive">Γράψε πόσα {baseName || 'βασικές μονάδες'} έχει 1 μονάδα (θετικός αριθμός).</p>}
      </div>
    </>
  );
}

export function ItemUnitsSection({ value, onChange, units, line, ratioSuggestion, showErrors = false, note }: {
  /** Σημείωση για τη μονάδα (π.χ. «η μονάδα του τιμολογίου δεν υπάρχει στο μητρώο») — μέσα στην ενότητα. */
  note?: React.ReactNode;
  value: UnitsValue;
  onChange: (v: UnitsValue) => void;
  units: Opt[];
  /** Τα νούμερα της γραμμής του τιμολογίου, για την προεπισκόπηση. */
  line?: { quantity: number | null; price: number | null; unitText: string | null } | null;
  /** Σχέση που φαίνεται στην περιγραφή («ΚΟΥΤΙ 100 ΤΕΜ») — προτείνεται, δεν εφαρμόζεται μόνη της. */
  ratioSuggestion?: number | null;
  /** Μετά από απόπειρα υποβολής: δείξε όλα τα σφάλματα. */
  showErrors?: boolean;
}) {
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? '';
  const baseName = nameOf(value.base);
  const set = (patch: Partial<UnitsValue>) => onChange({ ...value, ...patch });

  const buyRatio = value.buy ? ratioOf(value.buyRatio) : 1;
  const qty = line?.quantity ?? null;
  const price = line?.price ?? null;
  const buyName = value.buy ? nameOf(value.buy) : baseName;
  const converts = Boolean(value.buy) && buyRatio != null && buyRatio !== 1;

  return (
    <FormSection
      tone="emerald" icon={<FiPackage />} title="Μονάδες μέτρησης"
      aside={line?.unitText ? <span className="text-emerald-800/80 dark:text-emerald-300/80">Στο τιμολόγιο: «{line.unitText}»</span> : undefined}
    >
      <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <label htmlFor="unit-base" className="pt-1.5 text-[length:var(--fs-11)] font-medium text-muted-foreground">
          Βασική <span className="text-destructive">*</span>
          <span className="block font-normal">μετράει η αποθήκη</span>
        </label>
        <FormSelect id="unit-base" value={value.base} onChange={(v) => set({ base: v })} opts={units} placeholder="Επίλεξε μονάδα" invalid={showErrors && !value.base} className="max-w-[16rem]" />

        <AltRow
          id="unit-buy" label="Αγοράζεται σε" unit={value.buy} ratio={value.buyRatio} base={value.base}
          onUnit={(v) => set({ buy: v })} onRatio={(v) => set({ buyRatio: v })}
          opts={units} baseName={baseName} suggestion={ratioSuggestion} showErrors={showErrors}
        />
        <AltRow
          id="unit-sell" label="Πωλείται σε" unit={value.sell} ratio={value.sellRatio} base={value.base}
          onUnit={(v) => set({ sell: v })} onRatio={(v) => set({ sellRatio: v })}
          opts={units} baseName={baseName} showErrors={showErrors}
        />
      </div>
      {note}

      {/* ΠΡΟΕΠΙΣΚΟΠΗΣΗ με τα νούμερα της γραμμής: τι γράφει το τιμολόγιο → τι θα γράψει η SoftOne. */}
      {baseName && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[length:var(--fs-12)] text-foreground dark:bg-emerald-500/10" role="status" aria-live="polite">
          {converts && buyRatio != null ? (
            <>
              <span className="text-muted-foreground">Τιμολόγιο</span>
              <strong className="tabular-nums">{qty != null ? fmt(qty) : 1} {buyName}</strong>
              {price != null && <span className="tabular-nums text-muted-foreground">× {money(price)}</span>}
              <FiArrowRight aria-hidden className="size-3.5 text-emerald-700" />
              <span className="text-muted-foreground">SoftOne</span>
              <strong className="tabular-nums text-emerald-800 dark:text-emerald-300">{fmt(toBaseQty(qty ?? 1, buyRatio), 4)} {baseName}</strong>
              {price != null && <span className="tabular-nums text-muted-foreground">· {money(price / buyRatio)} / {baseName.toLowerCase()}</span>}
              <span className="basis-full text-[length:var(--fs-11)] text-muted-foreground">Η αξία δεν αλλάζει· τιμολόγιο σε {baseName.toLowerCase()} μετατρέπεται αυτόματα από τη μονάδα της γραμμής.</span>
            </>
          ) : (
            <span className="text-muted-foreground">Η ποσότητα του τιμολογίου μπαίνει ως έχει σε {baseName.toLowerCase()}{qty != null && <> (<strong className="tabular-nums text-foreground">{fmt(qty)}</strong>)</>}.</span>
          )}
        </div>
      )}
    </FormSection>
  );
}
