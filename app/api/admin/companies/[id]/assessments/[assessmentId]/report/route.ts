// app/api/admin/companies/[id]/assessments/[assessmentId]/report/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { buildAssessmentDocx, type AssessmentForReport } from '@/lib/programs/assessment-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; assessmentId: string }> }) {
  await requirePermission('programs.read');
  const { assessmentId } = await params;

  const a = await prisma.companyAssessment.findUnique({
    where: { id: assessmentId },
    include: {
      company: { select: { name: true, afm: true, legalForm: true, regionCode: true } },
      program: { select: { title: true, referenceCode: true } },
      questionnaire: {
        select: {
          threshold: true, maxScore: true, sourceNote: true,
          questions: {
            orderBy: { order: 'asc' },
            select: { id: true, code: true, text: true, answerType: true, maxPoints: true, weight: true, options: { orderBy: { order: 'asc' }, select: { id: true, label: true, points: true } } },
          },
        },
      },
      answers: { select: { questionId: true, valueBool: true, valueNumber: true, selectedOptionId: true, pointsAwarded: true } },
    },
  });
  if (!a) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const buffer = await buildAssessmentDocx({
    overallVerdict: a.overallVerdict,
    eligible: a.eligible,
    eligibilityResult: a.eligibilityResult,
    questionnaireScore: a.questionnaireScore as unknown as string | null,
    questionnaireMax: a.questionnaireMax as unknown as string | null,
    questionnairePassed: a.questionnairePassed,
    createdAt: a.createdAt,
    company: a.company,
    program: a.program,
    questionnaire: a.questionnaire
      ? {
          threshold: a.questionnaire.threshold as unknown as string | null,
          maxScore: a.questionnaire.maxScore as unknown as string | null,
          sourceNote: a.questionnaire.sourceNote,
          questions: a.questionnaire.questions.map((q) => ({
            id: q.id, code: q.code, text: q.text, answerType: q.answerType,
            maxPoints: q.maxPoints as unknown as string | null, weight: q.weight as unknown as string | null,
            options: q.options.map((o) => ({ id: o.id, label: o.label, points: o.points as unknown as string | null })),
          })),
        }
      : null,
    answers: a.answers.map((x) => ({
      questionId: x.questionId, valueBool: x.valueBool,
      valueNumber: x.valueNumber as unknown as string | null,
      selectedOptionId: x.selectedOptionId, pointsAwarded: x.pointsAwarded as unknown as string | null,
    })),
  } as AssessmentForReport);

  const safeName = (a.company?.name ?? 'εταιρία').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  const filename = `Αξιολόγηση_${safeName}.docx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="assessment-report.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
