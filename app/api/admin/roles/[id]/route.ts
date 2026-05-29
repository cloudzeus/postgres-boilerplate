import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const PatchSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullish(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission('roles.update');
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const role = await prisma.role.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ role });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission('roles.delete');
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (role.isSystem) return NextResponse.json({ error: 'system_role_protected' }, { status: 400 });
  const userCount = await prisma.user.count({ where: { roleId: role.id } });
  if (userCount > 0) return NextResponse.json({ error: 'role_in_use' }, { status: 400 });
  await prisma.role.delete({ where: { id: role.id } });
  return NextResponse.json({ ok: true });
}
