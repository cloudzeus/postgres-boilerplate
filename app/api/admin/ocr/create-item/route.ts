import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyMatchToLine, QueueError } from '@/lib/ocr/queues';
import {
  buildItemPayload, softoneCreateItem,
  buildExpensePayload, softoneCreateExpense, softoneLoadExpenseTemplate,
  buildLineItemPayload, softoneCreateLineItem, softoneLoadLineItemTemplate,
  softoneNextItemCode, isDuplicateCodeError, clearItemCodeCache, SoftoneOrphanError,
} from '@/lib/softone';
import { itemCodeMaskKey, ITEM_KIND_GENITIVE, type ItemCodeKind } from '@/lib/item-code';
import { mirrorItemCodes } from '@/lib/item-code-mirror';
import { getSetting } from '@/lib/settings';
import { checkLineItemTemplate } from '@/lib/ocr/lineitem-create';
import { requiredTraderKind } from '@/lib/ocr/required-trader-kind';
import { loadAccountChart } from '@/lib/ocr/account-chart';
import { checkAccounts, type AccountStatus } from '@/lib/ocr/account-check';

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
  /** Μόνο για `lineitem`: **υποχρεωτική** υπάρχουσα χρεοπίστωση-πρότυπο (Τύπος + κατηγορία). */
  templateMtrl: z.number().int().positive().nullable().optional(),
  /**
   * Μόνο για `lineitem`: ο λογαριασμός **γενικής λογιστικής**, ΡΗΤΑ. Δεν κληρονομείται σιωπηλά
   * από το πρότυπο — δες `lib/ocr/lineitem-create.ts`.
   */
  acnmsk: z.string().trim().max(40).nullable().optional(),
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
        message: 'Διάλεξε υπάρχουσα χρεοπίστωση ως πρότυπο — ο «Τύπος» και η «Κατηγορία τιμολόγησης» αντιγράφονται από εκεί και δεν παράγονται από την περιγραφή.',
      }, { status: 400 });
    }

    let template: Awaited<ReturnType<typeof softoneLoadLineItemTemplate>>;
    try {
      template = await softoneLoadLineItemTemplate(b.templateMtrl);
    } catch (e) {
      return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
    }

    // Ο λογαριασμός: ό,τι έδωσε ο χρήστης, αλλιώς η ΠΡΟΤΑΣΗ του προτύπου. Ποτέ κενός.
    const acnmsk = (b.acnmsk ?? '').trim() || (template.acnmsk ?? '').trim();
    const accountVerdict = await judgeAccount(acnmsk, `${b.code} — ${b.name}`);

    // Ο τύπος συναλλασσομένου που απαιτεί ΑΥΤΟ το παραστατικό — από τη σειρά του, όχι από εικασία.
    const requiredSodtype = await requiredSodtypeForLine(b.lineId ?? null);
    const issue = checkLineItemTemplate({
      templateLabel: `${template.code} — ${template.name}`,
      lisourceType: template.lisourceType,
      requiredSodtype,
      accountStatus: acnmsk ? accountVerdict.status : 'missing',
      accountMessage: accountVerdict.message,
      accountChosen: Boolean((b.acnmsk ?? '').trim()),
    });
    if (issue) {
      return NextResponse.json({
        error: issue.code,
        field: issue.code === 'account_blocked' ? 'acnmsk' : 'templateMtrl',
        message: issue.message,
        template: templateDto(template, accountVerdict, requiredSodtype),
      }, { status: 422 });
    }

    const payloadInput = {
      code: b.code, name: b.name, templateMtrl: b.templateMtrl, acnmsk,
      vat: b.vat ?? null, mtrCategory: b.category ?? null, unit: b.unit ?? null,
    };

    if (b.dryRun) {
      return NextResponse.json({
        dryRun: true,
        template: templateDto(template, accountVerdict, requiredSodtype),
        payload: { service: 'setData', ...buildLineItemPayload(payloadInput, template.flags) },
      });
    }

    let created: Awaited<ReturnType<typeof softoneCreateLineItem>>;
    try {
      created = await softoneCreateLineItem(payloadInput);
    } catch (e) {
      const taken = await duplicateCode(e, 'lineitem', b);
      if (taken) return taken;
      // Το read-back χτύπησε ΑΦΟΥ το SoftOne έγραψε: υπάρχει ορφανή χρεοπίστωση που δεν μπαίνει
      // στον καθρέφτη ούτε στη γραμμή. Το MTRL δεν επιτρέπεται να ζει μόνο σε ένα toast — χωρίς
      // αυτό κανείς δεν ξέρει αύριο τι να διορθώσει στον ERP.
      if (e instanceof SoftoneOrphanError) {
        console.error('[create-item] ορφανή χρεοπίστωση MTRL', e.mtrl, e.message);
        await logAudit({
          userId: u.id, userEmail: u.email,
          action: 'ocr.item.create_softone_orphan',
          resource: 'softone_lineitem', resourceId: String(e.mtrl),
          metadata: { code: b.code, name: b.name, lineId: b.lineId ?? null, reason: e.message },
        }).catch(() => null);
      }
      return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
    }

    /**
     * Ο καθρέφτης γράφεται από το **read-back**, όχι από ό,τι νομίζουμε ότι στείλαμε.
     *
     * Ο χαρακτηρισμός myDATA μένει **κενός** επίτηδες (`classType`/`classCategory`/`myDataCode`):
     * δεν τον αντιγράφουμε από το πρότυπο, ώστε το `no_mydata_classification` να **χτυπήσει** και
     * ο χρήστης να τον ορίσει — αντί να ταξιδέψει σιωπηλά λάθος χαρακτηρισμός προς το myDATA.
     */
    const mirror = {
      code: created.code, name: created.name,
      vat: b.vat ?? template.vat,
      mtrType: numOrNull(created.template.flags.MTRTYPE),
      mtrCategory: b.category ? Number(b.category) : (template.mtrCategory ? Number(template.mtrCategory) : null),
      classType: null, classCategory: null, myDataCode: null, myDataVprc: null,
      acnmsk: created.acnmsk,
      // Ο λογαριασμός ΔΕΝ είναι «άγνωστος»: μόλις τον στείλαμε και τον ξαναδιαβάσαμε. Χωρίς
      // σφραγίδα, ο έλεγχος θα έλεγε «ασυγχρόνιστο» για εγγραφή ενός δευτερολέπτου.
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

const numOrNull = (v: unknown): number | null => {
  const t = String(v ?? '').trim();
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null;
};

/** Τι λέει ο ΔΙΚΟΣ μας έλεγχος για έναν λογαριασμό γενικής — ίδια κρίση με την καταχώριση. */
async function judgeAccount(
  acnmsk: string, article: string,
): Promise<{ status: AccountStatus; message: string | null; accountName: string | null }> {
  if (!acnmsk) {
    return {
      status: 'missing', accountName: null,
      message: 'ο λογαριασμός είναι κενός — η γραμμή θα μπλόκαρε στην καταχώριση με «account_missing»',
    };
  }
  try {
    const chart = await loadAccountChart([acnmsk]);
    const res = checkAccounts(
      [{ rowIndex: 0, path: 'LINLINES', article, acnmsk, acnmskKnown: true }],
      chart,
    );
    const line = res.lines[0];
    return { status: line?.status ?? 'unknown', message: line?.message ?? null, accountName: line?.accountName ?? null };
  } catch {
    // Ο καθρέφτης δεν απάντησε: «άγνωστο» δεν είναι «λείπει» — δεν μπλοκάρουμε στα τυφλά.
    return { status: 'unknown', message: null, accountName: null };
  }
}

/** Το SODTYPE που απαιτεί η σειρά του παραστατικού ΤΗΣ γραμμής. `null` = άγνωστη σειρά. */
async function requiredSodtypeForLine(lineId: string | null): Promise<number | null> {
  if (!lineId) return null;
  const line = await prisma.ocrInvoiceItem.findUnique({
    where: { id: lineId },
    select: { document: { select: { seriesSource: true, softoneSeries: true } } },
  }).catch(() => null);
  if (!line?.document) return null;
  return (await requiredTraderKind(line.document))?.sodtype ?? null;
}

/** Ό,τι χρειάζεται το UI για να δείξει το πρότυπο και την κρίση μας πάνω του. */
function templateDto(
  t: Awaited<ReturnType<typeof softoneLoadLineItemTemplate>>,
  account: { status: AccountStatus; message: string | null; accountName: string | null },
  requiredSodtype: number | null,
) {
  return {
    mtrl: t.mtrl, code: t.code, name: t.name,
    flags: t.flags,
    acnmsk: t.acnmsk, vat: t.vat, mtrCategory: t.mtrCategory,
    lisourceType: t.lisourceType,
    requiredSodtype,
    account,
  };
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
