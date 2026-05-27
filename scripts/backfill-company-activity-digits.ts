import 'dotenv/config';
import { prisma } from '../lib/db';

// Backfill CompanyActivity.codeWithoutDots and CompanyActivity.codeAade for
// rows created before these fields existed. Safe to re-run.
//
//   codeWithoutDots ← KadCode.codeWithoutDots (or stripped form of `code`)
//   codeAade        ← digit-only zero-padded to 8 chars (AADE firm_act_code convention)

(async () => {
  const activities = await prisma.companyActivity.findMany({
    where: { OR: [{ codeWithoutDots: null }, { codeAade: null }] },
    select: { id: true, code: true, codeWithoutDots: true, codeAade: true },
  });
  console.log(`activities to backfill: ${activities.length}`);

  let cwdFromKad = 0, cwdFromStrip = 0, aadeFilled = 0;
  for (const a of activities) {
    let codeWithoutDots = a.codeWithoutDots;
    if (!codeWithoutDots) {
      const kad = await prisma.kadCode.findUnique({
        where: { code: a.code }, select: { codeWithoutDots: true },
      });
      if (kad?.codeWithoutDots) { codeWithoutDots = kad.codeWithoutDots; cwdFromKad++; }
      else { codeWithoutDots = a.code.replace(/\./g, ''); cwdFromStrip++; }
    }

    let codeAade = a.codeAade;
    if (!codeAade) {
      const digits = (codeWithoutDots ?? a.code).replace(/[^0-9]/g, '');
      codeAade = digits ? digits.padEnd(Math.max(8, digits.length), '0') : a.code;
      aadeFilled++;
    }

    await prisma.companyActivity.update({
      where: { id: a.id }, data: { codeWithoutDots, codeAade },
    });
  }
  console.log({ cwdFromKad, cwdFromStrip, aadeFilled });
  await prisma.$disconnect();
})();
