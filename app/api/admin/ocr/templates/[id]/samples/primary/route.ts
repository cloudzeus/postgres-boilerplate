// POST → κάνει το κύριο δείγμα του προτύπου (αυτό με τις περιοχές) και δείγμα εκπαίδευσης (spec §11).
// Για τα πρότυπα που υπήρχαν πριν από την εκπαίδευση: το αρχείο είναι εκεί, η γραμμή λείπει.
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SampleError, SAMPLE_ERROR } from '@/lib/templates/sample';
import { adoptPrimarySample, refreshTrainingScore } from '@/lib/templates/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  try {
    const sample = await adoptPrimarySample(id, u.id);
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.sample.adopt_primary', resource: 'extractionTemplate', resourceId: id, metadata: { sampleId: sample.id } });
    return NextResponse.json({ sample, training: await refreshTrainingScore(id) });
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(SAMPLE_ERROR[e.code].body, { status: SAMPLE_ERROR[e.code].status });
    throw e;
  }
}
