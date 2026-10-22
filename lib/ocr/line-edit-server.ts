// SERVER: χειροκίνητη επεξεργασία γραμμών (πρόσθεσε / άλλαξε / αφαίρεσε). Βλ. `lib/ocr/line-edit.ts`.
//
// Οι γραμμές που ΜΕΝΟΥΝ κρατούν τη δική τους εγγραφή `OcrInvoiceItem` (άρα αντιστοίχιση SoftOne,
// κέντρο κόστους, έργο, επιμερισμούς) — απλώς αλλάζει το `rowIndex` όπου χρειάζεται. Μόνο όσες
// αφαιρούνται χάνουν ό,τι είχαν· οι νέες μπαίνουν χωρίς αντιστοίχιση και περνούν από την αυτόματη.
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { matchDocItems } from '@/lib/ocr/softone-match';
import { describeLineEdit, planLineEdit, type LineEditOps, type LineValues } from '@/lib/ocr/line-edit';

export class LineEditError extends Error {}

const NO_MATCH = {
  softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneAsset: null,
  softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: null,
} as const;

export async function editDocumentLines(
  docId: string,
  ops: LineEditOps,
  actor: { id: string; email: string } | null,
): Promise<{ summary: string; lines: number; matched: number }> {
  const meta = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { postStatus: true, status: true } });
  if (!meta) throw new LineEditError('Το παραστατικό δεν βρέθηκε.');
  if (meta.postStatus === 'POSTED') throw new LineEditError('Το παραστατικό έχει ήδη καταχωριστεί στη SoftOne — οι γραμμές του δεν αλλάζουν πια από εδώ.');
  if (meta.postStatus === 'PENDING') throw new LineEditError('Η καταχώριση είναι σε εξέλιξη — δοκίμασε σε λίγο.');

  const doc = await loadDocumentJson(docId);
  const current: LineValues[] = doc.lines.map((l) => ({
    name: l.name ?? '', code: l.code, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice,
    discount: l.discount, net: l.net, vatRate: l.vatRate,
  }));
  const plan = planLineEdit(current, ops);
  if (plan.errors.length) throw new LineEditError(plan.errors.join(' '));

  const items = await prisma.ocrInvoiceItem.findMany({ where: { documentId: docId }, select: { id: true, rowIndex: true } });
  const itemAt = new Map(items.map((i) => [i.rowIndex, i.id]));

  // Οι γραμμές του κανονικού εγγράφου: οι παλιές κρατούν ό,τι δεν αγγίζει η φόρμα (EAN, σειριακά,
  // μονάδα αγοράς, custom), οι νέες ξεκινούν καθαρές.
  const nextLines = plan.lines.map(({ values: v, from }) => {
    const base = from != null ? doc.lines[from] : {};
    const vatAmount = v.net != null && v.vatRate != null ? Math.round(v.net * v.vatRate) / 100 : null;
    return {
      ...base,
      name: v.name, code: v.code, unit: v.unit, quantity: v.quantity, unitPrice: v.unitPrice, discount: v.discount,
      net: v.net, vatRate: v.vatRate, vatAmount,
      total: v.net != null && vatAmount != null ? Math.round((v.net + vatAmount) * 100) / 100 : null,
    };
  });

  const itemOps = [
    // Όσες αφαιρούνται: φεύγουν με τους επιμερισμούς τους (cascade).
    ...(plan.removed.length ? [prisma.ocrInvoiceItem.deleteMany({ where: { documentId: docId, rowIndex: { in: plan.removed } } })] : []),
    // Όσες μένουν: νέο rowIndex + τα ποσά της φόρμας. Αν άλλαξε περιγραφή/κωδικός, η αυτόματη
    // αντιστοίχιση ξαναγίνεται — η χειροκίνητη (`manual`) μένει.
    ...plan.lines.flatMap(({ values: v, from }, to) => {
      if (from == null) return [];
      const id = itemAt.get(from);
      if (!id) return [];
      const reset = plan.identityChanged.includes(to);
      return [prisma.ocrInvoiceItem.update({
        where: { id },
        data: {
          rowIndex: to, name: v.name, code: v.code, quantity: v.quantity, price: v.unitPrice,
          discount: v.discount, vatRate: v.vatRate, total: v.net,
        },
      }), ...(reset ? [prisma.ocrInvoiceItem.updateMany({
        where: { id, NOT: { softoneMatchedBy: 'manual' } }, data: { ...NO_MATCH },
      })] : [])];
    }),
    // Νέες: χωρίς αντιστοίχιση.
    ...(plan.lines.some((l) => l.from == null) ? [prisma.ocrInvoiceItem.createMany({
      data: plan.lines.flatMap(({ values: v, from }, to) => (from != null ? [] : [{
        documentId: docId, rowIndex: to, name: v.name, code: v.code, quantity: v.quantity, price: v.unitPrice,
        discount: v.discount, vatRate: v.vatRate, total: v.net, ...NO_MATCH,
      }])),
    })] : []),
  ];

  await saveDocumentJson(docId, { ...doc, lines: nextLines as typeof doc.lines }, {
    itemOps,
    // Ανθρώπινη διόρθωση της ανάγνωσης.
    also: actor ? { verifiedAt: new Date(), verifiedById: actor.id } : {},
  });
  const tally = await matchDocItems(docId).catch(() => ({ matched: 0, total: plan.lines.length }));

  const summary = describeLineEdit(ops);
  if (actor) {
    await logAudit({
      userId: actor.id, userEmail: actor.email, action: 'ocr.lines.edit', resource: 'ocr_document', resourceId: docId,
      metadata: { summary, ops, before: current },
    }).catch(() => null);
  }
  return { summary, lines: plan.lines.length, matched: tally.matched };
}
