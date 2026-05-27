import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// GET /api/kad/children            → top-level (sectors, level=1)
// GET /api/kad/children?parent=01  → direct children of "01"
export async function GET(request: NextRequest) {
  await requirePermission('kad.read');
  const parent = request.nextUrl.searchParams.get('parent');

  const rows = await prisma.kadCode.findMany({
    where: parent ? { parentCode: parent } : { level: 1 },
    orderBy: { code: 'asc' },
    select: {
      code: true, title: true, description: true,
      level: true, sector: true, parentCode: true, path: true,
      _count: { select: { children: true } },
    },
  });

  // Total descendants per node via path-prefix count, batched.
  const descendants = await Promise.all(
    rows.map((r) =>
      r.path
        ? prisma.kadCode.count({ where: { path: { startsWith: `${r.path}>` } } })
        : Promise.resolve(0),
    ),
  );

  return NextResponse.json({
    nodes: rows.map((r, i) => ({
      code: r.code,
      title: r.title ?? r.description,
      level: r.level,
      sector: r.sector,
      parentCode: r.parentCode,
      directChildren: r._count.children,
      descendants: descendants[i],
      hasChildren: r._count.children > 0,
    })),
  });
}
