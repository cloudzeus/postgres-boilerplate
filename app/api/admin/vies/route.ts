import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { checkForeignVat, vatCheckHistory } from '@/lib/foreign-vat-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/vies?vat=IT01808880270[&force=1][&name=…&street=…&zip=…&city=…][&history=1]
// Έλεγχος ξένου ΑΦΜ ΚΑΤΑ ΠΑΡΑΓΓΕΛΙΑ από τις επίσημες δωρεάν αρχές (VIES / HMRC / Brønnøysund / UID),
// με ιστορικό 30 ημερών. Ποτέ δεν πετάει προς το UI: κάθε αποτυχία γυρίζει `{ valid: null, error,
// message }` με status 200 (400 μόνο για ΑΦΜ χωρίς πρόθεμα ξένης χώρας).
export async function GET(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const q = new URL(req.url).searchParams;
  const raw = q.get('vat') ?? '';
  if (q.get('history') === '1') return NextResponse.json({ history: await vatCheckHistory(raw) });
  const trader = { name: q.get('name'), street: q.get('street'), postalCode: q.get('zip'), city: q.get('city') };
  const r = await checkForeignVat(raw, { trader, force: q.get('force') === '1', userId: u.id });
  return NextResponse.json(r, { status: r.error === 'invalid_format' && !r.countryCode ? 400 : 200 });
}
