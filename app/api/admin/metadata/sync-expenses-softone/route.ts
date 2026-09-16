import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { syncExpenses, syncFailureResponse, withResyncLock } from '@/lib/softone/resync';

// Ενεργά έξοδα (object EXPENSES → πίνακας EXPN) → `SoftoneExpense`.
// Η λογική ζει στο `lib/softone/resync.ts` — ΜΙΑ υλοποίηση, που καλεί και το «Συγχρονισμός όλων».
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    // Η κλειδαριά είναι κοινή με το «Συγχρονισμός όλων»: ο πίνακας σβήνεται και ξαναγράφεται
    // ολόκληρος, οπότε δύο ταυτόχρονα περάσματα πάνω του δεν επιτρέπονται.
    const r = await withResyncLock(u, ['expenses'], () => syncExpenses(u));
    return NextResponse.json({ ok: true, total: r.total, created: r.created, updated: r.updated, skipped: r.skipped, ...r.detail, syncedAt: r.syncedAt });
  } catch (e) {
    // Το SoftOne δεν χρεώνεται ό,τι δεν είναι δικό του: αποτυχία της τοπικής βάσης βγαίνει 500
    // `database_error`, «τρέχει ήδη συγχρονισμός» 409.
    const { status, body } = syncFailureResponse(e);
    return NextResponse.json(body, { status });
  }
}
