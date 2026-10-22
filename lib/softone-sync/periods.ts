// SERVER: χρήσεις και περίοδοι της SoftOne για τον έλεγχο «επιτρέπεται η καταχώριση σε αυτή την ημερομηνία;».
// Μόνο αναγνώσεις (GetTable FISCPRD / PERIOD), με cache 10′ στη διεργασία — αλλάζουν σπάνια, και ο
// έλεγχος τρέχει σε κάθε προεπισκόπηση καταχώρισης.
import 'server-only';
import { loadSoftoneConfig, softoneGetTable } from '@/lib/softone';
import { evaluatePeriod, type FiscalYearRow, type PeriodRow, type PeriodVerdict } from '@/lib/ocr/period-check';

const TTL_MS = 10 * 60_000;
let cache: { at: number; company: string; years: FiscalYearRow[]; periods: PeriodRow[] } | null = null;

async function load(): Promise<{ years: FiscalYearRow[]; periods: PeriodRow[] }> {
  const cfg = await loadSoftoneConfig();
  const company = String(cfg.company ?? '').trim();
  if (cache && cache.company === company && Date.now() - cache.at < TTL_MS) return cache;
  const where = /^\d+$/.test(company) ? `COMPANY=${company}` : '';
  const [years, periods] = await Promise.all([
    softoneGetTable('FISCPRD', ['FISCPRD', 'NAME', 'FROMDATE', 'FINALDATE', 'ISACTIVE', 'LOCKFISCPRD'], where),
    softoneGetTable('PERIOD', ['FISCPRD', 'PERIOD', 'NAME', 'FROMDATE', 'FINALDATE', 'ISACTIVE'], where),
  ]);
  cache = { at: Date.now(), company, years: years as unknown as FiscalYearRow[], periods: periods as unknown as PeriodRow[] };
  return cache;
}

/** `null` = η SoftOne δεν απάντησε: δεν κρίνουμε (η ίδια θα αρνηθεί, με μεταφρασμένο μήνυμα). */
export async function periodVerdict(dateIso: string | null | undefined): Promise<PeriodVerdict | null> {
  try {
    const { years, periods } = await load();
    if (!years.length) return null;
    return evaluatePeriod(dateIso, years, periods);
  } catch {
    return null;
  }
}
