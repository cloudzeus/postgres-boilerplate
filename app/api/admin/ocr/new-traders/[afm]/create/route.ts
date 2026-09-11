import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { parseAfmParam, vatCountry } from '@/lib/ocr/validate';
import { applyVatPrefix } from '@/lib/ocr/vat-prefix';
import { applyTraderToDocs, TRADER_KIND_LABEL } from '@/lib/ocr/queues';
import {
  buildTraderPayload, softoneCreateSupplier, softoneCreateCreditor, softoneFetchCountries,
  matchCountryId, TRADER_KIND_SODTYPE, type SoftoneCountry,
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
  /** ISO-2 χώρα έδρας· κενό ⇒ την παίρνουμε από το ίδιο το ΑΦΜ. */
  country: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Κωδικός χώρας 2 γραμμάτων').nullable().optional(),
  dryRun: z.boolean().optional(),
});

// POST — δημιουργεί προμηθευτή (SODTYPE 12) ή πιστωτή (16) στο SoftOne για τον
// εκδότη του ΑΦΜ, τον καθρεφτίζει τοπικά και τον γράφει σε ΟΛΑ τα έγγραφα του
// ΑΦΜ (spec 2026-09-11 §2). `dryRun` επιστρέφει μόνο το setData payload.
export async function POST(req: Request, { params }: { params: Promise<{ afm: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const afm = parseAfmParam((await params).afm);
  if (!afm) return NextResponse.json({ error: 'invalid_afm', message: 'Μη έγκυρο ΑΦΜ.' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  // Η χώρα του εκδότη: ό,τι επέλεξε ο χρήστης, αλλιώς αυτή που λέει το ίδιο το
  // ΑΦΜ (ξένο πρόθεμα → η χώρα του, σκέτα ψηφία → Ελλάδα).
  const country = (b.country ?? vatCountry(afm) ?? 'GR').toUpperCase();
  // Ο εκδότης είναι ξένος αλλά το OCR διάβασε γυμνά ψηφία: προσθέτουμε το πρόθεμα
  // της χώρας ΜΙΑ φορά, εδώ, και το χρησιμοποιούμε παντού (SoftOne + έγγραφα).
  const vatId = applyVatPrefix(afm, country);

  const input = {
    name: b.name,
    afm: vatId,
    code: b.code ?? null,
    doyCode: b.doyCode ?? null,
    profession: b.profession ?? null,
    address: b.address ?? null,
    zip: b.zip ?? null,
    city: b.city ?? null,
    phone: b.phone ?? null,
    email: b.email ?? null,
    country,
  };

  // Το μητρώο χωρών φορτώνεται ΜΙΑ φορά ανά αίτημα (cached 24h μέσα στη διεργασία).
  // Χωρίς αυτό ο συναλλασσόμενος δημιουργείται κανονικά, απλώς χωρίς `COUNTRY`.
  const countries: SoftoneCountry[] = await softoneFetchCountries().catch(() => []);
  const warnings = matchCountryId(country, countries) ? [] : ['country_not_found'];

  // Dry-run: το ακριβές setData χωρίς καμία εγγραφή στο SoftOne.
  if (b.dryRun) {
    return NextResponse.json({
      dryRun: true, warnings,
      vatId,
      payload: { service: 'setData', ...buildTraderPayload(b.kind, input, countries) },
    });
  }

  let trdr: number;
  let code: string;
  try {
    ({ trdr, code } = b.kind === 'creditor'
      ? await softoneCreateCreditor(input, countries)
      : await softoneCreateSupplier(input, countries));
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  const kind = TRADER_KIND_LABEL[b.kind];
  const sodtype = TRADER_KIND_SODTYPE[b.kind];
  // Καθρέφτης: ο νέος συναλλασσόμενος γίνεται αμέσως αναζητήσιμος/αντιστοιχίσιμος.
  // Τηλέφωνο/email γράφονται και στο SoftOne (PHONE01/EMAIL) και εδώ.
  const mirror = {
    code, name: b.name, afm: vatId, sodtype, kind, isActive: true,
    doy: b.doyCode ?? null, profession: b.profession ?? null,
    address: b.address ?? null, zip: b.zip ?? null, city: b.city ?? null,
    phone: b.phone ?? null, email: b.email ?? null,
  };
  await prisma.softoneTrader.upsert({ where: { trdr }, update: mirror, create: { trdr, ...mirror } }).catch(() => null);

  // Το `afm` του path είναι το ΤΡΕΧΟΝ κλειδί της ομάδας· το `vatId` είναι η τελική
  // μορφή. Αν διαφέρουν, τα έγγραφα ξαναγράφονται με τη νέα τιμή.
  const docsUpdated = await applyTraderToDocs(afm, { trdr, code, name: b.name, kind }, { vatId });

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.trader.create', resource: 'softone_trader', resourceId: String(trdr),
    metadata: { afm, vatId, kind: b.kind, code, name: b.name, country, docsUpdated, warnings },
  }).catch(() => null);

  return NextResponse.json({ ok: true, trdr, code, name: b.name, afm: vatId, kind, country, docsUpdated, warnings });
}
