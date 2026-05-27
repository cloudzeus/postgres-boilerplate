import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { geocodeAddress } from '@/lib/geocode';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;
  const c = await prisma.company.findUnique({
    where: { id },
    select: { address: true, city: true, zip: true, country: true },
  });
  if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const geo = await geocodeAddress(c);
  if (!geo) return NextResponse.json({ error: 'geocode_failed' }, { status: 422 });

  const updated = await prisma.company.update({
    where: { id },
    data: { latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date(), geocodedAddress: geo.formatted },
    select: { latitude: true, longitude: true, geocodedAt: true, geocodedAddress: true },
  });
  return NextResponse.json({ ok: true, ...updated, formatted: geo.formatted });
}
