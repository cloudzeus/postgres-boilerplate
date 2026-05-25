import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().cuid().nullable().optional(),
});

export async function POST(req: Request) {
  const actor = await requirePermission('media.manage_folders');
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const last = await prisma.mediaFolder.findFirst({
    where: { parentId: parsed.data.parentId ?? null },
    orderBy: { order: 'desc' },
  });
  const folder = await prisma.mediaFolder.create({
    data: {
      name: parsed.data.name.trim(),
      parentId: parsed.data.parentId ?? null,
      order: (last?.order ?? -1) + 1,
      createdById: actor.id,
    },
  });
  return NextResponse.json({ folder }, { status: 201 });
}
