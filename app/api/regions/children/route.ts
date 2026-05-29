import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// GET /api/regions/children            → top-level (Περιφέρειες, level=3)
// GET /api/regions/children?parent=111 → direct children of "111"
export async function GET(request: NextRequest) {
  await requirePermission('metadata.read');
  const parent = request.nextUrl.searchParams.get('parent');

  const rows = await prisma.region.findMany({
    where: parent ? { parentCode: parent } : { level: 3 },
    orderBy: { nameEL: 'asc' },
    select: {
      code: true, nameEL: true, level: true, parentCode: true, path: true,
      _count: { select: { children: true } },
    },
  });

  const descendants = await Promise.all(
    rows.map((r) =>
      r.path ? prisma.region.count({ where: { path: { startsWith: `${r.path}>` } } }) : Promise.resolve(0),
    ),
  );

  return NextResponse.json({
    nodes: rows.map((r, i) => ({
      code: r.code,
      nameEL: r.nameEL,
      level: r.level,
      parentCode: r.parentCode,
      directChildren: r._count.children,
      descendants: descendants[i],
      hasChildren: r._count.children > 0,
    })),
  });
}
