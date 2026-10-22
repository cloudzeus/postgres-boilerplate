// «Επιτρέπεται η καταχώριση σε αυτή την ημερομηνία;» — καθαρό module (χωρίς I/O).
//
// Η SoftOne κρατά χρήσεις (`FISCPRD`: έναρξη, λήξη, ενεργή, «Κλειδωμένη») και μηνιαίες περιόδους
// (`PERIOD`: ενεργή). Μέχρι τώρα το μαθαίναμε μόνο όταν η ίδια η SoftOne αρνιόταν την εγγραφή — με
// μήνυμα που ο χρήστης δεν καταλάβαινε, και ΑΦΟΥ είχε περάσει όλους τους άλλους ελέγχους. Τώρα το
// λέμε πριν, στη λίστα «Τι μένει», με τη χρήση και την περίοδο ονομαστικά.

export interface FiscalYearRow { FISCPRD: string; NAME?: string; FROMDATE?: string; FINALDATE?: string; ISACTIVE?: string; LOCKFISCPRD?: string }
export interface PeriodRow { FISCPRD: string; PERIOD: string; NAME?: string; FROMDATE?: string; FINALDATE?: string; ISACTIVE?: string }

export type PeriodCode = 'ok' | 'no_date' | 'no_fiscal_year' | 'fiscal_year_closed' | 'period_closed';
export interface PeriodVerdict { code: PeriodCode; message: string | null; fiscalYear: string | null; period: string | null }

const day = (s: string | undefined | null): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s ?? ''));
  return m ? m[1] : null;
};
const el = (iso: string) => iso.split('-').reverse().join('/');

export function evaluatePeriod(dateIso: string | null | undefined, years: readonly FiscalYearRow[], periods: readonly PeriodRow[]): PeriodVerdict {
  const d = day(dateIso);
  if (!d) return { code: 'no_date', message: null, fiscalYear: null, period: null };
  const year = years.find((y) => { const a = day(y.FROMDATE), b = day(y.FINALDATE); return a != null && b != null && a <= d && d <= b; });
  if (!year) {
    const known = years.map((y) => Number(y.FISCPRD)).filter(Number.isFinite).sort((a, b) => a - b);
    return {
      code: 'no_fiscal_year', fiscalYear: null, period: null,
      message: `Η ημερομηνία ${el(d)} δεν ανήκει σε καμία χρήση της SoftOne${known.length ? ` (υπάρχουν ${known[0]}–${known[known.length - 1]})` : ''}. Αν διαβάστηκε λάθος, διόρθωσέ τη· αλλιώς η χρήση πρέπει να ανοίξει στη SoftOne.`,
    };
  }
  const yName = year.NAME?.trim() || `χρήση ${year.FISCPRD}`;
  if (year.ISACTIVE === '0' || year.LOCKFISCPRD === '1') {
    return {
      code: 'fiscal_year_closed', fiscalYear: year.FISCPRD, period: null,
      message: `Η «${yName}» είναι ${year.LOCKFISCPRD === '1' ? 'κλειδωμένη' : 'ανενεργή'} στη SoftOne — δεν δέχεται καταχωρίσεις στις ${el(d)}. Αν η ημερομηνία διαβάστηκε λάθος, διόρθωσέ τη· αλλιώς ζήτησε από τον λογιστή να την ξεκλειδώσει.`,
    };
  }
  const period = periods.find((p) => p.FISCPRD === year.FISCPRD && (() => { const a = day(p.FROMDATE), b = day(p.FINALDATE); return a != null && b != null && a <= d && d <= b; })());
  if (period && period.ISACTIVE === '0') {
    return {
      code: 'period_closed', fiscalYear: year.FISCPRD, period: period.PERIOD,
      message: `Η περίοδος «${period.NAME?.trim() || period.PERIOD} ${year.FISCPRD}» είναι κλειστή στη SoftOne — δεν δέχεται καταχωρίσεις στις ${el(d)}. Αν η ημερομηνία διαβάστηκε λάθος, διόρθωσέ τη· αλλιώς ζήτησε από τον λογιστή να ανοίξει την περίοδο.`,
    };
  }
  return { code: 'ok', message: null, fiscalYear: year.FISCPRD, period: period?.PERIOD ?? null };
}
