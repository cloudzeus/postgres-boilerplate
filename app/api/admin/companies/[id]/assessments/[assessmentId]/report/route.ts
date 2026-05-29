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
      questionnaire: { select: { threshold: true, maxScore: true, sourceNote: true } },
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
      ? { threshold: a.questionnaire.threshold as unknown as string | null, maxScore: a.questionnaire.maxScore as unknown as string | null, sourceNote: a.questionnaire.sourceNote }
      : null,
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
