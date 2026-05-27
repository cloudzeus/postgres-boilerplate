import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.read');
  const { id } = await ctx.params;
  const documents = await prisma.companyDocument.findMany({
    where: { companyId: id },
    orderBy: [{ dateRegistrated: 'desc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json({ documents });
}
