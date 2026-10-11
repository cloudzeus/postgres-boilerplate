import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { createGlAccount, GlAccountError, planGlAccount } from '@/lib/softone-sync/gl-account-create';

const Body = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  vatRate: z.number().min(0).max(100).nullable(),
  dryRun: z.boolean().optional(),
});

// Άνοιγμα λογαριασμού γενικής στο SoftOne (object ACNTGL, μία εγγραφή) — βλ. `gl-account-create.ts`.
// `dryRun` επιστρέφει ΑΚΡΙΒΩΣ ό,τι θα σταλεί, χωρίς καμία εγγραφή.
export async function POST(req: Request) {
  const u = await requirePermission('metadata.manage');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', message: 'Δώσε κωδικό, περιγραφή και ΦΠΑ.' }, { status: 400 });
  const { dryRun, ...input } = parsed.data;
  try {
    if (dryRun) return NextResponse.json({ dryRun: true, ...(await planGlAccount(input)) });
    const r = await createGlAccount(input);
    await logAudit({
      userId: u.id, userEmail: u.email, action: 'softone.account.create', resource: 'softone_account', resourceId: String(r.acnt),
      metadata: { code: r.code, name: r.name, template: r.template.code, vat: r.vat, vatAccount: r.vatAccount?.code ?? null },
    }).catch(() => null);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof GlAccountError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
