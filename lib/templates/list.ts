// lib/templates/list.ts — SERVER. The template list shape, shared by the list route and the list page.
import 'server-only';
import { prisma } from '@/lib/db';
import { uniqueKey } from './schema';

type ListRow = {
  id: string; name: string; slug: string; department: string | null; vatNumber: string | null; supplierName: string | null;
  mode: 'AUTO' | 'SEMI_AUTO' | 'MANUAL'; status: 'DRAFT' | 'ACTIVE'; version: number; timesUsed: number;
  sampleStorageKey: string | null; updatedAt: Date; _count: { fields: number; runs: number };
};

/** Row shape for the list page and GET. */
export function toListRow(t: ListRow) {
  return {
    id: t.id, name: t.name, slug: t.slug, department: t.department, vatNumber: t.vatNumber, supplierName: t.supplierName,
    mode: t.mode, status: t.status, version: t.version, fieldsCount: t._count.fields, runsCount: t._count.runs,
    timesUsed: t.timesUsed, hasSample: !!t.sampleStorageKey, updatedAt: t.updatedAt.toISOString(),
  };
}

export const LIST_QUERY = { orderBy: [{ name: 'asc' as const }], include: { _count: { select: { fields: true, runs: true } } } };

/** First free slug for `base` (base, base_2, …) — one query, no loop of round-trips. */
export async function freeSlug(base: string): Promise<string> {
  const rows = await prisma.extractionTemplate.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } });
  return uniqueKey(base, rows.map((r) => r.slug));
}
