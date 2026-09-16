import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { softoneCreateItemCategory } from '@/lib/softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1, 'Η περιγραφή είναι υποχρεωτική').max(128),
  /** Σύντμηση (`MTRCATEGORY.CODE`, ≤12). Κενή ⇒ παράγεται από την περιγραφή. */
  code: z.string().trim().max(12).nullable().optional(),
});

/**
 * POST — νέα **εμπορική κατηγορία είδους** στο SoftOne (object `ITECATEGORY` → `MTRCATEGORY`),
 * από τη φόρμα δημιουργίας είδους.
 *
 * Γράφει ΠΡΑΓΜΑΤΙΚΑ στο SoftOne και επιβεβαιώνεται με **ανάγνωση πίσω** μέσα στο
 * `softoneCreateItemCategory`. Μόνο μετά την επιβεβαίωση μπαίνει στον τοπικό καθρέφτη
 * (`SoftoneLookup` kind `MTRCATEGORY`), ώστε να είναι αμέσως επιλέξιμη — και ο επόμενος
 * συγχρονισμός βοηθητικών πινάκων τη βρίσκει κανονικά στο SoftOne.
 *
 * ΓΙΑΤΙ ΔΕΝ ΥΠΑΡΧΕΙ το αντίστοιχο για **ομάδες**: ο `MTRGROUP` κρατά ΞΕΧΩΡΙΣΤΗ γραμμή ανά
 * εταιρεία και το Web Service γράφει σε φάντασμα COMPANY — το `setData` γυρίζει `success: true`
 * και η γραμμή της εταιρείας δεν αλλάζει ποτέ (καταγεγραμμένο σε ζωντανό tenant). Ένα κουμπί που
 * αποτυγχάνει σιωπηλά είναι χειρότερο από κανένα κουμπί, οπότε η φόρμα απλώς το λέει.
 */
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  let created: { mtrCategory: number; code: string; name: string };
  try {
    created = await softoneCreateItemCategory({ name: b.name, code: b.code ?? null });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  const code = String(created.mtrCategory);
  await prisma.softoneLookup.upsert({
    where: { kind_code: { kind: 'MTRCATEGORY', code } },
    update: { name: created.name },
    create: { kind: 'MTRCATEGORY', code, name: created.name },
  }).catch(() => null);

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.item_category.create', resource: 'softone_lookup', resourceId: code,
    metadata: { mtrCategory: created.mtrCategory, code: created.code, name: created.name },
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    // `code` = ό,τι περιμένει το `ITEM.MTRCATEGORY` (το αριθμητικό id), `label` = τι βλέπει ο χρήστης.
    category: { code, label: created.name },
    abbrev: created.code,
    mtrCategory: created.mtrCategory,
  });
}
