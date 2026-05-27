import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const ChannelSchema = z.object({
  kind: z.enum(['EMAIL', 'PHONE', 'MOBILE', 'FAX', 'OTHER']),
  label: z.string().optional().nullable(),
  value: z.string().min(1),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  order: z.coerce.number().int().optional(),
}).refine((v) => v.kind !== 'EMAIL' || /^\S+@\S+\.\S+$/.test(v.value), {
  message: 'Μη έγκυρο email', path: ['value'],
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.read');
  const { id } = await ctx.params;
  const channels = await prisma.companyChannel.findMany({
    where: { companyId: id },
    orderBy: [{ kind: 'asc' }, { isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ channels });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = ChannelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const channel = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.companyChannel.updateMany({
        where: { companyId: id, kind: parsed.data.kind, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.companyChannel.create({ data: { ...parsed.data, companyId: id } });
  });
  return NextResponse.json({ channel }, { status: 201 });
}
