import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete } from '@/lib/bunny';
import { normalizeAfm } from '@/lib/ocr/validate';

const ItemSchema = z.object({
  code: z.string().nullable().optional(), name: z.string(),
  quantity: z.number().nullable().optional(), price: z.number().nullable().optional(),
  discount: z.number().nullable().optional(), vatRate: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
});
const PatchSchema = z.object({
  category: z.enum(['EXPENSE','INVOICE_IN','INVOICE_OUT','RECEIPT','CREDIT_NOTE','PAYROLL','TAX','OTHER']).nullable().optional(),
  docType: z.enum(['INVOICE','RECEIPT','GENERAL_TEXT']).optional(),
  notes: z.string().max(4000).nullable().optional(),
  extractedData: z.record(z.string(), z.any()).optional(),
  items: z.array(ItemSchema).optional(),
  // Hybrid reconciliation lock: null = auto-derived, RESOLVED = ολοκληρώθηκε, IGNORED = αγνοήθηκε.
  reconOverride: z.enum(['RESOLVED', 'IGNORED']).nullable().optional(),
  // Chosen SoftOne document SERIES. Ο κωδικός ΜΟΝΟΣ ΤΟΥ δεν είναι ταυτότητα: ο ίδιος κωδικός
  // υπάρχει και στις αγορές (SOSOURCE 1251) και στους πιστωτές (1653) — γι' αυτό ο επιλογέας
  // στέλνει μαζί και το `seriesSource`.
  softoneSeries: z.string().max(64).nullable().optional(),
  seriesSource: z.number().int().nullable().optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    include: { items: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const body = PatchSchema.parse(await req.json());
  const { items, seriesSource: _seriesSource, ...scalar } = body;

  // Χειροκίνητη επιλογή σειράς: κλειδώνει το έγγραφο απέναντι στον αυτόματο ταξινομητή
  // (`seriesBy: 'manual'`, spec 2026-09-11 §1.4). Καθάρισμα της σειράς ξεκλειδώνει.
  let seriesPatch: Record<string, unknown> = {};
  if ('softoneSeries' in body) {
    if (body.softoneSeries) {
      // Ο επιλογέας στέλνει την ενότητα μαζί με τον κωδικό· παλιοί clients (χωρίς
      // `seriesSource`) πέφτουν στην αναζήτηση παρακάτω.
      const seriesSource = body.seriesSource ?? await sourceOfSeries(body.softoneSeries);
      // Ταυτότητα σειράς = το ΖΕΥΓΟΣ (ενότητα, κωδικός): δεχόμαστε μόνο ενεργοποιημένες
      // σειρές — ο ίδιος κωδικός υπάρχει και στις δύο ενότητες.
      if (!(await seriesIsEnabled(body.softoneSeries, seriesSource))) {
        return NextResponse.json(
          { error: 'unknown_series', message: 'Η σειρά δεν υπάρχει στις ενεργοποιημένες σειρές αγορών/πιστωτών.' },
          { status: 422 },
        );
      }
      seriesPatch = {
        seriesBy: 'manual', seriesConfidence: 1, seriesReason: 'χειροκίνητη επιλογή', seriesSource,
      };
    } else {
      seriesPatch = { seriesBy: null, seriesConfidence: null, seriesReason: null, seriesSource: null };
    }
  }

  // Το ΑΦΜ εκδότη ζει και ως στήλη με index (spec §2/§3): κάθε γράψιμο του
  // `extractedData` πρέπει να το ξανασυγχρονίζει, αλλιώς οι ουρές δείχνουν παλιά ομάδα.
  const afmPatch = body.extractedData
    ? { issuerAfm: normalizeAfm((body.extractedData as { vatNumber?: unknown }).vatNumber) }
    : {};

  const doc = await prisma.ocrDocument.update({ where: { id }, data: { ...scalar, ...seriesPatch, ...afmPatch } as any });

  if (items) {
    await prisma.$transaction([
      prisma.ocrInvoiceItem.deleteMany({ where: { documentId: id } }),
      prisma.ocrInvoiceItem.createMany({
        data: items.map((it, i) => ({
          documentId: id, rowIndex: i, code: it.code ?? null, name: it.name,
          quantity: it.quantity ?? null, price: it.price ?? null, discount: it.discount ?? null,
          vatRate: it.vatRate ?? null, total: it.total ?? null,
        })),
      }),
    ]);
  }
  const fresh = await prisma.ocrDocument.findUnique({ where: { id }, include: { items: { orderBy: { rowIndex: 'asc' } } } });
  return NextResponse.json(fresh ?? doc);
}

/**
 * Fallback όταν ο client δεν έστειλε `seriesSource`: αγορές πρώτα (SOSOURCE 1251) και μετά
 * ΜΟΝΟ οι πιστωτές (1653) — οι δύο ενότητες που μπορεί να επιλέξει ο χρήστης. Χωρίς το φίλτρο
 * η αναζήτηση θα κατέληγε σε άσχετη ενότητα που τυχαίνει να έχει τον ίδιο κωδικό σειράς.
 */
async function seriesIsEnabled(code: string, sosource: number | null): Promise<boolean> {
  if (sosource === 1251) {
    const row = await prisma.purchaseDocType.findFirst({
      where: { code, enabled: true, isActive: true }, select: { id: true },
    });
    return !!row;
  }
  if (sosource === 1653) {
    const row = await prisma.softoneDocSeries.findFirst({
      where: { code, sosource: 1653, enabled: true, isActive: true }, select: { id: true },
    });
    return !!row;
  }
  return false;
}

async function sourceOfSeries(code: string): Promise<number | null> {
  const purchase = await prisma.purchaseDocType.findUnique({ where: { code }, select: { id: true } });
  if (purchase) return 1251;
  const creditor = await prisma.softoneDocSeries.findFirst({ where: { code, sosource: 1653 }, select: { sosource: true } });
  return creditor?.sosource ?? null;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.delete');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try { await bunnyDelete([doc.storageKey]); } catch { /* best effort */ }
  await prisma.ocrDocument.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
