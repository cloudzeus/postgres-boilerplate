import { describe, it, expect } from 'vitest';
import { evaluatePeriod, type FiscalYearRow, type PeriodRow } from '../period-check';

const Y = (y: number, over: Partial<FiscalYearRow> = {}): FiscalYearRow => ({ FISCPRD: String(y), NAME: `ΧΡΗΣΗ ${y}`, FROMDATE: `${y}-01-01 00:00:00`, FINALDATE: `${y}-12-31 00:00:00`, ISACTIVE: '1', LOCKFISCPRD: '0', ...over });
const P = (y: number, m: number, active = '1'): PeriodRow => ({ FISCPRD: String(y), PERIOD: String(m), NAME: ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος'][m - 1] ?? `Μήνας ${m}`, FROMDATE: `${y}-${String(m).padStart(2, '0')}-01 00:00:00`, FINALDATE: `${y}-${String(m).padStart(2, '0')}-28 00:00:00`, ISACTIVE: active });

describe('evaluatePeriod', () => {
  it('ανοιχτή χρήση και περίοδος ⇒ ok', () => {
    expect(evaluatePeriod('2026-03-15', [Y(2026)], [P(2026, 3)]).code).toBe('ok');
  });
  it('ημερομηνία εκτός κάθε χρήσης ⇒ no_fiscal_year, με το εύρος που υπάρχει', () => {
    const v = evaluatePeriod('2027-01-05', [Y(2025), Y(2026)], []);
    expect(v.code).toBe('no_fiscal_year');
    expect(v.message).toMatch(/05\/01\/2027.*2025–2026/);
  });
  it('κλειδωμένη χρήση ⇒ fiscal_year_closed', () => {
    const v = evaluatePeriod('2025-06-10', [Y(2025, { LOCKFISCPRD: '1' }), Y(2026)], []);
    expect(v.code).toBe('fiscal_year_closed');
    expect(v.message).toMatch(/κλειδωμένη/);
  });
  it('ανενεργή μηνιαία περίοδος ⇒ period_closed, με το όνομα του μήνα', () => {
    const v = evaluatePeriod('2026-02-10', [Y(2026)], [P(2026, 1), P(2026, 2, '0')]);
    expect(v.code).toBe('period_closed');
    expect(v.message).toMatch(/Φεβρουάριος 2026/);
  });
  it('χωρίς ημερομηνία ⇒ no_date (το λέει άλλος έλεγχος)', () => {
    expect(evaluatePeriod(null, [Y(2026)], []).code).toBe('no_date');
  });
});
