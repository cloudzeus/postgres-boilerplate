import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { SoftoneOutboxStatus } from '@prisma/client';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { sendItem } from '@/lib/softone-sync/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Οι δύο ανθρώπινες αποφάσεις πάνω σε μια εργασία που «ίσως εκτελέστηκε»:
 *
 * `retry`  — «την έψαξα στο SoftOne, ΔΕΝ υπάρχει, ξαναστείλ' την». Μόνο ο χρήστης μπορεί να το
 *            πει αυτό· η εφαρμογή δεν έχει τρόπο να το ξέρει, και μια λάθος επανάληψη γεννά
 *            διπλή εγγραφή στο ERP.
 * `cancel` — «την έκανα αλλιώς / δεν τη θέλω».
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('metadata.manage');
  const { id } = await params;
  const action = (await req.json().catch(() => ({})) as { action?: unknown }).action;

  const item = await prisma.softoneOutbox.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (action === 'cancel') {
    if (item.status === SoftoneOutboxStatus.SENT) {
      return NextResponse.json(
        { error: 'already_sent', message: 'Η εργασία έχει ήδη σταλεί — η ακύρωση εδώ δεν αναιρεί τίποτα στο SoftOne.' },
        { status: 409 },
      );
    }
    await prisma.softoneOutbox.update({ where: { id }, data: { status: SoftoneOutboxStatus.CANCELLED } });
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'softone.outbox.cancel', resource: 'softone_outbox', resourceId: id,
      metadata: { kind: item.kind, label: item.label, from: item.status },
    }).catch(() => null);
    return NextResponse.json({ ok: true, status: 'CANCELLED' });
  }

  if (action === 'retry') {
    if (item.status === SoftoneOutboxStatus.SENT) {
      return NextResponse.json(
        { error: 'already_sent', message: 'Η εργασία έχει ήδη ολοκληρωθεί.' },
        { status: 409 },
      );
    }
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'softone.outbox.retry', resource: 'softone_outbox', resourceId: id,
      // Η ΡΗΤΗ βεβαίωση του χρήστη ότι έλεγξε το ERP καταγράφεται: αν προκύψει διπλοεγγραφή,
      // φαίνεται ποιος αποφάσισε την επανάληψη και πότε.
      metadata: { kind: item.kind, label: item.label, from: item.status, confirmedAbsentInErp: true },
    }).catch(() => null);
    const outcome = await sendItem({ ...item, status: SoftoneOutboxStatus.PENDING });
    return NextResponse.json(outcome);
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}
