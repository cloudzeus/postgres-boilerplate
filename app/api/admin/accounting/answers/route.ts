import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { changeRuleTarget } from '@/lib/accounting/apply-answer';

const Body = z.object({
  key: z.string().min(1).max(300),
  title: z.string().max(300).optional(),
  fingerprint: z.string().min(1).max(100),
  status: z.enum(['ACCEPTED', 'CHANGED', 'NEEDS_ERP']),
  comment: z.string().trim().max(4000).optional(),
  target: z.object({ kind: z.enum(['expense', 'lineitem']), id: z.number().int().positive() }).optional(),
});

// Απάντηση του λογιστή σε ένα ερώτημα (βλ. `lib/accounting/questions.ts`).
//  - ACCEPTED: καταγράφεται.
//  - CHANGED + target: αλλάζει ο στόχος της απόφασης σε όλους τους σχετικούς κανόνες + επανεφαρμογή.
//  - NEEDS_ERP (ή CHANGED χωρίς στόχο): ανοίγει αυτόματα θέμα στην αναφορά του integrator.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', message: 'Λείπουν στοιχεία απάντησης.' }, { status: 400 });
  const { key, title, status, comment, target } = parsed.data;
  let { fingerprint } = parsed.data;

  if ((status === 'NEEDS_ERP' || (status === 'CHANGED' && !target)) && !comment) {
    return NextResponse.json({ error: 'comment_required', message: 'Γράψε τι χρειάζεται να γίνει.' }, { status: 400 });
  }

  let applied: Awaited<ReturnType<typeof changeRuleTarget>> | null = null;
  if (status === 'CHANGED' && target) {
    if (!key.startsWith('rule:')) return NextResponse.json({ error: 'not_changeable', message: 'Εδώ δεν αλλάζει στόχος — περιέγραψε την αλλαγή.' }, { status: 400 });
    try {
      applied = await changeRuleTarget(key.slice(5), target);
    } catch (e) {
      return NextResponse.json({ error: 'apply_failed', message: (e as Error).message }, { status: 409 });
    }
    // Η απάντηση αφορά πλέον τη ΝΕΑ πρόταση, άρα το αποτύπωμα είναι ο νέος στόχος.
    fingerprint = `${target.kind === 'expense' ? 'expn' : 'lin'}:${target.id}`;
  }

  const who = u.email ?? u.id;
  await prisma.accountingAnswer.upsert({
    where: { questionKey: key },
    update: { fingerprint, status, comment: comment ?? null, answeredBy: who, answeredAt: new Date() },
    create: { questionKey: key, fingerprint, status, comment: comment ?? null, answeredBy: who },
  });

  let integratorItem: string | null = null;
  if (status === 'NEEDS_ERP' || (status === 'CHANGED' && !target)) {
    // Ένα ανοιχτό θέμα ανά ερώτημα: νέα απάντηση ενημερώνει το υπάρχον αντί να το διπλασιάζει.
    const existing = await prisma.integratorItem.findFirst({ where: { questionKey: key, status: 'OPEN' } });
    const data = { title: title ? `Λογιστής: ${title}` : `Λογιστής: ${key}`, detail: comment!, createdBy: who };
    integratorItem = existing
      ? (await prisma.integratorItem.update({ where: { id: existing.id }, data })).id
      : (await prisma.integratorItem.create({ data: { ...data, questionKey: key, source: 'accountant', severity: 'mid' } })).id;
  }

  await logAudit({
    userId: u.id, userEmail: u.email, action: 'accounting.answer', resource: 'accounting_question', resourceId: key,
    metadata: { status, comment: comment ?? null, target: target ?? null, rules: applied?.rules ?? null, integratorItem },
  }).catch(() => null);
  return NextResponse.json({ ok: true, applied, integratorItem });
}
