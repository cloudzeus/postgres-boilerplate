import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { staticMapUrl } from '@/lib/geocode';

export async function GET(request: Request) {
  await requirePermission('companies.read');
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');
  const zoom = parseInt(searchParams.get('zoom') ?? '15', 10);
  const w = parseInt(searchParams.get('w') ?? '600', 10);
  const h = parseInt(searchParams.get('h') ?? '320', 10);
  if (!isFinite(lat) || !isFinite(lng)) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const url = staticMapUrl({ lat, lng, zoom, width: Math.min(w, 1280), height: Math.min(h, 800) });
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[map/static] MapTiler failed', res.status, detail.slice(0, 300));
    return NextResponse.json({ error: 'maptiler_failed', status: res.status, detail: detail.slice(0, 300) }, { status: 502 });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
