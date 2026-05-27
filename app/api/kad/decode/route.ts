import { NextRequest, NextResponse } from 'next/server';
import { decodeKADCode } from '@/lib/kad/decoder';
import { requirePermission } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  await requirePermission('kad.read');
  const { code } = await request.json().catch(() => ({ code: '' }));
  if (!code || typeof code !== 'string') {
    return NextResponse.json(
      { error: 'invalid', message: 'Παρακαλώ εισάγετε έναν ΚΑΔ κωδικό' },
      { status: 400 },
    );
  }
  const result = await decodeKADCode(code);
  if (!result) {
    return NextResponse.json(
      { error: 'not_found', message: `Ο ΚΑΔ "${code}" δεν βρέθηκε` },
      { status: 404 },
    );
  }
  return NextResponse.json(result);
}
