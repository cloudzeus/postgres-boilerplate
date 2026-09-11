import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SampleError, SAMPLE_ERROR, SAMPLE_MAX_BYTES, storeSample } from '@/lib/templates/sample';
import { refreshTrainingScore } from '@/lib/templates/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ERRORS = SAMPLE_ERROR;

// POST multipart { file } — αποθηκεύει το δείγμα στο private Bunny zone και μετρά σελίδες.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;

  // Content-Length first: formData() buffers the whole body, so a size check after it has
  // already paid the memory. storeSample keeps its own guard for the decoded bytes.
  if (Number(req.headers.get('content-length') ?? 0) > SAMPLE_MAX_BYTES) return NextResponse.json(ERRORS.too_large.body, { status: ERRORS.too_large.status });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 });
  if (file.size > SAMPLE_MAX_BYTES) return NextResponse.json(ERRORS.too_large.body, { status: ERRORS.too_large.status });

  try {
    const { mimeType, pageCount } = await storeSample(id, Buffer.from(await file.arrayBuffer()));
    // A new design sample resets the primary training row, so the template's score no longer
    // describes the samples it has. Recount before anyone reads the gate. Never fatal.
    await refreshTrainingScore(id).catch((e) => console.error('[templates] score refresh failed', id, (e as Error).message));
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.sample.upload', resource: 'extractionTemplate', resourceId: id, metadata: { mimeType, pageCount } });
    return NextResponse.json({ ok: true, mimeType, pageCount });
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(ERRORS[e.code].body, { status: ERRORS[e.code].status });
    throw e;
  }
}
