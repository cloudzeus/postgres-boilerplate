import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { POST_OBJECTS, POST_LINE_TABLES } from '@/lib/ocr/posting-target';

const Body = z.object({
  source: z.enum(['series', 'purchase']),
  id: z.number().int().positive(),
  enabled: z.boolean().optional(),
  // Στόχος καταχώρισης. `null` = «η προεπιλογή της ενότητας» (βλ. lib/ocr/posting-target.ts).
  postObject: z.enum(POST_OBJECTS).nullable().optional(),
  postLines: z.enum(POST_LINE_TABLES).nullable().optional(),
});

// PATCH — αλλάζει τον χειροκίνητο διακόπτη («τη χρησιμοποιούμε») ή/και τον ΣΤΟΧΟ ΚΑΤΑΧΩΡΙΣΗΣ
// μιας σειράς. Κανένα από τα δύο δεν το αγγίζει ποτέ ο συγχρονισμός από το SoftOne.
export async function PATCH(req: Request) {
  const u = await requirePermission('metadata.manage');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { source, id, enabled, postObject, postLines } = parsed.data;
  if (enabled === undefined && postObject === undefined && postLines === undefined) {
    return NextResponse.json({ error: 'nothing_to_change' }, { status: 400 });
  }

  const data = {
    ...(enabled === undefined ? {} : { enabled }),
    ...(postObject === undefined ? {} : { postObject }),
    ...(postLines === undefined ? {} : { postLines }),
  };
  const select = { id: true, code: true, name: true, postObject: true, postLines: true } as const;
  const row = source === 'purchase'
    ? await prisma.purchaseDocType.update({ where: { id }, data, select })
    : await prisma.softoneDocSeries.update({ where: { id }, data, select });

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: enabled === undefined
      ? 'metadata.docseries.post_target'
      : enabled ? 'metadata.docseries.enable' : 'metadata.docseries.disable',
    resource: source === 'purchase' ? 'purchaseDocType' : 'softoneDocSeries',
    resourceId: String(row.id),
    metadata: { code: row.code, name: row.name, postObject: row.postObject, postLines: row.postLines },
  });

  return NextResponse.json({ ok: true, id: row.id, enabled, postObject: row.postObject, postLines: row.postLines });
}
