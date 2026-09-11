// GET → οι εργασίες σάρωσης (`?templateId`, `?status=active|QUEUED|…`, `?count=1` μόνο το πλήθος).
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { activeJobCount, listJobs } from '@/lib/templates/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await requirePermission('ocr.read');
  const url = new URL(req.url);
  // Το σήμα στο πλαϊνό μενού ρωτά μόνο «πόσες τρέχουν» — μία μέτρηση, όχι 100 γραμμές.
  if (url.searchParams.get('count') === '1') return NextResponse.json({ active: await activeJobCount() });

  const jobs = await listJobs({
    templateId: url.searchParams.get('templateId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: Number(url.searchParams.get('limit')) || undefined,
  });
  return NextResponse.json({ jobs });
}
