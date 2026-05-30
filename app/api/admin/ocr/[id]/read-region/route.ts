// app/api/admin/ocr/[id]/read-region/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  field: z.string().min(1),
  page: z.number().int().min(0).default(0),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // x,y,w,h normalized 0..1
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const { field, page, bbox } = Body.parse(await req.json());

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Fetch original bytes from CDN.
  const fileRes = await fetch(doc.publicUrl, { cache: 'no-store' });
  if (!fileRes.ok) return NextResponse.json({ error: 'file unavailable' }, { status: 502 });
  let imgBuf = Buffer.from(await fileRes.arrayBuffer());

  // For PDFs, rasterize the requested page first (mirrors lib/ocr/extract.ts rasterizePdf).
  if (doc.mimeType === 'application/pdf') {
    try {
      const { createRequire } = await import('node:module');
      const req2 = createRequire(import.meta.url);
      const workerPath = req2.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
    } catch { /* pdf-to-img will try its own fallback */ }

    const { pdf } = await import('pdf-to-img');
    const document = await pdf(imgBuf, { scale: 3 });
    let i = 0;
    let found: Buffer<ArrayBuffer> | null = null;
    for await (const p of document) {
      if (i === page) {
        const raw = p as Uint8Array;
        const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
        found = Buffer.from(ab);
        break;
      }
      i++;
    }
    if (!found) return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    imgBuf = found;
  }

  // Crop the normalized bbox.
  const meta = await sharp(imgBuf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const [nx, ny, nw, nh] = bbox;
  const left = Math.max(0, Math.round(nx * W));
  const top = Math.max(0, Math.round(ny * H));
  const width = Math.min(W - left, Math.max(8, Math.round(nw * W)));
  const height = Math.min(H - top, Math.max(8, Math.round(nh * H)));
  const crop = await sharp(imgBuf)
    .extract({ left, top, width, height })
    .resize({ width: Math.max(width * 2, 400), withoutEnlargement: false })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();

  // Focused vision call — read ONLY this field.
  const visionKey =
    (await getSetting<string>('ai.visionApiKey')) ??
    process.env.GEMINI_API_KEY ??
    '';
  const visionUrl =
    (await getSetting<string>('ai.visionUrl')) ??
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const visionModel =
    (await getSetting<string>('ai.visionModel')) ?? 'gemini-2.5-flash';

  if (!visionKey) return NextResponse.json({ error: 'vision key not configured' }, { status: 500 });

  const visionRes = await fetch(visionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${visionKey}` },
    body: JSON.stringify({
      model: visionModel,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Read the value of the field "${field}" from this cropped image of a Greek invoice/receipt. Respond with ONLY the raw value text, no labels, no quotes, no explanation.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${crop.toString('base64')}` },
            },
          ],
        },
      ],
    }),
  });

  if (!visionRes.ok) return NextResponse.json({ error: `vision ${visionRes.status}` }, { status: 502 });

  const data = await visionRes.json();
  const value = String(data?.choices?.[0]?.message?.content ?? '').trim();
  const u = data?.usage ?? {};

  void logAiUsage({
    scope: 'OCR_VISION',
    provider: providerFromUrl(visionUrl),
    model: visionModel,
    operation: 'ocr.region',
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  });

  return NextResponse.json({ value });
}
