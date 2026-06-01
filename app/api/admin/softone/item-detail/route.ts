import { NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/rbac';
import { softoneItemDetail } from '@/lib/softone';

export const runtime = 'nodejs';

// Live SoftOne read of a single item's classification (VAT, unit, group,
// category, manufacturer, brand) for the "copy from similar item" flow — these
// fields are NOT kept in the local SoftoneItem mirror.
// GET ?mtrl=<id>
export async function GET(req: Request) {
  await requireAnyPermission('ocr.read', 'ocr.categorize', 'metadata.read');
  const mtrl = Number(new URL(req.url).searchParams.get('mtrl'));
  if (!Number.isFinite(mtrl)) {
    return NextResponse.json({ error: 'invalid_mtrl' }, { status: 400 });
  }
  try {
    const detail = await softoneItemDetail(mtrl);
    if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
