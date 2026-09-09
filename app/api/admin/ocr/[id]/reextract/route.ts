import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { extractDocument } from '@/lib/ocr/extract';
import { buildSoftoneMatch, matchDocItems, buildDuplicateCheck } from '@/lib/ocr/softone-match';
import { getSetting } from '@/lib/settings';
import { runMatchingTemplate } from '@/lib/templates/run';
import type { RunOutcome } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Re-extraction plus a template run (one vision call per region) easily outruns the 60s default.
export const maxDuration = 300;

/**
 * Re-run extraction on an existing OcrDocument with a higher-tier vision model.
 * Useful for blurry / low-contrast scans where the default fast model misses
 * fields. Temporarily overrides ai.visionModel to gemini-2.5-pro for the call.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Flag as PROCESSING immediately so the UI can render a progress bar while
  // we hit the LLM. Returns to COMPLETED / FAILED below in the same request.
  await prisma.ocrDocument.update({
    where: { id },
    data: { status: 'PROCESSING', errorMessage: null },
  });

  const buffer = await bunnyDownload(doc.storageKey);

  // Temporarily upgrade the vision model via in-memory setting override.
  const originalModel = await getSetting<string>('ai.visionModel');
  const upgradedModel = 'gemini-2.5-pro';
  await prisma.appSetting.upsert({
    where: { key: 'ai.visionModel' },
    update: { value: upgradedModel },
    create: { key: 'ai.visionModel', value: upgradedModel },
  });

  // Hoisted out of the try so the template run can happen AFTER the `finally` restores the model:
  // the global `ai.visionModel` override is shared by every request, so its window stays as narrow
  // as the re-extraction itself.
  let vat: unknown = null;
  let ok: { model: string; data: unknown } | null = null;
  let failure: string | null = null;

  try {
    const docTypeMap: Record<string, 'invoice' | 'receipt' | 'general_text'> = {
      INVOICE: 'invoice', RECEIPT: 'receipt', GENERAL_TEXT: 'general_text',
    };
    const result = await extractDocument({
      buffer,
      mimeType: doc.mimeType,
      docType: docTypeMap[doc.docType],
      language: doc.language as any,
      pdfSource: doc.mimeType === 'application/pdf' ? 'scanned' : undefined,
    });

    const items = doc.docType === 'INVOICE' && Array.isArray(result.data?.items) ? result.data.items : [];

    // Re-check the SoftOne supplier match (issuer ΑΦΜ → TRDR SODTYPE=12). Best-effort.
    const softone = await buildSoftoneMatch(result.data?.vatNumber);

    await prisma.$transaction([
      prisma.ocrInvoiceItem.deleteMany({ where: { documentId: id } }),
      prisma.ocrDocument.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          extractedData: result.data,
          rawText: result.rawText,
          model: result.model,
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
          completedAt: new Date(),
          errorMessage: null,
          ...softone,
        },
      }),
      ...items.map((it: any, idx: number) =>
        prisma.ocrInvoiceItem.create({
          data: {
            documentId: id, rowIndex: idx,
            code: it?.code ?? null, name: String(it?.name ?? ''),
            quantity: it?.quantity != null ? Number(it.quantity) : null,
            price: it?.price != null ? Number(it.price) : null,
            discount: it?.discount != null ? Number(it.discount) : null,
            vatRate: it?.vatRate != null ? Number(it.vatRate) : null,
            total: it?.total != null ? Number(it.total) : null,
          },
        }),
      ),
    ]);

    // Auto-match invoice lines to SoftOne items (products + services).
    await matchDocItems(id).catch(() => null);

    // PURDOC duplicate check (best-effort).
    if (softone.softoneTrdr) {
      const dup = await buildDuplicateCheck(softone.softoneTrdr, result.data?.invoiceNumber, result.data?.date);
      await prisma.ocrDocument.update({ where: { id }, data: dup }).catch(() => null);
    }

    vat = result.data?.vatNumber;
    ok = { model: result.model, data: result.data };
  } catch (err: any) {
    await prisma.ocrDocument.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 2000) },
    });
    failure = String(err?.message ?? err);
  } finally {
    // Restore the previous model setting.
    if (originalModel) {
      await prisma.appSetting.update({
        where: { key: 'ai.visionModel' },
        data: { value: originalModel },
      });
    } else {
      await prisma.appSetting.deleteMany({ where: { key: 'ai.visionModel' } });
    }
  }

  if (!ok) return NextResponse.json({ error: failure }, { status: 422 });

  // Extraction template linked to this issuer (spec §15.1). Best-effort; failures become a FAILED run.
  // Deliberately outside the try/finally above: the template run does its own vision calls and would
  // otherwise keep the global model override in place for everyone else while it works.
  const templateRun: RunOutcome | null = await runMatchingTemplate(id, vat, 'reextract');
  return NextResponse.json({ ok: true, ...ok, templateRun });
}
