// lib/templates/list.ts — SERVER. The template list shape, shared by the list route and the list page.
import 'server-only';
import { prisma } from '@/lib/db';
import { uniqueKey } from './schema';

type ListRow = {
  id: string; name: string; slug: string; department: string | null; vatNumber: string | null; supplierName: string | null;
  mode: 'AUTO' | 'SEMI_AUTO' | 'MANUAL'; status: 'DRAFT' | 'ACTIVE'; version: number; timesUsed: number;
  sampleStorageKey: string | null; updatedAt: Date; _count: { fields: number; runs: number; samples: number };
  trainingScore: number | null; verifiedSamples: number;
};

/** Row shape for the list page and GET. */
export function toListRow(t: ListRow) {
  return {
    id: t.id, name: t.name, slug: t.slug, department: t.department, vatNumber: t.vatNumber, supplierName: t.supplierName,
    mode: t.mode, status: t.status, version: t.version, fieldsCount: t._count.fields, runsCount: t._count.runs,
    // Εκπαίδευση (§11): πόσα δείγματα υπάρχουν, πόσα επιβεβαιώθηκαν και με τι βαθμό — η λίστα δείχνει
    // με μια ματιά ποιο πρότυπο είναι έτοιμο για ενεργοποίηση και ποιο δεν έχει κοιτάξει κανείς.
    samplesCount: t._count.samples, trainingScore: t.trainingScore, verifiedSamples: t.verifiedSamples,
    timesUsed: t.timesUsed, hasSample: !!t.sampleStorageKey, updatedAt: t.updatedAt.toISOString(),
  };
}

/** The list row as the UI sees it — one source of truth for the table's row type. */
export type TemplateListRow = ReturnType<typeof toListRow>;

export const LIST_QUERY = { orderBy: [{ name: 'asc' as const }], include: { _count: { select: { fields: true, runs: true, samples: true } } } };

/** First free slug for `base` (base, base_2, …) — one query, no loop of round-trips. */
export async function freeSlug(base: string): Promise<string> {
  // Only `base` itself and the `base_N` family can collide — a bare `startsWith: base` also drags in
  // unrelated neighbours (`ironworks` for `iron`) and inflates the suffix. Note `_` is a LIKE wildcard
  // that Prisma does not escape, so `base_` also matches `baseX`; harmless here because uniqueKey()
  // tests exact membership (`base_2`, `base_3`, …) rather than counting the rows it got back.
  const rows = await prisma.extractionTemplate.findMany({
    where: { OR: [{ slug: base }, { slug: { startsWith: `${base}_` } }] },
    select: { slug: true },
  });
  return uniqueKey(base, rows.map((r) => r.slug));
}
