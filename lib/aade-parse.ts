/**
 * Ανάλυση της απάντησης του proxy `afm2info` (μητρώο ΑΑΔΕ) σε καθαρό σχήμα.
 *
 * Ο proxy μεταφράζει XML σε JSON: τα **κενά** (nil) στοιχεία δεν έρχονται ως
 * `null` αλλά ως **αντικείμενα** — π.χ. `{ '@_xsi:nil': 'true' }` ή `{}` — και
 * ένα σκέτο `String(v)` τα κάνει «[object Object]». Γι' αυτό κάθε πεδίο περνά
 * από το {@link textOf}.
 *
 * Καθαρές συναρτήσεις, χωρίς δίκτυο: το route κάνει μόνο το fetch.
 */

/** Ό,τι δίνει το μητρώο ΑΑΔΕ για ένα ΑΦΜ (χωρίς τη γραμμή Δ.Ο.Υ. του SoftOne). */
export interface Afm2InfoRecord {
  afm: string;
  name: string;
  /**
   * Ο ΕΠΙΣΗΜΟΣ κωδικός Δ.Ο.Υ. της ΑΑΔΕ (`basic_rec.doy`, π.χ. «1190»). Αυτό είναι το κλειδί της
   * αντιστοίχισης με το SoftOne (`IRSDATA.CODE`) — βλ. `lib/tax-office.ts`. Η ονομασία
   * (`doyDescr`) είναι μόνο για εμφάνιση και για την εφεδρική ακριβή σύγκριση όταν λείπει ο κωδικός.
   */
  doyCode: string | null;
  doyDescr: string | null;
  profession: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  legalForm: string | null;
  isActive: boolean;
}

/** Κλειδιά που κρύβουν το κείμενο σε XML→JSON αντικείμενα. */
const TEXT_KEYS = ['_', '#text', '$t'] as const;

/**
 * Κείμενο από οτιδήποτε γυρίζει ο proxy:
 * - `string` → trimmed ή `null` αν είναι κενό
 * - `number` → η γραφή του
 * - `array` → το πρώτο στοιχείο που δίνει κείμενο
 * - `object` → το `_` / `#text` / `$t` του, αλλιώς `null` (nil element)
 * - οτιδήποτε άλλο (`null`, boolean, …) → `null`
 */
export function textOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = textOf(item);
      if (t) return t;
    }
    return null;
  }
  if (typeof v === 'object') {
    for (const k of TEXT_KEYS) {
      if (k in (v as Record<string, unknown>)) {
        const t = textOf((v as Record<string, unknown>)[k]);
        if (t) return t;
      }
    }
    return null;
  }
  return null;
}

/** `firm_act_tab.item` → πάντα πίνακας (ο proxy δίνει αντικείμενο όταν είναι ένα). */
function actList(raw: unknown): Record<string, unknown>[] {
  const item = (raw as { firm_act_tab?: { item?: unknown } } | null)?.firm_act_tab?.item;
  const list = Array.isArray(item) ? item : item ? [item] : [];
  return list.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object');
}

/**
 * Απάντηση `afm2info` → {@link Afm2InfoRecord}, ή `null` όταν το ΑΦΜ δεν
 * υπάρχει στο μητρώο. «Δεν υπάρχει» σημαίνει: `basic_rec.afm` χωρίς κείμενο
 * (ξένο ΑΦΜ — όλα τα στοιχεία έρχονται nil) **ή** κενή επωνυμία.
 */
export function parseAfm2Info(raw: unknown): Afm2InfoRecord | null {
  const b = (raw as { basic_rec?: unknown } | null)?.basic_rec;
  if (!b || typeof b !== 'object') return null;
  const rec = b as Record<string, unknown>;

  const afm = textOf(rec.afm);
  const name = textOf(rec.onomasia);
  if (!afm || !name) return null;

  // Κύρια δραστηριότητα (ΚΑΔ) → επάγγελμα· αλλιώς η πρώτη που υπάρχει.
  const acts = actList(raw);
  const primary = acts.find((a) => textOf(a.firm_act_kind) === '1') ?? acts[0];

  const address = [textOf(rec.postal_address), textOf(rec.postal_address_no)]
    .filter(Boolean).join(' ');

  return {
    afm,
    name,
    doyCode: textOf(rec.doy),
    doyDescr: textOf(rec.doy_descr),
    profession: textOf(primary?.firm_act_descr),
    address: address || null,
    zip: textOf(rec.postal_zip_code),
    city: textOf(rec.postal_area_description),
    legalForm: textOf(rec.legal_status_descr),
    // Στην ΑΑΔΕ το «1» σημαίνει ΕΝΕΡΓΟΣ.
    isActive: textOf(rec.deactivation_flag) === '1',
  };
}
