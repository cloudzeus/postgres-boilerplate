import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { geocodeAddress } from '@/lib/geocode';
import { matchRegion } from '@/lib/regions/match';

const BranchSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  isHeadquarters: z.boolean().optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  fax: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  contactPerson: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  order: z.coerce.number().int().optional(),
  regionCode: z.string().optional().nullable(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.read');
  const { id } = await ctx.params;
  const branches = await prisma.companyBranch.findMany({
    where: { companyId: id },
    orderBy: [{ isHeadquarters: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ branches });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = BranchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const { email, ...rest } = parsed.data;
  const geo = await geocodeAddress({ address: rest.address, city: rest.city, zip: rest.zip, country: rest.country });

  let regionCode = rest.regionCode ?? null;
  if (!regionCode && (rest.address || rest.city || rest.district)) {
    const m = await matchRegion({
      address: rest.address, city: rest.city, district: rest.district, zip: rest.zip, country: rest.country,
      latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
    });
    if (m) regionCode = m.regionCode;
  }

  const branch = await prisma.$transaction(async (tx) => {
    if (rest.isHeadquarters) {
      await tx.companyBranch.updateMany({ where: { companyId: id, isHeadquarters: true }, data: { isHeadquarters: false } });
    }
    return tx.companyBranch.create({
      data: {
        ...rest, regionCode, email: email || null, companyId: id,
        ...(geo ? { latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date() } : {}),
      },
    });
  });
  return NextResponse.json({ branch }, { status: 201 });
}
