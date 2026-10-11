// lib/softone-sync/item-maintenance.ts — SERVER. Διόρθωση ΥΠΑΡΧΟΝΤΟΣ είδους/υπηρεσίας στο SoftOne:
// αλλαγή κωδικού ή αδρανοποίηση. ΠΟΤΕ διαγραφή — η αδρανοποίηση αναιρείται, η διαγραφή όχι.
//
// Γιατί χρειάζεται: εγγραφές που γράφτηκαν λάθος πριν διορθωθεί ο κανόνας (υπηρεσία ως είδος,
// δασμολογικός κωδικός ως κωδικός είδους). Ο τύπος (SODTYPE) μιας υπάρχουσας εγγραφής ΔΕΝ αλλάζει
// με setData, οπότε μια υπηρεσία-που-έγινε-είδος αδρανοποιείται και ξαναδημιουργείται σωστά.
//
// Ασφάλεια: στέλνεται ΜΟΝΟ ένα πεδίο της κεφαλίδας (`CODE` ή `ISACTIVE`) στο object που ορίζει ο
// ζωντανός τύπος της εγγραφής (51 → ITEM, 52 → SERVICE). Πριν και μετά διαβάζονται ζωντανά κωδικός,
// περιγραφή, τύπος και κατάσταση· κάθε απρόσμενη αλλαγή σταματά με δυνατό μήνυμα.
import 'server-only';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { softoneCall, softoneGetTable, softoneFetchAllMtrlCodes, clearItemCodeCache } from '@/lib/softone';
import { erpMaskAccepts, itemErpMaskKey } from '@/lib/erp-mask';

export class ItemMaintenanceError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message); this.name = 'ItemMaintenanceError'; }
}

const OBJECT_FOR_SODTYPE: Record<string, 'ITEM' | 'SERVICE'> = { '51': 'ITEM', '52': 'SERVICE' };
const FIELDS = ['MTRL', 'CODE', 'NAME', 'SODTYPE', 'ISACTIVE'];

async function liveRow(mtrl: number) {
  const [row] = await softoneGetTable('MTRL', FIELDS, `MTRL=${mtrl}`);
  if (!row) throw new ItemMaintenanceError('not_found', `Η εγγραφή ${mtrl} δεν βρέθηκε στο SoftOne.`, 404);
  return row;
}

export type ItemChange = { code: string } | { deactivate: true };

export interface ItemChangeResult {
  mtrl: number;
  object: 'ITEM' | 'SERVICE';
  before: { code: string; isActive: boolean };
  after: { code: string; isActive: boolean };
  /** Γραμμές παραστατικών με αντιστοίχιση σε αυτή την εγγραφή — ενημερώθηκε ο κωδικός τους. */
  linesUpdated: number;
}

export async function changeSoftoneItem(mtrl: number, change: ItemChange): Promise<ItemChangeResult> {
  const before = await liveRow(mtrl);
  const object = OBJECT_FOR_SODTYPE[before.SODTYPE];
  if (!object) throw new ItemMaintenanceError('unsupported_type', `Η εγγραφή ${mtrl} δεν είναι είδος ή υπηρεσία (SODTYPE ${before.SODTYPE}).`);

  let field: Record<string, string | number>;
  if ('code' in change) {
    const code = change.code.trim();
    if (!code) throw new ItemMaintenanceError('code_required', 'Δώσε νέο κωδικό.');
    if (code === before.CODE) throw new ItemMaintenanceError('same_code', 'Ο κωδικός είναι ήδη αυτός.');
    const kind = before.SODTYPE === '52' ? 'service' : 'product';
    const mask = await getSetting<string>(itemErpMaskKey(kind), '').catch(() => '');
    if (mask && !erpMaskAccepts(mask, code)) {
      throw new ItemMaintenanceError('code_mask', `Ο κωδικός «${code}» δεν ταιριάζει στη μάσκα της εγκατάστασης (${mask}).`);
    }
    // Μοναδικότητα σε ΟΛΟ το MTRL (είδη, υπηρεσίες, χρεοπιστώσεις, πάγια) — όπως την ελέγχει το ERP.
    clearItemCodeCache();
    const taken = await softoneFetchAllMtrlCodes();
    if (taken.includes(code)) throw new ItemMaintenanceError('code_taken', `Ο κωδικός «${code}» χρησιμοποιείται ήδη στο SoftOne.`, 409);
    field = { CODE: code };
  } else {
    if (before.ISACTIVE === '0') throw new ItemMaintenanceError('already_inactive', 'Η εγγραφή είναι ήδη ανενεργή.');
    field = { ISACTIVE: 0 };
  }

  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number }>('setData', {
    OBJECT: object, KEY: String(mtrl), DATA: { [object]: [field] },
  });
  if (res.success === false) throw new ItemMaintenanceError('softone_error', res.error ?? `setData ${object} ${mtrl} απέτυχε`, 502);

  const after = await liveRow(mtrl);
  if (after.SODTYPE !== before.SODTYPE || after.NAME !== before.NAME) {
    throw new ItemMaintenanceError('unexpected_change', `ΠΡΟΣΟΧΗ: μετά την ενημέρωση άλλαξε και η περιγραφή ή ο τύπος της ${mtrl}. Έλεγξέ την στο SoftOne.`, 500);
  }
  const ok = 'code' in change ? after.CODE === change.code.trim() : after.ISACTIVE === '0';
  if (!ok) throw new ItemMaintenanceError('not_persisted', `Το SoftOne απάντησε επιτυχία αλλά η αλλαγή δεν αποθηκεύτηκε στην ${mtrl}.`, 502);

  // Καθρέφτης + ό,τι κουβαλά αντίγραφο του κωδικού.
  await prisma.softoneItem.updateMany({ where: { mtrl }, data: { code: after.CODE, isActive: after.ISACTIVE !== '0' } });
  const lines = 'code' in change
    ? await prisma.ocrInvoiceItem.updateMany({ where: { softoneMtrl: mtrl }, data: { softoneCode: after.CODE } })
    : { count: 0 };
  clearItemCodeCache();
  return {
    mtrl, object,
    before: { code: before.CODE, isActive: before.ISACTIVE !== '0' },
    after: { code: after.CODE, isActive: after.ISACTIVE !== '0' },
    linesUpdated: lines.count,
  };
}
