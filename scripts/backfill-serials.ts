// scripts/backfill-serials.ts — ONE-OFF, ΙΔΕΜΠΟΤΗΤΙΚΟ, ΜΟΝΟ ΤΟΠΙΚΗ ΒΑΣΗ.
// Συμπληρώνει το νέο `document.lines[].serials` στα ήδη σκαναρισμένα παραστατικά, από την περιγραφή
// κάθε γραμμής (`lib/ocr/serials.ts`). Γραμμή που έχει ήδη σειριακούς δεν αγγίζεται.
// Χρήση: npx tsx --env-file=.env scripts/backfill-serials.ts [--apply]
import { prisma } from '../lib/db';
import { extractSerials } from '../lib/ocr/serials';

const APPLY = process.argv.includes('--apply');
// `--force`: ξαναϋπολογίζει ΚΑΙ γραμμές που έχουν ήδη σειριακούς (π.χ. μετά από διόρθωση του κανόνα).
const FORCE = process.argv.includes('--force');
const docs = await prisma.ocrDocument.findMany({ where: { document: { not: undefined } }, select: { id: true, fileName: true, document: true } });
let touched = 0, total = 0;
for (const d of docs) {
  const c = d.document as { lines?: { name?: string | null; serials?: string[] }[] } | null;
  if (!c?.lines?.length) continue;
  let changed = false;
  const lines = c.lines.map((l) => {
    if (l.serials?.length && !FORCE) return l;
    const sn = extractSerials(l.name);
    if (!sn.length) { if (l.serials?.length) changed = true; return { ...l, serials: [] }; }
    if (JSON.stringify(sn) === JSON.stringify(l.serials ?? [])) return l;
    changed = true; total += sn.length;
    return { ...l, serials: sn };
  });
  if (!changed) continue;
  touched++;
  console.log(`  ${d.fileName.split('/').pop()} → ${lines.flatMap((l) => l.serials ?? []).join(', ')}`);
  if (APPLY) await prisma.ocrDocument.update({ where: { id: d.id }, data: { document: { ...c, lines } as never } });
}
console.log(`${APPLY ? 'ΕΦΑΡΜΟΓΗ' : 'DRY-RUN'} · παραστατικά: ${touched} · σειριακοί: ${total}`);
await prisma.$disconnect();
