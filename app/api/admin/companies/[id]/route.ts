import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { geocodeAddress } from '@/lib/geocode';
import { resolveKadForActivity } from '@/lib/kad/resolve';
import { matchRegion } from '@/lib/regions/match';
import { resolveBusinessTypeId } from '@/lib/companies/business-type';

const UpdateSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1).optional(),
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
  businessTypeId: z.string().optional().nullable(),
  businessTypeOverride: z.boolean().optional(),
  foundingDate: z.string().optional().nullable(),
  aadeStatus: z.string().optional().nullable(),
  aadeFirmKind: z.string().optional().nullable(),
  aadeSyncedAt: z.string().optional().nullable(),
  typeIds: z.array(z.string()).min(1).optional(),
  activities: z.array(z.object({
    code: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(['PRIMARY', 'SECONDARY']),
    order: z.coerce.number().int().optional(),
  })).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.read');
  const { id } = await ctx.params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      types: { include: { type: true } },
      activities: { orderBy: [{ kind: 'asc' }, { order: 'asc' }] },
    },
  });
  if (!company) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Enrich activities with operating-license flag from KadLicenseRequirement.
  const activityCodes = company.activities.map((a) => a.code).filter(Boolean);
  let licenseSet = new Set<string>();
  if (activityCodes.length > 0) {
    const reqs = await prisma.kadLicenseRequirement.findMany({
      where: { code: { in: activityCodes }, licenseType: 'OPERATING_LICENSE' },
      select: { code: true },
    });
    licenseSet = new Set(reqs.map((r) => r.code));
  }
  const enriched = {
    ...company,
    activities: company.activities.map((a) => ({ ...a, requiresLicense: licenseSet.has(a.code) })),
  };
  return NextResponse.json({ company: enriched });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const { typeIds, activities, email, foundingDate, aadeSyncedAt, ...rest } = parsed.data;

  // Coerce empty `code` → null so we don't trip the UNIQUE constraint with "".
  if ('code' in rest && (rest.code === '' || rest.code == null)) {
    (rest as any).code = null;
  }
  // Reject collision early with a clean message instead of a Prisma P2002.
  if (rest.code) {
    const dup = await prisma.company.findFirst({
      where: { code: rest.code, NOT: { id } },
      select: { id: true, name: true },
    });
    if (dup) {
      return NextResponse.json(
        { error: 'duplicate_code', message: `Ο κωδικός "${rest.code}" χρησιμοποιείται ήδη από την εταιρία "${dup.name}".` },
        { status: 409 },
      );
    }
  }

  // Re-geocode only when an address part is in the payload
  const addrChanged = ['address', 'city', 'zip', 'country', 'district'].some((k) => k in rest);
  const geo = addrChanged
    ? await (async () => {
        const cur = await prisma.company.findUnique({
          where: { id },
          select: { address: true, city: true, zip: true, country: true },
        });
        return geocodeAddress({
          address: rest.address ?? cur?.address ?? null,
          city: rest.city ?? cur?.city ?? null,
          zip: rest.zip ?? cur?.zip ?? null,
          country: rest.country ?? cur?.country ?? 'GR',
        });
      })()
    : null;

  if (!('regionCode' in rest) && (addrChanged || 'municipalityId' in rest || 'prefectureId' in rest)) {
    const cur = await prisma.company.findUnique({
      where: { id }, select: { regionCode: true, address: true, city: true, district: true, zip: true, country: true, municipalityId: true, prefectureId: true },
    });
    if (!cur?.regionCode) {
      const m = await matchRegion({
        address: rest.address ?? cur?.address, city: rest.city ?? cur?.city,
        district: rest.district ?? cur?.district, zip: rest.zip ?? cur?.zip, country: rest.country ?? cur?.country,
        municipalityId: rest.municipalityId ?? cur?.municipalityId, prefectureId: rest.prefectureId ?? cur?.prefectureId,
        latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
      });
      if (m) (rest as any).regionCode = m.regionCode;
    }
  }

  const company = await prisma.$transaction(async (tx) => {
    const updated = await tx.company.update({
      where: { id },
      data: {
        ...rest,
        ...(email !== undefined ? { email: email || null } : {}),
        ...(foundingDate !== undefined ? { foundingDate: foundingDate ? new Date(foundingDate) : null } : {}),
        ...(aadeSyncedAt !== undefined ? { aadeSyncedAt: aadeSyncedAt ? new Date(aadeSyncedAt) : null } : {}),
        ...(geo ? { latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date(), geocodedAddress: geo.formatted } : {}),
      },
    });
    if (typeIds) {
      await tx.companyTypeAssignment.deleteMany({ where: { companyId: id } });
      await tx.companyTypeAssignment.createMany({
        data: typeIds.map((typeId) => ({ companyId: id, typeId })),
      });
    }
    if (activities) {
      await tx.companyActivity.deleteMany({ where: { companyId: id } });
      if (activities.length > 0) {
        const resolved = await Promise.all(
          activities.map((a) => resolveKadForActivity(a.code, a.description)),
        );
        await tx.companyActivity.createMany({
          data: activities.map((a, i) => ({
            companyId: id,
            code: resolved[i].code,
            codeWithoutDots: resolved[i].codeWithoutDots,
            codeAade: resolved[i].codeAade,
            description: resolved[i].description,
            kind: a.kind,
            order: a.order ?? i,
          })),
        });
      }
    }
    return updated;
  });

  // Resolve businessTypeId from legal form (unless manually overridden).
  {
    const companyId = id;
    const override = body.businessTypeOverride === true;
    if (override) {
      await prisma.company.update({ where: { id: companyId }, data: { businessTypeOverride: true, businessTypeId: typeof body.businessTypeId === 'string' && body.businessTypeId ? body.businessTypeId : null } });
    } else {
      const saved = await prisma.company.findUnique({ where: { id: companyId }, select: { legalForm: true, businessTypeId: true, legalTypeRef: { select: { descr: true } } } });
      const catalog = await prisma.businessType.findMany({ select: { id: true, code: true } });
      const next = resolveBusinessTypeId({ legalForm: saved?.legalForm ?? null, legalTypeDescr: saved?.legalTypeRef?.descr ?? null, businessTypeId: saved?.businessTypeId ?? null, businessTypeOverride: false }, catalog);
      await prisma.company.update({ where: { id: companyId }, data: { businessTypeOverride: false, businessTypeId: next } });
    }
  }

  return NextResponse.json({ company });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.delete');
  const { id } = await ctx.params;
  await prisma.company.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
