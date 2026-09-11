import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { suggestForGroup } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?afm=&pattern=&code= — lazy προτάσεις για μια ομάδα της ουράς (spec §3).
export async function GET(req: Request) {
  await requirePermission('ocr.read');
  const q = new URL(req.url).searchParams;
  const pattern = (q.get('pattern') ?? '').trim();
  if (!pattern) {
    return NextResponse.json({ error: 'missing_pattern', message: 'Λείπει το pattern της ομάδας.' }, { status: 400 });
  }
  const suggestions = await suggestForGroup({
    afm: (q.get('afm') ?? '').trim(),
    pattern,
    code: q.get('code'),
    sample: q.get('sample'),
  });
  return NextResponse.json({ suggestions });
}
