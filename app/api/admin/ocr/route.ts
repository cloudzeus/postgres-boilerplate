import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';
import { extractAndPersist } from '@/lib/ocr/pipeline';
import { isExtractDocType, type ExtractDocType, type SupportedLang } from '@/lib/ocr/templates';
import { MAX_OCR_BYTES, MAX_OCR_MB } from '@/lib/ocr/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Base OCR plus a template run (one vision call per region) easily outruns the 60s default.
export const maxDuration = 300;

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/bmp',
]);

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
  // Προεπιλογή «auto»: ο χρήστης δεν χρειάζεται να ξέρει αν αυτό που ανεβάζει είναι τιμολόγιο,
  // απόδειξη ή ελεύθερο κείμενο — το αποφασίζει η ίδια η ανάγνωση.
  const docType = String(form.get('docType') ?? 'auto') as ExtractDocType;
  const language = String(form.get('language') ?? 'el') as SupportedLang;
  const pdfSource = String(form.get('pdfSource') ?? 'auto') as 'auto' | 'digital' | 'scanned';
  const batchId = form.get('batchId') ? String(form.get('batchId')) : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
  }
  if (!isExtractDocType(docType)) {
    return NextResponse.json({ error: `Invalid docType: ${docType}` }, { status: 400 });
  }
  if (!LANGS.includes(language)) {
    return NextResponse.json({ error: `Invalid language: ${language}` }, { status: 400 });
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
  }
  if (file.size > MAX_OCR_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_OCR_MB} MB limit` }, { status: 413 });
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
      // Προσωρινό είδος όσο τρέχει η ανάγνωση· αντικαθίσταται από το `resolvedDocType` παρακάτω.
      // Στο «auto» δεν ξέρουμε ακόμη τίποτα — κρατάμε INVOICE, το συνηθέστερο.
      docType: docType === 'receipt' ? 'RECEIPT' : docType === 'general_text' ? 'GENERAL_TEXT' : 'INVOICE',
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

  // 3) Run extraction — η ΚΟΙΝΗ διαδρομή (ίδια για τα κομμάτια ενός διαχωρισμένου PDF).
  try {
    const { data, durationMs, templateRun } = await extractAndPersist({
      documentId: doc.id,
      buffer,
      mimeType: file.type,
      docType,
      language,
      pdfSource,
      trigger: 'upload',
    });

    return NextResponse.json({ id: doc.id, data, durationMs, templateRun });
  } catch (err: any) {
    await prisma.ocrDocument.update({
      where: { id: doc.id },
      data: { status: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 2000) },
    });
    return NextResponse.json({ id: doc.id, error: String(err?.message ?? err) }, { status: 422 });
  }
}
