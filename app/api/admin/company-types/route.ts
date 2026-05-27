import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const CreateSchema = z.object({
  key: z.string().min(2).regex(/^[A-Z0-9_]+$/, 'Μόνο κεφαλαία, αριθμοί, underscore'),
  name: z.string().min(1),
  pluralName: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  order: z.coerce.number().int().optional(),
});

export async function GET() {
  await requirePermission('companies.read');
  const types = await prisma.companyType.findMany({
    orderBy: { order: 'asc' },
    include: { _count: { select: { companies: true } } },
  });
  return NextResponse.json({ types });
}

export async function POST(request: Request) {
  await requirePermission('companies.manage_types');
  const body = await request.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const exists = await prisma.companyType.findUnique({ where: { key: parsed.data.key } });
  if (exists) return NextResponse.json({ error: 'exists' }, { status: 409 });
  const type = await prisma.companyType.create({ data: { ...parsed.data, isSystem: false } });
  return NextResponse.json({ type }, { status: 201 });
}
