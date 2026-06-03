import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const norm = z.number().min(0).max(1);
const Patch = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  regionHint: z.object({ page: z.number().int().min(0), bbox: z.tuple([norm, norm, norm, norm]) }).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  await requirePermission('ocr.categorize');
  const { ruleId } = await params;
  const body = Patch.parse(await req.json());
  // key is immutable (keeps already-stored values linked) — never updated here.
  const rule = await prisma.supplierFieldRule.update({
    where: { id: ruleId },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.regionHint !== undefined ? { regionHint: (body.regionHint ?? null) as any } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });
  return NextResponse.json({ ok: true, rule });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  await requirePermission('ocr.categorize');
  const { ruleId } = await params;
  await prisma.supplierFieldRule.delete({ where: { id: ruleId } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
