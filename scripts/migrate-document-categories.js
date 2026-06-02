import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable for Prisma');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const types = await prisma.documentType.findMany({ where: { category: { not: null }, categoryId: null } });
  const seen = new Map();
  for (const t of types) {
    const name = (t.category || '').trim();
    if (!name) continue;
    let cat = seen.get(name);
    if (!cat) {
      cat = await prisma.documentCategory.upsert({ where: { name }, update: {}, create: { name } });
      seen.set(name, cat);
    }
    await prisma.documentType.update({ where: { id: t.id }, data: { categoryId: cat.id } });
  }
  console.log(`✓ Migrated ${types.length} document types into ${seen.size} categories`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
