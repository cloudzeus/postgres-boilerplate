// POST → ξαναδιαβάζει ΟΛΑ τα δείγματα του προτύπου (μετά από αλλαγή περιοχών/οδηγιών, spec §11).
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SampleError, SAMPLE_ERROR } from '@/lib/templates/sample';
import { readAllSamples, refreshTrainingScore } from '@/lib/templates/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Δεκάδες δείγματα × δεκάδες περιοχές, σειριακά: αυτό είναι το πιο αργό αίτημα όλης της εφαρμογής.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  try {
    const r = await readAllSamples(id);
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.samples.read_all', resource: 'extractionTemplate', resourceId: id, metadata: r });
    return NextResponse.json({ ...r, training: await refreshTrainingScore(id) });
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(SAMPLE_ERROR[e.code].body, { status: SAMPLE_ERROR[e.code].status });
    throw e;
  }
}
