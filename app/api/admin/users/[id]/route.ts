import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
  locale: z.string().min(2).max(8).optional(),
  preferredLocales: z.array(z.string().min(2).max(8)).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission('users.update');
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const user = await prisma.user.update({ where: { id }, data: parsed.data });
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'users.update', resource: 'user', resourceId: user.id,
    metadata: { changes: parsed.data },
  });
  return NextResponse.json({ user });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission('users.delete');
  const target = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  await prisma.user.delete({ where: { id } });
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'users.delete', resource: 'user', resourceId: id,
    metadata: { email: target?.email },
  });
  return NextResponse.json({ ok: true });
}
