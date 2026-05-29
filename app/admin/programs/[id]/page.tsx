import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FiArrowLeft, FiDownload } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { ProgramEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;

  const program = await prisma.program.findUnique({
    where: { id },
    include: {
      kads:        { orderBy: { code: 'asc' } },
      expenseCats: { orderBy: { order: 'asc' } },
      regions:     { orderBy: { name: 'asc' } },
      criteria:    { orderBy: { order: 'asc' } },
      deadlines:   { orderBy: { order: 'asc' } },
      legalForms:  { orderBy: { name: 'asc' } },
      bonuses:     { orderBy: { order: 'asc' } },
      files:       { orderBy: [{ kind: 'asc' }, { uploadedAt: 'asc' }] },
      questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } },
    },
  });
  if (!program) notFound();

  const canUpdate = await hasPermission('programs.update');
  const canDelete = await hasPermission('programs.delete');

  // Coerce Decimal/Date to JSON-safe primitives for the client component.
  const serialized = {
    ...program,
    publicationDate: program.publicationDate?.toISOString().slice(0, 10) ?? null,
    submissionStart: program.submissionStart?.toISOString().slice(0, 10) ?? null,
    submissionEnd:   program.submissionEnd?.toISOString().slice(0, 10) ?? null,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
    totalBudget: program.totalBudget != null ? Number(program.totalBudget) : null,
    fundingRate: program.fundingRate != null ? Number(program.fundingRate) : null,
    minEmployeesFte:     program.minEmployeesFte != null ? Number(program.minEmployeesFte) : null,
    minOperationalYears: program.minOperationalYears != null ? Number(program.minOperationalYears) : null,
    expenseCats: program.expenseCats.map((c) => ({
      ...c,
      minAmount:     c.minAmount != null ? Number(c.minAmount) : null,
      minPercentage: c.minPercentage != null ? Number(c.minPercentage) : null,
      maxAmount:     c.maxAmount != null ? Number(c.maxAmount) : null,
      maxPercentage: c.maxPercentage != null ? Number(c.maxPercentage) : null,
    })),
    bonuses: program.bonuses.map((b) => ({
      ...b,
      bonusRate:   b.bonusRate   != null ? Number(b.bonusRate)   : null,
      bonusAmount: b.bonusAmount != null ? Number(b.bonusAmount) : null,
    })),
    files: program.files.map((f) => ({
      ...f,
      uploadedAt: f.uploadedAt.toISOString(),
    })),
    regions: program.regions.map((r) => ({
      ...r, fundingRate: r.fundingRate != null ? Number(r.fundingRate) : null,
    })),
    deadlines: program.deadlines.map((d) => ({
      ...d, deadline: d.deadline.toISOString().slice(0, 10),
    })),
    questionnaire: program.questionnaire ? {
      ...program.questionnaire,
      threshold: program.questionnaire.threshold != null ? Number(program.questionnaire.threshold) : null,
      maxScore:  program.questionnaire.maxScore  != null ? Number(program.questionnaire.maxScore)  : null,
      generatedAt: program.questionnaire.generatedAt?.toISOString() ?? null,
      createdAt: program.questionnaire.createdAt.toISOString(),
      updatedAt: program.questionnaire.updatedAt.toISOString(),
      questions: program.questionnaire.questions.map((q) => ({
        ...q,
        weight:    q.weight    != null ? Number(q.weight)    : null,
        maxPoints: q.maxPoints != null ? Number(q.maxPoints) : null,
        options: q.options.map((o) => ({ ...o, points: Number(o.points) })),
      })),
    } : null,
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <Link href="/admin/programs" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <FiArrowLeft className="size-4" /> Πίσω στη λίστα
        </Link>
        {program.storageKey && (
          <a
            href={`/api/admin/programs/${program.id}/file`}
            target="_blank" rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted"
          >
            <FiDownload className="size-3.5" /> Πρωτότυπο PDF
          </a>
        )}
      </div>

      <ProgramEditor program={serialized as any} canUpdate={canUpdate} canDelete={canDelete} />
    </div>
  );
}
