import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  // Το CLI (migrate deploy/status, introspection) πάει ΑΠΕΥΘΕΙΑΣ στο Postgres (5432): τα migrations
  // θέλουν advisory locks και session, που δεν περνούν από PgBouncer σε transaction mode. Η εφαρμογή
  // συνδέεται μέσω PgBouncer με το `DATABASE_URL` (βλ. `lib/db.ts`).
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  },
});
