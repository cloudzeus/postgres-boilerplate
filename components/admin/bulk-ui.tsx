'use client';

// components/admin/bulk-ui.tsx — τα ΚΟΙΝΑ κομμάτια των παραθύρων μαζικής διευθέτησης
// (συναλλασσόμενοι, είδη & έξοδα). Ένα σημείο, ώστε τα δύο παράθυρα να είναι ΙΔΙΑ στην όψη
// και στη συμπεριφορά — ο χρήστης που έμαθε το ένα ξέρει ήδη το άλλο.
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Το χρώμα ΜΟΝΟ στο εικονίδιο· το κείμενο μένει στο χρώμα κειμένου για να διαβάζεται. */
export function Line({ icon: Icon, fg, spin, children }: { icon: React.ElementType; fg: string; spin?: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-[length:var(--fs-11)] text-foreground">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', spin && 'animate-spin')} style={{ color: fg }} aria-hidden />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export function Chip({ icon: Icon, fg, children }: { icon: React.ElementType; fg: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-semibold text-foreground">
      <Icon className="size-3" style={{ color: fg }} aria-hidden /> {children}
    </span>
  );
}

export const BTN_PRIMARY =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3.5 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition ' +
  'hover:bg-sisyphus-600 active:bg-sisyphus-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500/40 focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none';

export const BTN_GHOST =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[length:var(--fs-12)] font-semibold text-foreground transition hover:bg-muted ' +
  'disabled:cursor-not-allowed disabled:opacity-60';
