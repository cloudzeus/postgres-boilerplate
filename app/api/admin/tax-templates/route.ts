import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  year: z.number().int().nullable().optional(),
});

// GET /api/admin/tax-templates — list all
export async function GET() {
  await requirePermission('ocr.read');
  const templates = await prisma.taxFormTemplate.findMany({
    orderBy: [{ code: 'asc' }, { year: 'desc' }],
    include: { _count: { select: { fields: true } } },
  });
  return NextResponse.json({ data: templates });
}

// POST /api/admin/tax-templates — create
export async function POST(req: Request) {
  const user = await requirePermission('ocr.create');
  const body = CreateSchema.parse(await req.json());

  const template = await prisma.taxFormTemplate.create({
    data: {
      code: body.code,
      name: body.name,
      year: body.year ?? null,
      createdById: user.id,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
