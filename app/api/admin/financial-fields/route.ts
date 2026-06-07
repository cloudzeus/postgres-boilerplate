import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/financial-fields — available financial-value keys (from tax templates),
// used to populate the criterion-variable mapping dropdowns ("αντιστοιχίσεις").
export async function GET() {
  await requirePermission('programs.read');
  const templates = await prisma.taxFormTemplate.findMany({
    orderBy: [{ code: 'asc' }, { year: 'desc' }],
    include: { fields: { orderBy: { order: 'asc' } } },
  });

  const fields = templates.flatMap((t) =>
    t.fields.map((f) => ({
      key: `${t.code}.${f.fieldKey}`,        // contract key, e.g. "E3.526"
      label: f.label,
      valueType: f.valueType,
      kind: f.kind,                           // SINGLE | SERIES | TABLE
      templateId: t.id,
      templateCode: t.code,
      templateName: t.name,
      columns: (f.config as { columns?: string[] } | null)?.columns ?? null,
    })),
  );

  return NextResponse.json({ fields });
}
