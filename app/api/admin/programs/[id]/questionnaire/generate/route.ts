// app/api/admin/programs/[id]/questionnaire/generate/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { generateQuestionnaire, persistQuestionnaire } from '@/lib/programs/questionnaire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  try {
    const { draft, model } = await generateQuestionnaire(id);
    await persistQuestionnaire(id, draft, model);
    const fresh = await prisma.programQuestionnaire.findUnique({ where: { programId: id }, include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } });
    return NextResponse.json(fresh);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'generation failed' }, { status: 500 });
  }
}
