import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { geocodeAddress } from '@/lib/geocode';
import { matchRegion } from '@/lib/regions/match';

const CompanyBaseSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  shortName: z.string().optional().nullable(),
  afm: z.string().optional().nullable(),
  doy: z.string().optional().nullable(),
  profession: z.string().optional().nullable(),
  legalForm: z.string().optional().nullable(),
  gemhNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  fax: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  website: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  contactTitle: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  creditLimit: z.coerce.number().optional().nullable(),
  discount: z.coerce.number().optional().nullable(),
  vatCategory: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  employeeCount: z.coerce.number().int().min(0).optional().nullable(),
  legalTypeId: z.coerce.number().int().optional().nullable(),
  gemiOfficeId: z.coerce.number().int().optional().nullable(),
  companyStatusId: z.coerce.number().int().optional().nullable(),
  prefectureId: z.string().optional().nullable(),
  municipalityId: z.string().optional().nullable(),
  regionCode: z.string().optional().nullable(),
  vatCategoryId: z.coerce.number().int().optional().nullable(),
  foundingDate: z.string().optional().nullable(),
  aadeStatus: z.string().optional().nullable(),
  aadeFirmKind: z.string().optional().nullable(),
  aadeSyncedAt: z.string().optional().nullable(),
  typeIds: z.array(z.string()).min(1, 'Επίλεξε τουλάχιστον έναν τύπο'),
  activities: z.array(z.object({
    code: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(['PRIMARY', 'SECONDARY']),
    order: z.coerce.number().int().optional(),
  })).optional(),
});

export async function GET(request: Request) {
  await requirePermission('companies.read');
  const { searchParams } = new URL(request.url);
  const typeKey = searchParams.get('typeKey');
  const typeId = searchParams.get('typeId');
  const q = searchParams.get('q');

  const where: any = {};
  if (typeId) where.types = { some: { typeId } };
  else if (typeKey) where.types = { some: { type: { key: typeKey } } };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { afm: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
    ];
  }

  const companies = await prisma.company.findMany({
    where,
    include: { types: { include: { type: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ companies });
}

export async function POST(request: Request) {
  await requirePermission('companies.create');
  const body = await request.json();
  const parsed = CompanyBaseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const { typeIds, activities, email, foundingDate, aadeSyncedAt, ...rest } = parsed.data;

  const geo = await geocodeAddress({ address: rest.address, city: rest.city, zip: rest.zip, country: rest.country });

  let regionCode = rest.regionCode ?? null;
  if (!regionCode && (rest.municipalityId || rest.prefectureId || rest.address || rest.city || rest.district)) {
    const m = await matchRegion({
      address: rest.address, city: rest.city, district: rest.district, zip: rest.zip, country: rest.country,
      municipalityId: rest.municipalityId, prefectureId: rest.prefectureId,
      latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
    });
    if (m) regionCode = m.regionCode;
  }

  const company = await prisma.company.create({
    data: {
      ...rest,
      regionCode,
      email: email || null,
      foundingDate: foundingDate ? new Date(foundingDate) : null,
      aadeSyncedAt: aadeSyncedAt ? new Date(aadeSyncedAt) : null,
      ...(geo ? { latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date(), geocodedAddress: geo.formatted } : {}),
      types: { create: typeIds.map((typeId) => ({ typeId })) },
      activities: activities && activities.length > 0
        ? { create: activities.map((a, i) => ({ code: a.code, description: a.description, kind: a.kind, order: a.order ?? i })) }
        : undefined,
    },
    include: { types: { include: { type: true } }, activities: true },
  });
  return NextResponse.json({ company }, { status: 201 });
}
