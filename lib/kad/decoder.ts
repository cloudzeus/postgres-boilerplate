import { prisma } from '@/lib/db';

export type DecodedKad = {
  code: string;
  codeWithoutDots: string | null;
  title: string;
  level: number | null;
  sector: string | null;
  path: string | null;
  hierarchy: Array<{
    code: string;
    title: string;
    level: number | null;
    sector: string | null;
    parentCode: string | null;
  }>;
  children: Array<{ code: string; title: string; level: number | null }>;
};

/** Strip everything except digits. NOT padded — storage uses variable-length raw digits. */
export function normalizeKad(input: string): string {
  return input.replace(/[^0-9]/g, '');
}

export async function decodeKADCode(input: string): Promise<DecodedKad | null> {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // Direct dotted lookup first (preserves levels with > 8 digits or custom shape).
  const dotted = raw.includes('.') ? raw : null;
  let hit = dotted
    ? await prisma.kadCode.findUnique({ where: { code: dotted } })
    : null;

  if (!hit) {
    const normalized = normalizeKad(raw);
    // Try exact, then strip trailing zeros, then shorter prefixes.
    const candidates = new Set<string>();
    let cur = normalized;
    candidates.add(cur);
    while (cur.endsWith('0') && cur.length > 1) { cur = cur.slice(0, -1); candidates.add(cur); }
    for (const len of [8, 7, 6, 5, 4, 3, 2]) {
      if (normalized.length >= len) candidates.add(normalized.slice(0, len));
    }
    for (const cand of candidates) {
      hit = await prisma.kadCode.findFirst({
        where: { codeWithoutDots: cand },
        orderBy: [{ level: 'desc' }, { code: 'asc' }],
      });
      if (hit) break;
    }
    if (!hit) {
      // Last resort: startsWith on shortest meaningful prefix
      for (const len of [6, 4, 2]) {
        const prefix = normalized.slice(0, len);
        if (!prefix) continue;
        hit = await prisma.kadCode.findFirst({
          where: { codeWithoutDots: { startsWith: prefix } },
          orderBy: [{ level: 'desc' }, { code: 'asc' }],
        });
        if (hit) break;
      }
    }
  }

  if (!hit) return null;

  const [children, hierarchy] = await Promise.all([
    prisma.kadCode.findMany({
      where: { parentCode: hit.code },
      orderBy: { code: 'asc' },
      take: 100,
      select: { code: true, title: true, description: true, level: true },
    }),
    walkUp(hit.code),
  ]);

  return {
    code: hit.code,
    codeWithoutDots: hit.codeWithoutDots,
    title: hit.title ?? hit.description,
    level: hit.level,
    sector: hit.sector,
    path: hit.path,
    hierarchy,
    children: children.map((c) => ({
      code: c.code,
      title: c.title ?? c.description,
      level: c.level,
    })),
  };
}

async function walkUp(code: string) {
  const chain: DecodedKad['hierarchy'] = [];
  let current: string | null = code;
  // Cap depth to avoid pathological cycles.
  for (let i = 0; i < 10 && current; i++) {
    const node = await prisma.kadCode.findUnique({
      where: { code: current },
      select: {
        code: true, title: true, description: true,
        level: true, sector: true, parentCode: true,
      },
    });
    if (!node) break;
    chain.unshift({
      code: node.code,
      title: node.title ?? node.description,
      level: node.level,
      sector: node.sector,
      parentCode: node.parentCode,
    });
    current = node.parentCode;
  }
  return chain;
}
