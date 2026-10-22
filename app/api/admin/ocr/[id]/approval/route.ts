import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { gatherForConversion } from '@/lib/ocr/post-softone';
import { approvalStatusFor, decideApproval, ApprovalError } from '@/lib/ocr/approvals-server';
import { canApproveLevel } from '@/lib/ocr/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function context(id: string) {
  const g = await gatherForConversion(id);
  return { document: g.document, trdr: g.doc.softoneTrdr ?? null, series: g.doc.softoneSeries ?? null, hasWarnings: g.warnings.length > 0 };
}

// GET — ποιες εγκρίσεις χρειάζονται, ποιες δόθηκαν, και τι μπορεί να εγκρίνει ο τρέχων χρήστης.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.read');
  const { id } = await params;
  try {
    const ctx = await context(id);
    const { cfg, status, fingerprint } = await approvalStatusFor(id, ctx.document, ctx.trdr, ctx.series, ctx.hasWarnings);
    const records = await prisma.ocrApproval.findMany({ where: { documentId: id }, orderBy: { createdAt: 'desc' }, take: 30 });
    return NextResponse.json({
      enabled: cfg.enabled, status,
      config: { level1Amount: cfg.level1Amount, level1Roles: cfg.level1Roles, level2Amount: cfg.level2Amount, level2Roles: cfg.level2Roles, whenWarnings: cfg.whenWarnings },
      canApprove: status.required.filter((l) => canApproveLevel(l, u.role.key, cfg)),
      me: u.id,
      records: records.map((r) => ({ ...r, current: r.fingerprint === fingerprint })),
    });
  } catch (e) {
    return NextResponse.json({ error: 'approval', message: (e as Error).message }, { status: 502 });
  }
}

const Body = z.object({ level: z.number().int().min(1).max(2), decision: z.enum(['APPROVED', 'REJECTED']), comment: z.string().max(1000).nullable().optional() });

// POST { level, decision, comment } — έγκριση ή απόρριψη (με σχόλιο) για το τρέχον αποτύπωμα του παραστατικού.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.read');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  try {
    await decideApproval(id, parsed.data, { id: u.id, email: u.email, roleKey: u.role.key ?? null }, await context(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'approval', message: (e as Error).message }, { status: e instanceof ApprovalError ? 422 : 502 });
  }
}
