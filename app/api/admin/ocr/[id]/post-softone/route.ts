import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { PostError, postDocumentToSoftone } from '@/lib/ocr/post-softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST → push the extracted OCR document to SoftOne (FINDOC / PURDOC).
 * The work lives in lib/ocr/post-softone.ts so the template runner posts through the same path.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.post');
  const { id } = await params;

  try {
    const { ref } = await postDocumentToSoftone(id);
    return NextResponse.json({ ok: true, ref });
  } catch (err) {
    if (err instanceof PostError) {
      return NextResponse.json({ error: err.message }, { status: err.code === 'not_found' ? 404 : 422 });
    }
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}
