import { prisma } from '../lib/db';
const key = (s: string | null | undefined) => String(s ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^(EL|GR)(?=\d{9}$)/, '');
const docs = await prisma.ocrDocument.findMany({ where: { softoneTrdr: { not: null } }, select: { id: true, fileName: true, issuerAfm: true, softoneTrdr: true } });
const tr = new Map((await prisma.softoneTrader.findMany({ where: { trdr: { in: docs.map((d) => d.softoneTrdr!) } }, select: { trdr: true, afm: true, name: true, sodtype: true } })).map((t) => [t.trdr, t]));
const bad = docs.filter((d) => { const t = tr.get(d.softoneTrdr!); const a = key(d.issuerAfm), b = key(t?.afm); return !t || !a || (a !== b && !b.endsWith(a) && !a.endsWith(b)); });
console.log(`δεμένα: ${docs.length} · ασυνεπή: ${bad.length}`);
for (const d of bad) { const t = tr.get(d.softoneTrdr!); console.log(`  ${d.id} | ${d.fileName.split('/').pop()?.slice(0,45)} | ΑΦΜ εκδότη ${d.issuerAfm ?? '—'} ≠ καρτέλα ${t?.afm ?? '?'} «${t?.name ?? 'δεν υπάρχει στον καθρέφτη'}» (sodtype ${t?.sodtype ?? '?'})`); }
await prisma.$disconnect();
