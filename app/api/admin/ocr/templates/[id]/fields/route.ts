import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { FieldsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';
import { isReady } from '@/lib/templates/readiness';
import { lastGoodForRegion } from '@/lib/templates/adaptive';
import { isValidBbox, type Region } from '@/lib/templates/schema';
import type { Action, Clause, MappingRowExcel, MappingRowInvoice } from '@/lib/templates/schema';

/** `TemplateField.region` as stored → a `Region`, or null when it is absent/unusable (cf. `toFieldDef`). */
function storedRegion(raw: unknown): Region | null {
  const r = raw as { page?: unknown; bbox?: unknown } | null;
  return r && typeof r.page === 'number' && isValidBbox(r.bbox) ? { page: r.page, bbox: r.bbox } : null;
}

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
  let demoted = false;
  await prisma.$transaction(async (tx) => {
    // The boxes as they stand NOW, to tell which ones this write actually moves — a moved box makes
    // the learned position (`lastGood`, spec §17.2) a statement about the OLD box, and searching a
    // radius around it would send the adaptive read back to the place the user just corrected.
    const before = new Map(
      (await tx.templateField.findMany({ where: { templateId: id }, select: { key: true, region: true } }))
        .map((f) => [f.key, storedRegion(f.region)] as const),
    );
    await tx.templateField.deleteMany({ where: { templateId: id, key: { notIn: keys } } });
    const at = new Date().toISOString();
    for (const f of parsed.data.fields) {
      const region = f.region === null ? Prisma.JsonNull : (f.region as unknown as Prisma.InputJsonValue);
      const columns = f.columns === null ? Prisma.JsonNull : (f.columns as unknown as Prisma.InputJsonValue);
      // A box the user just drew (or just saved off a run, «Αποθήκευση στο πρότυπο») IS the new last
      // good position, with a weight of one: the next reading will average onto it, not onto history.
      const next = lastGoodForRegion(before.get(f.key) ?? null, f.region ?? null, at);
      const lastGood = next === undefined ? undefined
        : next === null ? Prisma.JsonNull : (next as unknown as Prisma.InputJsonValue);
      const data = { label: f.label, kind: f.kind, valueType: f.valueType, color: f.color.toUpperCase(), region, columns, aiHint: f.aiHint, required: f.required, order: f.order, ...(lastGood === undefined ? {} : { lastGood }) };
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

    // Dropping the last region (or the last field) can take an ACTIVE template out of
    // readiness. Demote it here rather than leave a template the run-time cannot honour
    // flagged ACTIVE — same predicate PATCH refuses an activation with.
    const after = await tx.extractionTemplate.findUniqueOrThrow({
      where: { id },
      include: { fields: { select: { region: true } }, mappings: { select: { id: true } } },
    });
    demoted = after.status === 'ACTIVE' && !isReady(after);
    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 }, ...(demoted ? { status: 'DRAFT' as const } : {}) } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.fields.update', resource: 'extractionTemplate', resourceId: id, metadata: { fields: keys.length } });
  return NextResponse.json({ ...toTemplateDto(full), cleanup, ...(demoted ? { demoted: true } : {}) });
}
