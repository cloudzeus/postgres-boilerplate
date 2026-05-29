// app/api/admin/companies/[id]/assessments/[assessmentId]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { awardPoints, computeScore } from '@/lib/programs/assessment-score';
import { computeVerdict } from '@/lib/programs/assessment-verdict';
import { asNum } from '@/lib/programs/coerce';
import type { ScoringQuestion, ScoringAnswer, ScoringModel } from '@/lib/programs/questionnaire-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({
  notes: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'COMPLETED']).optional(),
  answers: z.array(z.object({
    questionId: z.string().min(1),
    valueBool: z.boolean().nullable().optional(),
    valueNumber: z.union([z.number(), z.string(), z.null()]).optional(),
    valueText: z.string().nullable().optional(),
    selectedOptionId: z.string().nullable().optional(),
    source: z.enum(['AUTO', 'MANUAL']).optional(),
  })).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; assessmentId: string }> }) {
  await requirePermission('programs.update');
  const { assessmentId } = await params;
  const body = Schema.parse(await req.json());

  const assessment = await prisma.companyAssessment.findUnique({
    where: { id: assessmentId },
    include: { questionnaire: { include: { questions: { include: { options: true } } } } },
  });
  if (!assessment) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    if (body.answers) {
      await tx.assessmentAnswer.deleteMany({ where: { assessmentId } });
      for (const a of body.answers) {
        await tx.assessmentAnswer.create({
          data: {
            assessmentId, questionId: a.questionId,
            valueBool: a.valueBool ?? null, valueNumber: asNum(a.valueNumber),
            valueText: a.valueText ?? null, selectedOptionId: a.selectedOptionId ?? null,
            source: a.source ?? 'MANUAL',
          },
        });
      }
    }

    let score: number | null = null, maxScore: number | null = null, passed: boolean | null = null;
    const q = assessment.questionnaire;
    if (q) {
      const questions: ScoringQuestion[] = q.questions.map((qq) => ({
        id: qq.id, answerType: qq.answerType as ScoringQuestion['answerType'], weight: asNum(qq.weight), maxPoints: asNum(qq.maxPoints),
        options: qq.options.map((o) => ({ id: o.id, points: Number(o.points) })),
      }));
      const answers: ScoringAnswer[] = (body.answers ?? []).map((a) => ({
        questionId: a.questionId, valueBool: a.valueBool ?? null, valueNumber: asNum(a.valueNumber), selectedOptionId: a.selectedOptionId ?? null,
      }));
      const r = computeScore(q.scoringModel as ScoringModel, asNum(q.threshold), asNum(q.maxScore), questions, answers);
      score = r.score; maxScore = r.maxScore; passed = r.passed;
      // persist per-answer pointsAwarded
      for (const a of answers) {
        const sq = questions.find((x) => x.id === a.questionId);
        if (sq) await tx.assessmentAnswer.updateMany({ where: { assessmentId, questionId: a.questionId }, data: { pointsAwarded: awardPoints(sq, a) } });
      }
    }

    await tx.companyAssessment.update({
      where: { id: assessmentId },
      data: {
        notes: body.notes ?? undefined,
        status: body.status ?? undefined,
        questionnaireScore: score, questionnaireMax: maxScore, questionnairePassed: passed,
        overallVerdict: computeVerdict(assessment.eligible ?? false, passed),
      },
    });
  }, { timeout: 60_000, maxWait: 10_000 });

  const fresh = await prisma.companyAssessment.findUnique({ where: { id: assessmentId }, include: { answers: true } });
  return NextResponse.json(fresh);
}
