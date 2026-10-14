import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable for Prisma');
}

// Η εφαρμογή συνδέεται μέσω PgBouncer (6432, transaction mode): το δικό μας pool είναι μικρό και
// το PgBouncer πολυπλέκει πάνω σε λίγες συνδέσεις του Postgres (`default_pool_size`). Τα migrations
// και τα backups πάνε απευθείας στο Postgres με το `DIRECT_URL` (prisma.config.ts, lib/backup.ts).
const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
  // Αδρανή connections κλείνουν γρήγορα — το PgBouncer κρατά ούτως ή άλλως τις συνδέσεις του server.
  idleTimeoutMillis: 30_000,
});
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({
    adapter,
    log: ['query', 'info', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
