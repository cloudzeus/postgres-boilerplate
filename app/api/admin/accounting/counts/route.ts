import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/db';
import { countOpenQuestions } from '@/lib/accounting/questions';

export const dynamic = 'force-dynamic';

// GET — badges του group «Λογιστική αρχικοποίηση»: ερωτήματα χωρίς (ισχύουσα) απάντηση και ανοιχτά
// θέματα του integrator.
export async function GET() {
  await requirePermission('metadata.read');
  const [questions, integrator] = await Promise.all([
    countOpenQuestions(),
    prisma.integratorItem.count({ where: { status: 'OPEN' } }),
  ]);
  return NextResponse.json({ questions, integrator });
}
