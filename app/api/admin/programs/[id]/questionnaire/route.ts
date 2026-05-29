// app/api/admin/programs/[id]/questionnaire/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { asNum, asStr } from '@/lib/programs/coerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({
  scoringModel: z.enum(['WEIGHTED', 'POINTS_SUM']),
  threshold: z.union([z.number(), z.string(), z.null()]).optional(),
  maxScore: z.union([z.number(), z.string(), z.null()]).optional(),
  sourceNote: z.string().nullable().optional(),
  questions: z.array(z.object({
    code: z.string().nullable().optional(),
    text: z.string().min(1),
    criterionRef: z.string().nullable().optional(),
    helpText: z.string().nullable().optional(),
    answerType: z.enum(['BOOLEAN', 'SINGLE_CHOICE', 'NUMERIC', 'SCALE']),
    weight: z.union([z.number(), z.string(), z.null()]).optional(),
    maxPoints: z.union([z.number(), z.string(), z.null()]).optional(),
    companyField: z.enum(['legalForm', 'operationalYears', 'employeeCount', 'region', 'kad']).nullable().optional(),
    options: z.array(z.object({ label: z.string().min(1), points: z.union([z.number(), z.string()]).optional() })).optional(),
  })),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  const body = Schema.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    const existing = await tx.programQuestionnaire.findUnique({ where: { programId: id } });
    if (existing) await tx.programQuestion.deleteMany({ where: { questionnaireId: existing.id } });
    const q = await tx.programQuestionnaire.upsert({
      where: { programId: id },
      create: { programId: id, scoringModel: body.scoringModel, threshold: asNum(body.threshold), maxScore: asNum(body.maxScore), sourceNote: asStr(body.sourceNote), status: 'READY' },
      update: { scoringModel: body.scoringModel, threshold: asNum(body.threshold), maxScore: asNum(body.maxScore), sourceNote: asStr(body.sourceNote), status: 'READY' },
    });
    for (let i = 0; i < body.questions.length; i++) {
      const d = body.questions[i];
      await tx.programQuestion.create({
        data: {
          questionnaireId: q.id, code: asStr(d.code), text: d.text, criterionRef: asStr(d.criterionRef),
          helpText: asStr(d.helpText), answerType: d.answerType, weight: asNum(d.weight), maxPoints: asNum(d.maxPoints),
          companyField: d.companyField ?? undefined, order: i,
          options: { create: (d.options ?? []).map((o, j) => ({ label: o.label, points: asNum(o.points) ?? 0, order: j })) },
        },
      });
    }
  }, { timeout: 60_000, maxWait: 10_000 });

  const fresh = await prisma.programQuestionnaire.findUnique({ where: { programId: id }, include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } });
  return NextResponse.json(fresh);
}
