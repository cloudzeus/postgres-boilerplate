import 'dotenv/config';
import { prisma } from '../lib/db';

// Reconcile legacy AADE-sourced KadCode rows (digit-only, length >= 6) against the
// canonical dotted hierarchy from kad2025.json. Strategy per legacy row:
//
//   1) If a canonical dotted entry with the same digit-form exists
//      → migrate CompanyActivity / CustomerKAD references to the canonical code
//      → delete the legacy duplicate row.
//   2) Otherwise (true ΑΕΔΕΕ-only leaf) → backfill parentCode/level/sector/path
//      so it slots into the hierarchy as a level-7 leaf under its closest canonical
//      ancestor. The row is preserved.

(async () => {
  const legacy = await prisma.$queryRawUnsafe<{ code: string }[]>(
    `SELECT code FROM "KadCode" WHERE code ~ '^[0-9]+$' AND length(code) >= 6`
  );
  console.log(`legacy KadCode rows: ${legacy.length}`);

  let migrated = 0, backfilled = 0;
  const unmapped: string[] = [];

  for (const { code: legacyCode } of legacy) {
    // (1) canonical with identical digit-form?
    const canonical = await prisma.kadCode.findFirst({
      where: { codeWithoutDots: legacyCode, code: { contains: '.' } },
    });
    if (canonical) {
      await prisma.companyActivity.updateMany({
        where: { code: legacyCode }, data: { code: canonical.code },
      });
      await prisma.customerKAD.updateMany({
        where: { resolvedKAD: legacyCode }, data: { resolvedKAD: canonical.code },
      });
      await prisma.kadCode.delete({ where: { code: legacyCode } });
      migrated++;
      continue;
    }

    // (2) backfill: find longest canonical dotted ancestor by prefix shortening.
    let parent: { code: string; level: number | null; sector: string | null; sectorLetter: string | null; path: string | null } | null = null;
    for (let len = legacyCode.length - 1; len >= 2; len--) {
      const s = legacyCode.slice(0, len);
      const t = await prisma.kadCode.findFirst({
        where: { codeWithoutDots: s, code: { contains: '.' } },
        orderBy: { level: 'desc' },
        select: { code: true, level: true, sector: true, sectorLetter: true, path: true },
      });
      if (t) { parent = t; break; }
    }
    if (!parent) { unmapped.push(legacyCode); continue; }

    await prisma.kadCode.update({
      where: { code: legacyCode },
      data: {
        codeWithoutDots: legacyCode,
        parentCode: parent.code,
        level: (parent.level ?? 6) + 1,
        sector: parent.sector,
        sectorLetter: parent.sectorLetter,
        path: `${parent.path}>${legacyCode}`,
      },
    });
    backfilled++;
  }

  console.log({ migrated, backfilled, unmapped: unmapped.length });
  if (unmapped.length) console.log('unmapped:', unmapped);
  await prisma.$disconnect();
})();
