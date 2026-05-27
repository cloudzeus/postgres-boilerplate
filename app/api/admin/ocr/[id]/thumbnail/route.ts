import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { ensureOcrThumbnail } from '@/lib/ocr/thumbnail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const url = await ensureOcrThumbnail(id);
  if (!url) return NextResponse.json({ error: 'could not generate thumbnail' }, { status: 422 });
  return NextResponse.json({ url });
}
