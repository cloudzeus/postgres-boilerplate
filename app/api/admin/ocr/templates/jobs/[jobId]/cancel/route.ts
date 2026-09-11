// POST → ακύρωση εργασίας (spec §13): ό,τι διαβάστηκε μένει, ό,τι δεν ξεκίνησε δεν θα ξεκινήσει.
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { cancelJob, JobError, JOB_ERROR } from '@/lib/templates/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { jobId } = await params;
  try {
    const out = await cancelJob(jobId);
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.job.cancel', resource: 'templateJob', resourceId: jobId, metadata: out });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof JobError) return NextResponse.json(JOB_ERROR[e.code].body, { status: JOB_ERROR[e.code].status });
    throw e;
  }
}
