import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchTaxOffices, matchTaxOffice } from '@/lib/softone';

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
  let raw: { basic_rec?: Record<string, unknown>; firm_act_tab?: { item?: unknown } } | null = null;
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
  const b = raw?.basic_rec as Record<string, unknown> | undefined;
  if (!b || !b.afm) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const s = (v: unknown): string | null => (v == null ? null : (String(v).trim() || null));
  const doyDescr = s(b.doy_descr);
  const addressParts = [s(b.postal_address), s(b.postal_address_no)].filter(Boolean);

  // Primary activity (ΚΑΔ) description → profession (JOBTYPETRD).
  const acts = raw?.firm_act_tab?.item;
  const actList = Array.isArray(acts) ? acts : acts ? [acts] : [];
  const primary = actList.find((a) => (a as Record<string, unknown>)?.firm_act_kind === '1') as Record<string, unknown> | undefined;
  const profession = s(primary?.firm_act_descr) ?? s((actList[0] as Record<string, unknown>)?.firm_act_descr);

  // 2) Δ.Ο.Υ. description → SoftOne IRSDATA code (best-effort; null when no match)
  let doyCode: string | null = null;
  try {
    const offices = await softoneFetchTaxOffices();
    doyCode = matchTaxOffice(doyDescr, offices);
  } catch { /* leave null — supplier is still created without Δ.Ο.Υ. */ }

  return NextResponse.json({
    afm: s(b.afm),
    name: s(b.onomasia) ?? '',
    doyDescr,
    doyCode,
    profession,
    address: addressParts.join(' ') || null,
    zip: s(b.postal_zip_code),
    city: s(b.postal_area_description),
    legalForm: s(b.legal_status_descr),
    isActive: s(b.deactivation_flag) === '1',
  });
}
