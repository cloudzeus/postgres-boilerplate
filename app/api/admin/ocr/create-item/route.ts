import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyMatchToLine, QueueError } from '@/lib/ocr/queues';
import {
  buildItemPayload, softoneCreateItem,
  buildExpensePayload, softoneCreateExpense, softoneLoadExpenseTemplate,
  buildLineItemPayload, softoneCreateLineItem, softoneLoadLineItemTemplate, lineItemMirrorFrom,
  softoneNextItemCode, isDuplicateCodeError, clearItemCodeCache,
} from '@/lib/softone';
import { itemCodeMaskKey, ITEM_KIND_GENITIVE, type ItemCodeKind } from '@/lib/item-code';
import { mirrorItemCodes } from '@/lib/item-code-mirror';
import { getSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * **Ο ΕΝΑΣ** inline δημιουργός μητρώου για ΜΙΑ γραμμή παραστατικού.
 *
 * Παλιά αυτό το route έφτιαχνε **μόνο** είδος ή υπηρεσία (`MTRL` 51/52). Στη σελίδα ενός
 * παραστατικού που καταχωρείται σε `LINLINES` αυτό ήταν αδιέξοδο με βήματα: ο χρήστης πατούσε
 * «Νέο», συμπλήρωνε φόρμα, δημιουργούσε ένα **είδος** — και η γραμμή έμενε αδύνατη να καταχωρηθεί,
 * γιατί μια γραμμή `LINLINES` δέχεται μόνο **χρεοπίστωση**. Τώρα το route δέχεται και τα τέσσερα
 * μητρώα, και ο καλών στέλνει αυτό που ΕΠΙΤΡΕΠΕΙ ο προορισμός της σειράς
 * (`lib/ocr/resolution-plan.ts`).
 *
 * `dryRun: true` επιστρέφει **ακριβώς** το object που θα σταλεί, χωρίς να αγγίξει το SoftOne.
 * Καμία εγγραφή δεν φεύγει χωρίς ρητό πάτημα ανθρώπου.
 */
const Body = z.object({
  kind: z.enum(['product', 'service', 'expense', 'lineitem']).optional(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  /** Συμβατότητα με τον παλιό καλών: `isService` αντί για `kind`. */
  isService: z.boolean().optional(),
  vat: z.string().trim().max(20).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  price: z.number().nullable().optional(),
  group: z.string().trim().max(20).nullable().optional(),
  category: z.string().trim().max(20).nullable().optional(),
  manufacturer: z.string().trim().max(20).nullable().optional(),
  brand: z.string().trim().max(20).nullable().optional(),
  /** Μόνο για `expense`: υπάρχον έξοδο από το οποίο αντιγράφονται τα required flags. */
  templateExpn: z.number().int().positive().nullable().optional(),
  /** Μόνο για `lineitem`: **υποχρεωτική** υπάρχουσα χρεοπίστωση-πρότυπο (Τύπος + λογαριασμός). */
  templateMtrl: z.number().int().positive().nullable().optional(),
  /** Η γραμμή που θα αντιστοιχιστεί αμέσως μετά. */
  lineId: z.string().trim().min(1).nullable().optional(),
  /** Ο κωδικός που κουβαλά η γραμμή — για σωστή πρόταση μετά από 409. */
  supplierCode: z.string().trim().max(50).nullable().optional(),
  dryRun: z.boolean().optional(),
});

type Input = z.infer<typeof Body>;

export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const missing = parsed.error.issues.some((i) => ['code', 'name'].includes(String(i.path[0])));
    return NextResponse.json(
      missing
        ? { error: 'missing_fields', message: 'Κωδικός και περιγραφή είναι υποχρεωτικά.' }
        : { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const kind: ItemCodeKind = b.kind ?? (b.isService ? 'service' : 'product');

  // ── Χρεοπίστωση (MTRL SODTYPE 53) ───────────────────────────────────
  if (kind === 'lineitem') {
    if (!b.templateMtrl) {
      return NextResponse.json({
        error: 'missing_template', field: 'templateMtrl',
        message: 'Διάλεξε υπάρχουσα χρεοπίστωση ως πρότυπο — ο «Τύπος» και ο λογαριασμός γενικής αντιγράφονται από εκεί και δεν παράγονται από την περιγραφή.',
      }, { status: 400 });
    }
    if (b.dryRun) {
      try {
        const template = await softoneLoadLineItemTemplate(b.templateMtrl);
        return NextResponse.json({
          dryRun: true,
          template: { mtrl: template.mtrl, code: template.code, name: template.name, flags: template.flags },
          payload: {
            service: 'setData',
            ...buildLineItemPayload(
              { code: b.code, name: b.name, templateMtrl: b.templateMtrl, vat: b.vat ?? null, mtrCategory: b.category ?? null, unit: b.unit ?? null },
              template.flags,
            ),
          },
        });
      } catch (e) {
        return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
      }
    }

    let created: Awaited<ReturnType<typeof softoneCreateLineItem>>;
    try {
      created = await softoneCreateLineItem({
        code: b.code, name: b.name, templateMtrl: b.templateMtrl,
        vat: b.vat ?? null, mtrCategory: b.category ?? null, unit: b.unit ?? null,
      });
    } catch (e) {
      const taken = await duplicateCode(e, 'lineitem', b);
      if (taken) return taken;
      return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
    }

    const copied = lineItemMirrorFrom(created.template.flags);
    const mirror = {
      code: created.code, name: created.name,
      vat: b.vat ?? (created.template.flags.VAT != null ? String(created.template.flags.VAT) : null),
      ...copied,
      ...(b.category ? { mtrCategory: Number(b.category) } : {}),
      // Ο λογαριασμός γενικής ΔΕΝ είναι «άγνωστος»: τον μόλις αντιγράψαμε από το πρότυπο και τον
      // στείλαμε εμείς. Χωρίς σφραγίδα, ο έλεγχος λογαριασμού θα έλεγε «ασυγχρόνιστο» σε μια
      // εγγραφή που γεννήθηκε πριν από ένα δευτερόλεπτο.
      acnmskSyncedAt: new Date(),
      isActive: true, syncedAt: new Date(),
    };
    await prisma.softoneLineItem.upsert({
      where: { mtrl: created.mtrl }, update: mirror, create: { mtrl: created.mtrl, ...mirror },
    }).catch(() => null);

    return finish(b, u, {
      lin: created.mtrl, code: created.code, name: created.name, kind, isService: false,
      templateOf: created.template.code,
    });
  }

  // ── Έξοδο (EXPN) ────────────────────────────────────────────────────
  if (kind === 'expense') {
    if (b.dryRun) {
      try {
        const { flags, expn: templateExpn } = await softoneLoadExpenseTemplate(b.templateExpn ?? null);
        return NextResponse.json({
          dryRun: true, templateExpn,
          payload: { service: 'setData', ...buildExpensePayload({ code: b.code, name: b.name, vat: b.vat ?? null }, flags) },
        });
      } catch (e) {
        return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
      }
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

    return finish(b, u, { expn: created.expn, code: created.code, name: created.name, kind, isService: false });
  }

  // ── Είδος / υπηρεσία (MTRL 51/52) ───────────────────────────────────
  const isService = kind === 'service';
  const vat = b.vat ?? '';
  const unit = b.unit ?? '';
  if (!vat || !unit) {
    return NextResponse.json(
      { error: 'missing_fields', message: 'ΦΠΑ και μονάδα είναι υποχρεωτικά για είδος/υπηρεσία.' },
      { status: 400 },
    );
  }
  const itemInput = {
    code: b.code, name: b.name, isService, vat, unit,
    price: b.price ?? null,
    group: b.group || null, category: b.category || null,
    manufacturer: b.manufacturer || null, brand: b.brand || null,
  };
  if (b.dryRun) {
    return NextResponse.json({ dryRun: true, payload: { service: 'setData', ...buildItemPayload(itemInput) } });
  }

  let mtrl: number;
  try {
    mtrl = await softoneCreateItem(itemInput);
  } catch (e) {
    const taken = await duplicateCode(e, kind, b);
    if (taken) return taken;
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  await prisma.softoneItem.upsert({
    where: { mtrl },
    update: { code: b.code, name: b.name, isService, isActive: true },
    create: { mtrl, code: b.code, name: b.name, isService, isActive: true },
  }).catch(() => null);

  return finish(b, u, { mtrl, code: b.code, name: b.name, kind, isService });
}

/**
 * Μετά τη δημιουργία: αντιστοίχιση **της γραμμής** (αν δόθηκε) μέσω του ίδιου γραφέα με το
 * `match-line` — άρα γράφεται και ο κανόνας ΜΝΗΜΗΣ του εκδότη. Παλιά το route έκανε σκέτο
 * `prisma.update`, οπότε η ίδια περιγραφή του ίδιου εκδότη ξαναρχόταν αταίριαστη αύριο.
 */
async function finish(
  b: Input,
  u: { id: string; email: string },
  created: {
    mtrl?: number; expn?: number; lin?: number; code: string; name: string;
    kind: ItemCodeKind; isService: boolean; templateOf?: string;
  },
) {
  let remembered = false;
  if (b.lineId) {
    try {
      const r = await applyMatchToLine({
        lineId: b.lineId,
        target: { mtrl: created.mtrl ?? null, expn: created.expn ?? null, lin: created.lin ?? null },
        isService: created.isService,
        userId: u.id,
      });
      remembered = r.remembered;
    } catch (e) {
      // Το SoftOne έγραψε ήδη — δεν ακυρώνουμε τη δημιουργία επειδή απέτυχε η αντιστοίχιση.
      if (!(e instanceof QueueError)) throw e;
      console.error('[create-item] line match failed', e.code, e.message);
    }
  }

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.item.create_softone',
    resource: created.lin != null ? 'softone_lineitem' : created.expn != null ? 'softone_expense' : 'softone_item',
    resourceId: String(created.lin ?? created.expn ?? created.mtrl),
    metadata: {
      kind: created.kind, code: created.code, name: created.name,
      lineId: b.lineId ?? null, templateOf: created.templateOf ?? null, remembered,
    },
  }).catch(() => null);

  return NextResponse.json({
    ok: true, kind: created.kind,
    mtrl: created.mtrl ?? null, expn: created.expn ?? null, lin: created.lin ?? null,
    code: created.code, name: created.name, remembered,
  });
}

/**
 * Το SoftOne αρνήθηκε επειδή ο κωδικός **υπάρχει ήδη**; Απαντάμε **409** με ΝΕΑ πρόταση και
 * σταματάμε. ΚΑΜΙΑ αυτόματη επανάληψη: μια δεύτερη προσπάθεια με άλλον κωδικό κινδυνεύει να
 * δημιουργήσει διπλή εγγραφή αν η πρώτη είχε τελικά περάσει. Αποφασίζει ο χρήστης.
 */
async function duplicateCode(e: unknown, kind: ItemCodeKind, b: Input): Promise<NextResponse | null> {
  const message = (e as Error).message;
  if (!isDuplicateCodeError(message)) return null;
  clearItemCodeCache(kind);
  const supplierCode = b.supplierCode && b.supplierCode !== b.code ? b.supplierCode : null;
  const next = await suggestCode(kind, supplierCode);
  return NextResponse.json(
    {
      error: 'code_taken', field: 'code', kind, message,
      hint: `Ο κωδικός είναι πιασμένος στο μητρώο ${ITEM_KIND_GENITIVE[kind]}.`,
      suggestion: next?.code ?? null,
      stale: next?.stale ?? false,
    },
    { status: 409 },
  );
}

/** Ο επόμενος προτεινόμενος κωδικός — ποτέ δεν πετάει· χωρίς πρόταση το UI δείχνει το μήνυμα του ERP. */
async function suggestCode(
  kind: ItemCodeKind, supplierCode: string | null,
): Promise<{ code: string | null; stale: boolean } | null> {
  try {
    const [mask, fallbackCodes] = await Promise.all([
      getSetting<string>(itemCodeMaskKey(kind), '').catch(() => ''),
      mirrorItemCodes(kind),
    ]);
    const r = await softoneNextItemCode(kind, { mask: mask ?? '', supplierCode, fallbackCodes });
    return { code: r.code, stale: r.stale };
  } catch {
    return null;
  }
}
