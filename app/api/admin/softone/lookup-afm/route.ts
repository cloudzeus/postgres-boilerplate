import { NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/rbac';
import { softoneFindByAfm } from '@/lib/softone';

// Looks up a ΑΦΜ in SoftOne TRDR and reports whether it is registered as a
// customer and/or supplier. Used by the OCR and company "Έλεγχος στο SoftOne" action.
export async function POST(req: Request) {
  await requireAnyPermission('ocr.read', 'companies.read', 'metadata.read', 'metadata.manage');

  const body = await req.json().catch(() => ({}));
  const afm = String(body?.afm ?? '').trim();
  if (!afm) return NextResponse.json({ error: 'missing_afm' }, { status: 400 });

  try {
    const result = await softoneFindByAfm(afm);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
