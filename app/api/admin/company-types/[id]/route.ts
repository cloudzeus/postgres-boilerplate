import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  pluralName: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  order: z.coerce.number().int().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.manage_types');
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const type = await prisma.companyType.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ type });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.manage_types');
  const { id } = await ctx.params;
  const existing = await prisma.companyType.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (existing.isSystem) return NextResponse.json({ error: 'system_type_protected' }, { status: 400 });
  await prisma.companyType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
