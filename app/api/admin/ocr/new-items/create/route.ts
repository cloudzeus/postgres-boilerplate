import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyMatchToGroup, QueueError } from '@/lib/ocr/queues';
import {
  buildItemPayload, softoneCreateItem,
  buildExpensePayload, softoneCreateExpense, softoneLoadExpenseTemplate,
  softoneNextItemCode, isDuplicateCodeError, clearItemCodeCache,
} from '@/lib/softone';
import { itemCodeMaskKey, type ItemCodeKind } from '@/lib/item-code';
import { getSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  afm: z.string().trim().max(20).default(''),
  pattern: z.string().trim().min(1).max(200),
  kind: z.enum(['product', 'service', 'expense']),
  code: z.string().trim().min(1).max(50),
  /** Ο κωδικός που κουβαλά η γραμμή του τιμολογίου — για να ξαναπροταθεί σωστά μετά από 409. */
  supplierCode: z.string().trim().max(50).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  vat: z.string().trim().max(20).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  /** Τιμή **ΧΟΝΔΡΙΚΗΣ** (καθαρή) από τη γραμμή — γράφεται στο `PRICEW`, όχι στο `PRICER`. */
  price: z.number().nullable().optional(),
  /** `ITEM.MTRGROUP` — ομάδα είδους (προαιρετική). */
  group: z.string().trim().max(20).nullable().optional(),
  /** `ITEM.MTRCATEGORY` — εμπορική κατηγορία είδους (προαιρετική). */
  category: z.string().trim().max(20).nullable().optional(),
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
      const taken = await duplicateCode(e, 'expense', b);
      if (taken) return taken;
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
  // Το ΠΟΣΟΣΤΟ ΦΠΑ δεν έρχεται από τον client: το διαβάζουμε από το μητρώο `VatCategory` με τον
  // κωδικό που διάλεξε ο χρήστης. Έτσι η λιανική που θα γραφτεί βγαίνει από ΜΙΑ πηγή αλήθειας —
  // και μια κατηγορία χωρίς ποσοστό (π.χ. «Άρθρο 39α») απλώς δεν παράγει λιανική.
  const vatRate = await prisma.vatCategory
    .findUnique({ where: { code: vat }, select: { rate: true } })
    .then((r) => r?.rate ?? null)
    .catch(() => null);

  const itemInput = {
    code: b.code, name: b.name, isService, vat, unit,
    price: b.price ?? null, vatRate,
    group: b.group || null, category: b.category || null,
  };

  if (b.dryRun) {
    return NextResponse.json({ dryRun: true, payload: { service: 'setData', ...buildItemPayload(itemInput) } });
  }

  let mtrl: number;
  try {
    mtrl = await softoneCreateItem(itemInput);
  } catch (e) {
    const taken = await duplicateCode(e, isService ? 'service' : 'product', b);
    if (taken) return taken;
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

/**
 * Το SoftOne αρνήθηκε επειδή ο κωδικός **υπάρχει ήδη**; Τότε απαντάμε **409** με ΝΕΑ πρόταση και
 * σταματάμε εκεί. ΚΑΜΙΑ αυτόματη επανάληψη: μια δεύτερη προσπάθεια με άλλον κωδικό κινδυνεύει να
 * δημιουργήσει διπλή εγγραφή αν η πρώτη είχε τελικά περάσει. Αποφασίζει ο χρήστης.
 *
 * `null` όταν το σφάλμα δεν είναι διπλός κωδικός — ο καλών συνεχίζει με το γενικό 502.
 */
async function duplicateCode(
  e: unknown, kind: ItemCodeKind, b: z.infer<typeof Body>,
): Promise<NextResponse | null> {
  const message = (e as Error).message;
  if (!isDuplicateCodeError(message)) return null;
  // Η νέα πρόταση πρέπει να βγει από ΦΡΕΣΚΑ δεδομένα — αλλιώς η cache 60s ξαναδίνει τον ίδιο.
  clearItemCodeCache(kind);
  // Ο κωδικός που ΜΟΛΙΣ απορρίφθηκε δεν ξαναπροτείνεται: αν ήταν ο κωδικός του προμηθευτή, τον
  // αποσύρουμε από τον κανόνα 1 — μόλις αποδείχθηκε πιασμένος, ό,τι κι αν λέει το μητρώο.
  const supplierCode = b.supplierCode && b.supplierCode !== b.code ? b.supplierCode : null;
  return NextResponse.json(
    { error: 'code_taken', field: 'code', kind, message, suggestion: await suggestCode(kind, supplierCode) },
    { status: 409 },
  );
}

/**
 * Ο επόμενος προτεινόμενος κωδικός του μητρώου — ΜΟΝΟ για να τον προτείνουμε μετά από άρνηση.
 * Ποτέ δεν πετάει: χωρίς πρόταση, το UI δείχνει απλώς το μήνυμα του ERP.
 */
async function suggestCode(kind: ItemCodeKind, supplierCode: string | null): Promise<string | null> {
  try {
    const mask = await getSetting<string>(itemCodeMaskKey(kind), '').catch(() => '');
    const r = await softoneNextItemCode(kind, { mask: mask ?? '', supplierCode });
    return r.code;
  } catch {
    return null;
  }
}
