// POST {documentId} → κάνει ένα ήδη σαρωμένο έγγραφο δείγμα εκπαίδευσης του προτύπου (§11 + §14.7).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SampleError, SAMPLE_ERROR } from '@/lib/templates/sample';
import { refreshTrainingScore, sampleFromDocument } from '@/lib/templates/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.object({ documentId: z.string().min(1).max(60) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  try {
    const sample = await sampleFromDocument(id, parsed.data.documentId, u.id);
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.sample.from_document', resource: 'extractionTemplate', resourceId: id, metadata: { documentId: parsed.data.documentId, sampleId: sample.id } });
    return NextResponse.json({ sample, training: await refreshTrainingScore(id) });
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(SAMPLE_ERROR[e.code].body, { status: SAMPLE_ERROR[e.code].status });
    console.error('[templates] sample from document failed', id, (e as Error).message);
    return NextResponse.json({ error: 'copy_failed', message: 'Το αρχείο του εγγράφου δεν ήταν διαθέσιμο' }, { status: 502 });
  }
}
