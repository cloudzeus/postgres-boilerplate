// lib/ocr/vat-map.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// Συντελεστής ΦΠΑ της γραμμής (π.χ. `13`) → **κωδικός κατηγορίας ΦΠΑ του SoftOne** (`VAT.VAT`,
// π.χ. `1131`). Αυτός ο αριθμός φεύγει ως `VAT` κάθε γραμμής του `setData`.
//
// ΓΙΑΤΙ ΤΟ 0 % ΕΜΠΛΕΚΕ ΚΑΘΕ ΛΟΓΑΡΙΑΣΜΟ ΡΕΥΜΑΤΟΣ. Ο χάρτης χτιζόταν αποκλειστικά από τη στήλη
// `VatCategory.rate` του καθρέφτη. Στην εγκατάσταση του πελάτη οι **μηδενικές** κατηγορίες
// («Μηδενικός Συντελεστής ΦΠΑ 0 %», «Άρθρο 39α 0 %») έρχονται από το SoftOne με `rate` **κενό**,
// όχι `0` — το ποσοστό ζει μόνο μέσα στην περιγραφή. Άρα ο χάρτης δεν είχε ΠΟΤΕ κλειδί `0`, κάθε
// γραμμή 0 % έπεφτε στο `no_vat_category`, και **δεν υπήρχε κανένας τρόπος** να διορθωθεί από την
// εφαρμογή: ο καθρέφτης είναι συγχρονισμένος και σωστός, λείπει η **αντιστοίχιση**.
//
// Η λύση δεν είναι να «μαντέψουμε» ότι το κενό σημαίνει μηδέν — δύο διαφορετικές κατηγορίες 0 %
// υπάρχουν ταυτόχρονα (απλή απαλλαγή vs άρθρο 39α) και η επιλογή έχει φορολογικές συνέπειες που
// η εφαρμογή δεν δικαιούται να κάνει. Η λύση είναι να **ρωτήσουμε** μία φορά και να το θυμόμαστε:
// ο χρήστης διαλέγει κατηγορία από το ΙΔΙΟ συγχρονισμένο μητρώο, και η επιλογή αποθηκεύεται ως
// υπέρβαση (`softone.vatRateMap`). Κανένας κωδικός δεν εφευρίσκεται ποτέ.

/** Το κλειδί ρύθμισης με τις χειροκίνητες αντιστοιχίσεις συντελεστή → κωδικού ΦΠΑ. */
export const VAT_RATE_MAP_SETTING = 'softone.vatRateMap';

/** Η γραμμή του μητρώου ΦΠΑ όπως τη χρειάζεται ο χάρτης — τίποτα παραπάνω. */
export interface VatCategoryLite {
  /** `VatCategory.code` — ο αριθμητικός κωδικός του SoftOne ως κείμενο («1131»). */
  code: string;
  /** Το ποσοστό, όπως το έδωσε το SoftOne. `null` = **δεν το δήλωσε** (π.χ. όλες οι 0 %). */
  rate: number | null;
  descr?: string | null;
  isActive?: boolean;
}

/**
 * Οι χειροκίνητες αντιστοιχίσεις, όπως ζουν στο `AppSetting`: `{ "0": "1000" }`.
 * Κλειδί = ο συντελεστής ως κείμενο· τιμή = ο `VatCategory.code`.
 */
export type VatRateOverrides = Record<string, string>;

/** Διαβάζει την τιμή της ρύθμισης ανεκτικά: ό,τι δεν είναι ζεύγος αριθμού→κειμένου πετιέται. */
export function parseVatRateOverrides(raw: unknown): VatRateOverrides {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: VatRateOverrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const rate = Number(String(k).replace(',', '.'));
    const code = String(v ?? '').trim();
    if (!Number.isFinite(rate) || rate < 0 || !code) continue;
    out[String(rate)] = code;
  }
  return out;
}

export interface VatRateMap {
  /** Συντελεστής → αριθμητικός κωδικός ΦΠΑ. Αυτό φεύγει στο payload. */
  byRate: Record<number, number>;
  /** Ποιοι συντελεστές λύθηκαν από **χειροκίνητη** αντιστοίχιση — για να το λέει το UI. */
  overridden: number[];
  /**
   * Υπερβάσεις που **αγνοήθηκαν** επειδή ο κωδικός δεν υπάρχει (ή δεν είναι ενεργός) στο μητρώο.
   * Δεν τις εφαρμόζουμε σιωπηλά: ένας κωδικός που δεν υπάρχει στο SoftOne θα απορριπτόταν εκεί.
   */
  ignored: { rate: number; code: string }[];
}

/**
 * Χτίζει τον χάρτη. **Πρώτος κερδίζει** για τις αυτόματες εγγραφές: το μητρώο έρχεται ήδη
 * ταξινομημένο (`order`, `code`) και δύο ενεργές κατηγορίες με τον ίδιο συντελεστή (π.χ. «ΦΠΑ 24 %»
 * και «2 ΦΠΑ 24 %») δεν επιτρέπεται να αλλάζουν τον κωδικό που στέλνουμε ανάλογα με τη διάθεση
 * του planner. Η **χειροκίνητη** αντιστοίχιση νικά πάντα την αυτόματη: είναι ρητή απόφαση ανθρώπου.
 */
export function buildVatRateMap(
  rows: readonly VatCategoryLite[],
  overrides: VatRateOverrides = {},
): VatRateMap {
  const byRate: Record<number, number> = {};
  const overridden: number[] = [];
  const ignored: { rate: number; code: string }[] = [];

  for (const v of rows) {
    if (v.isActive === false) continue;
    const rate = v.rate == null ? null : Number(v.rate);
    const code = Number(v.code);
    if (rate == null || !Number.isFinite(rate) || !Number.isFinite(code)) continue;
    if (byRate[rate] == null) byRate[rate] = code;
  }

  const known = new Map(rows.filter((r) => r.isActive !== false).map((r) => [String(r.code).trim(), r]));
  for (const [rateKey, code] of Object.entries(overrides)) {
    const rate = Number(rateKey);
    if (!Number.isFinite(rate)) continue;
    const row = known.get(code);
    const id = Number(code);
    if (!row || !Number.isFinite(id)) { ignored.push({ rate, code }); continue; }
    byRate[rate] = id;
    overridden.push(rate);
  }

  return { byRate, overridden, ignored };
}

/**
 * Ποιοι συντελεστές των γραμμών **δεν** έχουν κωδικό. Αυτή είναι η λίστα που δείχνει η λωρίδα
 * ελέγχων και που ο χρήστης λύνει επί τόπου. `null` συντελεστής μετράει ως λείπων **μόνο όταν
 * η γραμμή δηλώνει ρητά ότι δεν έχει ΦΠΑ**; εδώ, όπως και στο `postingBlockers`, μια γραμμή χωρίς
 * συντελεστή είναι αδύνατο να αντιστοιχιστεί και αναφέρεται ως `null`.
 */
export function missingVatRates(
  rates: readonly (number | null | undefined)[],
  byRate: Record<number, number>,
): (number | null)[] {
  const out: (number | null)[] = [];
  const seen = new Set<string>();
  for (const r of rates) {
    const rate = r == null || !Number.isFinite(Number(r)) ? null : Number(r);
    if (rate != null && byRate[rate] != null) continue;
    const key = String(rate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rate);
  }
  return out;
}

/**
 * Ποιες κατηγορίες του μητρώου έχει νόημα να προταθούν για έναν συντελεστή που λείπει.
 *
 * Προτείνουμε αυτές που **γράφουν το ποσοστό στην περιγραφή τους** («… 0 %», «ΦΠΑ 24 %»): είναι η
 * μόνη ένδειξη που έχουμε όταν η στήλη `rate` είναι κενή, και είναι ένδειξη του ΙΔΙΟΥ του SoftOne,
 * όχι δική μας εικασία. Δεν επιλέγουμε τίποτα αυτόματα — απλώς βάζουμε πρώτες τις πιθανές.
 */
export function suggestVatCategories(
  rows: readonly VatCategoryLite[],
  rate: number | null,
): VatCategoryLite[] {
  const active = rows.filter((r) => r.isActive !== false);
  if (rate == null) return active;
  const matches = (r: VatCategoryLite): boolean => {
    if (r.rate != null && Number(r.rate) === rate) return true;
    const m = String(r.descr ?? '').match(/(\d+(?:[.,]\d+)?)\s*%/);
    return m ? Number(m[1].replace(',', '.')) === rate : false;
  };
  return [...active.filter(matches), ...active.filter((r) => !matches(r))];
}
