import { NextRequest, NextResponse } from 'next/server';
import { decodeRegion } from '@/lib/regions/decoder';
import { requirePermission } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  await requirePermission('metadata.read');
  const { code } = await request.json().catch(() => ({ code: '' }));
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'invalid', message: 'Εισάγετε κωδικό ή όνομα περιοχής' }, { status: 400 });
  }
  const result = await decodeRegion(code);
  if (!result) {
    return NextResponse.json({ error: 'not_found', message: `Η περιοχή "${code}" δεν βρέθηκε` }, { status: 404 });
  }
  return NextResponse.json(result);
}
