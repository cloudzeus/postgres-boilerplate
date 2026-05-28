import 'dotenv/config';
import { prisma } from '../lib/db';

(async () => {
  const total = await prisma.kadLicenseRequirement.count();
  const roots = await prisma.kadLicenseRequirement.count({ where: { inherited: false } });
  const children = await prisma.kadLicenseRequirement.count({ where: { inherited: true } });
  console.log({ total, roots, children });
  await prisma.$disconnect();
})();
