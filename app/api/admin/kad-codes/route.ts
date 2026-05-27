import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const UpsertSchema = z.object({
  code: z.string().regex(/^\d{2,10}$/, 'Μόνο αριθμοί 2-10 ψηφία'),
  description: z.string().min(1),
  parentCode: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET(request: Request) {
  await requirePermission('kad.read');
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);

  const where = q
    ? { OR: [
        { code: { contains: q } },
        { description: { contains: q, mode: 'insensitive' as const } },
      ] }
    : {};

  const [codes, total] = await Promise.all([
    prisma.kadCode.findMany({ where, orderBy: { code: 'asc' }, take: limit }),
    prisma.kadCode.count({ where }),
  ]);
  return NextResponse.json({ codes, total });
}

export async function POST(request: Request) {
  await requirePermission('kad.manage');
  const body = await request.json();
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const code = await prisma.kadCode.upsert({
    where: { code: parsed.data.code },
    update: parsed.data,
    create: parsed.data,
  });
  return NextResponse.json({ code });
}
