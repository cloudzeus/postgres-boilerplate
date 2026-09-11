import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { suggestForGroup } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?afm=&pattern=&code= — lazy προτάσεις για μια ομάδα της ουράς (spec §3).
/** Ό,τι μπαίνει σε αναζήτηση ονόματος/κωδικού φράζεται — το query string είναι δημόσια είσοδος. */
const MAX_LEN = 200;
const bounded = (v: string | null): string => String(v ?? '').trim().slice(0, MAX_LEN);

export async function GET(req: Request) {
  await requirePermission('ocr.read');
  const q = new URL(req.url).searchParams;
  const pattern = bounded(q.get('pattern'));
  if (!pattern) {
    return NextResponse.json({ error: 'missing_pattern', message: 'Λείπει το pattern της ομάδας.' }, { status: 400 });
  }
  const suggestions = await suggestForGroup({
    afm: (q.get('afm') ?? '').trim(),
    pattern,
    code: bounded(q.get('code')),
    sample: q.get('sample'),
  });
  return NextResponse.json({ suggestions });
}
