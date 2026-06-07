import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { slugifyFieldKey } from '@/lib/ocr/field-rules';

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
  fieldKey: z.string().optional(),
  label: z.string().min(1),
  section: z.string().nullable().optional(),
  valueType: z.enum(['CURRENCY', 'NUMBER', 'PERCENT', 'INTEGER', 'DATE', 'BOOLEAN']),
  kind: z.enum(['SINGLE', 'SERIES', 'TABLE']).optional(),
  config: z.object({ columns: z.array(z.string()) }).nullable().optional(),
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

  // fieldKey is optional — derive a stable, unique key from the label when empty.
  const usedKeys = new Set<string>();
  const withKeys = fields.map((f, i) => {
    let key = (f.fieldKey?.trim() || slugifyFieldKey(f.label) || `field_${i + 1}`).slice(0, 60);
    if (!key) key = `field_${i + 1}`;
    const base = key;
    let n = 2;
    while (usedKeys.has(key)) key = `${base}_${n++}`;
    usedKeys.add(key);
    return { ...f, fieldKey: key };
  });

  await prisma.$transaction(async (tx) => {
    await tx.taxFormTemplateField.deleteMany({ where: { templateId } });
    for (let i = 0; i < withKeys.length; i++) {
      const f = withKeys[i];
      await tx.taxFormTemplateField.create({
        data: {
          templateId,
          fieldKey: f.fieldKey,
          label: f.label,
          section: f.section ?? null,
          valueType: f.valueType,
          kind: f.kind ?? 'SINGLE',
          config: f.config ? JSON.parse(JSON.stringify(f.config)) : undefined,
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
