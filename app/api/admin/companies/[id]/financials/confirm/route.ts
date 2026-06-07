import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { buildFinancialUpserts, type ReviewedField } from '@/lib/tax/financial-merge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  templateId: z.string().min(1),
  year: z.number().int(),
  sourceDocumentId: z.string().nullable(),
  reviewed: z.record(
    z.string(),
    z.object({
      raw: z.union([z.string(), z.number(), z.null()]),
      edited: z.boolean(),
    }),
  ),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission('ocr.create');
  const { id: companyId } = await params;

  const body = BodySchema.parse(await req.json()) as {
    templateId: string;
    year: number;
    sourceDocumentId: string | null;
    reviewed: Record<string, ReviewedField>;
  };

  const template = await prisma.taxFormTemplate.findUnique({
    where: { id: body.templateId },
    include: { fields: true },
  });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const rows = buildFinancialUpserts({
    companyId,
    templateId: template.id,
    templateCode: template.code,
    year: body.year,
    sourceDocumentId: body.sourceDocumentId,
    reviewed: body.reviewed,
    fields: template.fields.map((f) => ({ fieldKey: f.fieldKey, valueType: f.valueType })),
  });

  await prisma.$transaction(
    rows.map((r) =>
      prisma.companyFinancialValue.upsert({
        where: {
          companyId_fieldKey_year: {
            companyId: r.companyId,
            fieldKey: r.fieldKey,
            year: r.year,
          },
        },
        create: { ...r, verifiedById: user.id },
        update: {
          value: r.value,
          source: r.source,
          sourceDocumentId: r.sourceDocumentId,
          verified: true,
          verifiedById: user.id,
        },
      }),
    ),
  );

  return NextResponse.json({ ok: true, count: rows.length });
}
