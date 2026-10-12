// lib/ocr/problem-suggestions.ts — SERVER. Προτάσεις λύσης για τα παραστατικά του «Προβλήματα & λύσεις».
import 'server-only';
import { prisma } from '@/lib/db';
import { suggestCategory, type CategorySuggestion, type OcrCategoryValue } from './category-suggest';

export interface ProblemSuggestion {
  category: CategorySuggestion | null;
  /** Για αποτυχημένη ανάγνωση: τι πήγε στραβά και ποια επανανάγνωση προτείνεται. */
  error: null | { message: string; hint: 'retry' | 'hq'; reason: string };
}

/** Αποτυχία ανάγνωσης: «σπασμένο JSON» είναι συνήθως τυχαίο του μοντέλου — αρκεί φθηνή επανάληψη. */
function errorHint(message: string | null): ProblemSuggestion['error'] {
  const m = message ?? '';
  if (/JSON|position \d+|Unexpected|Expected/i.test(m)) {
    return { message: m, hint: 'retry', reason: 'Η απάντηση του μοντέλου κόπηκε — συνήθως αρκεί νέα ανάγνωση με το κανονικό μοντέλο.' };
  }
  return { message: m, hint: 'hq', reason: 'Δύσκολο έγγραφο — προτείνεται ανάγνωση με το ισχυρό μοντέλο (HQ).' };
}

export async function loadProblemSuggestions(ids: string[]): Promise<Record<string, ProblemSuggestion>> {
  const docs = await prisma.ocrDocument.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, status: true, category: true, errorMessage: true, issuerAfm: true, seriesSource: true, softoneSeries: true, document: true,
      items: { select: { softoneMtrl: true, softoneAsset: true, softoneExpn: true, softoneLinMtrl: true } },
    },
  });
  const afms = [...new Set(docs.map((d) => d.issuerAfm).filter((v): v is string => !!v))];
  const [issuerRows, seriesRows] = await Promise.all([
    afms.length
      ? prisma.ocrDocument.groupBy({ by: ['issuerAfm', 'category'], _count: true, where: { issuerAfm: { in: afms }, category: { not: null } } })
      : [],
    prisma.ocrDocument.groupBy({ by: ['seriesSource', 'softoneSeries', 'category'], _count: true, where: { category: { not: null }, softoneSeries: { not: null } } }),
  ]);
  const histOf = (rows: { category: string | null; _count: number }[]) => {
    const h: Partial<Record<OcrCategoryValue, number>> = {};
    for (const r of rows) if (r.category) h[r.category as OcrCategoryValue] = (h[r.category as OcrCategoryValue] ?? 0) + r._count;
    return h;
  };

  const out: Record<string, ProblemSuggestion> = {};
  for (const d of docs) {
    const doc = (d.document ?? {}) as { kind?: string; type?: { label?: string | null; myDataType?: string | null } };
    const goods = d.items.filter((i) => i.softoneMtrl != null || i.softoneAsset != null).length;
    const expenses = d.items.filter((i) => i.softoneExpn != null || i.softoneLinMtrl != null).length;
    out[d.id] = {
      category: d.status === 'COMPLETED' && !d.category
        ? suggestCategory({
            kind: doc.kind ?? null,
            typeLabel: doc.type?.label ?? null,
            myDataType: doc.type?.myDataType ?? null,
            seriesSource: d.seriesSource,
            lines: { goods, expenses },
            issuerHistory: histOf(issuerRows.filter((r) => r.issuerAfm === d.issuerAfm)),
            seriesHistory: histOf(seriesRows.filter((r) => r.seriesSource === d.seriesSource && r.softoneSeries === d.softoneSeries)),
          })
        : null,
      error: d.status === 'FAILED' ? errorHint(d.errorMessage) : null,
    };
  }
  return out;
}
