import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { FieldsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';
import type { Action, Clause, MappingRowExcel, MappingRowInvoice } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Cleanup = {
  mappings: { name: string; removedRows: number }[];
  conditions: { id: string; name: string; removedClauses: number; removedActions: number }[];
};

// PUT { fields } — αντικαθιστά το σύνολο των πεδίων (upsert by key, διαγραφή όσων λείπουν).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = FieldsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const keys = parsed.data.fields.map((f) => f.key);
  // Everything a mapping row or a condition clause is allowed to point at AFTER
  // this write: the field keys themselves plus `<tableKey>.<columnKey>` for every
  // TABLE column. Computed from the incoming payload, not from the DB, so a field
  // that is being removed or renamed in this same request is already excluded.
  const valid = new Set<string>();
  for (const f of parsed.data.fields) {
    valid.add(f.key);
    if (f.kind === 'TABLE') for (const c of f.columns ?? []) valid.add(`${f.key}.${c.key}`);
  }

  const cleanup: Cleanup = { mappings: [], conditions: [] };
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

    // Removing or renaming a field leaves mappings and conditions pointing at a key
    // that no longer exists — those rows would silently never match at run time.
    // Drop them here so the stored template stays internally consistent, and report
    // what went; plan 2 surfaces this cleanup to the user in the editor.
    const mappings = await tx.templateMapping.findMany({ where: { templateId: id } });
    for (const m of mappings) {
      const rows = (m.rows as unknown as (MappingRowInvoice | MappingRowExcel)[]) ?? [];
      const kept = rows.filter((r) => valid.has(r.fieldKey));
      if (kept.length === rows.length) continue;
      await tx.templateMapping.update({ where: { id: m.id }, data: { rows: kept as unknown as Prisma.InputJsonValue } });
      cleanup.mappings.push({ name: m.name, removedRows: rows.length - kept.length });
    }

    const conditions = await tx.templateCondition.findMany({ where: { templateId: id } });
    for (const c of conditions) {
      const clauses = (c.clauses as unknown as Clause[]) ?? [];
      const actions = (c.actions as unknown as Action[]) ?? [];
      // `$`-prefixed clause keys are pipeline pseudo-fields (not template fields),
      // so they survive any change to the field set.
      const keptClauses = clauses.filter((cl) => cl.fieldKey.startsWith('$') || valid.has(cl.fieldKey));
      // A SET_FIELD that writes an invoiceKey has no template field to lose.
      const keptActions = actions.filter((a) => a.type !== 'SET_FIELD' || !a.params.fieldKey || valid.has(a.params.fieldKey));
      const removedClauses = clauses.length - keptClauses.length;
      const removedActions = actions.length - keptActions.length;
      if (!removedClauses && !removedActions) continue;
      await tx.templateCondition.update({
        where: { id: c.id },
        data: { clauses: keptClauses as unknown as Prisma.InputJsonValue, actions: keptActions as unknown as Prisma.InputJsonValue },
      });
      cleanup.conditions.push({ id: c.id, name: c.name, removedClauses, removedActions });
    }

    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.fields.update', resource: 'extractionTemplate', resourceId: id, metadata: { fields: keys.length } });
  return NextResponse.json({ ...toTemplateDto(full), cleanup });
}
