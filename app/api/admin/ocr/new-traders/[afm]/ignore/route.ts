import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { parseAfmParam } from '@/lib/ocr/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().trim().max(200).nullable().optional() });

// POST — «Αγνόηση» εκδότη: βγαίνει από την ουρά χωρίς να δημιουργηθεί τίποτα στο
// SoftOne (spec 2026-09-11 §2). DELETE αναιρεί.
//
// Το `[afm]` είναι το ΤΡΕΧΟΝ κλειδί της ομάδας — προθεματισμένο (`CY10123456A`) όταν
// έτσι το διάβασε το OCR, γυμνό αλλιώς. ΔΕΝ προσθέτουμε πρόθεμα εδώ: η αγνόηση δεν
// ξαναγράφει τα έγγραφα, οπότε ένα «διορθωμένο» ΑΦΜ δεν θα ταίριαζε ποτέ με την ομάδα.
export async function POST(req: Request, { params }: { params: Promise<{ afm: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const afm = parseAfmParam((await params).afm);
  if (!afm) return NextResponse.json({ error: 'invalid_afm', message: 'Μη έγκυρο ΑΦΜ.' }, { status: 400 });

  const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const reason = parsed.data.reason ?? null;

  await prisma.ignoredIssuer.upsert({
    where: { afm },
    update: { reason, createdById: u.id },
    create: { afm, reason, createdById: u.id },
  });

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.trader.ignore', resource: 'ignored_issuer', resourceId: afm,
    metadata: { reason },
  }).catch(() => null);

  return NextResponse.json({ ok: true, afm, ignored: true, reason });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ afm: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const afm = parseAfmParam((await params).afm);
  if (!afm) return NextResponse.json({ error: 'invalid_afm', message: 'Μη έγκυρο ΑΦΜ.' }, { status: 400 });

  await prisma.ignoredIssuer.delete({ where: { afm } }).catch(() => null);

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.trader.ignore', resource: 'ignored_issuer', resourceId: afm,
    metadata: { undo: true },
  }).catch(() => null);

  return NextResponse.json({ ok: true, afm, ignored: false });
}
