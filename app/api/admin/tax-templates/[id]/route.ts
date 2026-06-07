import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  year: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'READY']).optional(),
});

// GET /api/admin/tax-templates/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;

  const template = await prisma.taxFormTemplate.findUnique({
    where: { id },
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  if (!template) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(template);
}

// PATCH /api/admin/tax-templates/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;
  const body = PatchSchema.parse(await req.json());

  const template = await prisma.taxFormTemplate.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.year !== undefined ? { year: body.year } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    },
  });
  return NextResponse.json(template);
}

// DELETE /api/admin/tax-templates/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;
  await prisma.taxFormTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
