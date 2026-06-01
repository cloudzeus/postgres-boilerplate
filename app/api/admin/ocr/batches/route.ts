import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// GET — list batches with aggregate counts.
export async function GET() {
  await requirePermission('ocr.read');
  const batches = await prisma.ocrBatch.findMany({
    orderBy: { createdAt: 'desc' }, take: 200,
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json({ batches });
}

// POST — create a batch (folder) before uploading its files.
export async function POST(req: Request) {
  const user = await requirePermission('ocr.create');
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim() || 'Φάκελος';
  const docType = ['INVOICE', 'RECEIPT', 'GENERAL_TEXT'].includes(body?.docType) ? body.docType : 'INVOICE';
  const language = String(body?.language ?? 'el');

  const batch = await prisma.ocrBatch.create({
    data: { name: name.slice(0, 120), docType, language, createdById: user.id },
  });
  return NextResponse.json({ id: batch.id, name: batch.name });
}
