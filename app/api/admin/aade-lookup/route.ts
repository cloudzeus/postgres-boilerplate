import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { ensurePrimaryActivity } from '@/lib/kad/resolve';

const Schema = z.object({ afm: z.string().regex(/^\d{9}$/, 'ΑΦΜ 9 ψηφία') });

type FirmAct = {
  firm_act_code: string;
  firm_act_descr: string;
  firm_act_kind: string;          // "1" κύρια, "2" δευτερεύουσα
  firm_act_kind_descr: string;
};

export async function POST(request: Request) {
  await requirePermission('companies.read');
  const body = await request.json();
  // Tolerate a country prefix / formatting: "EL999863881" → "999863881".
  if (body && typeof body.afm === 'string') body.afm = body.afm.replace(/\D+/g, '');
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });

  let raw: any;
  try {
    const r = await fetch('https://vat.wwa.gr/afm2info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afm: parsed.data.afm }),
      cache: 'no-store',
    });
    if (!r.ok) return NextResponse.json({ error: 'aade_http', status: r.status }, { status: 502 });
    raw = await r.json();
  } catch (e: any) {
    return NextResponse.json({ error: 'aade_unreachable', message: e?.message }, { status: 502 });
  }

  const b = raw?.basic_rec;
  if (!b || !b.afm) return NextResponse.json({ error: 'not_found', raw }, { status: 404 });

  const items: FirmAct[] = raw?.firm_act_tab?.item
    ? (Array.isArray(raw.firm_act_tab.item) ? raw.firm_act_tab.item : [raw.firm_act_tab.item])
    : [];

  const activities = ensurePrimaryActivity(items.map((a, i) => ({
    code: a.firm_act_code,
    description: a.firm_act_descr,
    kind: a.firm_act_kind === '1' ? 'PRIMARY' as const : 'SECONDARY' as const,
    order: i,
  })));

  // NOTE: Δεν γράφουμε πια στο KadCode εδώ. Το master catalog σπέρνεται από το
  // kad2025.json (prisma/seeds/kad2026.ts) και resolveKadForActivity κάνει το
  // mapping όταν αποθηκευτούν τα activities στο PUT /companies/[id].

  const profession = activities.find((a) => a.kind === 'PRIMARY')?.description ?? null;
  const stopDate = s(b.stop_date);
  const isActive = s(b.deactivation_flag) === '1' && !stopDate;

  const addressParts = [s(b.postal_address), s(b.postal_address_no)].filter(Boolean);

  return NextResponse.json({
    mapped: {
      afm: s(b.afm),
      name: s(b.onomasia) ?? '',
      shortName: s(b.commer_title),
      doy: s(b.doy_descr),
      legalForm: s(b.legal_status_descr),
      address: addressParts.join(' ') || null,
      zip: s(b.postal_zip_code),
      city: s(b.postal_area_description),
      country: 'GR',
      foundingDate: s(b.regist_date),
      profession,
      aadeStatus: s(b.deactivation_flag_descr),
      aadeFirmKind: s(b.firm_flag_descr),
      isActive,
    },
    activities,
  });
}

/** AADE/ΓΕΜΗ XML→JSON nil coercer (shared idea — kept inline for portability). */
function s(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as any;
    if (o.$ && (o.$['xsi:nil'] === 'true' || o.$.nil === 'true')) return null;
    if (typeof o._ === 'string') return o._.trim() || null;
  }
  return null;
}
