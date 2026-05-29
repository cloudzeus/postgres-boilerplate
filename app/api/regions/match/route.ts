import { NextRequest, NextResponse } from 'next/server';
import { matchRegion } from '@/lib/regions/match';
import { requirePermission } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  await requirePermission('companies.read');
  const body = await request.json().catch(() => ({}));
  const result = await matchRegion({
    address: body.address ?? null,
    city: body.city ?? null,
    district: body.district ?? null,
    zip: body.zip ?? null,
    country: body.country ?? null,
    municipalityId: body.municipalityId ?? null,
    prefectureId: body.prefectureId ?? null,
    latitude: typeof body.latitude === 'number' ? body.latitude : null,
    longitude: typeof body.longitude === 'number' ? body.longitude : null,
  });
  if (!result) {
    return NextResponse.json({ error: 'not_found', message: 'Δεν βρέθηκε αντιστοίχιση' }, { status: 404 });
  }
  return NextResponse.json(result);
}
