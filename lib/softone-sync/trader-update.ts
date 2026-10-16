// SERVER: ανάγνωση και τροποποίηση ΥΠΑΡΧΟΝΤΟΣ συναλλασσομένου στη SoftOne.
// Ροή: ζωντανή ανάγνωση → σχέδιο (μόνο ό,τι άλλαξε) → setData με KEY → ΝΕΑ ανάγνωση και σύγκριση
// → καθρέφτης. Βλ. `lib/trader-update.ts`.
import 'server-only';
import { prisma } from '@/lib/db';
import { softoneCall, softoneGetTable, SoftoneError } from '@/lib/softone';
import {
  TRADER_OBJECT_BY_SODTYPE, TRADER_EDIT_FIELDS, planTraderUpdate, traderValuesFromRow, unappliedChanges,
  type TraderUpdatePlan, type TraderValues, type TraderChange,
} from '@/lib/trader-update';

const TRDR_COLS = ['TRDR', 'SODTYPE', 'CODE', ...TRADER_EDIT_FIELDS.map((f) => f.col)];
/** Όσα πεδία του TRDEXTRA ελέγχουμε ότι ΔΕΝ άλλαξαν όταν γράφουμε ΚΑΔ. */
const EXTRA_COLS = ['TRDR', 'KAD', 'KAD1', 'REFCODE', 'VARCHAR01', 'VARCHAR02', 'NUM01', 'NUM02', 'SOSDATE', 'SOEDATE'];

export interface LiveTrader { trdr: number; sodtype: number; code: string; values: TraderValues; extraRow: Record<string, string> | null }

async function readExtra(trdr: number): Promise<Record<string, string> | null> {
  const full = await softoneGetTable('TRDEXTRA', EXTRA_COLS, `TRDR=${trdr}`).catch(() => null);
  const rows = full ?? await softoneGetTable('TRDEXTRA', ['TRDR', 'KAD', 'KAD1'], `TRDR=${trdr}`).catch(() => []);
  return rows[0] ?? null;
}

export async function readTraderLive(trdr: number): Promise<LiveTrader> {
  const rows = await softoneGetTable('TRDR', TRDR_COLS, `TRDR=${trdr}`);
  const row = rows.find((r) => Number(r.TRDR) === trdr);
  if (!row) throw new SoftoneError(`Ο συναλλασσόμενος ${trdr} δεν βρέθηκε στη SoftOne.`);
  const extraRow = await readExtra(trdr);
  return { trdr, sodtype: Number(row.SODTYPE), code: String(row.CODE ?? ''), values: traderValuesFromRow(row, extraRow), extraRow };
}

export function traderPayload(live: LiveTrader, plan: TraderUpdatePlan) {
  const target = TRADER_OBJECT_BY_SODTYPE[live.sodtype];
  if (!target) throw new SoftoneError('Αυτός ο τύπος συναλλασσομένου δεν τροποποιείται από την εφαρμογή.');
  // Η κεφαλίδα πρέπει να υπάρχει στο payload· αν άλλαξε μόνο ο ΚΑΔ, στέλνουμε την ίδια επωνυμία (καμία αλλαγή).
  const head = Object.keys(plan.row).length ? plan.row : { NAME: live.values.name ?? '' };
  return {
    OBJECT: target.object, KEY: String(live.trdr),
    DATA: { [target.object]: [head], ...(plan.extra ? { [target.extra]: [plan.extra] } : {}) },
  };
}

export interface TraderUpdateResult {
  changes: TraderChange[];
  /** Πεδία που η SoftOne ΔΕΝ κράτησε (νέα ανάγνωση ≠ αυτό που στείλαμε). */
  unapplied: TraderChange[];
  /** Πεδία του TRDEXTRA που άλλαξαν ενώ δεν τα αγγίξαμε (δεν πρέπει να συμβεί ποτέ). */
  sideEffects: string[];
  payload: ReturnType<typeof traderPayload> | null;
}

export async function updateTrader(trdr: number, next: TraderValues, opts: { dryRun?: boolean } = {}): Promise<TraderUpdateResult> {
  const live = await readTraderLive(trdr);
  const plan = planTraderUpdate(live.values, next);
  if (plan.errors.length) throw new SoftoneError(plan.errors.join(' '));
  if (!plan.changes.length) return { changes: [], unapplied: [], sideEffects: [], payload: null };
  const payload = traderPayload(live, plan);
  if (opts.dryRun) return { changes: plan.changes, unapplied: [], sideEffects: [], payload };

  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number }>('setData', payload);
  if (res.success === false) throw new SoftoneError(res.error ?? `setData ${payload.OBJECT} απέτυχε (code ${res.errorcode ?? '?'})`);

  const after = await readTraderLive(trdr);
  const unapplied = unappliedChanges(plan, after.values);
  const sideEffects: string[] = [];
  if (plan.extra && live.extraRow && after.extraRow) {
    for (const [k, v] of Object.entries(live.extraRow)) {
      if (k === 'KAD' || k === 'KAD1' || k === 'TRDR') continue;
      if (String(after.extraRow[k] ?? '') !== String(v ?? '')) sideEffects.push(k);
    }
  }
  // Ο καθρέφτης από τη ΝΕΑ ανάγνωση — όχι από ό,τι ζητήσαμε.
  const v = after.values;
  await prisma.softoneTrader.update({
    where: { trdr },
    data: {
      name: v.name ?? '', afm: v.afm ?? null, doy: v.irsData ?? null, profession: v.profession ?? null,
      address: v.address ?? null, district: v.district ?? null, zip: v.zip ?? null, city: v.city ?? null,
      phone: v.phone ?? null, phone2: v.phone2 ?? null, fax: v.fax ?? null, email: v.email ?? null, webpage: v.webpage ?? null,
    },
  }).catch(() => null);
  return { changes: plan.changes, unapplied, sideEffects, payload };
}
