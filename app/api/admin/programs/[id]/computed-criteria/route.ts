import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VarSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  source: z.enum(['FINANCIAL', 'MANUAL', 'PARAM', 'DERIVED']),
  fieldKey: z.string().nullable().optional(),
  yearMode: z.enum(['REFERENCE', 'PRIOR_1', 'PRIOR_2', 'PRIOR_3']).optional(),
  constant: z.number().nullable().optional(),
  formula: z.string().nullable().optional(),
});
const BandSchema = z.object({ min: z.number().nullable(), max: z.number().nullable(), score: z.number() });
const CriterionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  weight: z.number(),
  variables: z.array(VarSchema),
  indexKey: z.string().nullable().optional(),
  indexExpression: z.string().nullable().optional(),
  bandMode: z.enum(['LOOKUP', 'PASSTHROUGH']),
  bands: z.array(BandSchema),
});
const BodySchema = z.object({
  threshold: z.number().nullable().optional(),
  criteria: z.array(CriterionSchema),
});

async function getQuestionnaire(programId: string) {
  return prisma.programQuestionnaire.findUnique({ where: { programId } });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id: programId } = await params;
  const q = await getQuestionnaire(programId);
  return NextResponse.json({
    threshold: q?.threshold != null ? Number(q.threshold) : 75,
    criteria: (q?.computedCriteria as unknown) ?? [],
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id: programId } = await params;
  const body = BodySchema.parse(await req.json());

  const q = await prisma.programQuestionnaire.upsert({
    where: { programId },
    create: {
      programId,
      threshold: body.threshold ?? undefined,
      computedCriteria: body.criteria as unknown as Prisma.InputJsonValue,
    },
    update: {
      threshold: body.threshold ?? undefined,
      computedCriteria: body.criteria as unknown as Prisma.InputJsonValue,
    },
  });
  return NextResponse.json({ ok: true, threshold: q.threshold != null ? Number(q.threshold) : null, criteria: q.computedCriteria });
}
