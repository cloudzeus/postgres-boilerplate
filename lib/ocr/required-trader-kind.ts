import 'server-only';
import { prisma } from '@/lib/db';
import { SODTYPE_FOR_OBJECT, resolvePostingTarget, type PostObject, type PostingTarget } from '@/lib/ocr/posting-target';
import { TRADER_KIND_SODTYPE, type TraderKind } from '@/lib/softone';

/**
 * «Τι ΤΥΠΟ καρτέλας χρειάζεται αυτό το παραστατικό» — μία πηγή αλήθειας.
 *
 * Στο SoftOne η ίδια εταιρεία υπάρχει **πολλές φορές** στον `TRDR`: μία γραμμή ανά τύπο
 * (12 προμηθευτής · 16 πιστωτής · 15 χρεώστης), ίδιο ΑΦΜ, διαφορετικό `CODE`. Ποια από αυτές
 * δέχεται η κεφαλίδα δεν το αποφασίζει ο εκδότης — το αποφασίζει η **ΣΕΙΡΑ** του παραστατικού:
 * η σειρά ορίζει το object καταχώρισης (`resolvePostingTarget`) και το object ορίζει το
 * `TRDR.SODTYPE` που δέχεται (`SODTYPE_FOR_OBJECT`).
 *
 * Η ίδια αλυσίδα χρειάζεται σε τρία σημεία — στην ευθυγράμμιση μετά τη σάρωση
 * (`alignTraderToTarget`), στην ουρά «Νέοι συναλλασσόμενοι» (ποιος εκδότης είναι ακόμη
 * εκκρεμής και για ΠΟΙΟΝ τύπο) και στην αρχική σύνδεση (`applyTraderToDocs`). Ζει εδώ μία φορά
 * ώστε οι τρεις να μη μπορούν να διαφωνήσουν.
 *
 * **Άγνωστη ή μη υποστηριζόμενη σειρά ⇒ `null`**, ΟΧΙ μια προεπιλογή «προμηθευτής». Ένα
 * παραστατικό χωρίς σειρά δεν ξέρουμε πού καταχωρείται, άρα δεν ξέρουμε ούτε τι καρτέλα θέλει:
 * το να το χρεώναμε στον τύπο «προμηθευτής» θα γεννούσε **φανταστική εκκρεμότητα** (ουρά που
 * ζητά καρτέλα που ίσως δεν χρειάζεται ποτέ) ή, χειρότερα, λάθος καρτέλα στην κεφαλίδα.
 */
export interface RequiredTraderKind {
  /** `TRDR.SODTYPE` που δέχεται η κεφαλίδα (12 / 16 / 15). */
  sodtype: number;
  /** Ο ίδιος τύπος με τα ονόματα της εφαρμογής. */
  kind: TraderKind;
  /** Το object καταχώρισης που το επέβαλε (για εξηγήσεις στο UI). */
  object: PostObject;
}

/** Η σειρά ενός εγγράφου, όπως ακριβώς τη γράφει η σάρωση πάνω στο `OcrDocument`. */
export interface DocSeriesRef {
  seriesSource: number | null;
  softoneSeries: string | null;
}

/** SODTYPE → όνομα τύπου. Παράγεται από τον ΙΔΙΟ χάρτη που χρησιμοποιεί η δημιουργία καρτέλας. */
const KIND_BY_SODTYPE = new Map<number, TraderKind>(
  (Object.keys(TRADER_KIND_SODTYPE) as TraderKind[]).map((k) => [TRADER_KIND_SODTYPE[k], k]),
);

/** Κλειδί ομαδοποίησης μιας σειράς: ενότητα + κωδικός. */
export const seriesKey = (ref: DocSeriesRef): string | null =>
  ref.seriesSource == null || !ref.softoneSeries ? null : `${ref.seriesSource}|${ref.softoneSeries}`;

/** Η γραμμή μητρώου μιας σειράς — ό,τι χρειάζεται ο `resolvePostingTarget`, τίποτα άλλο. */
type SeriesRow = { name?: string | null; section?: string | null; postObject?: string | null; postLines?: string | null };

/** Από τον προορισμό στον απαιτούμενο τύπο — `null` όταν η ενότητα δεν υποστηρίζεται. */
function kindFromTarget(target: PostingTarget | null): RequiredTraderKind | null {
  if (!target?.supported) return null;
  const sodtype = SODTYPE_FOR_OBJECT[target.object];
  const kind = KIND_BY_SODTYPE.get(sodtype);
  // Ένα object που δείχνει σε SODTYPE εκτός των τριών (π.χ. πελάτης) δεν είναι εκκρεμότητα
  // «νέου συναλλασσομένου» αυτής της ουράς — καλύτερα σιωπή παρά λάθος τύπος.
  return kind ? { sodtype, kind, object: target.object } : null;
}

/**
 * Ο απαιτούμενος τύπος για **πολλά** έγγραφα με μία ανάγνωση ανά μητρώο σειρών.
 *
 * Επιστρέφει χάρτη με κλειδί το {@link seriesKey}. Έγγραφα χωρίς σειρά δεν μπαίνουν καν στον
 * χάρτη — ο καλών τα βλέπει ως «άγνωστο», που δεν είναι το ίδιο με «δεν χρειάζεται καρτέλα».
 */
export async function requiredTraderKinds(
  refs: readonly DocSeriesRef[],
): Promise<Map<string, RequiredTraderKind | null>> {
  const targets = await postingTargetsForSeries(refs);
  const out = new Map<string, RequiredTraderKind | null>();
  for (const [key, target] of targets) out.set(key, kindFromTarget(target));
  return out;
}

/**
 * Ο **προορισμός καταχώρισης** ανά σειρά (object + πίνακας γραμμών), με μία ανάγνωση ανά μητρώο.
 *
 * Είναι η ίδια ανάγνωση που χρειάζεται και ο απαιτούμενος τύπος συναλλασσομένου και η
 * κατηγοριοποίηση των γραμμών (`lib/ocr/line-kind.ts`): ο πίνακας γραμμών ΟΡΙΖΕΙ σε ποιο μητρώο
 * πρέπει να δείχνει η γραμμή. Γι' αυτό ζει εδώ, μία φορά.
 */
export async function postingTargetsForSeries(
  refs: readonly DocSeriesRef[],
): Promise<Map<string, PostingTarget | null>> {
  const out = new Map<string, PostingTarget | null>();

  const pairs = new Map<string, { sosource: number; code: string }>();
  for (const ref of refs) {
    const key = seriesKey(ref);
    if (key && !pairs.has(key)) pairs.set(key, { sosource: Number(ref.seriesSource), code: String(ref.softoneSeries) });
  }
  if (pairs.size === 0) return out;

  const all = [...pairs.values()];
  // Οι σειρές ΑΓΟΡΩΝ (1251) ζουν σε δικό τους μητρώο (`PurchaseDocType`), οι υπόλοιπες στο
  // γενικό `SoftoneDocSeries` — ακριβώς όπως τις διαβάζει και η καταχώριση.
  const purchase = all.filter((p) => p.sosource === 1251);
  const other = all.filter((p) => p.sosource !== 1251);

  const [purchaseRows, otherRows] = await Promise.all([
    purchase.length === 0 ? Promise.resolve([]) : prisma.purchaseDocType.findMany({
      where: { code: { in: purchase.map((p) => p.code) } },
      select: { code: true, name: true, section: true, postObject: true, postLines: true },
    }).catch(() => []),
    other.length === 0 ? Promise.resolve([]) : prisma.softoneDocSeries.findMany({
      where: { OR: other.map((p) => ({ sosource: p.sosource, code: p.code })) },
      select: { sosource: true, code: true, name: true, section: true, postObject: true, postLines: true },
    }).catch(() => []),
  ]);

  const purchaseByCode = new Map(purchaseRows.map((r) => [r.code, r]));
  const otherByKey = new Map(otherRows.map((r) => [`${r.sosource}|${r.code}`, r]));

  for (const [key, p] of pairs) {
    const row: SeriesRow | null = p.sosource === 1251
      ? purchaseByCode.get(p.code) ?? null
      : otherByKey.get(key) ?? null;
    const target = resolvePostingTarget({ sosource: p.sosource, ...(row ?? {}) });
    out.set(key, target.supported ? target : null);
  }
  return out;
}

/** Ο απαιτούμενος τύπος για **ένα** έγγραφο. `null` = άγνωστη ή μη υποστηριζόμενη σειρά. */
export async function requiredTraderKind(ref: DocSeriesRef): Promise<RequiredTraderKind | null> {
  const key = seriesKey(ref);
  if (!key) return null;
  const map = await requiredTraderKinds([ref]);
  return map.get(key) ?? null;
}
