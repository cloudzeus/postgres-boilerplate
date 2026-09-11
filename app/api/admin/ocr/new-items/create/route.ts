import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyMatchToGroup, QueueError } from '@/lib/ocr/queues';
import {
  buildItemPayload, softoneCreateItem,
  buildExpensePayload, softoneCreateExpense, softoneLoadExpenseTemplate,
} from '@/lib/softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  afm: z.string().trim().max(20).default(''),
  pattern: z.string().trim().min(1).max(200),
  kind: z.enum(['product', 'service', 'expense']),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  vat: z.string().trim().max(20).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  price: z.number().nullable().optional(),
  /** Προαιρετικό «πρότυπο» έξοδο από το οποίο αντιγράφονται τα required flags. */
  templateExpn: z.number().int().positive().nullable().optional(),
  dryRun: z.boolean().optional(),
});

// POST — δημιουργεί νέο είδος/υπηρεσία (ITEM → MTRL) ή έξοδο (EXPENSES → EXPN)
// στο SoftOne, το καθρεφτίζει τοπικά και το αντιστοιχίζει σε όλη την ομάδα
// γραμμών (spec 2026-09-11 §3). `dryRun` επιστρέφει μόνο το setData payload.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const isService = b.kind === 'service';

  // ── Έξοδο (EXPN) ────────────────────────────────────────────────────
  if (b.kind === 'expense') {
    if (b.dryRun) {
      // Read-before-write: τα required flags έρχονται από υπάρχον έξοδο (spec §6).
      let flags: Record<string, unknown>;
      let templateExpn: number | null;
      try {
        ({ flags, expn: templateExpn } = await softoneLoadExpenseTemplate(b.templateExpn ?? null));
      } catch (e) {
        return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
      }
      const payload = buildExpensePayload({ code: b.code, name: b.name, vat: b.vat ?? null }, flags);
      return NextResponse.json({ dryRun: true, templateExpn, payload: { service: 'setData', ...payload } });
    }

    let created: { expn: number; code: string; name: string; templateExpn: number | null };
    try {
      created = await softoneCreateExpense({
        code: b.code, name: b.name, vat: b.vat ?? null, templateExpn: b.templateExpn ?? null,
      });
    } catch (e) {
      return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
    }

    const mirror = { code: created.code, name: created.name, vat: b.vat ?? null, isActive: true, syncedAt: new Date() };
    await prisma.softoneExpense.upsert({
      where: { expn: created.expn }, update: mirror, create: { expn: created.expn, ...mirror },
    }).catch(() => null);

    return finish(b, u, { expn: created.expn, code: created.code, name: created.name, kind: 'expense', isService: false });
  }

  // ── Είδος / υπηρεσία (MTRL) ─────────────────────────────────────────
  const vat = b.vat ?? '';
  const unit = b.unit ?? '';
  if (!vat || !unit) {
    return NextResponse.json(
      { error: 'missing_fields', message: 'ΦΠΑ και μονάδα είναι υποχρεωτικά για είδος/υπηρεσία.' },
      { status: 400 },
    );
  }
  const itemInput = { code: b.code, name: b.name, isService, vat, unit, price: b.price ?? null };

  if (b.dryRun) {
    return NextResponse.json({ dryRun: true, payload: { service: 'setData', ...buildItemPayload(itemInput) } });
  }

  let mtrl: number;
  try {
    mtrl = await softoneCreateItem(itemInput);
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  await prisma.softoneItem.upsert({
    where: { mtrl },
    update: { code: b.code, name: b.name, isService, isActive: true },
    create: { mtrl, code: b.code, name: b.name, isService, isActive: true },
  }).catch(() => null);

  return finish(b, u, { mtrl, code: b.code, name: b.name, kind: b.kind, isService });
}

/** Μετά τη δημιουργία: αντιστοίχιση όλης της ομάδας + μνήμη + audit. */
async function finish(
  b: z.infer<typeof Body>,
  u: { id: string; email: string },
  created: { mtrl?: number; expn?: number; code: string; name: string; kind: string; isService: boolean },
) {
  let linesUpdated = 0;
  try {
    const r = await applyMatchToGroup({
      afm: b.afm, pattern: b.pattern,
      target: { mtrl: created.mtrl ?? null, expn: created.expn ?? null },
      isService: created.isService, userId: u.id,
    });
    linesUpdated = r.linesUpdated;
  } catch (e) {
    // Το SoftOne έγραψε ήδη — δεν ακυρώνουμε τη δημιουργία επειδή απέτυχε η αντιστοίχιση.
    if (!(e instanceof QueueError)) throw e;
    console.error('[new-items/create] group match failed', e.code, e.message);
  }

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.item.create',
    resource: created.expn != null ? 'softone_expense' : 'softone_item',
    resourceId: String(created.expn ?? created.mtrl),
    metadata: { kind: created.kind, code: created.code, name: created.name, afm: b.afm, pattern: b.pattern, linesUpdated },
  }).catch(() => null);

  return NextResponse.json({
    ok: true, kind: created.kind,
    mtrl: created.mtrl ?? null, expn: created.expn ?? null,
    code: created.code, name: created.name, linesUpdated,
  });
}
