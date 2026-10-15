'use client';

// «Μονάδες μέτρησης» νέου είδους: βασική (αποθήκη) · αγοράζεται σε · πωλείται σε.
//
// Το πρόβλημα που λύνει: ο προμηθευτής πουλά ΚΙΒΩΤΙΟ των 100, εμείς πουλάμε ΤΕΜΑΧΙΟ. Χωρίς σχέση
// μονάδων, «2» στο τιμολόγιο γίνεται 2 τεμάχια στην αποθήκη. Με σχέση (1 κιβώτιο = 100 τεμάχια) η
// SoftOne γράφει 200 τεμάχια — και το κόστος ανά τεμάχιο βγαίνει σωστό.
//
// Η επεξήγηση κάτω από τα πεδία δείχνει ΤΑ ΝΟΥΜΕΡΑ ΤΗΣ ΓΡΑΜΜΗΣ: τι γράφει το τιμολόγιο και τι
// θα μπει στη SoftOne. Δεν είναι κείμενο βοήθειας — είναι προεπισκόπηση.
import * as React from 'react';
import { FiArrowRight, FiInfo, FiZap } from 'react-icons/fi';
import { toBaseQty } from '@/lib/item-units';

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

function UnitSelect({ value, onChange, opts, ariaLabel, placeholder, className }: {
  value: string; onChange: (v: string) => void; opts: Opt[]; ariaLabel: string; placeholder: string; className?: string;
}) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}
      className={`h-9 min-w-0 cursor-pointer rounded-md border border-input bg-background px-2 text-[length:var(--fs-13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

/** Μία σειρά «αγοράζεται/πωλείται σε»: [ίδια με βασική | άλλη μονάδα] → 1 [μονάδα] = [N] [βασική]. */
function AltRow({ id, label, hint, unit, ratio, onUnit, onRatio, opts, baseName, suggestion }: {
  id: string; label: string; hint: string;
  unit: string; ratio: string; onUnit: (v: string) => void; onRatio: (v: string) => void;
  opts: Opt[]; baseName: string; suggestion?: { ratio: number; source: string } | null;
}) {
  const other = unit !== '';
  const ratioN = ratioOf(ratio);
  const invalid = other && ratioN == null;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground" id={`${id}-label`}>{label}</span>
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-[length:var(--fs-11)]">
          {[{ v: false, t: 'Ίδια με τη βασική' }, { v: true, t: 'Άλλη μονάδα' }].map((o) => (
            <button
              key={String(o.v)} type="button" role="radio" aria-checked={other === o.v}
              onClick={() => { if (o.v === other) return; if (o.v) { onUnit(opts.find((x) => x.name !== baseName)?.id ?? ''); } else { onUnit(''); onRatio(''); } }}
              className={`min-h-7 cursor-pointer rounded px-2 font-medium transition-colors ${other === o.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {o.t}
            </button>
          ))}
        </div>
      </div>
      {other && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5">
          <span className="text-[length:var(--fs-13)] tabular-nums text-muted-foreground">1</span>
          <UnitSelect value={unit} onChange={onUnit} opts={opts} ariaLabel={`${label}: μονάδα`} placeholder="Μονάδα…" className="w-36" />
          <span className="text-[length:var(--fs-13)] text-muted-foreground" aria-hidden>=</span>
          <input
            id={`${id}-ratio`} value={ratio} onChange={(e) => onRatio(e.target.value)} inputMode="decimal"
            aria-label={`Πόσα ${baseName} έχει 1 μονάδα`} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
            placeholder="π.χ. 100"
            className={`h-9 w-20 rounded-md border bg-background px-2 text-right text-[length:var(--fs-13)] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-destructive' : 'border-input'}`}
          />
          <span className="text-[length:var(--fs-13)] font-medium text-foreground">{baseName || 'βασικές'}</span>
          {suggestion && ratioN !== suggestion.ratio && (
            <button
              type="button" onClick={() => onRatio(String(suggestion.ratio))}
              className="ml-auto inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-full bg-amber-50 px-2 text-[length:var(--fs-11)] font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
              title={`Από ${suggestion.source}`}
            >
              <FiZap aria-hidden className="size-3" /> {suggestion.ratio} από {suggestion.source} — Χρήση
            </button>
          )}
        </div>
      )}
      <p id={`${id}-hint`} className={`text-[length:var(--fs-11)] ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
        {invalid ? `Γράψε πόσα ${baseName || 'βασικές μονάδες'} έχει 1 μονάδα (θετικός αριθμός).` : hint}
      </p>
    </div>
  );
}

export function ItemUnitsSection({ value, onChange, units, line, ratioSuggestion }: {
  value: UnitsValue;
  onChange: (v: UnitsValue) => void;
  units: Opt[];
  /** Τα νούμερα της γραμμής του τιμολογίου, για την προεπισκόπηση. */
  line?: { quantity: number | null; price: number | null; unitText: string | null } | null;
  /** Σχέση που φαίνεται στην περιγραφή («ΚΟΥΤΙ 100 ΤΕΜ») — προτείνεται, δεν εφαρμόζεται μόνη της. */
  ratioSuggestion?: number | null;
}) {
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? '';
  const baseName = nameOf(value.base);
  const set = (patch: Partial<UnitsValue>) => onChange({ ...value, ...patch });

  const buyRatio = value.buy ? ratioOf(value.buyRatio) : 1;
  const qty = line?.quantity ?? null;
  const price = line?.price ?? null;
  const buyName = value.buy ? nameOf(value.buy) : baseName;

  return (
    <section className="space-y-3" aria-labelledby="units-title">
      <div className="flex items-baseline justify-between gap-2">
        <p id="units-title" className="text-[length:var(--fs-10)] font-semibold uppercase tracking-wider text-muted-foreground">Μονάδες μέτρησης</p>
      </div>

      <label className="grid gap-1.5">
        <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">Βασική μονάδα <span className="text-destructive">*</span> <span className="font-normal">— σε αυτήν μετράει η αποθήκη</span></span>
        <UnitSelect value={value.base} onChange={(v) => set({ base: v })} opts={units} ariaLabel="Βασική μονάδα" placeholder="Επίλεξε μονάδα" className="w-full" />
      </label>

      <AltRow
        id="unit-buy" label="Αγοράζεται από τον προμηθευτή σε"
        hint="Αν ο προμηθευτής τιμολογεί σε συσκευασία (κιβώτιο, πακέτο), γράψε πόσα τεμάχια έχει."
        unit={value.buy} ratio={value.buyRatio}
        onUnit={(v) => set({ buy: v })} onRatio={(v) => set({ buyRatio: v })}
        opts={units} baseName={baseName}
        suggestion={ratioSuggestion ? { ratio: ratioSuggestion, source: 'την περιγραφή' } : null}
      />
      <AltRow
        id="unit-sell" label="Πωλείται σε"
        hint="Συνήθως ίδια με τη βασική (πουλάμε τεμάχιο). Άλλαξέ τη μόνο αν πουλάτε σε συσκευασία."
        unit={value.sell} ratio={value.sellRatio}
        onUnit={(v) => set({ sell: v })} onRatio={(v) => set({ sellRatio: v })}
        opts={units} baseName={baseName}
      />

      {/* ΠΡΟΕΠΙΣΚΟΠΗΣΗ με τα νούμερα της γραμμής: τι γράφει το τιμολόγιο → τι θα γράψει η SoftOne. */}
      {baseName && (
        <div className="rounded-lg border border-sisyphus-500/25 bg-sisyphus-50/60 px-3 py-2.5 text-[length:var(--fs-12)] leading-relaxed text-foreground dark:bg-sisyphus-500/10" role="status" aria-live="polite">
          <p className="mb-1 flex items-center gap-1.5 text-[length:var(--fs-11)] font-semibold text-sisyphus-700 dark:text-sisyphus-300">
            <FiInfo aria-hidden className="size-3.5" /> Τι θα γίνεται στην καταχώριση αγοράς
          </p>
          {value.buy && buyRatio != null && buyRatio !== 1 ? (
            qty != null ? (
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span>Τιμολόγιο: <strong className="tabular-nums">{fmt(qty)} {buyName}</strong>{price != null && <> × <span className="tabular-nums">{money(price)}</span></>}</span>
                <FiArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                <span>SoftOne: <strong className="tabular-nums">{fmt(toBaseQty(qty, buyRatio), 4)} {baseName}</strong> στην αποθήκη
                  {price != null && <>, κόστος <strong className="tabular-nums">{money(price / buyRatio)}</strong> / {baseName.toLowerCase()}</>}
                </span>
              </p>
            ) : (
              <p>1 {buyName} του τιμολογίου γίνεται <strong className="tabular-nums">{fmt(buyRatio, 4)} {baseName}</strong> στην αποθήκη.</p>
            )
          ) : (
            <p>Η ποσότητα του τιμολογίου μπαίνει ως έχει σε {baseName.toLowerCase()}{qty != null ? <> (<strong className="tabular-nums">{fmt(qty)}</strong>)</> : null}.</p>
          )}
          {value.buy && buyRatio != null && buyRatio !== 1 && (
            <p className="mt-1 text-[length:var(--fs-11)] text-muted-foreground">
              Η αξία της γραμμής δεν αλλάζει. Αν κάποιο τιμολόγιο γράφει την ποσότητα σε {baseName.toLowerCase()}, η εφαρμογή το καταλαβαίνει από τη μονάδα της γραμμής και μετατρέπει.
            </p>
          )}
          {line?.unitText && (
            <p className="mt-1 text-[length:var(--fs-11)] text-muted-foreground">Μονάδα στο τιμολόγιο: «{line.unitText}».</p>
          )}
        </div>
      )}
    </section>
  );
}
