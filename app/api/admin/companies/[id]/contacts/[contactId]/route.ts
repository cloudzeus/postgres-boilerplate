import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const UpdateSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  fullName: z.string().min(1).optional(),
  role: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  fax: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  order: z.coerce.number().int().optional(),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; contactId: string }> },
) {
  await requirePermission('companies.update');
  const { id, contactId } = await ctx.params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const { email, fullName, firstName, lastName, ...rest } = parsed.data;

  const composed = [firstName, lastName].filter(Boolean).join(' ').trim() || fullName;

  const contact = await prisma.$transaction(async (tx) => {
    if (rest.isPrimary) {
      await tx.companyContact.updateMany({
        where: { companyId: id, isPrimary: true, NOT: { id: contactId } },
        data: { isPrimary: false },
      });
    }
    return tx.companyContact.update({
      where: { id: contactId },
      data: {
        ...rest,
        ...(firstName !== undefined ? { firstName: firstName ?? null } : {}),
        ...(lastName !== undefined ? { lastName: lastName ?? null } : {}),
        ...(composed ? { fullName: composed } : {}),
        ...(email !== undefined ? { email: email || null } : {}),
      },
    });
  });
  return NextResponse.json({ contact });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; contactId: string }> }) {
  await requirePermission('companies.update');
  const { contactId } = await ctx.params;
  await prisma.companyContact.delete({ where: { id: contactId } });
  return NextResponse.json({ ok: true });
}
