import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT { fields } — αντικαθιστά το σύνολο των πεδίων (upsert by key, διαγραφή όσων λείπουν).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = FieldsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const keys = parsed.data.fields.map((f) => f.key);
  await prisma.$transaction(async (tx) => {
    await tx.templateField.deleteMany({ where: { templateId: id, key: { notIn: keys } } });
    for (const f of parsed.data.fields) {
      const region = f.region === null ? Prisma.JsonNull : (f.region as unknown as Prisma.InputJsonValue);
      const columns = f.columns === null ? Prisma.JsonNull : (f.columns as unknown as Prisma.InputJsonValue);
      const data = { label: f.label, kind: f.kind, valueType: f.valueType, color: f.color.toUpperCase(), region, columns, aiHint: f.aiHint, required: f.required, order: f.order };
      await tx.templateField.upsert({
        where: { templateId_key: { templateId: id, key: f.key } },
        update: data,
        create: { templateId: id, key: f.key, ...data },
      });
    }
    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  return NextResponse.json(toTemplateDto(full));
}
