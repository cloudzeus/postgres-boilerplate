import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { generateComputedCriteria } from '@/lib/eval/generate-criteria';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/admin/programs/[id]/computed-criteria/generate — AI-extract scoring criteria from the guide
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  try {
    const result = await generateComputedCriteria(id);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'generation failed' }, { status: 422 });
  }
}
