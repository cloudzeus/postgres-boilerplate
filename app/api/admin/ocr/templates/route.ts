import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SLUG_RE, templateSlug } from '@/lib/templates/schema';
import { LIST_QUERY, freeSlug, toListRow } from '@/lib/templates/list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — λίστα προτύπων
export async function GET() {
  await requirePermission('ocr.read');
  const rows = await prisma.extractionTemplate.findMany(LIST_QUERY);
  return NextResponse.json({ templates: rows.map(toListRow) });
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  // SLUG_RE is lowercase-only and the server-generated slug is lowercase by construction (slugKey()).
  // A client-supplied slug is taken verbatim, so the Task-7 dialog must lowercase what the user types —
  // the server contract is a 400, not a silent fix.
  slug: z.string().trim().regex(SLUG_RE, 'Slug: μόνο a-z, 0-9, _').optional(),
  department: z.string().trim().max(80).transform((v) => v || null).nullable().optional(),
  vatNumber: z.string().trim().regex(/^\d{9}$/, 'ΑΦΜ 9 ψηφίων').nullable().optional(),
  traderTrdr: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().max(200).transform((v) => v || null).nullable().optional(),
});

// POST — νέο πρότυπο (DRAFT). Μόνο το όνομα είναι υποχρεωτικό (spec §14.1).
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  // freeSlug() appends `_N`, so leave room inside SLUG_RE's 60 chars for the suffix.
  const autoBase = () => templateSlug(b.name).slice(0, 57);

  let slug: string;
  if (b.slug) {
    if (await prisma.extractionTemplate.findUnique({ where: { slug: b.slug }, select: { id: true } })) {
      return NextResponse.json({ error: 'duplicate_slug', message: 'Υπάρχει ήδη πρότυπο με αυτό το slug' }, { status: 409 });
    }
    slug = b.slug;
  } else slug = await freeSlug(autoBase());

  const create = (s: string) => prisma.extractionTemplate.create({
    data: { name: b.name, slug: s, department: b.department ?? null, vatNumber: b.vatNumber ?? null, traderTrdr: b.traderTrdr ?? null, supplierName: b.supplierName ?? null, createdById: u.id },
  });
  const isDuplicate = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  const duplicate = () => NextResponse.json({ error: 'duplicate_slug', message: 'Υπάρχει ήδη πρότυπο με αυτό το slug' }, { status: 409 });

  let t;
  try {
    t = await create(slug);
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    // Two concurrent creates can race freeSlug(); the unique index is the arbiter. The client picked no
    // slug, so a 409 would be meaningless to it — recompute once and retry before giving up.
    if (b.slug) return duplicate();
    try {
      t = await create(await freeSlug(autoBase()));
    } catch (retryErr) {
      if (isDuplicate(retryErr)) return duplicate();
      throw retryErr;
    }
  }
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.create', resource: 'extractionTemplate', resourceId: t.id, metadata: { name: t.name, slug: t.slug } });
  return NextResponse.json({ ok: true, id: t.id, slug: t.slug }, { status: 201 });
}
