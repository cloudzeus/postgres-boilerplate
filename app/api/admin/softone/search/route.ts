import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAnyPermission } from '@/lib/rbac';

// Searches the local SoftOne mirrors for manual matching (items / suppliers).
// GET ?type=items|suppliers&q=...
export async function GET(req: Request) {
  await requireAnyPermission('ocr.read', 'metadata.read', 'metadata.manage');
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type') ?? 'items';
  const q = (sp.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  if (type === 'suppliers') {
    const rows = await prisma.softoneSupplier.findMany({
      where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }, { afm: { contains: q } }] },
      take: 25, orderBy: { name: 'asc' },
      select: { trdr: true, code: true, name: true, afm: true, kind: true, city: true },
    });
    return NextResponse.json({
      results: rows.map((r) => ({ id: r.trdr, code: r.code, name: r.name, sub: [r.kind, r.afm, r.city].filter(Boolean).join(' · ') })),
    });
  }

  // items (products + services)
  const onlyService = sp.get('service'); // '1' = only services, '0' = only products, null = both
  const rows = await prisma.softoneItem.findMany({
    where: {
      AND: [
        onlyService === '1' ? { isService: true } : onlyService === '0' ? { isService: false } : {},
        { OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q } }, { code1: { contains: q } }, { code2: { contains: q } },
        ] },
      ],
    },
    take: 25, orderBy: { name: 'asc' },
    select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true },
  });
  return NextResponse.json({
    results: rows.map((r) => ({
      id: r.mtrl, code: r.code, name: r.name, isService: r.isService,
      sub: [r.isService ? 'υπηρεσία' : 'είδος', r.code2 && `εργ. ${r.code2}`, r.code1 && `EAN ${r.code1}`].filter(Boolean).join(' · '),
    })),
  });
}
