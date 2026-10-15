import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { checkForeignVat } from '@/lib/foreign-vat-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/vies?vat=IT01808880270 — έλεγχος ξένου ΑΦΜ (εκτός Ελλάδας) ΚΑΤΑ ΠΑΡΑΓΓΕΛΙΑ: μέσω
// taxid.dev όταν υπάρχει κλειδί (Ρυθμίσεις → Διασυνδέσεις), αλλιώς απευθείας στο VIES της ΕΕ.
// Ποτέ δεν πετάει προς το UI: κάθε αποτυχία γυρίζει `{ valid: null, error, message }` με status 200
// (400 μόνο για ΑΦΜ που δεν είναι ξένο).
export async function GET(req: Request) {
  await requirePermission('ocr.categorize');
  const raw = new URL(req.url).searchParams.get('vat') ?? '';
  const r = await checkForeignVat(raw);
  return NextResponse.json(r, { status: r.error === 'not_foreign' ? 400 : 200 });
}
