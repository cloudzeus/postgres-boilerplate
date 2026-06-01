import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneCreateSupplier, buildSupplierPayload } from '@/lib/softone';

export const runtime = 'nodejs';

// Creates a new supplier (TRDR SODTYPE=12) in SoftOne from AADE-sourced data,
// mirrors it locally, and (optionally) links the originating OCR document.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const b = await req.json().catch(() => ({}));
  const name = String(b?.name ?? '').trim();
  const afm = String(b?.afm ?? '').trim();
  if (!name || !afm) {
    return NextResponse.json({ error: 'missing_fields', message: 'Επωνυμία και ΑΦΜ είναι υποχρεωτικά.' }, { status: 400 });
  }

  const supInput = {
    name, afm,
    code: b?.code || null,
    doyCode: b?.doyCode || null,
    profession: b?.profession || null,
    address: b?.address || null,
    zip: b?.zip || null,
    city: b?.city || null,
  };

  // Dry-run: return the exact setData object without writing to SoftOne.
  if (b?.dryRun) {
    return NextResponse.json({ dryRun: true, payload: { service: 'setData', ...buildSupplierPayload(supInput) } });
  }

  let trdr: number, code: string;
  try {
    ({ trdr, code } = await softoneCreateSupplier(supInput));
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  // Mirror locally so it's instantly searchable/matchable.
  await prisma.softoneSupplier.upsert({
    where: { trdr },
    update: { code, name, afm, kind: 'Προμηθευτής', isActive: true },
    create: { trdr, code, name, afm, kind: 'Προμηθευτής', isActive: true },
  }).catch(() => null);

  // Link the originating document, if provided.
  if (b?.docId) {
    await prisma.ocrDocument.update({
      where: { id: String(b.docId) },
      data: { softoneTrdr: trdr, softoneCode: code, softoneName: name, softoneKind: 'Προμηθευτής', softoneChecked: new Date() },
    }).catch(() => null);
  }

  await logAuditSafe(u.id, u.email, trdr, code);
  return NextResponse.json({ ok: true, trdr, code, name });
}

async function logAuditSafe(userId: string, email: string, trdr: number, code: string) {
  try {
    const { logAudit } = await import('@/lib/audit');
    await logAudit({ userId, userEmail: email, action: 'ocr.supplier.create_softone', resource: 'softone_supplier', resourceId: String(trdr), metadata: { code } });
  } catch { /* ignore */ }
}
