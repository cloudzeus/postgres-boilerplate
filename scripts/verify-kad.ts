import 'dotenv/config';
import { prisma } from '../lib/db';
(async () => {
  const total = await prisma.kadCode.count();
  const byLevel: any = await prisma.$queryRawUnsafe(
    `SELECT level, COUNT(*)::int AS n FROM "KadCode" GROUP BY level ORDER BY level NULLS LAST`
  );
  const sectors = await prisma.kadCode.count({ where: { level: 1 } });
  const aadeLeaves = await prisma.$queryRawUnsafe<any[]>(
    `SELECT code, level, "parentCode", path FROM "KadCode" WHERE level=7 ORDER BY code LIMIT 5`
  );
  const ca = await prisma.companyActivity.count();
  console.log({ total, sectors, companyActivities: ca, byLevel });
  console.log('sample AADE leaves (level=7):'); console.table(aadeLeaves);
  await prisma.$disconnect();
})();
