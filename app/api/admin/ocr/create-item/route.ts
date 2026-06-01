import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneCreateItem, buildItemPayload } from '@/lib/softone';

export const runtime = 'nodejs';

// Creates a new item/service in SoftOne, mirrors it locally, and (optionally)
// links the originating invoice line to it.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const b = await req.json().catch(() => ({}));
  const code = String(b?.code ?? '').trim();
  const name = String(b?.name ?? '').trim();
  const vat = String(b?.vat ?? '').trim();
  const unit = String(b?.unit ?? '').trim();
  if (!code || !name || !vat || !unit) {
    return NextResponse.json({ error: 'missing_fields', message: 'Κωδικός, περιγραφή, ΦΠΑ και μονάδα είναι υποχρεωτικά.' }, { status: 400 });
  }

  const itemInput = {
    code, name, isService: !!b?.isService, vat, unit,
    price: b?.price != null ? Number(b.price) : null,
    group: b?.group || null, category: b?.category || null,
    manufacturer: b?.manufacturer || null, brand: b?.brand || null,
  };

  // Dry-run: return the exact setData object without writing to SoftOne.
  if (b?.dryRun) {
    return NextResponse.json({ dryRun: true, payload: { service: 'setData', ...buildItemPayload(itemInput) } });
  }

  let mtrl: number;
  try {
    mtrl = await softoneCreateItem(itemInput);
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  // Mirror locally so it's instantly searchable/matchable.
  await prisma.softoneItem.upsert({
    where: { mtrl },
    update: { code, name, isService: !!b?.isService, isActive: true },
    create: { mtrl, code, name, isService: !!b?.isService, isActive: true },
  }).catch(() => null);

  // Link the originating line, if provided.
  if (b?.lineId) {
    await prisma.ocrInvoiceItem.update({
      where: { id: String(b.lineId) },
      data: { softoneMtrl: mtrl, softoneCode: code, softoneName: name, softoneIsService: !!b?.isService, softoneMatchedBy: 'manual' },
    }).catch(() => null);
  }

  await logAuditSafe(u.id, u.email, mtrl, code);
  return NextResponse.json({ ok: true, mtrl, code, name });
}

async function logAuditSafe(userId: string, email: string, mtrl: number, code: string) {
  try {
    const { logAudit } = await import('@/lib/audit');
    await logAudit({ userId, userEmail: email, action: 'ocr.item.create_softone', resource: 'softone_item', resourceId: String(mtrl), metadata: { code } });
  } catch { /* ignore */ }
}
