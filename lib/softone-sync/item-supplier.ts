// lib/softone-sync/item-supplier.ts — SERVER. Κωδικός & τιμή αγοράς ανά προμηθευτή σε ΥΠΑΡΧΟΝ είδος.
//
// Ανάγνωση με getData (φρέσκια, κάθε φορά), σχέδιο με `planItemSupplier` (καθαρό), εγγραφή με
// setData ΜΟΝΟ όταν το ζητήσει ο χρήστης, και ΑΝΑΓΝΩΣΗ ΠΙΣΩ: το `success:true` δεν αποδεικνύει ότι
// έμειναν όλες οι γραμμές — επιβεβαιώνουμε ότι η αλλαγή μας είναι εκεί ΚΑΙ ότι δεν χάθηκε καμία
// από τις υπάρχουσες.
import 'server-only';
import { softoneCall, SoftoneError } from '@/lib/softone';
import {
  ITEM_SUPPLIER_LOCATEINFO, parseItemSupplierData, planItemSupplier,
  type ItemSupplierChange, type ItemSupplierPlan, type ItemSupplierState,
} from '@/lib/item-supplier';

export async function readItemSuppliers(mtrl: number): Promise<ItemSupplierState> {
  const res = await softoneCall<{ success?: boolean; error?: string; data?: Record<string, unknown> }>(
    'getData', { OBJECT: 'ITEM', KEY: mtrl, LOCATEINFO: ITEM_SUPPLIER_LOCATEINFO },
  );
  if (res.success === false) throw new SoftoneError(res.error ?? `getData ITEM ${mtrl} απέτυχε`);
  return parseItemSupplierData(mtrl, res.data);
}

export async function planForItem(mtrl: number, change: ItemSupplierChange, supplierLabel?: string): Promise<{ state: ItemSupplierState; plan: ItemSupplierPlan }> {
  const state = await readItemSuppliers(mtrl);
  return { state, plan: planItemSupplier(state, change, supplierLabel) };
}

/** Γράφει το σχέδιο και επιβεβαιώνει με ανάγνωση. Πετά με ελληνικό μήνυμα αν κάτι δεν έμεινε. */
export async function applyItemSupplier(mtrl: number, change: ItemSupplierChange, supplierLabel?: string): Promise<{ state: ItemSupplierState; plan: ItemSupplierPlan }> {
  const { state: before, plan } = await planForItem(mtrl, change, supplierLabel);
  if (!plan.payload) return { state: before, plan };
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number }>('setData', plan.payload);
  if (res.success === false) throw new SoftoneError(res.error ?? `setData ITEM απέτυχε (code ${res.errorcode ?? '?'})`);

  const after = await readItemSuppliers(mtrl);
  if (after.codes.length < before.codes.length || after.prices.length < before.prices.length) {
    throw new SoftoneError('Η SoftOne δέχτηκε την αλλαγή, αλλά μετά λείπουν γραμμές κωδικών/τιμών που υπήρχαν. Έλεγξε την καρτέλα του είδους.');
  }
  const code = String(change.code ?? '').trim().toUpperCase();
  if (plan.payload.DATA.MTRSUPCODE && code && !after.codes.some((r) => r.trdr === change.trdr && r.code.toUpperCase() === code)) {
    throw new SoftoneError('Ο κωδικός προμηθευτή ΔΕΝ βρέθηκε στο είδος μετά την εγγραφή.');
  }
  if (plan.payload.DATA.MTRSUPPRCS && change.price != null
    && !after.prices.some((r) => r.trdr === change.trdr && r.price != null && Math.abs(r.price - change.price!) < 1e-6)) {
    throw new SoftoneError('Η τιμή αγοράς ΔΕΝ βρέθηκε στο είδος μετά την εγγραφή.');
  }
  return { state: after, plan };
}
