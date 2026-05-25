import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const Schema = z.object({ permissionIds: z.array(z.string().cuid()) });

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  await requirePermission('permissions.assign');
  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: params.id } });
    if (parsed.data.permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: parsed.data.permissionIds.map((permissionId) => ({ roleId: params.id, permissionId })),
        skipDuplicates: true,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
