// Η ΜΙΑ στατιστική κάρτα της εφαρμογής (dashboard, OCR, εκκρεμότητες, αναρτημένα, AI, παρτίδες).
//
// Πριν υπήρχαν έξι παραλλαγές: μόνο ένας μεγάλος αριθμός με άδειο χώρο, άλλα ύψη, τίτλοι που
// έσπαγαν σε δύο γραμμές. Εδώ κάθε κάρτα έχει την ΙΔΙΑ δομή και το ίδιο ύψος:
//   [εικονίδιο] ΕΤΙΚΕΤΑ
//   ΤΙΜΗ μονάδα ………… [ενέργεια]
//   πληροφορία (έως 2 γραμμές)
//   (προαιρετική μπάρα προόδου, πάντα στο κάτω μέρος)
// Χωρίς hooks — δουλεύει και σε server components.
import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type StatTone = 'blue' | 'emerald' | 'amber' | 'red' | 'violet' | 'slate';

// Στατικές κλάσεις (το Tailwind JIT δεν βλέπει δυναμικά ονόματα).
const TONE: Record<StatTone, { icon: string; bar: string; edge: string }> = {
  blue: { icon: 'bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15 dark:text-sisyphus-300', bar: 'bg-sisyphus-500', edge: 'before:bg-sisyphus-500' },
  emerald: { icon: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', bar: 'bg-emerald-500', edge: 'before:bg-emerald-500' },
  amber: { icon: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', bar: 'bg-amber-500', edge: 'before:bg-amber-500' },
  red: { icon: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300', bar: 'bg-red-500', edge: 'before:bg-red-500' },
  violet: { icon: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300', bar: 'bg-violet-500', edge: 'before:bg-violet-500' },
  slate: { icon: 'bg-muted text-muted-foreground', bar: 'bg-muted-foreground', edge: 'before:bg-border' },
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Μικρή μονάδα δίπλα στην τιμή («€», «%», «γραμμές»). */
  unit?: string;
  icon?: React.ReactNode;
  tone?: StatTone;
  /** Πληροφορία κάτω από την τιμή (έως δύο γραμμές). */
  sub?: React.ReactNode;
  /** 0–100: μπάρα προόδου στο κάτω μέρος. */
  progress?: number | null;
  /** Δεξιά της τιμής: μικρό κουμπί ενέργειας (η ετικέτα κρατά όλο το πλάτος). */
  aside?: React.ReactNode;
  /** Ολόκληρη η κάρτα σύνδεσμος. */
  href?: string;
  /** Χρώματα από μητρώο (π.χ. καταστάσεις εκκρεμότητας) — υπερισχύουν του `tone`. */
  color?: { fg: string; bg: string };
  className?: string;
}

export function StatCard({ label, value, unit, icon, tone = 'blue', sub, progress, aside, href, color, className }: StatCardProps) {
  const t = TONE[tone];
  const edge = color ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color.fg }} /> : null;
  const body = (
    <>
      {edge}
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span aria-hidden className={cn('grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-3.5', !color && t.icon)} style={color ? { backgroundColor: color.bg, color: color.fg } : undefined}>{icon}</span>}
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-12)] font-medium text-muted-foreground" title={label}>{label}</span>
      </div>
      <div className="mt-2 flex min-w-0 items-baseline gap-1">
        <span className="truncate text-[length:var(--fs-20)] font-semibold leading-none tabular-nums tracking-tight text-foreground">{value}</span>
        {unit && <span className="shrink-0 text-[length:var(--fs-12)] font-medium text-muted-foreground">{unit}</span>}
        {aside && <span className="-my-1 ml-auto shrink-0 self-center">{aside}</span>}
      </div>
      {sub != null && <p className="mt-1 line-clamp-2 text-[length:var(--fs-11)] leading-snug tabular-nums text-muted-foreground">{sub}</p>}
      {progress != null && (
        <div className="mt-auto pt-2" aria-hidden>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-[width] duration-300', !color && t.bar)} style={{ backgroundColor: color?.fg, width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        </div>
      )}
    </>
  );
  const cls = cn(
    'relative flex h-full min-h-[5.75rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card py-2.5 pl-3.5 pr-3 shadow-fluent-2',
    // Λεπτή χρωματιστή άκρη αριστερά — η ταυτότητα της κάρτας με μια ματιά.
    !color && ["before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']", t.edge],
    className,
  );
  return href ? (
    <Link href={href} className={cn(cls, 'cx-transition hover:-translate-y-0.5 hover:shadow-fluent-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Πλέγμα καρτών με ίσα ύψη. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5', className)}>{children}</section>;
}
