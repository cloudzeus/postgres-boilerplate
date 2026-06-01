import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';
import { extractDocument } from '@/lib/ocr/extract';
import { buildSoftoneMatch, matchDocItems, buildDuplicateCheck } from '@/lib/ocr/softone-match';
import { ensureOcrThumbnail } from '@/lib/ocr/thumbnail';
import { type DocType, type SupportedLang } from '@/lib/ocr/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
const MAX_OCR_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/bmp',
]);

const DOC_TYPES: DocType[] = ['invoice', 'receipt', 'general_text'];
const LANGS: SupportedLang[] = ['el', 'en', 'de'];

function sanitizeFileName(name: string) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase() || 'document';
}

function ymPath() {
  const d = new Date();
  return `ocr/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// GET /api/admin/ocr — list
export async function GET() {
  await requirePermission('ocr.read');
  const docs = await prisma.ocrDocument.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, fileName: true, mimeType: true, size: true, docType: true,
      language: true, status: true, createdAt: true, completedAt: true,
      errorMessage: true, publicUrl: true,
    },
  });
  return NextResponse.json({ data: docs });
}

// POST /api/admin/ocr — upload + extract
export async function POST(req: Request) {
  const user = await requirePermission('ocr.create');

  const form = await req.formData();
  const file = form.get('file');
  const docType = String(form.get('docType') ?? 'invoice') as DocType;
  const language = String(form.get('language') ?? 'el') as SupportedLang;
  const pdfSource = String(form.get('pdfSource') ?? 'auto') as 'auto' | 'digital' | 'scanned';
  const batchId = form.get('batchId') ? String(form.get('batchId')) : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
  }
  if (!DOC_TYPES.includes(docType)) {
    return NextResponse.json({ error: `Invalid docType: ${docType}` }, { status: 400 });
  }
  if (!LANGS.includes(language)) {
    return NextResponse.json({ error: `Invalid language: ${language}` }, { status: 400 });
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
  }
  if (file.size > MAX_OCR_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_OCR_BYTES / (1024 * 1024)} MB limit` }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = sanitizeFileName(file.name || 'document');
  const ext = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : '';
  const stem = safeName.replace(ext, '').slice(0, 60) || 'doc';
  const storageKey = `${ymPath()}/${slug()}-${stem}${ext}`;

  // 1) Persist file to Bunny (private, no public ACL).
  await bunnyUploadPrivate({ key: storageKey, body: buffer, contentType: file.type });
  const publicUrl = `bunny:${storageKey}`; // reference only; download via signed endpoint if needed

  // 2) Create PROCESSING row.
  const doc = await prisma.ocrDocument.create({
    data: {
      fileName: file.name,
      originalName: file.name,
      storageKey,
      publicUrl,
      mimeType: file.type,
      size: file.size,
      docType: docType === 'invoice' ? 'INVOICE' : docType === 'receipt' ? 'RECEIPT' : 'GENERAL_TEXT',
      // We store the *resolved* mode after extraction; placeholder for now.
      pdfSource: file.type === 'application/pdf'
        ? (pdfSource === 'scanned' ? 'SCANNED' : pdfSource === 'digital' ? 'DIGITAL' : null)
        : null,
      language,
      status: 'PROCESSING',
      batchId,
      createdById: user.id,
    },
  });

  // 3) Run extraction.
  try {
    const result = await extractDocument({
      buffer, mimeType: file.type, docType, language,
      pdfSource: file.type === 'application/pdf' ? pdfSource : undefined,
    });

    // Persist invoice line items if present.
    const items = docType === 'invoice' && Array.isArray(result.data?.items) ? result.data.items : [];

    // Tag with the SoftOne supplier (issuer ΑΦΜ → TRDR SODTYPE=12). Best-effort.
    const softone = await buildSoftoneMatch(result.data?.vatNumber);

    await prisma.$transaction([
      prisma.ocrDocument.update({
        where: { id: doc.id },
        data: {
          status: 'COMPLETED',
          extractedData: result.data,
          rawText: result.rawText,
          model: result.model,
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
          completedAt: new Date(),
          ...softone,
          // Reflect the path actually taken: rawText present ⇒ digital, otherwise scanned.
          pdfSource: file.type === 'application/pdf'
            ? (result.rawText ? 'DIGITAL' : 'SCANNED')
            : null,
        },
      }),
      ...items.map((it: any, idx: number) =>
        prisma.ocrInvoiceItem.create({
          data: {
            documentId: doc.id,
            rowIndex: idx,
            code: it?.code ?? null,
            name: String(it?.name ?? ''),
            quantity: it?.quantity != null ? Number(it.quantity) : null,
            price: it?.price != null ? Number(it.price) : null,
            discount: it?.discount != null ? Number(it.discount) : null,
            vatRate: it?.vatRate != null ? Number(it.vatRate) : null,
            total: it?.total != null ? Number(it.total) : null,
          },
        }),
      ),
    ]);

    // Auto-match invoice lines to SoftOne items (cheap local lookup; manual matches preserved).
    await matchDocItems(doc.id).catch(() => null);

    // PURDOC duplicate check (supplier + αριθμός παραστατικού + ημ/νία). Best-effort.
    if (softone.softoneTrdr) {
      const dup = await buildDuplicateCheck(softone.softoneTrdr, result.data?.invoiceNumber, result.data?.date);
      await prisma.ocrDocument.update({ where: { id: doc.id }, data: dup }).catch(() => null);
    }

    // Best-effort thumbnail generation (don't fail the request if it errors).
    ensureOcrThumbnail(doc.id).catch(() => null);

    return NextResponse.json({ id: doc.id, data: result.data, durationMs: result.durationMs });
  } catch (err: any) {
    await prisma.ocrDocument.update({
      where: { id: doc.id },
      data: { status: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 2000) },
    });
    return NextResponse.json({ id: doc.id, error: String(err?.message ?? err) }, { status: 422 });
  }
}
