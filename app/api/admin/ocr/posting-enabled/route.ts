import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { POSTING_ENABLED_KEY } from '@/lib/ocr/post-softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ο διακόπτης `softone.postingEnabled`, ΜΟΝΟΣ του.
 *
 * Υπάρχει επειδή οι διάλογοι δημιουργίας μητρώου (συναλλασσόμενος, είδος/υπηρεσία) άνοιγαν πάντα
 * σε «Δοκιμή», ανεξάρτητα από το αν η εγκατάσταση καταχωρεί όντως στο SoftOne. Αποτέλεσμα: σε
 * παραγωγική εγκατάσταση ο χρήστης συμπλήρωνε ολόκληρη φόρμα και το κουμπί έλεγε «Προετοιμασία
 * object» — δηλαδή δεν δημιουργούσε τίποτα. Τώρα το default ΑΚΟΛΟΥΘΕΙ τον διακόπτη.
 *
 * Δεν περνά από `/api/admin/settings`: εκείνο θέλει δικαίωμα ρυθμίσεων, ενώ αυτό το χρειάζεται
 * όποιος δουλεύει παραστατικά. Επιστρέφει ΜΟΝΟ ένα boolean — κανένα άλλο στοιχείο ρυθμίσεων.
 */
export async function GET() {
  await requirePermission('ocr.read');
  const enabled = (await getSetting<boolean>(POSTING_ENABLED_KEY)) === true;
  return NextResponse.json({ enabled });
}
