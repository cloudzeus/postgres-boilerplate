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
   *
   * Είναι η **ΚΥΡΙΑ** δραστηριότητα και μόνο. Δες {@link tradeActivities} για το γιατί αυτό
   * από μόνο του δεν αρκεί.
   */
  activity: string | null;
  /**
   * Οι **ΕΜΠΟΡΙΚΕΣ** δραστηριότητες του μητρώου — οι ΚΑΔ που σημαίνουν «αγοράζουμε για να
   * ξαναπουλήσουμε» (ομάδες 45/46/47, **χωρίς** το `46.1` που είναι μεσιτεία έναντι αμοιβής).
   * Κενός πίνακας όταν δεν υπάρχει καμία, και αυτό είναι **δήλωση**, όχι απουσία: «καμία
   * εμπορική δραστηριότητα στο μητρώο» απαντά κατηγορηματικά το ερώτημα «μεταπωλούμε;» με
   * **όχι** — γι' αυτό και το {@link kadDigits} κοιτάζει και το `code`, ώστε το «όχι» να μη
   * βγαίνει ποτέ από ελλιπή δεδομένα.
   *
   * Γιατί χρειάζεται χωριστά από το {@link activity}: η κύρια δραστηριότητα είναι **μία** και
   * συχνά δεν είναι η εμπορική. Μια εταιρεία λογισμικού με κύριο ΚΑΔ «ανάπτυξη λογισμικού» και
   * **δευτερεύον** «χονδρικό εμπόριο εξοπλισμού πληροφορικής» μεταπωλεί πραγματικά υπολογιστές
   * — και με μόνη την κύρια δραστηριότητα στο prompt, ένας αγορασμένος υπολογιστής κατατάσσεται
   * σωστά (πάνω στα δεδομένα που δόθηκαν) ως **έξοδο**. Η κεφαλίδα αυτού του αρχείου λέει ότι
   * το ερώτημα είναι «για μεταπώληση ή για ανάλωση;» — και πετούσαμε ακριβώς το πεδίο που το
   * απαντά.
   */
  tradeActivities: string[];
}

export const UNKNOWN_OWN_COMPANY: OwnCompanyProfile = {
  afm: null, name: null, activity: null, tradeActivities: [],
};

/**
 * Οι **διψήφιες ομάδες ΚΑΔ** που σημαίνουν εμπόριο: **45** (οχήματα), **46** (χονδρικό),
 * **47** (λιανικό).
 *
 * Ολόκληρο το εύρος και όχι διαλεχτοί κωδικοί, επίτηδες. Το NACE/ΚΑΔ **έχει ήδη** αυτή τη
 * διάκριση ενσωματωμένη: ο τομέας G («Χονδρικό και λιανικό εμπόριο») είναι εξ ορισμού
 * «μεταπώληση χωρίς ουσιαστικό μετασχηματισμό» — δηλαδή **ακριβώς** το ερώτημα που θέτουμε.
 * Μια χειροδιαλεγμένη λίστα κωδικών θα ήταν δική μας εικασία πάνω σε ταξινομία που ήδη
 * απαντά, θα ξεχνούσε κωδικούς, και θα σάπιζε με κάθε αναθεώρηση των ΚΑΔ. Το εύρος είναι
 * επαληθεύσιμο σε μια γραμμή· μια λίστα 40 κωδικών δεν είναι.
 */
const TRADE_KAD_DIVISIONS = new Set(['45', '46', '47']);

/**
 * **ΕΞΑΙΡΕΣΗ: η ομάδα `46.1` — εμπόριο ΕΝΑΝΤΙ ΑΜΟΙΒΗΣ.**
 *
 * Το `46.1` είναι «χονδρικό εμπόριο **έναντι αμοιβής ή βάσει σύμβασης**»: μεσίτες και
 * αντιπρόσωποι που **ποτέ δεν αποκτούν κυριότητα** των αγαθών. Δεν αγοράζουν για να
 * ξαναπουλήσουν — διαμεσολαβούν και εισπράττουν προμήθεια. Τυπώνοντάς το κάτω από «ΜΟΝΟ αυτά
 * μεταπωλούμε» θα λέγαμε στο μοντέλο **το ακριβώς αντίθετο** από αυτό που δηλώνει ο ΚΑΔ, και θα
 * το ενθαρρύναμε να δει απόθεμα εκεί που δεν υπάρχει.
 */
const COMMISSION_KAD_GROUP = '461';

/**
 * Πόσες εμπορικές δραστηριότητες φτάνουν στο prompt. Είναι μακριές συμβολοσειρές, αλλά η λίστα
 * παρουσιάζεται στο μοντέλο ως **κλειστή** («ΜΟΝΟ αυτά μεταπωλούμε») — οπότε μια σιωπηλή κοπή θα
 * μετέτρεπε αλήθεια σε ψέμα. Το πλαφόν είναι γενναίο, και ό,τι περισσεύει **δηλώνεται** αντί να
 * εξαφανιστεί (δες {@link tradeActivityLines}).
 */
const MAX_TRADE_ACTIVITIES = 12;

/**
 * Η διψήφια ομάδα ενός ΚΑΔ από τα **αποθηκευμένα** πεδία, όχι από την περιγραφή.
 *
 * Δοκιμάζονται **και τα τρία** πεδία με σειρά: `codeAade` (zero-padded 8ψήφιο, «46500000»),
 * `codeWithoutDots`, και τέλος το `code` με τις τελείες («46.50.00»). Το τελευταίο δεν είναι
 * περιττό: υπάρχουν ζωντανές εταιρείες όπου **κάθε** γραμμή δραστηριότητας έχει `codeAade` και
 * `codeWithoutDots` `NULL` και μόνο το `code` συμπληρωμένο. Χωρίς αυτό, μια εταιρεία λιανικού
 * εμπορίου θα εμφανιζόταν στο prompt ως «ΚΑΜΙΑ εμπορική δραστηριότητα — δεν μεταπωλούμε» —
 * **ελλιπή δεδομένα παρουσιασμένα ως θετικός ισχυρισμός**, ακριβώς η αποτυχία που προειδοποιεί
 * η κεφαλίδα αυτού του αρχείου.
 *
 * Ποτέ από το κείμενο: η λέξη «εμπόριο» εμφανίζεται και σε ΚΑΔ που δεν είναι μεταπώληση.
 */
const kadDigits = (a: { codeAade: string | null; codeWithoutDots: string | null; code: string | null }): string =>
  (a.codeAade ?? a.codeWithoutDots ?? a.code ?? '').replace(/\D/g, '');

/** `true` όταν ο ΚΑΔ δηλώνει πραγματική **μεταπώληση** (ομάδες 45/46/47, εκτός του 46.1). */
function isTradeKad(a: { codeAade: string | null; codeWithoutDots: string | null; code: string | null }): boolean {
  const d = kadDigits(a);
  if (d.length < 2) return false;
  if (!TRADE_KAD_DIVISIONS.has(d.slice(0, 2))) return false;
  return d.slice(0, 3) !== COMMISSION_KAD_GROUP;
}

/**
 * Οι γραμμές που θα μπουν στο prompt, με την **ΚΥΡΙΑ** δραστηριότητα πρώτη και ρητή αναφορά σε
 * όσες δεν χώρεσαν. Μια λίστα που παρουσιάζεται ως κλειστή δεν επιτρέπεται να κόβεται σιωπηλά.
 */
export function tradeActivityLines(
  activities: readonly { codeAade: string | null; codeWithoutDots: string | null; code: string | null; description: string; kind: string }[],
): string[] {
  const trade = activities.filter(isTradeKad);
  // ΚΥΡΙΑ πρώτη: αν κοπεί κάτι, να κοπεί το λιγότερο χαρακτηριστικό.
  const sorted = [...trade].sort((a, b) => Number(b.kind === 'PRIMARY') - Number(a.kind === 'PRIMARY'));
  const shown = sorted.slice(0, MAX_TRADE_ACTIVITIES).map((a) => {
    const code = a.codeAade ?? a.codeWithoutDots ?? a.code ?? '';
    return `${code} ${(a.description ?? '').trim()}`.trim();
  }).filter(Boolean);
  const rest = sorted.length - shown.length;
  return rest > 0 ? [...shown, `…και άλλες ${rest} εμπορικές δραστηριότητες`] : shown;
}

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
  let value: OwnCompanyProfile = { afm, name: null, activity: null, tradeActivities: [] };

  if (afm) {
    const row = await prisma.company
      .findFirst({
        where: { afm },
        select: {
          name: true,
          profession: true,
          gemiObjective: true,
          // Οι ΚΑΔ του μητρώου: η ΚΥΡΙΑ δραστηριότητα δεν είναι κατ' ανάγκη η εμπορική.
          activities: {
            select: { codeAade: true, codeWithoutDots: true, code: true, description: true, kind: true },
            orderBy: { order: 'asc' },
          },
        },
      })
      .catch(() => null);
    if (row) {
      const activity = (row.profession ?? '').trim() || (row.gemiObjective ?? '').trim();
      const tradeActivities = tradeActivityLines(row.activities ?? []);
      value = {
        afm,
        name: row.name ?? null,
        activity: activity ? activity.slice(0, 300) : null,
        tradeActivities,
      };
    }
  }

  cached = { at: Date.now(), value };
  return value;
}

/** Μόνο για tests / μετά από αλλαγή ρύθμισης. */
export const clearOwnCompanyCache = (): void => { cached = null; };
