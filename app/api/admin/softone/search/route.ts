import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAnyPermission } from '@/lib/rbac';
import { SUPPLIER_SODTYPES } from '@/lib/softone';

// Searches the local SoftOne mirrors for manual matching (items / traders).
// GET ?type=items|suppliers|traders&q=...
// `suppliers` and `traders` are the same query (SODTYPE 12 suppliers + 16 creditors);
// the queue pages call it `traders` because a creditor is not a supplier.
export async function GET(req: Request) {
  await requireAnyPermission('ocr.read', 'metadata.read', 'metadata.manage');
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type') ?? 'items';
  const q = (sp.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  if (type === 'suppliers' || type === 'traders') {
    const rows = await prisma.softoneTrader.findMany({
      where: {
        sodtype: { in: [...SUPPLIER_SODTYPES] },
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }, { afm: { contains: q } }],
      },
      take: 25, orderBy: { name: 'asc' },
      select: { trdr: true, code: true, name: true, afm: true, kind: true, city: true },
    });
    return NextResponse.json({
      // `afm` on its own as well as inside `sub`: the caller that links a supplier needs the
      // bare VAT number, and digging it back out of the display string is guesswork.
      results: rows.map((r) => ({ id: r.trdr, code: r.code, name: r.name, afm: r.afm ?? null, sub: [r.kind, r.afm && `ΑΦΜ ${r.afm}`, r.city].filter(Boolean).join(' · ') })),
    });
  }

  if (type === 'expenses') {
    // Έξοδα (EditMaster EXPENSES → EXPN) — τρίτο μητρώο της ουράς «Είδη & έξοδα».
    const rows = await prisma.softoneExpense.findMany({
      where: {
        isActive: true,
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }],
      },
      take: 25, orderBy: { name: 'asc' },
      select: { expn: true, code: true, name: true, vat: true },
    });
    return NextResponse.json({
      results: rows.map((r) => ({
        id: r.expn, code: r.code, name: r.name, isService: false,
        sub: ['έξοδο', r.vat && `ΦΠΑ ${r.vat}`].filter(Boolean).join(' · '),
      })),
    });
  }

  if (type === 'products' || type === 'services') {
    // Ρητά μητρώα ανά κατηγορία, ώστε ο καλών να μη χρειάζεται το `service` flag.
    const rows = await prisma.softoneItem.findMany({
      where: {
        isService: type === 'services',
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q } }, { code1: { contains: q } }, { code2: { contains: q } },
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
