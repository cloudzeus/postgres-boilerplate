import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SampleError, SAMPLE_MAX_BYTES, storeSample } from '@/lib/templates/sample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ERRORS: Record<SampleError['code'], { status: number; body: Record<string, string> }> = {
  not_found: { status: 404, body: { error: 'not_found' } },
  too_large: { status: 413, body: { error: 'too_large', message: 'Μέγιστο 25 MB' } },
  unsupported_type: { status: 415, body: { error: 'unsupported_type' } },
};

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
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.sample.upload', resource: 'extractionTemplate', resourceId: id, metadata: { mimeType, pageCount } });
    return NextResponse.json({ ok: true, mimeType, pageCount });
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(ERRORS[e.code].body, { status: ERRORS[e.code].status });
    throw e;
  }
}
