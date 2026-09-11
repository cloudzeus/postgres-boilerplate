import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { normalizeVatId, viesPrefix } from '@/lib/ocr/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Το VIES δεν απαντά ποτέ γρήγορα· πέρα από αυτό το όριο δεν περιμένουμε. */
const VIES_TIMEOUT_MS = 8_000;
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

/**
 * Το VIES επιστρέφει «---» (ή κενό) όταν το κράτος-μέλος κρύβει επωνυμία/διεύθυνση.
 * Αυτό ΔΕΝ είναι τιμή: το γυρίζουμε σε `null` ώστε το UI να μη δείξει «Χρήση».
 */
function viesValue(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /^-+$/.test(s)) return null;
  return s;
}

// GET /api/admin/vies?vat=CY10123456A — έλεγχος ξένου ΑΦΜ στο μητρώο VIES
// (αντικαθιστά την ΑΑΔΕ για εκδότες εκτός Ελλάδας). Ποτέ δεν πετάει προς το UI:
// κάθε αποτυχία γυρίζει `{ valid: null, error }` με status 200.
export async function GET(req: Request) {
  await requirePermission('ocr.categorize');

  const raw = new URL(req.url).searchParams.get('vat') ?? '';
  const id = normalizeVatId(raw)?.id ?? null;
  const prefix = id ? viesPrefix(id) : null;
  if (!id || !prefix) {
    return NextResponse.json(
      { valid: null, error: 'invalid_vat', message: 'Το VIES δέχεται μόνο ΑΦΜ χώρας ΕΕ με πρόθεμα (π.χ. CY10123456A).' },
      { status: 400 },
    );
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VIES_TIMEOUT_MS);
  let data: Record<string, unknown> | null = null;
  try {
    const res = await fetch(VIES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ countryCode: prefix, vatNumber: id.slice(2) }),
      cache: 'no-store',
      signal: ac.signal,
    });
    if (!res.ok) {
      return NextResponse.json({ valid: null, error: 'vies_http', status: res.status });
    }
    data = await res.json();
  } catch (e) {
    return NextResponse.json({ valid: null, error: 'vies_unreachable', message: (e as Error).message });
  } finally {
    clearTimeout(timer);
  }

  // Το VIES δηλώνει τα δικά του σφάλματα μέσα σε 200 (π.χ. MS_UNAVAILABLE).
  const userError = String(data?.userError ?? '').toUpperCase();
  if (userError && userError !== 'VALID') {
    return NextResponse.json({ valid: null, error: 'vies_error', message: userError });
  }

  return NextResponse.json({
    vat: id,
    countryCode: prefix,
    valid: data?.valid === true,
    name: viesValue(data?.name),
    address: viesValue(data?.address),
  });
}
