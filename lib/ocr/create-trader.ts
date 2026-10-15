// lib/ocr/create-trader.ts — SERVER. Η ΜΙΑ υλοποίηση της «δημιουργία συναλλασσομένου στο SoftOne».
//
// Υπήρχε μέσα στο route handler. Βγήκε εδώ όταν μπήκε η ουρά εργασιών: η ίδια δουλειά πρέπει να
// μπορεί να τρέξει και ΤΩΡΑ (ο χρήστης πάτησε το κουμπί και η σύνδεση είναι όρθια) και ΑΡΓΟΤΕΡΑ
// (η σύνδεση είχε πέσει, η εργασία μπήκε σε σειρά και φεύγει στην επανασύνδεση). Δύο αντίγραφα
// θα ξέφευγαν το ένα από το άλλο — και το δεύτερο θα ήταν σίγουρα το φτωχότερο.
//
// «Δημιουργία» ΔΕΝ είναι μόνο το `setData`. Είναι τέσσερα πράγματα, και αν λείψει οποιοδήποτε η
// δουλειά είναι μισή:
//   1. `setData` στο σωστό object (SUPPLIER/CREDITOR/DEBTOR — το SODTYPE το ορίζει το object)
//   2. ΕΠΑΛΗΘΕΥΣΗ με ανάγνωση: το `success:true` του SoftOne δεν αποδεικνύει ότι έμεινε η γραμμή
//   3. τοπικός καθρέφτης, για να γίνει αμέσως αναζητήσιμος
//   4. γράψιμο του νέου TRDR σε ΟΛΑ τα παραστατικά του ΑΦΜ
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { applyTraderToDocs, TRADER_KIND_LABEL } from '@/lib/ocr/queues';
import {
  softoneCreateTrader, softoneFetchCountries, softoneGetTable, matchCountryId,
  TRADER_KIND_SODTYPE, type SoftoneCountry,
} from '@/lib/softone';
import { normalizeAfm } from '@/lib/ocr/validate';

export type TraderKind = 'supplier' | 'creditor' | 'debtor';

export interface CreateTraderJob {
  /** Το ΑΦΜ όπως το κρατά η ομάδα παραστατικών — μπορεί να διαφέρει από το τελικό `vatId`. */
  afm: string;
  kind: TraderKind;
  input: {
    name: string; afm: string; code: string | null; irsData: string | null;
    profession: string | null; address: string | null; zip: string | null; city: string | null;
    phone: string | null; email: string | null; country: string;
    latitude: number | null; longitude: number | null;
  };
  actor: { id: string; email: string } | null;
}

export interface CreateTraderResult {
  ok: true; trdr: number; code: string; name: string; afm: string;
  kind: string; country: string; docsUpdated: number; warnings: string[];
  /** Υπήρχε ΗΔΗ καρτέλα με αυτόν τον ΑΦΜ: δεν δημιουργήθηκε νέα, τα παραστατικά συνδέθηκαν σε αυτήν. */
  existing?: boolean;
}

/**
 * Η καρτέλα που ΗΔΗ υπάρχει για αυτόν τον ΑΦΜ και τύπο: πρώτα ο καθρέφτης, μετά ζωντανά το SoftOne
 * (μια καρτέλα που φτιάχτηκε έξω από την εφαρμογή δεν είναι ακόμη στον καθρέφτη).
 */
export async function findExistingTrader(vat: string, sodtype: number): Promise<{ trdr: number; code: string; name: string } | null> {
  const key = normalizeAfm(vat);
  if (!key) return null;
  const local = await prisma.softoneTrader.findMany({
    where: { sodtype, isActive: true, afm: { contains: key } },
    select: { trdr: true, code: true, name: true, afm: true },
    orderBy: { trdr: 'asc' },
  });
  const hit = local.find((t) => normalizeAfm(t.afm) === key);
  if (hit) return { trdr: hit.trdr, code: hit.code ?? '', name: hit.name };
  // Ο κωδικός είναι μόνο γράμματα/ψηφία (normalizeAfm) — ασφαλής μέσα στο φίλτρο.
  const live = await softoneGetTable('TRDR', ['TRDR', 'CODE', 'NAME', 'AFM', 'ISACTIVE'], `AFM='${key}' AND SODTYPE=${sodtype}`).catch(() => []);
  const l = live.find((r) => r.ISACTIVE !== '0' && normalizeAfm(r.AFM) === key);
  return l ? { trdr: Number(l.TRDR), code: l.CODE, name: l.NAME } : null;
}

export async function createTraderInSoftone(job: CreateTraderJob): Promise<CreateTraderResult> {
  const { afm, kind, input, actor } = job;

  // Το μητρώο χωρών είναι cached 24ω μέσα στη διεργασία. Χωρίς αυτό ο συναλλασσόμενος
  // δημιουργείται κανονικά, απλώς χωρίς `COUNTRY` — γι' αυτό η αποτυχία του δεν σταματά τίποτα.
  const countries: SoftoneCountry[] = await softoneFetchCountries().catch(() => []);
  const warnings = matchCountryId(input.country, countries) ? [] : ['country_not_found'];

  const label = TRADER_KIND_LABEL[kind];
  const sodtype = TRADER_KIND_SODTYPE[kind];

  // ΠΟΤΕ ΔΕΥΤΕΡΗ ΚΑΡΤΕΛΑ ΓΙΑ ΤΟΝ ΙΔΙΟ ΑΦΜ. Στις 15/10 φτιάχτηκε δεύτερη «Α ΜΑΡΓΑΡΙΤΗΣ ΙΚΕ» (958)
  // ενώ υπήρχε η 955 μία ώρα νωρίτερα — και τα τιμολόγιά της θα περνούσαν τον έλεγχο διπλών, που
  // ψάχνει ανά καρτέλα. Αν υπάρχει, ΣΥΝΔΕΟΥΜΕ αντί να δημιουργήσουμε.
  const existing = await findExistingTrader(input.afm || afm, sodtype)
    ?? (normalizeAfm(input.afm) !== normalizeAfm(afm) ? await findExistingTrader(afm, sodtype) : null);
  if (existing) {
    await prisma.softoneTrader.upsert({
      where: { trdr: existing.trdr },
      update: {},
      create: { trdr: existing.trdr, code: existing.code, name: existing.name, afm: input.afm, sodtype, kind: label, isActive: true },
    }).catch(() => null);
    const docsUpdated = await applyTraderToDocs(
      afm, { trdr: existing.trdr, code: existing.code, name: existing.name, kind: label, sodtype }, { vatId: input.afm },
    );
    if (actor) {
      await logAudit({
        userId: actor.id, userEmail: actor.email,
        action: 'ocr.trader.link_existing', resource: 'softone_trader', resourceId: String(existing.trdr),
        metadata: { afm, vatId: input.afm, kind, code: existing.code, name: existing.name, docsUpdated },
      }).catch(() => null);
    }
    return {
      ok: true, trdr: existing.trdr, code: existing.code, name: existing.name, afm: input.afm, kind: label,
      country: input.country, docsUpdated, warnings: [...warnings, 'already_exists'], existing: true,
    };
  }

  const { trdr, code } = await softoneCreateTrader(kind, input, countries);
  const mirror = {
    code, name: input.name, afm: input.afm, sodtype, kind: label, isActive: true,
    doy: input.irsData, profession: input.profession,
    address: input.address, zip: input.zip, city: input.city,
    phone: input.phone, email: input.email,
  };
  await prisma.softoneTrader.upsert({ where: { trdr }, update: mirror, create: { trdr, ...mirror } }).catch(() => null);

  const docsUpdated = await applyTraderToDocs(
    afm, { trdr, code, name: input.name, kind: label, sodtype }, { vatId: input.afm },
  );

  if (actor) {
    await logAudit({
      userId: actor.id, userEmail: actor.email,
      action: 'ocr.trader.create', resource: 'softone_trader', resourceId: String(trdr),
      metadata: { afm, vatId: input.afm, kind, code, name: input.name, country: input.country, docsUpdated, warnings },
    }).catch(() => null);
  }

  return { ok: true, trdr, code, name: input.name, afm: input.afm, kind: label, country: input.country, docsUpdated, warnings };
}

/**
 * Διαβάζει τα ορίσματα μιας αποθηκευμένης εργασίας ουράς.
 *
 * Τα δεδομένα έχουν περάσει από JSON και μπορεί να έχουν γραφτεί από ΠΑΛΙΟΤΕΡΗ έκδοση του κώδικα,
 * γι' αυτό ελέγχονται αντί να γίνουν `as`: μια εργασία που κάθεται στην ουρά μια εβδομάδα πρέπει
 * είτε να εκτελεστεί σωστά είτε να πει καθαρά ότι δεν διαβάζεται.
 */
export function parseCreateTraderJob(p: Record<string, unknown>): CreateTraderJob {
  const j = p as Partial<CreateTraderJob>;
  const kind = j.kind;
  if (kind !== 'supplier' && kind !== 'creditor' && kind !== 'debtor') {
    throw new Error(`Η εργασία δεν έχει έγκυρο τύπο συναλλασσομένου («${String(kind)}»).`);
  }
  if (typeof j.afm !== 'string' || !j.afm) throw new Error('Η εργασία δεν έχει ΑΦΜ.');
  const i = j.input;
  if (!i || typeof i !== 'object' || typeof i.name !== 'string' || typeof i.afm !== 'string') {
    throw new Error('Η εργασία δεν έχει επωνυμία/ΑΦΜ συναλλασσομένου.');
  }
  return { afm: j.afm, kind, input: i, actor: j.actor ?? null };
}
