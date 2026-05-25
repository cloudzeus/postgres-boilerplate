import { headers } from 'next/headers';
import { prisma } from '@/lib/db';

export interface AuditEntry {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry) {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
    userAgent = h.get('user-agent') ?? null;
  } catch {
    /* headers() unavailable outside request scope */
  }
  await prisma.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      userEmail: entry.userEmail ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ? (entry.metadata as never) : undefined,
      ip,
      userAgent,
    },
  });
}
