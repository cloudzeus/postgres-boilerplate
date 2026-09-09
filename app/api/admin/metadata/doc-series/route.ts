import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

const Body = z.object({
  source: z.enum(['series', 'purchase']),
  id: z.number().int().positive(),
  enabled: z.boolean(),
});

// PATCH — flips the manual on/off flag («τη χρησιμοποιούμε») of one series.
// The flag is never touched by the SoftOne sync.
export async function PATCH(req: Request) {
  const u = await requirePermission('metadata.manage');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { source, id, enabled } = parsed.data;

  const row = source === 'purchase'
    ? await prisma.purchaseDocType.update({ where: { id }, data: { enabled }, select: { id: true, code: true, name: true } })
    : await prisma.softoneDocSeries.update({ where: { id }, data: { enabled }, select: { id: true, code: true, name: true } });

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: enabled ? 'metadata.docseries.enable' : 'metadata.docseries.disable',
    resource: source === 'purchase' ? 'purchaseDocType' : 'softoneDocSeries',
    resourceId: String(row.id),
    metadata: { code: row.code, name: row.name },
  });

  return NextResponse.json({ ok: true, id: row.id, enabled });
}
