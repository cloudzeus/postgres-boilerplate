import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

const ContactSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  fullName: z.string().min(1).optional(),                  // αυτο-συντάσσεται αν λείπει
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

function deriveFullName(first?: string | null, last?: string | null, fallback?: string | null) {
  const composed = [first, last].filter(Boolean).join(' ').trim();
  return composed || fallback || '';
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.read');
  const { id } = await ctx.params;
  const contacts = await prisma.companyContact.findMany({
    where: { companyId: id },
    orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ contacts });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  const { email, fullName, firstName, lastName, ...rest } = parsed.data;
  const fn = deriveFullName(firstName, lastName, fullName);
  if (!fn.trim()) return NextResponse.json({ error: 'missing_name' }, { status: 400 });

  const contact = await prisma.$transaction(async (tx) => {
    if (rest.isPrimary) {
      await tx.companyContact.updateMany({ where: { companyId: id, isPrimary: true }, data: { isPrimary: false } });
    }
    return tx.companyContact.create({
      data: {
        ...rest,
        firstName: firstName ?? null, lastName: lastName ?? null,
        fullName: fn,
        email: email || null,
        companyId: id,
      },
    });
  });
  return NextResponse.json({ contact }, { status: 201 });
}
