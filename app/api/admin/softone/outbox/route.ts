import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { outboxSummary } from '@/lib/softone-sync/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Η ουρά, νεότερες πρώτα. Το `payload` ΔΕΝ επιστρέφεται: είναι ογκώδες και δεν το διαβάζει άνθρωπος. */
export async function GET(req: Request) {
  await requirePermission('metadata.manage');
  const status = new URL(req.url).searchParams.get('status');
  const items = await prisma.softoneOutbox.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, kind: true, label: true, status: true, attempts: true,
      lastError: true, createdAt: true, sentAt: true, tenantKey: true,
    },
  });
  return NextResponse.json({ items, summary: await outboxSummary() });
}
