// Τροποποίηση ΥΠΑΡΧΟΝΤΟΣ συναλλασσομένου στη SoftOne — καθαρό module (χωρίς I/O).
//
// Κανόνας: στέλνουμε ΜΟΝΟ ό,τι άλλαξε σε σχέση με τη ΖΩΝΤΑΝΗ ανάγνωση της καρτέλας (όχι με τον
// τοπικό καθρέφτη, που μπορεί να είναι παλιός). Τα objects SUPPLIER/CUSTOMER/DEBTOR/CREDITOR είναι
// EditMaster: το setData με KEY ενημερώνει μόνο τα πεδία που στέλνονται. Ο ΚΑΔ ζει σε άλλον πίνακα
// (TRDEXTRA μέσω <SUP|CUS|DEB|CRE>EXTRA) — στέλνεται μόνο αν άλλαξε.

/** Object ανά SODTYPE. Οι χρηματικοί λογαριασμοί (14) δεν τροποποιούνται από εδώ. */
export const TRADER_OBJECT_BY_SODTYPE: Record<number, { object: string; extra: string }> = {
  12: { object: 'SUPPLIER', extra: 'SUPEXTRA' },
  13: { object: 'CUSTOMER', extra: 'CUSEXTRA' },
  15: { object: 'DEBTOR', extra: 'DEBEXTRA' },
  16: { object: 'CREDITOR', extra: 'CREEXTRA' },
};

/** Τα πεδία της καρτέλας που τροποποιούνται, με το όριο χαρακτήρων του schema (SUPPLIER/CUSTOMER). */
export const TRADER_EDIT_FIELDS = [
  { key: 'name', col: 'NAME', label: 'Επωνυμία', max: 128 },
  { key: 'afm', col: 'AFM', label: 'Α.Φ.Μ.', max: 20 },
  { key: 'irsData', col: 'IRSDATA', label: 'Δ.Ο.Υ.', max: 128 },
  { key: 'profession', col: 'JOBTYPETRD', label: 'Επάγγελμα', max: 128 },
  { key: 'address', col: 'ADDRESS', label: 'Διεύθυνση', max: 100 },
  { key: 'district', col: 'DISTRICT', label: 'Περιοχή', max: 30 },
  { key: 'zip', col: 'ZIP', label: 'Τ.Κ.', max: 10 },
  { key: 'city', col: 'CITY', label: 'Πόλη', max: 30 },
  { key: 'country', col: 'COUNTRY', label: 'Χώρα', max: 6 },
  { key: 'phone', col: 'PHONE01', label: 'Τηλέφωνο', max: 20 },
  { key: 'phone2', col: 'PHONE02', label: 'Τηλέφωνο 2', max: 20 },
  { key: 'fax', col: 'FAX', label: 'Fax', max: 20 },
  { key: 'email', col: 'EMAIL', label: 'Email', max: 128 },
  { key: 'webpage', col: 'WEBPAGE', label: 'Ιστοσελίδα', max: 64 },
] as const;

export type TraderFieldKey = (typeof TRADER_EDIT_FIELDS)[number]['key'];
export type TraderValues = Partial<Record<TraderFieldKey, string | null>> & { kad?: number | null; kad1?: number | null };

export interface TraderChange { key: TraderFieldKey | 'kad' | 'kad1'; label: string; from: string | null; to: string | null }

const norm = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s : null;
};
const kadNorm = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** Από τη γραμμή TRDR (GetTable) στις τιμές της φόρμας. */
export function traderValuesFromRow(row: Record<string, unknown>, extra?: Record<string, unknown> | null): TraderValues {
  const out: TraderValues = {};
  for (const f of TRADER_EDIT_FIELDS) out[f.key] = norm(row[f.col]);
  out.kad = kadNorm(extra?.KAD);
  out.kad1 = kadNorm(extra?.KAD1);
  return out;
}

export interface TraderUpdatePlan {
  changes: TraderChange[];
  /** Τα πεδία της καρτέλας (μόνο όσα άλλαξαν). */
  row: Record<string, unknown>;
  /** Ο πίνακας EXTRA (μόνο αν άλλαξε ΚΑΔ). */
  extra: Record<string, unknown> | null;
  errors: string[];
}

/**
 * Τι αλλάζει. `next` περιέχει ΜΟΝΟ όσα πεδία ορίζει ο χρήστης (απόντα κλειδιά = «δεν αγγίζω»).
 * Κενή τιμή σε πεδίο που είχε τιμή = σβήσιμο (στέλνεται ""). Η επωνυμία δεν σβήνεται ποτέ.
 */
export function planTraderUpdate(current: TraderValues, next: TraderValues): TraderUpdatePlan {
  const changes: TraderChange[] = [];
  const row: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of TRADER_EDIT_FIELDS) {
    if (!(f.key in next)) continue;
    const to = norm(next[f.key]);
    const from = norm(current[f.key]);
    if (to === from) continue;
    if (f.key === 'name' && !to) { errors.push('Η επωνυμία δεν μπορεί να είναι κενή.'); continue; }
    if (to && to.length > f.max) { errors.push(`${f.label}: έως ${f.max} χαρακτήρες (έχει ${to.length}).`); continue; }
    if (f.key === 'country' && to && !/^\d+$/.test(to)) { errors.push('Χώρα: επίλεξε από το μητρώο χωρών της SoftOne.'); continue; }
    changes.push({ key: f.key, label: f.label, from, to });
    row[f.col] = f.key === 'irsData' || f.key === 'country' ? (to ? Number(to) || to : '') : (to ?? '');
  }
  let extra: Record<string, unknown> | null = null;
  for (const [key, col, label] of [['kad', 'KAD', 'ΚΑΔ (κύρια)'], ['kad1', 'KAD1', 'ΚΑΔ (δευτερεύουσα)']] as const) {
    if (!(key in next)) continue;
    const to = kadNorm(next[key]);
    const from = kadNorm(current[key]);
    if (to === from) continue;
    extra ??= {};
    extra[col] = to ?? '';
    changes.push({ key, label, from: from == null ? null : String(from), to: to == null ? null : String(to) });
  }
  return { changes, row, extra, errors };
}

/**
 * Μετά την εγγραφή: ποια πεδία ΔΕΝ πήραν την τιμή που στείλαμε (σύγκριση με νέα ανάγνωση).
 * Η SoftOne απαντά `success:true` και για εγγραφές που αγνόησε — αυτό είναι η μόνη απόδειξη.
 */
export function unappliedChanges(plan: TraderUpdatePlan, after: TraderValues): TraderChange[] {
  return plan.changes.filter((c) => {
    const got = c.key === 'kad' || c.key === 'kad1' ? (after[c.key] == null ? null : String(after[c.key])) : norm(after[c.key]);
    return (got ?? null) !== (c.to ?? null);
  });
}
