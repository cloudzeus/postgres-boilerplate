import { prisma } from '../lib/db';
const orig = await prisma.ocrDocument.findUnique({ where: { id: 'cmpwluhbh0005zvd4zqkpt3gz' }, select: { id: true } });
const batches = await prisma.ocrBatch.findMany({ where: { sourceName: { contains: 'SKM_C284e26060210170' } }, include: { documents: { select: { id: true, fileName: true, status: true, issuerAfm: true, softoneTrdr: true, errorMessage: true, extractedData: true } } } });
console.log('αρχικό υπάρχει ακόμη:', !!orig);
for (const b of batches) { console.log('φάκελος', b.id, b.createdAt.toISOString().slice(11,19)); for (const d of b.documents) { const e: any = d.extractedData ?? {}; console.log('  ', d.id, d.status, d.fileName, '| ΑΦΜ', d.issuerAfm, '|', e.companyName ?? '—', '|', e.invoiceNumber ?? '—', e.date ?? '', e.totalAmount ?? '', d.errorMessage ?? ''); } }
await prisma.$disconnect();
