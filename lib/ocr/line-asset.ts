// lib/ocr/line-asset.ts — SERVER. Αντιστοίχιση γραμμής παραστατικού σε ΠΑΓΙΟ (ASSLINES).
//
// Χωριστά από το `applyMatchToLine`: το πάγιο ΔΕΝ μαθαίνεται από τη μνήμη (κάθε πάγιο είναι
// μοναδικό — ένα δεύτερο MacBook είναι ΑΛΛΟ πάγιο), οπότε δεν γράφεται κανόνας `LineMatchRule`.
import 'server-only';
import { prisma } from '@/lib/db';
import { refreshDocTallies } from './softone-match';

export async function assignLineAsset(lineId: string, assetMtrl: number | null) {
  const line = await prisma.ocrInvoiceItem.findUnique({ where: { id: lineId }, select: { id: true, documentId: true } });
  if (!line) throw new Error('Η γραμμή δεν βρέθηκε.');
  const asset = assetMtrl == null ? null : await prisma.softoneAsset.findUnique({ where: { mtrl: assetMtrl }, select: { mtrl: true, code: true, name: true } });
  if (assetMtrl != null && !asset) throw new Error('Το πάγιο δεν υπάρχει στο μητρώο — συγχρόνισε τα πάγια.');
  await prisma.ocrInvoiceItem.update({
    where: { id: lineId },
    data: asset
      ? {
          softoneAsset: asset.mtrl, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null,
          softoneCode: asset.code, softoneName: asset.name, softoneIsService: null, softoneMatchedBy: 'manual',
        }
      : {
          softoneAsset: null, softoneCode: null, softoneName: null, softoneMatchedBy: null,
        },
  });
  // Ο επιμερισμός δεν συνυπάρχει με πάγιο: η γραμμή πάει ακέραιη σε ΕΝΑ πάγιο.
  if (asset) await prisma.ocrInvoiceItemAllocation.deleteMany({ where: { itemId: lineId } });
  await refreshDocTallies([line.documentId]);
  return { lineId, docId: line.documentId, asset };
}
