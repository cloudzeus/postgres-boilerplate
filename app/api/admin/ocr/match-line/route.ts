import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyAnalyticsToLine, applyMatchToLine, clearLineMatch, QueueError } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Χειροκίνητη αντιστοίχιση ΜΙΑΣ γραμμής παραστατικού — η ενέργεια της σελίδας
 * `/admin/ocr/<id>` και των μικρών picker της ίδιας σελίδας.
 *
 * `POST { lineId, mtrl }` (η αρχική μορφή, αμετάβλητη) ή `{ lineId, expn }` /
 * `{ lineId, lin }` για έξοδο και χρεοπίστωση. Κανένας στόχος (ή `mtrl: null`) ⇒ καθαρισμός.
 * `{ lineId, analyticsOnly: true, analytics }` γράφει ΜΟΝΟ κέντρο κόστους / έργο /
 * δραστηριότητα — ρητή σημαία, ώστε να μη μπερδεύεται ποτέ με τον καθαρισμό.
 *
 * Το βαρύ μέρος — ανάγνωση μητρώου, καθάρισμα των ΑΛΛΩΝ στηλών, και κυρίως η ΜΝΗΜΗ
 * (`LineMatchRule`, ΑΦΜ εκδότη + κανονικοποιημένο κείμενο) — ζει στο `lib/ocr/queues.ts`,
 * το ίδιο αρχείο που εξυπηρετεί την ουρά «Είδη & έξοδα». Μία απόφαση, ένας γραφέας.
 */
const Body = z.object({
  lineId: z.string().trim().min(1),
  mtrl: z.number().int().positive().nullish(),
  expn: z.number().int().positive().nullish(),
  lin: z.number().int().positive().nullish(),
  isService: z.boolean().optional(),
  /** Γράψε ΜΟΝΟ την αναλυτική· η αντιστοίχιση της γραμμής μένει ως έχει. */
  analyticsOnly: z.boolean().optional(),
  analytics: z.object({
    costCntr: z.number().int().positive().nullish(),
    prjc: z.number().int().positive().nullish(),
    prjcStage: z.number().int().positive().nullish(),
  }).optional(),
}).refine(
  // ΕΝΑΣ στόχος τη φορά. Δύο μαζί είναι ασαφές αίτημα και θα γραφόταν σιωπηλά ο ένας —
  // η ουρά το απορρίπτει με `z.union`, το ίδιο κάνει κι εδώ.
  (b) => [b.mtrl, b.expn, b.lin].filter((v) => v != null).length <= 1,
  { message: 'Δώσε ΕΝΑΝ στόχο: είδος (mtrl), έξοδο (expn) ή χρεοπίστωση (lin).', path: ['mtrl'] },
);

export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Ο παλιός κωδικός για το πιο συχνό λάθος, ώστε να μη χαλάσει κανένας καλών.
    const missingLine = parsed.error.issues.some((i) => i.path[0] === 'lineId');
    return NextResponse.json(
      missingLine ? { error: 'missing_lineId' } : { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const hasTarget = b.mtrl != null || b.expn != null || b.lin != null;

  try {
    if (b.analyticsOnly) {
      const r = await applyAnalyticsToLine({ lineId: b.lineId, analytics: b.analytics, userId: u.id });
      await logAudit({
        userId: u.id, userEmail: u.email,
        action: 'ocr.line.analytics', resource: 'ocr_line', resourceId: b.lineId,
        metadata: { docId: r.docId, remembered: r.remembered, ...r.analytics },
      }).catch(() => null);
      return NextResponse.json({ ok: true, analytics: r.analytics, remembered: r.remembered, docId: r.docId });
    }

    if (!hasTarget) {
      const r = await clearLineMatch(b.lineId);
      await logAudit({
        userId: u.id, userEmail: u.email,
        action: 'ocr.line.unmatch', resource: 'ocr_line', resourceId: b.lineId,
        metadata: { docId: r.docId },
      }).catch(() => null);
      return NextResponse.json({ ok: true, cleared: true });
    }

    const r = await applyMatchToLine({
      lineId: b.lineId,
      target: { mtrl: b.mtrl ?? null, expn: b.expn ?? null, lin: b.lin ?? null },
      isService: b.isService,
      // Έξοδο → EXPANAL, που δεν έχει αναλυτική: δεν γράφουμε τιμές που θα πετιόνταν.
      analytics: b.expn != null ? undefined : b.analytics,
      userId: u.id,
    });
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'ocr.line.match', resource: 'ocr_line', resourceId: b.lineId,
      metadata: {
        docId: r.docId, mtrl: r.mtrl, expn: r.expn, lin: r.lin, code: r.code, name: r.name,
        afm: r.afm, pattern: r.pattern, remembered: r.remembered, ...r.analytics,
      },
    }).catch(() => null);
    return NextResponse.json({
      ok: true,
      // Το αρχικό σχήμα απάντησης μένει ως έχει — απλώς πλουσιότερο.
      match: { mtrl: r.mtrl, expn: r.expn, lin: r.lin, code: r.code, name: r.name, isService: r.isService },
      kind: r.kind,
      docId: r.docId,
      remembered: r.remembered,
    });
  } catch (e) {
    if (e instanceof QueueError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }
}
