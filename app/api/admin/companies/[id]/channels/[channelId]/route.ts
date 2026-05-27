import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const UpdateSchema = z.object({
  kind: z.enum(['EMAIL', 'PHONE', 'MOBILE', 'FAX', 'OTHER']).optional(),
  label: z.string().optional().nullable(),
  value: z.string().min(1).optional(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  order: z.coerce.number().int().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; channelId: string }> }) {
  await requirePermission('companies.update');
  const { id, channelId } = await ctx.params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });

  const channel = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary && parsed.data.kind !== undefined) {
      await tx.companyChannel.updateMany({
        where: { companyId: id, kind: parsed.data.kind, isPrimary: true, NOT: { id: channelId } },
        data: { isPrimary: false },
      });
    } else if (parsed.data.isPrimary) {
      const existing = await tx.companyChannel.findUnique({ where: { id: channelId }, select: { kind: true } });
      if (existing) {
        await tx.companyChannel.updateMany({
          where: { companyId: id, kind: existing.kind, isPrimary: true, NOT: { id: channelId } },
          data: { isPrimary: false },
        });
      }
    }
    return tx.companyChannel.update({ where: { id: channelId }, data: parsed.data });
  });
  return NextResponse.json({ channel });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; channelId: string }> }) {
  await requirePermission('companies.update');
  const { channelId } = await ctx.params;
  await prisma.companyChannel.delete({ where: { id: channelId } });
  return NextResponse.json({ ok: true });
}
