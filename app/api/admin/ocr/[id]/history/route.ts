import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — το ιστορικό αλλαγών ΕΝΟΣ παραστατικού: ό,τι κατέγραψε το audit για το ίδιο το έγγραφο και
 * για τις γραμμές του (αντιστοιχίσεις, επιμερισμοί, μονάδες). Μόνο ανάγνωση.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const items = await prisma.ocrInvoiceItem.findMany({ where: { documentId: id }, select: { id: true, rowIndex: true } });
  const rowOf = new Map(items.map((i) => [i.id, i.rowIndex]));
  const rows = await prisma.auditLog.findMany({
    where: { resourceId: { in: [id, ...items.map((i) => i.id)] } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, action: true, resourceId: true, userEmail: true, createdAt: true, metadata: true },
  });
  return NextResponse.json({
    entries: rows.map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: r.id, action: r.action, at: r.createdAt.toISOString(), user: r.userEmail ?? null,
        line: r.resourceId && rowOf.has(r.resourceId) ? (rowOf.get(r.resourceId)! + 1) : null,
        summary: typeof m.summary === 'string' ? m.summary : null,
        source: typeof m.source === 'string' ? m.source : null,
        before: m.before ?? null,
        after: m.after ?? null,
        ok: typeof m.ok === 'boolean' ? m.ok : null,
        error: typeof m.error === 'string' ? m.error : null,
      };
    }),
  });
}
