import 'dotenv/config';
import { prisma } from '../lib/db';
import { matchRegion } from '../lib/regions/match';

async function main() {
  const companies = await prisma.company.findMany({
    where: { regionCode: null },
    select: {
      id: true, name: true, address: true, city: true, district: true, zip: true, country: true,
      municipalityId: true, prefectureId: true, latitude: true, longitude: true,
    },
  });
  console.log(`Companies to backfill: ${companies.length}`);

  const tally: Record<string, number> = { gemi: 0, name: 0, geo: 0, none: 0 };
  for (const c of companies) {
    const m = await matchRegion({
      address: c.address, city: c.city, district: c.district, zip: c.zip, country: c.country,
      municipalityId: c.municipalityId, prefectureId: c.prefectureId,
      latitude: c.latitude, longitude: c.longitude,
    });
    if (m) {
      await prisma.company.update({ where: { id: c.id }, data: { regionCode: m.regionCode } });
      tally[m.confidence]++;
    } else {
      tally.none++;
    }
  }
  console.log('Companies:', tally);

  const branches = await prisma.companyBranch.findMany({
    where: { regionCode: null },
    select: {
      id: true, address: true, city: true, district: true, zip: true, country: true,
      latitude: true, longitude: true,
    },
  });
  console.log(`Branches to backfill: ${branches.length}`);

  const btally: Record<string, number> = { name: 0, geo: 0, none: 0 };
  for (const b of branches) {
    const m = await matchRegion({
      address: b.address, city: b.city, district: b.district, zip: b.zip, country: b.country,
      latitude: b.latitude, longitude: b.longitude,
    });
    if (m) {
      await prisma.companyBranch.update({ where: { id: b.id }, data: { regionCode: m.regionCode } });
      btally[m.confidence]++;
    } else {
      btally.none++;
    }
  }
  console.log('Branches:', btally);
  console.log('Backfill done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
