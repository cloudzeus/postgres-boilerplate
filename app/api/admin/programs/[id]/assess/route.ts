import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';
import { evaluateCriterion, computeAssessment, type Criterion } from '@/lib/eval/score';
import { resolveCriterionInputs, neededFieldKeys, type FinancialsMap } from '@/lib/eval/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  companyId: z.string().min(1),
  referenceYear: z.number().int(),
  manual: z.record(z.string(), z.record(z.string(), z.number())).optional(), // manual[critCode][varKey] = value
  save: z.boolean().optional(),
});

// POST /api/admin/programs/[id]/assess — run the computed assessment for a company
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('programs.read');
  const { id: programId } = await params;
  const body = BodySchema.parse(await req.json());

  const q = await prisma.programQuestionnaire.findUnique({ where: { programId } });
  const criteria = ((q?.computedCriteria as unknown) as Criterion[] | null) ?? [];
  const threshold = q?.threshold != null ? Number(q.threshold) : 75;
  if (criteria.length === 0) return NextResponse.json({ error: 'Δεν έχουν οριστεί υπολογιστικά κριτήρια' }, { status: 400 });

  // Pull only the financial values the criteria need.
  const keys = neededFieldKeys(criteria);
  const rows = keys.length
    ? await prisma.companyFinancialValue.findMany({ where: { companyId: body.companyId, fieldKey: { in: keys } } })
    : [];
  const financials: FinancialsMap = {};
  for (const r of rows) {
    if (r.value == null) continue;
    (financials[r.fieldKey] ??= {})[r.year] = Number(r.value);
  }

  const detailed = criteria.map((c) => {
    const inputs = resolveCriterionInputs(c, financials, body.referenceYear, body.manual?.[c.code]);
    const res = evaluateCriterion(c, inputs);
    return {
      code: c.code, label: c.label, weight: c.weight,
      inputs, index: res.index, score: res.score,
      weighted: Math.round((res.score * c.weight) / 100 * 100) / 100,
      error: res.error ?? null,
    };
  });
  const summary = computeAssessment(detailed.map((d) => ({ code: d.code, weight: d.weight, index: d.index, score: d.score })), threshold);

  const payload = { threshold, referenceYear: body.referenceYear, criteria: detailed, total: summary.total, passed: summary.passed, verdict: summary.verdict };

  if (body.save) {
    const existing = await prisma.companyAssessment.findFirst({ where: { companyId: body.companyId, programId } });
    const data = {
      questionnaireId: q?.id ?? null,
      questionnaireScore: summary.total,
      questionnaireMax: 100,
      questionnairePassed: summary.passed,
      overallVerdict: summary.verdict,
      status: 'COMPLETED' as const,
      eligibilityResult: payload as unknown as Prisma.InputJsonValue,
    };
    if (existing) await prisma.companyAssessment.update({ where: { id: existing.id }, data });
    else await prisma.companyAssessment.create({ data: { companyId: body.companyId, programId, createdById: user.id, ...data } });
  }

  return NextResponse.json(payload);
}
