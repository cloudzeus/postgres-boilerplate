import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const Schema = z.object({
  order: z.array(z.object({ id: z.string().cuid(), order: z.number().int().nonnegative() })),
});

export async function POST(req: Request) {
  await requirePermission('permissions.reorder');
  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  await prisma.$transaction(
    parsed.data.order.map((o) => prisma.permission.update({ where: { id: o.id }, data: { order: o.order } })),
  );
  return NextResponse.json({ ok: true });
}
