import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeAfm } from '@/lib/ocr/validate';
import { applyTraderToDocs, TRADER_KIND_LABEL } from '@/lib/ocr/queues';
import {
  buildTraderPayload, softoneCreateSupplier, softoneCreateCreditor, TRADER_KIND_SODTYPE,
} from '@/lib/softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  kind: z.enum(['supplier', 'creditor']),
  name: z.string().trim().min(1, 'Η επωνυμία είναι υποχρεωτική').max(200),
  code: z.string().trim().max(30).nullable().optional(),
  doyCode: z.string().trim().max(20).nullable().optional(),
  profession: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  zip: z.string().trim().max(20).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  dryRun: z.boolean().optional(),
});

// POST — δημιουργεί προμηθευτή (SODTYPE 12) ή πιστωτή (16) στο SoftOne για τον
// εκδότη του ΑΦΜ, τον καθρεφτίζει τοπικά και τον γράφει σε ΟΛΑ τα έγγραφα του
// ΑΦΜ (spec 2026-09-11 §2). `dryRun` επιστρέφει μόνο το setData payload.
export async function POST(req: Request, { params }: { params: Promise<{ afm: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const afm = normalizeAfm((await params).afm);
  if (!afm) return NextResponse.json({ error: 'invalid_afm', message: 'Μη έγκυρο ΑΦΜ.' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  const input = {
    name: b.name,
    afm,
    code: b.code ?? null,
    doyCode: b.doyCode ?? null,
    profession: b.profession ?? null,
    address: b.address ?? null,
    zip: b.zip ?? null,
    city: b.city ?? null,
  };

  // Dry-run: το ακριβές setData χωρίς καμία εγγραφή στο SoftOne.
  if (b.dryRun) {
    return NextResponse.json({ dryRun: true, payload: { service: 'setData', ...buildTraderPayload(b.kind, input) } });
  }

  let trdr: number;
  let code: string;
  try {
    ({ trdr, code } = b.kind === 'creditor'
      ? await softoneCreateCreditor(input)
      : await softoneCreateSupplier(input));
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  const kind = TRADER_KIND_LABEL[b.kind];
  const sodtype = TRADER_KIND_SODTYPE[b.kind];
  // Καθρέφτης: ο νέος συναλλασσόμενος γίνεται αμέσως αναζητήσιμος/αντιστοιχίσιμος.
  // Τα τηλέφωνο/email δεν μπαίνουν στο setData (δεν τα γράφει ο payload builder) — μένουν τοπικά.
  const mirror = {
    code, name: b.name, afm, sodtype, kind, isActive: true,
    doy: b.doyCode ?? null, profession: b.profession ?? null,
    address: b.address ?? null, zip: b.zip ?? null, city: b.city ?? null,
    phone: b.phone ?? null, email: b.email ?? null,
  };
  await prisma.softoneTrader.upsert({ where: { trdr }, update: mirror, create: { trdr, ...mirror } }).catch(() => null);

  const docsUpdated = await applyTraderToDocs(afm, { trdr, code, name: b.name, kind });

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.trader.create', resource: 'softone_trader', resourceId: String(trdr),
    metadata: { afm, kind: b.kind, code, name: b.name, docsUpdated },
  }).catch(() => null);

  return NextResponse.json({ ok: true, trdr, code, name: b.name, kind, docsUpdated });
}
