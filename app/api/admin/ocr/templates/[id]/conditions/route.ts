import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { ConditionsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT { conditions } — αντικαθιστά όλους τους κανόνες (κρατά τα ids που δίνονται ώστε να μείνουν σταθερά για το διάγραμμα).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = ConditionsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true } }, mappings: { select: { name: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const fieldKeys = new Set(t.fields.map((f) => f.key));
  const mappingNames = new Set(t.mappings.map((m) => m.name));
  for (const c of parsed.data.conditions) {
    for (const cl of c.clauses) if (!cl.fieldKey.startsWith('$') && !fieldKeys.has(cl.fieldKey)) return NextResponse.json({ error: 'unknown_field', message: `Άγνωστο πεδίο στη ρήτρα: ${cl.fieldKey}` }, { status: 422 });
    for (const a of c.actions) if (a.type === 'SWITCH_MAPPING' && !mappingNames.has(a.params.mappingName)) return NextResponse.json({ error: 'unknown_mapping', message: `Άγνωστο mapping: ${a.params.mappingName}` }, { status: 422 });
  }

  const keepIds = parsed.data.conditions.map((c) => c.id).filter((x): x is string => !!x);
  // Guard against a client-supplied id that belongs to another template — never let it hijack that row.
  if (keepIds.length) {
    const foreign = await prisma.templateCondition.findMany({ where: { id: { in: keepIds }, templateId: { not: id } }, select: { id: true } });
    if (foreign.length) return NextResponse.json({ error: 'foreign_condition', message: `Μη έγκυρα ids συνθηκών: ${foreign.map((f) => f.id).join(', ')}` }, { status: 422 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.templateCondition.deleteMany({ where: { templateId: id, id: { notIn: keepIds } } });
    for (const c of parsed.data.conditions) {
      const data = { name: c.name, order: c.order, isActive: c.isActive, logic: c.logic, clauses: c.clauses as unknown as Prisma.InputJsonValue, actions: c.actions as unknown as Prisma.InputJsonValue };
      if (c.id) await tx.templateCondition.upsert({ where: { id: c.id }, update: data, create: { id: c.id, templateId: id, ...data } });
      else await tx.templateCondition.create({ data: { templateId: id, ...data } });
    }
    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.conditions.update', resource: 'extractionTemplate', resourceId: id, metadata: { conditions: parsed.data.conditions.length } });
  return NextResponse.json(toTemplateDto(full));
}
