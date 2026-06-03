import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeAfm } from '@/lib/ocr/validate';
import { slugifyFieldKey, upsertFieldRule } from '@/lib/ocr/field-rules';
import { extractDocument } from '@/lib/ocr/extract';
import { bunnyDownload } from '@/lib/bunny';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const norm = z.number().min(0).max(1);
const Body = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  regionHint: z.object({ page: z.number().int().min(0), bbox: z.tuple([norm, norm, norm, norm]) }).optional(),
});

const docEnumToType = { INVOICE: 'invoice', RECEIPT: 'receipt', GENERAL_TEXT: 'general_text' } as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('ocr.categorize');
  const { id } = await params;
  const body = Body.parse(await req.json());

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.docType === 'GENERAL_TEXT') {
    return NextResponse.json({ error: 'Τα ειδικά πεδία υποστηρίζονται μόνο σε τιμολόγια/αποδείξεις.' }, { status: 422 });
  }

  const data = (doc.extractedData ?? {}) as any;
  const afm = normalizeAfm(data?.vatNumber);
  if (!afm || !/^\d{9}$/.test(afm)) {
    return NextResponse.json({ error: 'Δεν υπάρχει έγκυρο ΑΦΜ εκδότη για να οριστεί κανόνας.' }, { status: 422 });
  }

  const docType = docEnumToType[doc.docType];
  const key = slugifyFieldKey(body.label);

  const rule = await upsertFieldRule({
    vatNumber: afm, docType, key, label: body.label,
    description: body.description ?? null, regionHint: body.regionHint ?? null,
    supplierName: data?.companyName ?? data?.storeName ?? null, createdById: user.id,
  });

  // Immediately apply to THIS document so the user sees the value now.
  let value: unknown = null;
  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const result = await extractDocument({
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer),
      mimeType: doc.mimeType,
      docType,
      language: (doc.language as any) ?? 'el',
      pdfSource: doc.mimeType === 'application/pdf' ? 'auto' : undefined,
    });
    value = (result.data?.customFields ?? {})[key] ?? null;
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { extractedData: result.data } });
  } catch {
    // Rule is saved; immediate apply is best-effort.
  }

  return NextResponse.json({ ok: true, rule: { id: rule.id, key: rule.key, label: rule.label }, value });
}
