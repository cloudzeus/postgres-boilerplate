import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete } from '@/lib/bunny';
import { DocumentSchema, normalizeDocument, type DocumentJson } from '@/lib/ocr/canonical';
import { docTypeOf, loadDocumentJson, mergeLegacyPatch, saveDocumentJson } from '@/lib/ocr/document';
import { matchDocItems } from '@/lib/ocr/softone-match';

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
  // Το κανονικό έγγραφο (spec §17.1) — ο νέος τρόπος. Επικυρώνεται με το `DocumentSchema`.
  document: z.record(z.string(), z.any()).optional(),
  // Ο παλιός τρόπος: flat κλειδιά + γραμμές. Επικαλύπτονται πάνω στο υπάρχον έγγραφο, ώστε ένας
  // client που δεν ξέρει από ψηφιακή σήμανση / χειρόγραφα να μην τα σβήνει γράφοντας το σύνολο.
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
  const { items, document: documentPatch, extractedData, seriesSource: _seriesSource, ...scalar } = body;

  // Η επικύρωση του εγγράφου γίνεται ΠΡΙΝ από οποιοδήποτε γράψιμο: ένα άκυρο σώμα δεν επιτρέπεται
  // να προλάβει να αποθηκεύσει τα μισά πεδία της καρτέλας.
  let nextDocument: DocumentJson | null = null;
  if (documentPatch !== undefined) {
    const parsed = DocumentSchema.safeParse(documentPatch);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_document', message: 'Το JSON του εγγράφου δεν ταιριάζει με το σχήμα.', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    nextDocument = normalizeDocument(parsed.data);
  }

  // Χειροκίνητη επιλογή σειράς: κλειδώνει το έγγραφο απέναντι στον αυτόματο ταξινομητή
  // (`seriesBy: 'manual'`, spec 2026-09-11 §1.4). Καθάρισμα της σειράς ξεκλειδώνει.
  //
  // ΜΟΝΟ όμως όταν η σειρά ΟΝΤΩΣ άλλαξε: κάθε άλλη αποθήκευση της καρτέλας (π.χ. διόρθωση
  // συνόλου) στέλνει μαζί και την τρέχουσα σειρά· αν τη σφραγίζαμε ως «χειροκίνητη», το
  // έγγραφο θα κλείδωνε άδικα έξω από τον ταξινομητή. Ίδιο ζεύγος ⇒ ούτε σφραγίδα ούτε
  // έλεγχος ενεργοποίησης, ώστε να μένει αποθηκεύσιμο κι ένα έγγραφο με σειρά που
  // απενεργοποιήθηκε στο μεταξύ.
  let seriesPatch: Record<string, unknown> = {};
  if ('softoneSeries' in body) {
    const current = await prisma.ocrDocument.findUnique({
      where: { id }, select: { softoneSeries: true, seriesSource: true },
    }) as { softoneSeries: string | null; seriesSource: number | null } | null;
    // Ο επιλογέας στέλνει την ενότητα μαζί με τον κωδικό· παλιοί clients (χωρίς
    // `seriesSource`) πέφτουν στην αναζήτηση παρακάτω.
    const seriesSource = body.softoneSeries
      ? body.seriesSource ?? await sourceOfSeries(body.softoneSeries)
      : null;
    const unchanged =
      (current?.softoneSeries ?? null) === (body.softoneSeries ?? null) &&
      (current?.seriesSource ?? null) === seriesSource;

    if (unchanged) {
      // Ούτε 422, ούτε `seriesBy: 'manual'`· το `scalar.softoneSeries` ξαναγράφει την ίδια τιμή.
    } else if (body.softoneSeries) {
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

  const doc = await prisma.ocrDocument.update({ where: { id }, data: { ...scalar, ...seriesPatch } as any });

  // Όλα τα γραψίματα του εγγράφου — κανονικά ή legacy — καταλήγουν στον έναν γραφέα, που κρατάει
  // `document`, `extractedData`, `issuerAfm` και τις γραμμές συμφωνημένα στο ίδιο transaction.
  if (nextDocument || extractedData !== undefined || items !== undefined) {
    // Το `docType` του ΙΔΙΟΥ PATCH αποφασίζει το είδος του εγγράφου: αλλιώς ένα τιμολόγιο που μόλις
    // έγινε «γενικό κείμενο» θα κρατούσε `kind: 'invoice'` μέχρι την επόμενη εξαγωγή.
    const next = nextDocument
      ?? mergeLegacyPatch(await loadDocumentJson(id), extractedData ?? {}, items, scalar.docType ? docTypeOf(scalar.docType) : null);
    // Οι γραμμές ξαναγράφονται ΜΟΝΟ όταν το αίτημα τις αφορά. Ένα PATCH με σκέτο `extractedData`
    // (π.χ. διόρθωση ΑΦΜ από την καρτέλα) δεν έχει λόγο να σβήσει και να ξαναφτιάξει τις γραμμές —
    // θα πετούσε κάθε χειροκίνητη αντιστοίχιση που δεν προλαβαίνει να μεταφερθεί.
    const replaceItems = items !== undefined || documentPatch != null;
    await saveDocumentJson(id, next, { replaceItems });
    // Ίδια συμπεριφορά με το `persistProjection` του runner: όταν οι γραμμές αλλάζουν, ξανατρέχει
    // η αυτόματη αντιστοίχιση ώστε τα `itemsTotal`/`itemsMatched` να μη μιλούν για γραμμές που
    // μόλις διαγράφηκαν. Λογιστική δουλειά — ποτέ μοιραία.
    if (replaceItems) await matchDocItems(id).catch(() => null);
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
