import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Manually links an invoice line to a SoftOne item (or clears it).
// POST { lineId, mtrl }  (mtrl null → clear)
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');
  const { lineId, mtrl } = await req.json().catch(() => ({}));
  if (!lineId) return NextResponse.json({ error: 'missing_lineId' }, { status: 400 });

  if (mtrl == null) {
    await prisma.ocrInvoiceItem.update({
      where: { id: String(lineId) },
      // Καθαρίζουμε ΚΑΙ το έξοδο ΚΑΙ τη χρεοπίστωση: αλλιώς μια γραμμή αντιστοιχισμένη σε EXPN
      // ή σε χρεοπίστωση έμενε «αντιστοιχισμένη» και δεν επέστρεφε ποτέ στην ουρά (spec §3).
      // ΚΑΙ την αναλυτική: κέντρο κόστους / έργο / δραστηριότητα επιλέχθηκαν ΓΙΑ ΤΗΝ ΠΡΟΗΓΟΥΜΕΝΗ
      // αντιστοίχιση. Μια γραμμή που γυρίζει στην ουρά αποσυνδεδεμένη δεν πρέπει να κουβαλά τον
      // επιμερισμό του κωδικού που μόλις αναιρέθηκε — θα έφευγε αθόρυβα στο επόμενο payload.
      data: {
        softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneCode: null,
        softoneName: null, softoneIsService: null, softoneMatchedBy: null,
        softoneCostCntr: null, softonePrjc: null, softonePrjcStage: null,
      },
    });
    return NextResponse.json({ ok: true, cleared: true });
  }

  const item = await prisma.softoneItem.findUnique({ where: { mtrl: Number(mtrl) } });
  if (!item) return NextResponse.json({ error: 'item_not_found' }, { status: 404 });

  await prisma.ocrInvoiceItem.update({
    where: { id: String(lineId) },
    data: {
      softoneMtrl: item.mtrl, softoneExpn: null, softoneLinMtrl: null, softoneCode: item.code, softoneName: item.name,
      softoneIsService: item.isService, softoneMatchedBy: 'manual',
    },
  });
  return NextResponse.json({ ok: true, match: { mtrl: item.mtrl, code: item.code, name: item.name, isService: item.isService } });
}
