import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchTaxOffices, matchTaxOffice } from '@/lib/softone';
import { parseAfm2Info } from '@/lib/aade-parse';

export const runtime = 'nodejs';

// Builds a SoftOne-ready supplier preview from a ΑΦΜ: pulls the authoritative
// fields from AADE (afm2info) and resolves the Δ.Ο.Υ. description to a SoftOne
// IRSDATA code. The UI shows this for confirmation before writing.
// POST { afm }
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');
  const afm = String((await req.json().catch(() => ({})))?.afm ?? '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(afm)) {
    return NextResponse.json({ error: 'invalid_afm', message: 'ΑΦΜ 9 ψηφίων.' }, { status: 400 });
  }

  // 1) AADE
  let raw: unknown = null;
  try {
    const r = await fetch('https://vat.wwa.gr/afm2info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afm }), cache: 'no-store',
    });
    if (!r.ok) return NextResponse.json({ error: 'aade_http', status: r.status }, { status: 502 });
    raw = await r.json();
  } catch (e) {
    return NextResponse.json({ error: 'aade_unreachable', message: (e as Error).message }, { status: 502 });
  }
  // Τα nil στοιχεία του proxy είναι ΑΝΤΙΚΕΙΜΕΝΑ, όχι null: χωρίς το
  // `parseAfm2Info` κάθε πεδίο θα γινόταν «[object Object]».
  const rec = parseAfm2Info(raw);
  if (!rec) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // 2) Δ.Ο.Υ. description → SoftOne IRSDATA code (best-effort; null when no match)
  let doyCode: string | null = null;
  try {
    const offices = await softoneFetchTaxOffices();
    doyCode = matchTaxOffice(rec.doyDescr, offices);
  } catch { /* leave null — supplier is still created without Δ.Ο.Υ. */ }

  return NextResponse.json({ ...rec, doyCode });
}
