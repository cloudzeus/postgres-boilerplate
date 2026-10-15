// lib/ocr/trader-docs.ts — SERVER. Τα σκαναρισμένα παραστατικά ΕΝΟΣ συναλλασσομένου.
//
// «Δικό του» = συνδεδεμένο με την καρτέλα (`softoneTrdr`) Ή με τον ίδιο ΑΦΜ εκδότη (και με τις δύο
// μορφές: «01808880270» / «IT01808880270») — ένα παραστατικό που δεν έχει συνδεθεί ακόμη ανήκει κι
// αυτό στον εκδότη του και πρέπει να φαίνεται εδώ.
import 'server-only';
import { prisma } from '@/lib/db';
import { normalizeAfm } from '@/lib/ocr/validate';

/** Οι μορφές ενός ΑΦΜ με τις οποίες μπορεί να έχει αποθηκευτεί (`issuerAfm`). */
export function afmForms(afm: string | null | undefined): string[] {
  const n = normalizeAfm(afm ?? '');
  if (!n) return [];
  const bare = /^[A-Z]{2,3}\d/.test(n) ? n.replace(/^[A-Z]{2,3}/, '') : null;
  return [...new Set([n, ...(bare ? [bare] : [])])];
}

/** Πλήθος παραστατικών ανά TRDR για ΟΛΟΥΣ τους συναλλασσόμενους (μία ομαδοποίηση + μία ανά ΑΦΜ). */
export async function traderDocCounts(traders: { trdr: number; afm: string | null }[]): Promise<Map<number, number>> {
  const [byTrdr, byAfm] = await Promise.all([
    prisma.ocrDocument.groupBy({ by: ['softoneTrdr'], where: { softoneTrdr: { not: null } }, _count: { _all: true } }),
    prisma.ocrDocument.groupBy({ by: ['issuerAfm'], where: { softoneTrdr: null, issuerAfm: { not: null } }, _count: { _all: true } }),
  ]);
  const linked = new Map(byTrdr.map((r) => [r.softoneTrdr as number, r._count._all]));
  const unlinked = new Map(byAfm.map((r) => [r.issuerAfm as string, r._count._all]));
  const out = new Map<number, number>();
  for (const t of traders) {
    const n = (linked.get(t.trdr) ?? 0) + afmForms(t.afm).reduce((s, f) => s + (unlinked.get(f) ?? 0), 0);
    if (n) out.set(t.trdr, n);
  }
  return out;
}

export interface TraderDocRow {
  id: string; fileName: string; createdAt: string;
  number: string | null; date: string | null; total: number | null;
  status: string; postStatus: string; linked: boolean; category: string | null;
  softoneTrdr: number | null; softoneDocExists: boolean | null; itemsTotal: number | null; itemsMatched: number | null; reconOverride: string | null;
}

export async function traderDocuments(trdr: number, afm: string | null, take = 200): Promise<TraderDocRow[]> {
  const forms = afmForms(afm);
  const docs = await prisma.ocrDocument.findMany({
    where: { OR: [{ softoneTrdr: trdr }, ...(forms.length ? [{ softoneTrdr: null, issuerAfm: { in: forms } }] : [])] },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, fileName: true, createdAt: true, status: true, postStatus: true, category: true, extractedData: true,
      softoneTrdr: true, softoneDocExists: true, itemsTotal: true, itemsMatched: true, reconOverride: true,
    },
  });
  return docs.map((d) => {
    const ed = (d.extractedData ?? {}) as Record<string, unknown>;
    const num = Number(ed.totalAmount);
    return {
      id: d.id, fileName: d.fileName, createdAt: d.createdAt.toISOString(),
      number: typeof ed.invoiceNumber === 'string' ? ed.invoiceNumber : null,
      date: typeof ed.date === 'string' ? ed.date : null,
      total: Number.isFinite(num) ? num : null,
      status: d.status, postStatus: d.postStatus, category: d.category, linked: d.softoneTrdr === trdr,
      softoneTrdr: d.softoneTrdr, softoneDocExists: d.softoneDocExists, itemsTotal: d.itemsTotal, itemsMatched: d.itemsMatched, reconOverride: d.reconOverride,
    };
  });
}
