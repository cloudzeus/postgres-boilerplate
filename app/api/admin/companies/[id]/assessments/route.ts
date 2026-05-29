// app/api/admin/companies/[id]/assessments/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { evaluateEligibility, type KadRule } from '@/lib/programs/eligibility';
import { autofillAnswers, type QuestionDraftWithId } from '@/lib/programs/assessment-autofill';
import { computeVerdict } from '@/lib/programs/assessment-verdict';
import { asNum } from '@/lib/programs/coerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const list = await prisma.companyAssessment.findMany({
    where: { companyId: id },
    orderBy: { createdAt: 'desc' },
    include: { program: { select: { title: true } } },
  });
  return NextResponse.json(list);
}

const CreateSchema = z.object({ programId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id: companyId } = await params;
  const { programId } = CreateSchema.parse(await req.json());

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { activities: { select: { code: true } } },
  });
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 });

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      kads: { select: { code: true, excluded: true } },
      legalForms: { select: { name: true } },
      regions: { select: { name: true } },
      questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } },
    },
  });
  if (!program) return NextResponse.json({ error: 'program not found' }, { status: 404 });

  // Resolve the company's region NAME from its Καλλικράτης regionCode (level-3 region).
  let regionName: string | null = null;
  if (company.regionCode) {
    const reg = await prisma.region.findUnique({ where: { code: company.regionCode }, select: { nameEL: true, level: true, parentCode: true } });
    regionName = reg?.nameEL ?? null;
    // climb to level-3 region name if the code points to a unit/municipality
    let cur: { nameEL: string; level: number; parentCode: string | null } | null = reg ?? null;
    while (cur && cur.level > 3 && cur.parentCode) {
      cur = await prisma.region.findUnique({ where: { code: cur.parentCode }, select: { nameEL: true, level: true, parentCode: true } });
      if (cur && cur.level === 3) regionName = cur.nameEL;
    }
  }

  const elig = evaluateEligibility(
    {
      activities: company.activities,
      legalForm: company.legalForm,
      employeeCount: company.employeeCount,
      foundingDate: company.foundingDate,
      regionName,
    },
    {
      kadRule: program.kadRule as KadRule,
      kads: program.kads,
      eligibleLegalForms: program.legalForms.map((l) => l.name),
      minEmployeesFte: asNum(program.minEmployeesFte),
      minOperationalYears: asNum(program.minOperationalYears),
      regions: program.regions.map((r) => r.name),
    },
    new Date(),
  );

  const assessment = await prisma.companyAssessment.create({
    data: {
      companyId, programId, questionnaireId: program.questionnaire?.id ?? null,
      eligible: elig.eligible, eligibilityResult: elig as any,
      overallVerdict: computeVerdict(elig.eligible, program.questionnaire ? false : null),
      status: 'DRAFT',
    },
  });

  // Pre-fill objective answers if a questionnaire exists.
  if (program.questionnaire) {
    const qs: QuestionDraftWithId[] = program.questionnaire.questions.map((q) => ({
      id: q.id, answerType: q.answerType, companyField: (q.companyField as any) ?? null,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    }));
    const filled = autofillAnswers(
      { legalForm: company.legalForm, employeeCount: company.employeeCount, foundingDate: company.foundingDate, regionName },
      qs, new Date(),
    );
    if (filled.length) {
      await prisma.assessmentAnswer.createMany({
        data: filled.map((a) => ({
          assessmentId: assessment.id, questionId: a.questionId,
          valueBool: a.valueBool ?? null, valueNumber: a.valueNumber ?? null,
          selectedOptionId: a.selectedOptionId ?? null, source: 'AUTO' as const,
        })),
      });
    }
  }

  const fresh = await prisma.companyAssessment.findUnique({
    where: { id: assessment.id },
    include: { answers: true, questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } } },
  });
  return NextResponse.json(fresh);
}
