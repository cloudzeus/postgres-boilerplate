import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { deleteBackup } from '@/lib/backup';
import { logAudit } from '@/lib/audit';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('system.backups');
  const { id } = await params;
  await deleteBackup(id);
  await logAudit({ userId: u.id, userEmail: u.email, action: 'backup.delete', resource: 'backup', resourceId: id });
  return NextResponse.json({ ok: true });
}
