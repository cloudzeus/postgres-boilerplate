import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';
import { extractField, type FieldExtract, type FieldDef } from '@/lib/ocr/tax-extract';
import type { Prisma } from '@prisma/client';

/** Runs async tasks with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission('ocr.create');
  const { id: companyId } = await params;

  const form = await req.formData();
  const file = form.get('file');
  const templateId = form.get('templateId') ? String(form.get('templateId')) : null;
  const fiscalYearRaw = form.get('fiscalYear');
  const fiscalYear = fiscalYearRaw ? Number(fiscalYearRaw) : NaN;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!templateId) {
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
  }
  if (!Number.isInteger(fiscalYear)) {
    return NextResponse.json({ error: 'fiscalYear must be an integer' }, { status: 400 });
  }

  const template = await prisma.taxFormTemplate.findUnique({
    where: { id: templateId },
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.type === 'application/pdf' ? 'pdf' : 'png';
  const key = `ocr/tax/${companyId}/${templateId}-${fiscalYear}-${crypto.randomUUID()}.${ext}`;

  let doc: Awaited<ReturnType<typeof prisma.ocrDocument.create>>;
  try {
    await bunnyUploadPrivate({ key, body: buf, contentType: file.type });

    doc = await prisma.ocrDocument.create({
      data: {
        fileName: key.split('/').pop()!,
        originalName: file.name,
        storageKey: key,
        publicUrl: `bunny:${key}`,
        mimeType: file.type,
        size: buf.length,
        docType: 'GENERAL_TEXT',
        category: 'TAX',
        language: 'el',
        status: 'PROCESSING',
        companyId,
        taxTemplateId: templateId,
        fiscalYear,
        createdById: user.id,
      },
    });
  } catch {
    return NextResponse.json({ error: 'storage upload failed' }, { status: 502 });
  }

  try {
    const defs: FieldDef[] = template.fields.map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      aiHint: f.aiHint ?? null,
      regionHint: f.regionHint as FieldDef['regionHint'],
      valueType: f.valueType as FieldDef['valueType'],
      kind: f.kind as FieldDef['kind'],
      config: f.config as FieldDef['config'],
    }));

    // Crop + OCR each field's own region (reliable), with bounded concurrency.
    const extracted: FieldExtract[] = await mapLimit(defs, 3, (d) => extractField(buf, file.type, d));

    await prisma.ocrDocument.update({
      where: { id: doc.id },
      data: {
        status: 'COMPLETED',
        extractedData: extracted as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ documentId: doc.id, fiscalYear, fields: extracted });
  } catch (e: any) {
    await prisma.ocrDocument.update({
      where: { id: doc.id },
      data: {
        status: 'FAILED',
        errorMessage: String(e?.message ?? e).slice(0, 2000),
      },
    });
    return NextResponse.json({ error: 'extraction failed' }, { status: 422 });
  }
}
