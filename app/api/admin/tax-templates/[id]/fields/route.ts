import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RegionHintSchema = z.object({
  page: z.number().int().min(0),
  bbox: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ]),
}).nullable().optional();

const FieldSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  section: z.string().nullable().optional(),
  valueType: z.enum(['CURRENCY', 'NUMBER', 'PERCENT', 'INTEGER', 'DATE', 'BOOLEAN']),
  regionHint: RegionHintSchema,
  aiHint: z.string().nullable().optional(),
  required: z.boolean().optional(),
});

const BodySchema = z.array(FieldSchema);

// PUT /api/admin/tax-templates/[id]/fields — replace all fields
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id: templateId } = await params;
  const fields = BodySchema.parse(await req.json());

  const exists = await prisma.taxFormTemplate.findUnique({ where: { id: templateId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.taxFormTemplateField.deleteMany({ where: { templateId } });
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      await tx.taxFormTemplateField.create({
        data: {
          templateId,
          fieldKey: f.fieldKey,
          label: f.label,
          section: f.section ?? null,
          valueType: f.valueType,
          regionHint: f.regionHint ? JSON.parse(JSON.stringify(f.regionHint)) : undefined,
          aiHint: f.aiHint ?? null,
          required: f.required ?? false,
          order: i,
        },
      });
    }
  }, { timeout: 30_000, maxWait: 10_000 });

  const template = await prisma.taxFormTemplate.findUnique({
    where: { id: templateId },
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  return NextResponse.json(template);
}
