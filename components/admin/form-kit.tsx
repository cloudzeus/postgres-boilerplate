'use client';

// Κοινά «υλικά» για τις φόρμες των παραθύρων (δημιουργία είδους, συναλλασσομένου, τιμές προμηθευτή):
// ΕΝΑ ύψος πεδίου (h-8), ΕΝΑ μέγεθος κειμένου (13), ετικέτες 11, ενότητες με χρωματιστή ταυτότητα.
// Ο στόχος: πυκνές φόρμες για tablet/desktop, όπου κάθε ενότητα αναγνωρίζεται με μια ματιά και
// όλα τα πεδία μιας σειράς στοιχίζονται στην ίδια γραμμή (η βοήθεια ζει ΚΑΤΩ από τη σειρά).
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type SectionTone = 'blue' | 'emerald' | 'amber' | 'violet' | 'slate';

// Στατικές κλάσεις (το Tailwind JIT δεν βλέπει δυναμικά ονόματα).
const TONE: Record<SectionTone, { box: string; head: string; icon: string }> = {
  blue: { box: 'border-sisyphus-500/25', head: 'bg-sisyphus-50/70 text-sisyphus-700 dark:bg-sisyphus-500/10 dark:text-sisyphus-300', icon: 'bg-sisyphus-500/15 text-sisyphus-600 dark:text-sisyphus-300' },
  emerald: { box: 'border-emerald-500/25', head: 'bg-emerald-50/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300', icon: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  amber: { box: 'border-amber-500/30', head: 'bg-amber-50/70 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300', icon: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  violet: { box: 'border-violet-500/25', head: 'bg-violet-50/70 text-violet-800 dark:bg-violet-500/10 dark:text-violet-300', icon: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  slate: { box: 'border-border', head: 'bg-muted/50 text-muted-foreground', icon: 'bg-muted text-muted-foreground' },
};

/** Ενότητα φόρμας: χρωματιστή κεφαλίδα (εικονίδιο + τίτλος + προαιρετική σημείωση δεξιά) και σώμα. */
export function FormSection({ tone = 'slate', icon, title, aside, children, className }: {
  tone?: SectionTone; icon?: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  const t = TONE[tone];
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('overflow-hidden rounded-lg border bg-card', t.box, className)}>
      <header className={cn('flex min-h-8 items-center gap-2 px-3 py-1.5', t.head)}>
        {icon && <span aria-hidden className={cn('grid size-5 shrink-0 place-items-center rounded [&_svg]:size-3', t.icon)}>{icon}</span>}
        <h3 id={id} className="text-[length:var(--fs-11)] font-semibold uppercase tracking-wide">{title}</h3>
        {aside && <div className="ml-auto min-w-0 text-[length:var(--fs-11)] font-normal normal-case tracking-normal">{aside}</div>}
      </header>
      <div className="space-y-2.5 px-3 py-2.5">{children}</div>
    </section>
  );
}

/** Ετικέτα πάνω από πεδίο — ΜΟΝΗ γραμμή, ώστε τα πεδία μιας σειράς να ξεκινούν στο ίδιο ύψος. */
export function Field({ label, required, htmlFor, className, children, error }: {
  label: React.ReactNode; required?: boolean; htmlFor?: string; className?: string; children: React.ReactNode; error?: string | null;
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1', className)}>
      <label htmlFor={htmlFor} className="truncate text-[length:var(--fs-11)] font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {error && <p role="alert" className="text-[length:var(--fs-11)] text-destructive">{error}</p>}
    </div>
  );
}

/** Ίδιο ύψος/μέγεθος για κάθε input των φορμών. */
export const fieldCls = 'h-8 text-[length:var(--fs-13)]';

/** Βοήθεια κάτω από μια ΣΕΙΡΑ πεδίων (όχι μέσα στη στήλη — δεν σπάει τη στοίχιση). */
export function RowHint({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warn' | 'bad' | 'ok' }) {
  const color = tone === 'warn' ? 'text-amber-800 dark:text-amber-300' : tone === 'bad' ? 'text-destructive' : tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground';
  return <p className={cn('text-[length:var(--fs-11)] leading-snug', color)}>{children}</p>;
}

/** Select της φόρμας: πλάτος στήλης, ύψος 8, κείμενο 13 — όχι native (δεν «φουσκώνει» σε στενή οθόνη). */
export function FormSelect({ id, value, onChange, opts, placeholder = 'Επιλογή…', ariaLabel, className, invalid, disabled }: {
  id?: string; value: string; onChange: (v: string) => void; opts: { id: string; name: string }[];
  placeholder?: string; ariaLabel?: string; className?: string; invalid?: boolean; disabled?: boolean;
}) {
  return (
    <Select value={value || ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} aria-invalid={invalid || undefined} className={cn('h-8 w-full min-w-0 overflow-hidden text-[length:var(--fs-13)] *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate *:data-[slot=select-value]:block', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {opts.length === 0 && <div className="px-2 py-1.5 text-[length:var(--fs-12)] text-muted-foreground">— κενό —</div>}
        {opts.map((o) => <SelectItem key={o.id} value={o.id} className="text-[length:var(--fs-13)]">{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Δύο επιλογών διακόπτης (π.χ. «Ίδια με τη βασική | Άλλη μονάδα»), ύψος 7. */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex shrink-0 rounded-md border border-border bg-muted/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('h-7 cursor-pointer rounded px-2 text-[length:var(--fs-11)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === o.value ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
