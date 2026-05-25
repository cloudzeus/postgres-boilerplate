import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function GET(req: Request) {
  await requirePermission('system.audit');
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') ?? undefined;
  const resource = url.searchParams.get('resource') ?? undefined;
  const action = url.searchParams.get('action') ?? undefined;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 1000);

  const entries = await prisma.auditLog.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(resource ? { resource } : {}),
      ...(action ? { action } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({ entries });
}
