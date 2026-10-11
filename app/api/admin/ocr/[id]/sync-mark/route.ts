import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { PostError, syncPostedMark } from '@/lib/ocr/post-softone';

// Ο ΜΑΡΚ σε ήδη καταχωρισμένο παραστατικό (μόνο το `SomyDataMARK` της κεφαλίδας, με έλεγχο ότι οι
// γραμμές δεν άλλαξαν) — βλ. `syncPostedMark`.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.post');
  const { id } = await params;
  try {
    const r = await syncPostedMark(id);
    if (r.changed) {
      await logAudit({
        userId: u.id, userEmail: u.email, action: 'ocr.post.mark', resource: 'ocr_document', resourceId: id,
        metadata: { ref: r.ref, mark: r.mark },
      }).catch(() => null);
    }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const code = e instanceof PostError ? e.code : 'mark_sync_failed';
    return NextResponse.json({ error: code, message: (e as Error).message }, { status: e instanceof PostError && e.code === 'not_found' ? 404 : 422 });
  }
}
