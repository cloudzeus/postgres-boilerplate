// scripts/backfill-utility-category.ts — ONE-OFF, ΙΔΕΜΠΟΤΗΤΙΚΟ, ΜΟΝΟ ΤΟΠΙΚΗ ΒΑΣΗ.
// Κατηγορία «Έξοδο» στους ήδη σκαναρισμένους λογαριασμούς κοινής ωφέλειας / μισθώσεων οχημάτων
// που δεν έχουν κατηγορία (`lib/ocr/utility-bills.ts`). Καμία κλήση SoftOne.
// Χρήση: npx tsx --env-file=.env scripts/backfill-utility-category.ts [--apply]
import { prisma } from '../lib/db';
import { detectUtility, utilityInputFromDocument, UTILITY_KIND_LABEL } from '../lib/ocr/utility-bills';

const APPLY = process.argv.includes('--apply');
const docs = await prisma.ocrDocument.findMany({
  where: { status: 'COMPLETED' },
  select: { id: true, fileName: true, category: true, issuerAfm: true, document: true, items: { select: { name: true, vatRate: true, total: true } } },
});
let found = 0, set = 0;
for (const d of docs) {
  const input = utilityInputFromDocument(d.document, d.issuerAfm, d.items);
  const u = input ? detectUtility(input) : null;
  if (!u) continue;
  found++;
  const will = !d.category;
  console.log(`${will ? '→ ΕΞΟΔΟ' : `  ${d.category}`}\t${UTILITY_KIND_LABEL[u.kind]}\t${u.provider ?? '—'}\t${d.fileName}`);
  if (will) {
    set++;
    if (APPLY) await prisma.ocrDocument.update({ where: { id: d.id }, data: { category: 'EXPENSE' } });
  }
}
console.log(`\n${found} λογαριασμοί · ${set} χωρίς κατηγορία ${APPLY ? '→ ορίστηκαν' : '(dry-run — τρέξε με --apply)'}`);
await prisma.$disconnect();
