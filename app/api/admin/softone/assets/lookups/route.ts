import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { loadAssetFormData } from '@/lib/softone-sync/asset-create';

export const dynamic = 'force-dynamic';

// GET — ό,τι χρειάζεται η φόρμα «Νέο πάγιο»: κατηγορίες (ζωντανά από το SoftOne), προτεινόμενοι
// κωδικοί, ΦΠΑ, αποθήκη παγίων. Μόνο ανάγνωση.
export async function GET() {
  await requirePermission('ocr.categorize');
  try {
    return NextResponse.json(await loadAssetFormData());
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
