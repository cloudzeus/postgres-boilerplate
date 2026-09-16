import * as React from 'react';
import { formatCustomFields, type CustomValueView } from '@/lib/ocr/custom-value';

/**
 * Τα ΕΙΔΙΚΑ ΠΕΔΙΑ σε οθόνη — ΕΝΑ component για τα τρία σημεία που τα δείχνουν
 * (σελίδα παραστατικού, καρτέλα γραμμής της λίστας, modal αποτελέσματος), ώστε να μη
 * διαφωνούν. Η μορφοποίηση ζει στο `lib/ocr/custom-value.ts` και δοκιμάζεται εκεί.
 *
 * Καθαρά δηλωτικό (κανένα hook, πτυσσόμενο με `<details>`): δουλεύει και σε server
 * component και μέσα σε client δέντρο.
 */

/** Μία τιμή: σκαλάρ/λίστα ως κείμενο, βαθιά δομή ως πτυσσόμενο με το αληθινό JSON. */
export function CustomValue({ view }: { view: CustomValueView }) {
  if (view.kind === 'empty') return <>—</>;
  if (view.kind === 'text') return <>{view.text}</>;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-sisyphus-700 underline decoration-dotted underline-offset-2 dark:text-sisyphus-300">
        {view.text} <span className="text-muted-foreground group-open:hidden">(εμφάνιση)</span>
        <span className="hidden text-muted-foreground group-open:inline">(απόκρυψη)</span>
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-snug whitespace-pre-wrap break-words">
        {view.json}
      </pre>
    </details>
  );
}

/** Ο πίνακας «Ειδικά πεδία» ενός εγγράφου. Κρύβεται όταν δεν υπάρχει κανένα. */
export function CustomFieldsBlock({ data }: { data: Record<string, unknown> | null | undefined }) {
  const entries = formatCustomFields((data?.customFields ?? {}) as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground">
        Ειδικά πεδία
      </header>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 p-3 sm:grid-cols-2">
        {entries.map((e) => (
          <div key={e.key} className="flex min-w-0 flex-col">
            <dt className="text-[11px] font-semibold text-muted-foreground">{e.label}</dt>
            <dd className="min-w-0 text-[12px] text-foreground"><CustomValue view={e.value} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Τα ειδικά πεδία ΜΙΑΣ γραμμής, στη στενή σειρά κάτω από τη γραμμή του πίνακα. */
export function LineCustomFields({ cf }: { cf: Record<string, unknown> | null | undefined }) {
  const entries = formatCustomFields(cf, { skipEmpty: true });
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((e) => (
        <span key={e.key} className="mr-3 inline-block align-top">
          <strong className="text-foreground">{e.label}:</strong> <CustomValue view={e.value} />
        </span>
      ))}
    </>
  );
}

/** `true` όταν η γραμμή έχει έστω ένα ειδικό πεδίο με τιμή — για το `colSpan` της σειράς. */
export function hasLineCustomFields(cf: Record<string, unknown> | null | undefined): boolean {
  return formatCustomFields(cf, { skipEmpty: true }).length > 0;
}
