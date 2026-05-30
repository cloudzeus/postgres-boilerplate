import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { geocodeAddress } from '@/lib/geocode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FirmAct {
  firm_act_code: string;
  firm_act_descr: string;
  firm_act_kind: string;          // "1" κύρια, "2" δευτερεύουσα
}

/**
 * AADE/ΓΕΜΗ services return XML serialized to JSON. NULL XML elements come
 * through as `{ $: { 'xsi:nil': 'true' } }` rather than JSON null. Normalize.
 */
function s(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as any;
    // xsi:nil marker
    if (o.$ && (o.$['xsi:nil'] === 'true' || o.$.nil === 'true')) return null;
    // SOAP-style { _: 'value' }
    if (typeof o._ === 'string') return o._.trim() || null;
  }
  return null;
}

/**
 * From the extracted ΑΦΜ on the OCR document:
 *  1) AADE lookup (afm2info)
 *  2) Create a Company of the requested type (SUPPLIER or CUSTOMER), or re-use
 *     an existing Company with the same ΑΦΜ.
 * Accepts ?role=SUPPLIER (default) or ?role=CUSTOMER. For CUSTOMER reads
 * `customerVatNumber`; for SUPPLIER reads `vatNumber`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.create');
  const { id } = await params;
  const url = new URL(req.url);
  const role = (url.searchParams.get('role') ?? 'SUPPLIER').toUpperCase();
  if (role !== 'SUPPLIER' && role !== 'CUSTOMER') {
    return NextResponse.json({ error: `Άγνωστο role: ${role}` }, { status: 400 });
  }

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'OCR is not completed yet' }, { status: 422 });
  }

  const data = (doc.extractedData ?? {}) as any;
  const sourceKey = role === 'CUSTOMER' ? 'customerVatNumber' : 'vatNumber';
  const afmRaw = String(data?.[sourceKey] ?? '').replace(/\D+/g, '');

  // Contact info is only captured for the ISSUER (supplier), so we only flow it
  // into a SUPPLIER company — never onto a customer record.
  const scanPhone = role === 'SUPPLIER' ? (String(data?.companyPhone ?? data?.phone ?? '').trim() || null) : null;
  const scanEmail = role === 'SUPPLIER' ? (String(data?.companyEmail ?? data?.email ?? '').trim() || null) : null;
  if (!/^\d{9}$/.test(afmRaw)) {
    return NextResponse.json({
      error: role === 'CUSTOMER'
        ? 'Δεν βρέθηκε ΑΦΜ Πελάτη (9 ψηφία) στα extracted πεδία.'
        : 'Δεν βρέθηκε ΑΦΜ Εκδότη (9 ψηφία) στα extracted πεδία.',
      afm: afmRaw,
    }, { status: 422 });
  }

  const typeRow = await prisma.companyType.findUnique({ where: { key: role } });
  if (!typeRow) {
    return NextResponse.json({ error: `${role} company type is not seeded` }, { status: 500 });
  }

  // Reuse αν υπάρχει ήδη — απλά εξασφαλίζουμε ότι έχει αυτόν τον τύπο.
  const existing = await prisma.company.findFirst({ where: { afm: afmRaw } });
  if (existing) {
    await prisma.companyTypeAssignment.upsert({
      where: { companyId_typeId: { companyId: existing.id, typeId: typeRow.id } },
      update: {},
      create: { companyId: existing.id, typeId: typeRow.id },
    });
    // Backfill phone/email from the scan only when the existing record lacks them.
    const fill: { phone?: string; email?: string } = {};
    if (scanPhone && !existing.phone) fill.phone = scanPhone;
    if (scanEmail && !existing.email) fill.email = scanEmail;
    const updated = Object.keys(fill).length
      ? await prisma.company.update({ where: { id: existing.id }, data: fill })
      : existing;
    return NextResponse.json({ company: updated, reused: true, role });
  }

  // AADE lookup
  let raw: any;
  try {
    const r = await fetch('https://vat.wwa.gr/afm2info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afm: afmRaw }),
      cache: 'no-store',
    });
    if (!r.ok) return NextResponse.json({ error: 'aade_http', status: r.status }, { status: 502 });
    raw = await r.json();
  } catch (e: any) {
    return NextResponse.json({ error: 'aade_unreachable', message: e?.message }, { status: 502 });
  }
  const b = raw?.basic_rec;
  if (!b || !b.afm) return NextResponse.json({ error: 'ΑΦΜ δεν βρέθηκε στην ΑΑΔΕ', raw }, { status: 404 });

  const items: FirmAct[] = raw?.firm_act_tab?.item
    ? (Array.isArray(raw.firm_act_tab.item) ? raw.firm_act_tab.item : [raw.firm_act_tab.item])
    : [];
  const activities = items.map((a, i) => ({
    code: a.firm_act_code,
    description: a.firm_act_descr,
    kind: a.firm_act_kind === '1' ? 'PRIMARY' as const : 'SECONDARY' as const,
    order: i,
  }));

  const addressParts = [s(b.postal_address), s(b.postal_address_no)].filter(Boolean);
  const address = addressParts.join(' ') || null;
  const stopDate = s(b.stop_date);
  const isActive = s(b.deactivation_flag) === '1' && !stopDate;
  const profession = activities.find((a) => a.kind === 'PRIMARY')?.description ?? null;
  const city = s(b.postal_area_description);
  const zip  = s(b.postal_zip_code);
  const registDate = s(b.regist_date);
  const parsedFounding = registDate ? new Date(registDate) : null;
  const validFounding = parsedFounding && !Number.isNaN(parsedFounding.getTime()) ? parsedFounding : null;

  const geo = await geocodeAddress({ address, city, zip, country: 'GR' });

  const company = await prisma.company.create({
    data: {
      name: s(b.onomasia) ?? `${role === 'CUSTOMER' ? 'Πελάτης' : 'Προμηθευτής'} ${afmRaw}`,
      shortName: s(b.commer_title),
      afm: afmRaw,
      doy: s(b.doy_descr),
      legalForm: s(b.legal_status_descr),
      address,
      city,
      zip,
      country: 'GR',
      profession,
      foundingDate: validFounding,
      isActive,
      ...(scanPhone ? { phone: scanPhone } : {}),
      ...(scanEmail ? { email: scanEmail } : {}),
      aadeSyncedAt: new Date(),
      ...(geo ? { latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date(), geocodedAddress: geo.formatted } : {}),
      types: { create: [{ typeId: typeRow.id }] },
      activities: activities.length
        ? { create: activities.map((a) => ({ code: a.code, description: a.description, kind: a.kind, order: a.order })) }
        : undefined,
    },
    include: { types: { include: { type: true } } },
  });

  return NextResponse.json({ company, reused: false, role }, { status: 201 });
}
