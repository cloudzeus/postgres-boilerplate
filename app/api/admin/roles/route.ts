import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const CreateSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
});

export async function GET() {
  await requirePermission('roles.read');
  const roles = await prisma.role.findMany({ orderBy: { order: 'asc' } });
  return NextResponse.json({ roles });
}

export async function POST(req: Request) {
  await requirePermission('roles.create');
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const last = await prisma.role.findFirst({ orderBy: { order: 'desc' } });
  const role = await prisma.role.create({
    data: { ...parsed.data, order: (last?.order ?? -1) + 1, isSystem: false },
  });
  return NextResponse.json({ role }, { status: 201 });
}
