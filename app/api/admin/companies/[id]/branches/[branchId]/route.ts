import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { geocodeAddress } from '@/lib/geocode';
import { matchRegion } from '@/lib/regions/match';

const UpdateSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1).optional(),
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

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; branchId: string }> },
) {
  await requirePermission('companies.update');
  const { id, branchId } = await ctx.params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const { email, ...rest } = parsed.data;

  const addrChanged = ['address', 'city', 'zip', 'country'].some((k) => k in rest);
  const geo = addrChanged
    ? await (async () => {
        const cur = await prisma.companyBranch.findUnique({
          where: { id: branchId },
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

  if (!('regionCode' in rest) && addrChanged) {
    const cur = await prisma.companyBranch.findUnique({
      where: { id: branchId },
      select: { regionCode: true, address: true, city: true, district: true, zip: true, country: true },
    });
    if (!cur?.regionCode) {
      const m = await matchRegion({
        address: rest.address ?? cur?.address, city: rest.city ?? cur?.city,
        district: rest.district ?? cur?.district, zip: rest.zip ?? cur?.zip, country: rest.country ?? cur?.country,
        latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
      });
      if (m) (rest as any).regionCode = m.regionCode;
    }
  }

  const branch = await prisma.$transaction(async (tx) => {
    if (rest.isHeadquarters) {
      await tx.companyBranch.updateMany({
        where: { companyId: id, isHeadquarters: true, NOT: { id: branchId } },
        data: { isHeadquarters: false },
      });
    }
    return tx.companyBranch.update({
      where: { id: branchId },
      data: {
        ...rest,
        ...(email !== undefined ? { email: email || null } : {}),
        ...(geo ? { latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date() } : {}),
      },
    });
  });
  return NextResponse.json({ branch });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; branchId: string }> },
) {
  await requirePermission('companies.update');
  const { branchId } = await ctx.params;
  await prisma.companyBranch.delete({ where: { id: branchId } });
  return NextResponse.json({ ok: true });
}
