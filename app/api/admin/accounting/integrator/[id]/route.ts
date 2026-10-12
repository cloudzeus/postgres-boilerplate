import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';

const Body = z.object({ status: z.enum(['OPEN', 'DONE']) });

// Ο integrator σημειώνει ένα θέμα ως διευθετημένο (ή το ξανανοίγει).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('metadata.manage');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const done = parsed.data.status === 'DONE';
  const item = await prisma.integratorItem.update({
    where: { id },
    data: { status: parsed.data.status, resolvedAt: done ? new Date() : null, resolvedBy: done ? u.email ?? u.id : null },
  }).catch(() => null);
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'accounting.integrator.status', resource: 'integrator_item', resourceId: id, metadata: { status: item.status } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
