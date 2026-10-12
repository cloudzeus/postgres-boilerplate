import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { rematchOpenDocuments } from '@/lib/ocr/queues';
import { lineCoverage } from '@/lib/ocr/coverage';

// Επανεφαρμογή της μνήμης αντιστοιχίσεων σε ΟΛΑ τα ανοιχτά παραστατικά — τοπικά, καμία κλήση SoftOne.
export async function POST() {
  const u = await requirePermission('ocr.categorize');
  const before = await lineCoverage();
  const r = await rematchOpenDocuments();
  const after = await lineCoverage();
  await logAudit({
    userId: u.id, userEmail: u.email, action: 'ocr.lines.rematch_all', resource: 'ocr_document', resourceId: 'all',
    metadata: { docs: r.docs, filled: r.filled, before: before.matched, after: after.matched, total: after.total },
  }).catch(() => null);
  return NextResponse.json({ ok: true, ...r, before, after });
}
