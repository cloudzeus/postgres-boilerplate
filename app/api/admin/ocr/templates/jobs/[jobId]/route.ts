// GET → μία εργασία με τα αρχεία της και τα πεδία του προτύπου (στήλες του πίνακα).
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getJob } from '@/lib/templates/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  await requirePermission('ocr.read');
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ job });
}
