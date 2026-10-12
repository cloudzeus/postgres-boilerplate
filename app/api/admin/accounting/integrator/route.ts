import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';

const Body = z.object({
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().min(1).max(4000),
  severity: z.enum(['high', 'mid', 'low']).default('mid'),
});

// Χειροκίνητο θέμα για τον integrator (ό,τι δεν προκύπτει από ερώτημα λογιστή).
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', message: 'Δώσε τίτλο και περιγραφή.' }, { status: 400 });
  const item = await prisma.integratorItem.create({ data: { ...parsed.data, source: 'manual', createdBy: u.email ?? u.id } });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'accounting.integrator.create', resource: 'integrator_item', resourceId: item.id, metadata: { title: item.title } }).catch(() => null);
  return NextResponse.json({ ok: true, id: item.id });
}
