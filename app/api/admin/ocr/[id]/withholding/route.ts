import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { analyzeWithholding, isServiceInvoice, withholdingNote } from '@/lib/ocr/withholding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — η παρακράτηση όπως τη βλέπει ο έλεγχος (ποσό, ποσοστό, παρατηρήσεις) και αν έχει επιβεβαιωθεί.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { softoneSeries: true } });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const document = await loadDocumentJson(id);
  const a = analyzeWithholding(document, { isServiceInvoice: isServiceInvoice(document) });
  return NextResponse.json({
    ...a, net: document.totals.net, total: document.totals.total, payable: document.totals.payable,
    acknowledged: (document.custom as Record<string, unknown> | undefined)?.withholdingAck === true,
    note: withholdingNote(a),
  });
}

const Body = z.object({ ack: z.boolean() });

// POST { ack } — «θα την καταχωρίσει ο λογιστής»: η καταχώριση προχωρά και το σχόλιο το γράφει.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const meta = await prisma.ocrDocument.findUnique({ where: { id }, select: { postStatus: true } });
  if (!meta) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (meta.postStatus === 'POSTED') return NextResponse.json({ error: 'posted', message: 'Έχει ήδη καταχωριστεί.' }, { status: 409 });
  const document = await loadDocumentJson(id);
  await saveDocumentJson(id, { ...document, custom: { ...(document.custom ?? {}), withholdingAck: parsed.data.ack } }, { replaceItems: false });
  const a = analyzeWithholding(document);
  await logAudit({
    userId: u.id, userEmail: u.email, action: 'ocr.withholding.ack', resource: 'ocr_document', resourceId: id,
    metadata: { summary: parsed.data.ack ? `Παρακράτηση ${a.amount ?? '—'} € θα περαστεί από τον λογιστή` : 'Αναιρέθηκε η επιβεβαίωση παρακράτησης', ack: parsed.data.ack, amount: a.amount, rate: a.rate },
  }).catch(() => null);
  return NextResponse.json({ ok: true });
}
