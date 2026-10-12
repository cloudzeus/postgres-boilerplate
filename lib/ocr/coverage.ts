// lib/ocr/coverage.ts — SERVER. Πόσο από τη δουλειά της αντιστοίχισης έχει γίνει, για τα ΑΝΟΙΧΤΑ
// (ακαταχώριστα) παραστατικά. Το νούμερο που δείχνει το demo: «82% των γραμμών αντιστοιχισμένες».
import 'server-only';
import { prisma } from '@/lib/db';

export interface LineCoverage {
  /** Γραμμές ανοιχτών παραστατικών. */
  total: number;
  /** Με στόχο (είδος/υπηρεσία/έξοδο/χρεοπίστωση) ή επιμερισμό, ή ρητά παραλειμμένες. */
  matched: number;
  /** Από αυτές, όσες συμπλήρωσε μόνη της η μνήμη. */
  byMemory: number;
  /** Ανοιχτά παραστατικά με ΟΛΕΣ τις γραμμές λυμένες. */
  docsComplete: number;
  docs: number;
}

export async function lineCoverage(): Promise<LineCoverage> {
  const docs = await prisma.ocrDocument.findMany({
    // Τα ΑΓΝΟΗΜΕΝΑ (π.χ. τιμολόγιο πώλησης που σαρώθηκε κατά λάθος) δεν είναι δουλειά που μένει.
    where: { status: 'COMPLETED', postStatus: { not: 'POSTED' }, OR: [{ reconOverride: null }, { reconOverride: { not: 'IGNORED' } }] },
    select: {
      items: {
        select: {
          softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneAsset: true, softoneMatchedBy: true,
          _count: { select: { allocations: true } },
        },
      },
    },
  });
  let total = 0, matched = 0, byMemory = 0, docsComplete = 0;
  for (const d of docs) {
    let done = 0;
    for (const i of d.items) {
      total++;
      const ok = i.softoneMtrl != null || i.softoneExpn != null || i.softoneLinMtrl != null || i.softoneAsset != null
        || (i._count?.allocations ?? 0) > 0 || i.softoneMatchedBy === 'skipped';
      if (!ok) continue;
      matched++; done++;
      if (i.softoneMatchedBy === 'memory') byMemory++;
    }
    if (d.items.length > 0 && done === d.items.length) docsComplete++;
  }
  return { total, matched, byMemory, docsComplete, docs: docs.length };
}
