import { prisma } from '@/lib/db';
import { deriveHierarchy, type RegionBreadcrumb } from '@/lib/regions/tree';

export type DecodedRegion = {
  code: string;
  nameEL: string;
  nameEN: string | null;
  level: number;
  path: string | null;
  latitude: number | null;
  longitude: number | null;
  breadcrumb: RegionBreadcrumb;
  children: Array<{ code: string; nameEL: string; level: number }>;
};

/** Look up a region by exact code, or by case-insensitive nameEL contains. */
export async function decodeRegion(input: string): Promise<DecodedRegion | null> {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  let hit = await prisma.region.findUnique({ where: { code: raw } });
  if (!hit) {
    hit = await prisma.region.findFirst({
      where: { nameEL: { contains: raw } },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
  }
  if (!hit) return null;

  const [children, breadcrumb] = await Promise.all([
    prisma.region.findMany({
      where: { parentCode: hit.code },
      orderBy: { nameEL: 'asc' },
      take: 400,
      select: { code: true, nameEL: true, level: true },
    }),
    deriveHierarchy(hit.code),
  ]);

  return {
    code: hit.code, nameEL: hit.nameEL, nameEN: hit.nameEN, level: hit.level,
    path: hit.path, latitude: hit.latitude, longitude: hit.longitude,
    breadcrumb, children,
  };
}
