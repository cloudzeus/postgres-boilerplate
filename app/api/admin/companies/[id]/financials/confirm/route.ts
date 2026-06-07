import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { buildFinancialWrites, type ReviewedAny } from '@/lib/tax/financial-merge';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VT = z.enum(['CURRENCY', 'NUMBER', 'PERCENT', 'INTEGER', 'DATE', 'BOOLEAN']);
const FieldSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SINGLE'), fieldKey: z.string(), valueType: VT, raw: z.string().nullable(), edited: z.boolean() }),
  z.object({ kind: z.literal('SERIES'), fieldKey: z.string(), valueType: VT, series: z.array(z.object({ year: z.number().nullable(), raw: z.string().nullable() })), edited: z.boolean() }),
  z.object({ kind: z.literal('TABLE'), fieldKey: z.string(), records: z.array(z.record(z.string(), z.string())), edited: z.boolean() }),
]);
const BodySchema = z.object({
  templateId: z.string().min(1),
  fiscalYear: z.number().int(),
  sourceDocumentId: z.string().nullable().optional(),
  fields: z.array(FieldSchema),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('ocr.create');
  const { id: companyId } = await params;
  const body = BodySchema.parse(await req.json());

  const template = await prisma.taxFormTemplate.findUnique({ where: { id: body.templateId }, select: { id: true, code: true } });
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const rows = buildFinancialWrites({
    companyId, templateId: template.id, templateCode: template.code, fiscalYear: body.fiscalYear,
    fields: body.fields as ReviewedAny[],
  });

  // Replace cleanly: drop existing values for the touched keys, then insert fresh.
  const touchedKeys = Array.from(new Set(rows.map((r) => r.fieldKey)));
  await prisma.$transaction([
    prisma.companyFinancialValue.deleteMany({ where: { companyId, fieldKey: { in: touchedKeys } } }),
    ...rows.map((r) => prisma.companyFinancialValue.create({
      data: {
        companyId: r.companyId, fieldKey: r.fieldKey, templateId: r.templateId, year: r.year,
        kind: r.kind, valueType: r.valueType,
        value: r.value ?? undefined, valueText: r.valueText ?? undefined,
        valueJson: (r.valueJson ?? undefined) as Prisma.InputJsonValue | undefined,
        source: r.source, sourceDocumentId: body.sourceDocumentId ?? undefined,
        verified: true, verifiedById: user.id,
      },
    })),
  ]);

  return NextResponse.json({ ok: true, count: rows.length });
}
