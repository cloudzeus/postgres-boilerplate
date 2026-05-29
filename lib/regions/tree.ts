export type RegionRef = { code: string; nameEL: string };

export type RegionBreadcrumb = {
  region: RegionRef | null;        // level 3
  regionalUnit: RegionRef | null;  // level 4 (Περιφερειακή Ενότητα / Νομός)
  municipality: RegionRef | null;  // level 5 (Δήμος)
};

export type RegionChainNode = { code: string; nameEL: string; level: number };

/** Pure: map an ordered (root→leaf) chain into the breadcrumb by level. */
export function buildBreadcrumb(chain: RegionChainNode[]): RegionBreadcrumb {
  const byLevel = (lvl: number) => {
    const n = chain.find((c) => c.level === lvl);
    return n ? { code: n.code, nameEL: n.nameEL } : null;
  };
  return {
    region: byLevel(3),
    regionalUnit: byLevel(4),
    municipality: byLevel(5),
  };
}

/** Walk up the parent chain from a node code, then build the breadcrumb. */
export async function deriveHierarchy(code: string): Promise<RegionBreadcrumb> {
  const { prisma } = await import('@/lib/db');
  const chain: RegionChainNode[] = [];
  let current: string | null = code;
  for (let i = 0; i < 8 && current; i++) {
    const node = await prisma.region.findUnique({
      where: { code: current },
      select: { code: true, nameEL: true, level: true, parentCode: true },
    });
    if (!node) break;
    chain.unshift({ code: node.code, nameEL: node.nameEL, level: node.level });
    current = node.parentCode;
  }
  return buildBreadcrumb(chain);
}
