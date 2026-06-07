// app/api/admin/programs/[id]/required-fields/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ItemSchema = z.object({
  templateId: z.string().min(1),
  fieldKey: z.string().min(1),
  yearsBack: z.number().int().min(1).default(1),
  mandatory: z.boolean().default(true),
});

const PutSchema = z.array(ItemSchema);

// GET /api/admin/programs/[id]/required-fields
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id: programId } = await params;

  const fields = await prisma.programRequiredField.findMany({
    where: { programId },
    include: { template: true },
    orderBy: { order: 'asc' },
  });
  return NextResponse.json(fields);
}

// PUT /api/admin/programs/[id]/required-fields — replace-all
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id: programId } = await params;

  const body = PutSchema.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    await tx.programRequiredField.deleteMany({ where: { programId } });
    for (let i = 0; i < body.length; i++) {
      const item = body[i];
      await tx.programRequiredField.create({
        data: {
          programId,
          templateId: item.templateId,
          fieldKey: item.fieldKey,
          yearsBack: item.yearsBack,
          mandatory: item.mandatory,
          order: i,
        },
      });
    }
  }, { timeout: 60_000, maxWait: 10_000 });

  const fresh = await prisma.programRequiredField.findMany({
    where: { programId },
    include: { template: true },
    orderBy: { order: 'asc' },
  });
  return NextResponse.json(fresh);
}
