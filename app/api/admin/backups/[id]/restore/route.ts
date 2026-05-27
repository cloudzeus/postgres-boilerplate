import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { restoreBackup } from '@/lib/backup';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('system.backups');
  const { id } = await params;
  try {
    await restoreBackup(id);
    await logAudit({ userId: u.id, userEmail: u.email, action: 'backup.restore', resource: 'backup', resourceId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
