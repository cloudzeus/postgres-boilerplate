// lib/ocr/own-company.ts — SERVER. «Ποιοι είμαστε εμείς», για όποιον χρειάζεται να κρίνει με
// βάση τη ΔΙΚΗ ΜΑΣ δραστηριότητα και όχι μόνο το κείμενο μιας γραμμής.
//
// Γιατί έχει σημασία: το αν μια γραμμή είναι **είδος** δεν είναι ιδιότητα του πράγματος, είναι
// ιδιότητα του **τι κάνει η αγοράστρια επιχείρηση**. Το ψωμί είναι απόθεμα για έναν φούρνο και
// έξοδο για ένα γραφείο. Χωρίς να ξέρει κανείς τι κάνουμε εμείς, το ερώτημα «για μεταπώληση ή
// για ανάλωση;» δεν απαντιέται.
import 'server-only';
import { prisma } from '@/lib/db';
import { resolveOwnAfm } from '@/lib/ocr/own-afm';

export interface OwnCompanyProfile {
  /** Το ΑΦΜ μας (`company.ownVat` ρύθμιση ή `COMPANY_OWN_VAT`). */
  afm: string | null;
  name: string | null;
  /**
   * Τι κάνει η επιχείρηση, σε μία γραμμή: επάγγελμα ΑΑΔΕ, αλλιώς ο σκοπός από το ΓΕΜΗ.
   * `null` όταν **δεν το ξέρουμε** — και τότε δεν το εφευρίσκουμε πουθενά.
   */
  activity: string | null;
}

export const UNKNOWN_OWN_COMPANY: OwnCompanyProfile = { afm: null, name: null, activity: null };

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; value: OwnCompanyProfile } | null = null;

/**
 * Η ταυτότητα και η δραστηριότητά μας από τα δεδομένα που ήδη κρατάμε: το ΑΦΜ από τη ρύθμιση
 * `company.ownVat` και, αν υπάρχει καρτέλα εταιρείας με αυτό το ΑΦΜ, το **επάγγελμα** (από την
 * ΑΑΔΕ) ή ο **σκοπός** (ΓΕΜΗ).
 *
 * Ποτέ δεν πετάει και ποτέ δεν μαντεύει: αν λείπει η καρτέλα, γυρίζει `activity: null` και ο
 * καλών οφείλει να το πει στο prompt ως «άγνωστη δραστηριότητα» αντί να φανταστεί μία.
 */
export async function resolveOwnCompany(): Promise<OwnCompanyProfile> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const afm = await resolveOwnAfm().catch(() => null);
  let value: OwnCompanyProfile = { afm, name: null, activity: null };

  if (afm) {
    const row = await prisma.company
      .findFirst({
        where: { afm },
        select: { name: true, profession: true, gemiObjective: true },
      })
      .catch(() => null);
    if (row) {
      const activity = (row.profession ?? '').trim() || (row.gemiObjective ?? '').trim();
      value = { afm, name: row.name ?? null, activity: activity ? activity.slice(0, 300) : null };
    }
  }

  cached = { at: Date.now(), value };
  return value;
}

/** Μόνο για tests / μετά από αλλαγή ρύθμισης. */
export const clearOwnCompanyCache = (): void => { cached = null; };
