import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { processAndUpload, MAX_UPLOAD_BYTES } from '@/lib/media';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const actor = await requirePermission('media.upload');
  const form = await req.formData();
  const folderId = (form.get('folderId') as string | null) || null;
  const file = form.get('file');

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'too_large', limit: MAX_UPLOAD_BYTES }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await processAndUpload({
      buffer,
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      folderId,
      uploadedById: actor.id,
    });
    await logAudit({
      userId: actor.id, userEmail: actor.email,
      action: 'media.upload', resource: 'media', resourceId: result.id,
      metadata: { name: result.name, size: result.size, isImage: result.isImage, isSvg: result.isSvg, folderId },
    });
    return NextResponse.json({ file: result });
  } catch (err) {
    return NextResponse.json({ error: 'upload_failed', message: (err as Error).message }, { status: 500 });
  }
}
