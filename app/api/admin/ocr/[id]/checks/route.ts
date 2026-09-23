import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { normalizeAfm } from '@/lib/ocr/validate';
import { postingTargetsForSeries, seriesKey } from '@/lib/ocr/required-trader-kind';
import { describeTargetShort, SODTYPE_FOR_OBJECT } from '@/lib/ocr/posting-target';
import { requiredTraderForTarget, allowedLineKinds, lineKindsReason } from '@/lib/ocr/resolution-plan';
import { VAT_RATE_MAP_SETTING, buildVatRateMap, missingVatRates, parseVatRateOverrides } from '@/lib/ocr/vat-map';

/**
 * Η συγκεντρωτική κατάσταση των ελέγχων ενός παραστατικού — ό,τι τροφοδοτεί τη
 * `<SoftoneChecksStrip>`.
 *
 * Δεν είναι πια «διπλό / προμηθευτής / είδη». Κουβαλά τον **ΠΡΟΟΡΙΣΜΟ** της σειράς, και μαζί του
 * τις τρεις απαντήσεις που έλειπαν και έκαναν τη σελίδα αδιέξοδο:
 *
 *  1. **ΠΟΙΟΝ τύπο καρτέλας** θέλει το παραστατικό (προμηθευτή / πιστωτή / χρεώστη). Η λωρίδα
 *     πρότεινε πάντα «Προμηθευτή», οπότε σε παραστατικό πιστωτών ο χρήστης συνέδεε καρτέλα που
 *     η καταχώριση θα απέρριπτε αργότερα ως `trader_kind_mismatch`.
 *  2. Ότι μια **ήδη συνδεδεμένη** καρτέλα μπορεί να είναι **λάθος τύπου**. Πριν, η λωρίδα έδειχνε
 *     πράσινο «βρέθηκε» και το μπλόκο εμφανιζόταν μόνο στην κάρτα καταχώρισης, παρακάτω.
 *  3. Ποιοι **συντελεστές ΦΠΑ** δεν έχουν κωδικό στο μητρώο — το `no_vat_category` ως κάτι που
 *     ΛΥΝΕΤΑΙ, όχι ως ανακοίνωση.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await ctx.params;

  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    select: {
      extractedData: true,
      softoneSeries: true, seriesSource: true,
      softoneDocExists: true, softoneDocRef: true, softoneDocChecked: true,
      softoneTrdr: true, softoneCode: true, softoneName: true, softoneKind: true, softoneChecked: true,
      items: {
        orderBy: { rowIndex: 'asc' },
        select: {
          id: true, rowIndex: true, code: true, name: true, vatRate: true,
          softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true,
        },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ed = (doc.extractedData ?? {}) as Record<string, unknown>;
  // Αντιστοιχισμένη = έχει είδος/υπηρεσία (MTRL), ΕΞΟΔΟ (EXPN) ή ΧΡΕΟΠΙΣΤΩΣΗ (LIN) — ίδιος
  // κανόνας με το `refreshDocTallies` και με την ουρά «Είδη & έξοδα».
  const unmatched = doc.items.filter(
    (i) => i.softoneMtrl == null && i.softoneExpn == null && i.softoneLinMtrl == null,
  );

  const ref = { seriesSource: doc.seriesSource, softoneSeries: doc.softoneSeries };
  const key = seriesKey(ref);
  const targets = key ? await postingTargetsForSeries([ref]) : null;
  const target = key ? targets?.get(key) ?? null : null;
  const required = requiredTraderForTarget(target);

  // Ο ΤΥΠΟΣ της συνδεδεμένης καρτέλας από τον τοπικό καθρέφτη. `null` = δεν τον ξέρουμε, οπότε
  // δεν κρίνουμε — ίδια στάση με το `trader_kind_mismatch` της καταχώρισης.
  const linked = doc.softoneTrdr
    ? await prisma.softoneTrader.findUnique({ where: { trdr: doc.softoneTrdr }, select: { sodtype: true } })
    : null;
  const mismatch = Boolean(
    target?.supported && doc.softoneTrdr && linked?.sodtype != null
    && linked.sodtype !== SODTYPE_FOR_OBJECT[target.object],
  );

  const [vats, vatSetting] = await Promise.all([
    prisma.vatCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, rate: true, descr: true },
    }),
    getSetting<unknown>(VAT_RATE_MAP_SETTING, {}).catch(() => ({})),
  ]);
  const vatMap = buildVatRateMap(
    vats.map((v) => ({ code: v.code, rate: v.rate == null ? null : Number(v.rate), descr: v.descr, isActive: true })),
    parseVatRateOverrides(vatSetting),
  );
  const missing = missingVatRates(
    doc.items.map((i) => (i.vatRate == null ? null : Number(i.vatRate))),
    vatMap.byRate,
  );

  return NextResponse.json({
    duplicate: {
      checked: doc.softoneDocChecked != null,
      exists: doc.softoneDocExists === true,
      ref: doc.softoneDocRef,
    },
    supplier: {
      checked: doc.softoneChecked != null,
      found: doc.softoneTrdr != null,
      trdr: doc.softoneTrdr,
      name: doc.softoneName, code: doc.softoneCode, kind: doc.softoneKind,
      afm: normalizeAfm(ed.vatNumber) ?? '',
      sodtype: linked?.sodtype ?? null,
      /** `null` = άγνωστη σειρά ⇒ δεν ξέρουμε τι καρτέλα θέλει, άρα δεν προτείνουμε καμία. */
      required,
      /** Συνδεδεμένη καρτέλα ΛΑΘΟΣ τύπου: πράσινο θα ήταν ψέμα. */
      mismatch,
    },
    items: {
      total: doc.items.length,
      matched: doc.items.length - unmatched.length,
      unmatched: unmatched.map((i) => ({ id: i.id, rowIndex: i.rowIndex, code: i.code, name: i.name })),
      /** Σε ποια μητρώα επιτρέπεται να δείχνουν οι γραμμές — κενό = άγνωστος προορισμός. */
      allowedKinds: allowedLineKinds(target),
      reason: lineKindsReason(target),
    },
    target: target
      ? {
        object: target.object, lines: target.lines, source: target.source,
        supported: target.supported, reason: target.reason, label: describeTargetShort(target),
      }
      : null,
    vat: {
      /** Συντελεστές γραμμών χωρίς κωδικό ΦΠΑ. `null` = γραμμή χωρίς συντελεστή. */
      missing,
      overridden: vatMap.overridden,
      ignored: vatMap.ignored,
    },
  });
}
