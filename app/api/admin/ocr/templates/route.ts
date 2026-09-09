import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — λίστα προτύπων (για τη σελίδα /admin/ocr/templates)
export async function GET() {
  await requirePermission('ocr.read');
  const rows = await prisma.extractionTemplate.findMany({
    orderBy: [{ supplierName: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { fields: true, runs: true } } },
  });
  return NextResponse.json({
    templates: rows.map((t) => ({
      id: t.id, name: t.name, vatNumber: t.vatNumber, supplierName: t.supplierName, docType: t.docType,
      mode: t.mode, status: t.status, version: t.version, fieldsCount: t._count.fields, runsCount: t._count.runs,
      timesUsed: t.timesUsed, hasSample: !!t.sampleStorageKey, updatedAt: t.updatedAt,
    })),
  });
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  vatNumber: z.string().trim().regex(/^\d{9}$/, 'ΑΦΜ 9 ψηφίων'),
  traderTrdr: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
  docType: z.enum(['INVOICE', 'RECEIPT']).default('INVOICE'),
});

// POST — νέο πρότυπο (DRAFT)
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const exists = await prisma.extractionTemplate.findUnique({ where: { vatNumber_docType_name: { vatNumber: b.vatNumber, docType: b.docType, name: b.name } } });
  if (exists) return NextResponse.json({ error: 'duplicate', message: 'Υπάρχει ήδη πρότυπο με αυτό το όνομα για τον προμηθευτή' }, { status: 409 });

  const t = await prisma.extractionTemplate.create({
    data: { name: b.name, vatNumber: b.vatNumber, traderTrdr: b.traderTrdr ?? null, supplierName: b.supplierName ?? null, docType: b.docType, createdById: u.id },
  });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.create', resource: 'extractionTemplate', resourceId: t.id, metadata: { name: t.name, vatNumber: t.vatNumber } });
  return NextResponse.json({ ok: true, id: t.id }, { status: 201 });
}
