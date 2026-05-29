import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

const Body = z.object({ roleId: z.string().cuid() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission('users.assign_role');
  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const role = await prisma.role.findUnique({ where: { id: parsed.data.roleId } });
  if (!role) return NextResponse.json({ error: 'role_not_found' }, { status: 404 });
  const user = await prisma.user.update({ where: { id }, data: { roleId: role.id } });
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'users.assign_role', resource: 'user', resourceId: user.id,
    metadata: { roleId: role.id, roleName: role.name },
  });
  return NextResponse.json({ user });
}
