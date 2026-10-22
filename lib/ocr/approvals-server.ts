// SERVER: εγκρίσεις καταχώρισης — ρυθμίσεις, κατάσταση, απόφαση. Βλ. `lib/ocr/approvals.ts`.
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getSetting } from '@/lib/settings';
import type { DocumentJson } from '@/lib/ocr/canonical';
import {
  approvalFingerprint, approvalStatus, canApproveLevel, parseRoles, requiredLevels,
  type ApprovalConfig, type ApprovalStatus,
} from '@/lib/ocr/approvals';

export class ApprovalError extends Error {}

export async function loadApprovalConfig(): Promise<ApprovalConfig> {
  const [enabled, a1, r1, a2, r2, ww] = await Promise.all([
    getSetting<boolean>('approvals.enabled'), getSetting<number>('approvals.level1Amount'), getSetting<string>('approvals.level1Roles'),
    getSetting<number>('approvals.level2Amount'), getSetting<string>('approvals.level2Roles'), getSetting<boolean>('approvals.whenWarnings'),
  ]);
  return {
    enabled: enabled === true,
    level1Amount: Number(a1 ?? 1000) || 0,
    level1Roles: parseRoles(r1 ?? 'ADMIN'),
    level2Amount: Number(a2 ?? 10000) || 0,
    level2Roles: parseRoles(r2 ?? 'SUPER_ADMIN'),
    whenWarnings: ww === true,
  };
}

export function fingerprintOf(document: DocumentJson, trdr: number | null, series: string | null): string {
  return approvalFingerprint({
    total: document.totals?.total ?? null, net: document.totals?.net ?? null, vat: document.totals?.vatAmount ?? null,
    trdr, series, number: document.type?.number ?? null, date: document.date ?? null,
    lines: document.lines.map((l) => ({ net: l.net ?? null })),
  });
}

/** Η κατάσταση εγκρίσεων ενός παραστατικού (για την καταχώριση και για το παράθυρο). */
export async function approvalStatusFor(docId: string, document: DocumentJson, trdr: number | null, series: string | null, hasWarnings: boolean, cfg?: ApprovalConfig)
  : Promise<{ cfg: ApprovalConfig; status: ApprovalStatus; fingerprint: string }> {
  const config = cfg ?? await loadApprovalConfig();
  const fingerprint = fingerprintOf(document, trdr, series);
  const { levels, reason } = requiredLevels(document.totals?.total ?? null, config, hasWarnings);
  if (!levels.length) return { cfg: config, status: { required: [], reason: null, approved: [], missing: [], rejected: null, satisfied: true }, fingerprint };
  const records = await prisma.ocrApproval.findMany({ where: { documentId: docId }, orderBy: { createdAt: 'asc' } });
  return { cfg: config, status: approvalStatus(levels, reason, records, fingerprint), fingerprint };
}

export async function decideApproval(
  docId: string,
  input: { level: number; decision: 'APPROVED' | 'REJECTED'; comment?: string | null },
  user: { id: string; email: string; roleKey: string | null },
  ctx: { document: DocumentJson; trdr: number | null; series: string | null; hasWarnings: boolean },
) {
  const meta = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { postStatus: true } });
  if (!meta) throw new ApprovalError('Το παραστατικό δεν βρέθηκε.');
  if (meta.postStatus === 'POSTED') throw new ApprovalError('Έχει ήδη καταχωριστεί.');
  const { cfg, status, fingerprint } = await approvalStatusFor(docId, ctx.document, ctx.trdr, ctx.series, ctx.hasWarnings);
  if (!status.required.includes(input.level)) throw new ApprovalError('Αυτό το επίπεδο έγκρισης δεν χρειάζεται για το παραστατικό.');
  if (!canApproveLevel(input.level, user.roleKey, cfg)) throw new ApprovalError(`Ο ρόλος σου δεν εγκρίνει επίπεδο ${input.level}.`);
  if (input.decision === 'REJECTED' && !String(input.comment ?? '').trim()) throw new ApprovalError('Γράψε γιατί απορρίπτεις — ο καταχωριστής πρέπει να ξέρει τι να διορθώσει.');
  if (input.level === 2 && input.decision === 'APPROVED') {
    const l1 = await prisma.ocrApproval.findFirst({ where: { documentId: docId, level: 1, fingerprint, decision: 'APPROVED' }, orderBy: { createdAt: 'desc' } });
    if (l1?.userId === user.id) throw new ApprovalError('Η δεύτερη έγκριση πρέπει να δοθεί από άλλον χρήστη (τέσσερα μάτια).');
  }
  await prisma.ocrApproval.create({
    data: { documentId: docId, level: input.level, decision: input.decision, userId: user.id, userEmail: user.email, roleKey: user.roleKey, comment: input.comment?.trim() || null, fingerprint },
  });
  await logAudit({
    userId: user.id, userEmail: user.email, action: input.decision === 'APPROVED' ? 'ocr.approval.approve' : 'ocr.approval.reject', resource: 'ocr_document', resourceId: docId,
    metadata: { summary: `${input.decision === 'APPROVED' ? 'Έγκριση' : 'Απόρριψη'} επιπέδου ${input.level}${input.comment ? `: ${input.comment}` : ''}`, level: input.level, fingerprint },
  }).catch(() => null);
}
