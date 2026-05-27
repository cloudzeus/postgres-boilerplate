import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { runBackup } from '@/lib/backup';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  await requirePermission('system.backups');
  const rows = await prisma.dbBackup.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({
    backups: rows.map((b) => ({
      id: b.id,
      filename: b.filename,
      sizeBytes: b.sizeBytes.toString(),
      status: b.status,
      trigger: b.trigger,
      errorMessage: b.errorMessage,
      createdAt: b.createdAt,
    })),
  });
}

export async function POST() {
  const u = await requirePermission('system.backups');
  try {
    const rec = await runBackup({ trigger: 'manual', userId: u.id });
    await logAudit({ userId: u.id, userEmail: u.email, action: 'backup.create', resource: 'backup', resourceId: rec.id });
    return NextResponse.json({ ok: true, id: rec.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
