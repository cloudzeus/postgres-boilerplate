// scripts/backfill-canonical.ts — ONE-OFF, ΙΔΕΜΠΟΤΗΤΙΚΟ (plan 5, spec §17.1).
//
// Δύο δουλειές, καμία καταστροφική:
//   1. Κάθε `OcrDocument` που γράφτηκε πριν το κανονικό JSON (`document IS NULL` και υπάρχει
//      `extractedData`) αποκτά το `document` του, φτιαγμένο από τα flat κλειδιά + τις γραμμές του
//      (`fromLegacy`). Το `extractedData`, οι γραμμές και το `issuerAfm` ΔΕΝ αγγίζονται.
//   2. Κάθε `TemplateMapping` με `target = 'INVOICE'` αλλάζει τα `invoiceKey` του σε διαδρομές του
//      κανονικού εγγράφου (`companyName` → `issuer.name`, `customFields.x` → `custom.x`, …).
//      Κλειδιά που είναι ήδη διαδρομές μένουν ως έχουν, άρα η επανεκτέλεση δεν αλλάζει τίποτα.
//
// Χρήση:
//   npx tsx --import ./scripts/templates/register.mjs scripts/backfill-canonical.ts --dry-run
//   npx tsx --import ./scripts/templates/register.mjs scripts/backfill-canonical.ts
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { fromLegacy, legacyKeyToPath, type CanonicalDocType } from '../lib/ocr/canonical';

const DRY = process.argv.includes('--dry-run') || process.argv.includes('--dry');
const BATCH = 200;

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
const docTypeOf = (t: unknown): CanonicalDocType =>
  t === 'GENERAL_TEXT' ? 'general_text' : t === 'RECEIPT' ? 'receipt' : 'invoice';

async function backfillDocuments(): Promise<{ scanned: number; filled: number }> {
  let cursor: string | undefined;
  let scanned = 0;
  let filled = 0;

  for (;;) {
    const batch = await prisma.ocrDocument.findMany({
      where: { document: { equals: Prisma.DbNull }, extractedData: { not: Prisma.DbNull } },
      select: { id: true, docType: true, extractedData: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;
    scanned += batch.length;

    const ids = batch.map((d) => d.id);
    const items = await prisma.ocrInvoiceItem.findMany({
      where: { documentId: { in: ids } },
      orderBy: [{ documentId: 'asc' }, { rowIndex: 'asc' }],
      select: {
        documentId: true, code: true, name: true, quantity: true,
        price: true, discount: true, vatRate: true, total: true,
      },
    });
    const byDoc = new Map<string, typeof items>();
    for (const it of items) {
      const list = byDoc.get(it.documentId) ?? [];
      list.push(it);
      byDoc.set(it.documentId, list);
    }

    for (const row of batch) {
      const document = fromLegacy(
        isObj(row.extractedData) ? row.extractedData : {},
        byDoc.get(row.id) ?? [],
        docTypeOf(row.docType),
      );
      if (DRY) {
        console.log(`  [dry] ${row.id} → kind=${document.kind} lines=${document.lines.length} total=${document.totals.total ?? '—'}`);
      } else {
        await prisma.ocrDocument.update({
          where: { id: row.id },
          data: { document: document as unknown as Prisma.InputJsonValue },
        });
      }
      filled += 1;
    }
    console.log(`· έγγραφα: ${filled} από ${scanned} σαρωμένα`);
  }
  return { scanned, filled };
}

type InvoiceRow = { fieldKey?: unknown; invoiceKey?: unknown };

async function rewriteMappings(): Promise<{ scanned: number; changed: number; unknown: string[] }> {
  const mappings = await prisma.templateMapping.findMany({
    where: { target: 'INVOICE' },
    select: { id: true, name: true, rows: true, templateId: true },
  });
  const unknown = new Set<string>();
  let changed = 0;

  for (const m of mappings) {
    if (!Array.isArray(m.rows)) continue;
    let touched = false;
    const next = (m.rows as InvoiceRow[]).map((r) => {
      if (!isObj(r) || typeof r.invoiceKey !== 'string') return r;
      const path = legacyKeyToPath(r.invoiceKey);
      if (!path) { unknown.add(r.invoiceKey); return r; }
      if (path === r.invoiceKey) return r;
      touched = true;
      return { ...r, invoiceKey: path };
    });
    if (!touched) continue;
    changed += 1;
    if (DRY) {
      console.log(`  [dry] mapping ${m.id} («${m.name}») → ${JSON.stringify(next)}`);
    } else {
      await prisma.templateMapping.update({
        where: { id: m.id },
        data: { rows: next as unknown as Prisma.InputJsonValue },
      });
    }
  }
  return { scanned: mappings.length, changed, unknown: [...unknown] };
}

async function main() {
  console.log(DRY ? '— ΔΟΚΙΜΗ (dry-run): καμία εγγραφή στη βάση —' : '— Κανονική εκτέλεση —');

  console.log('\n1) Κανονικό JSON εγγράφου');
  const docs = await backfillDocuments();
  console.log(`   σύνολο: ${docs.filled} έγγραφα ${DRY ? 'θα γέμιζαν' : 'γέμισαν'} (σαρώθηκαν ${docs.scanned})`);

  console.log('\n2) INVOICE mappings → διαδρομές εγγράφου');
  const maps = await rewriteMappings();
  console.log(`   σύνολο: ${maps.changed} από ${maps.scanned} mappings ${DRY ? 'θα άλλαζαν' : 'άλλαξαν'}`);
  if (maps.unknown.length) console.log(`   ⚠ άγνωστα κλειδιά (έμειναν ως έχουν): ${maps.unknown.join(', ')}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
