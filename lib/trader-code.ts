/**
 * Επόμενος ΕΛΕΥΘΕΡΟΣ κωδικός συναλλασσομένου — καθαρή λογική, χωρίς I/O.
 *
 * Γιατί υπάρχει: το `CODE` του `TRDR` είναι `required: true`, `calculated: false`,
 * `defaultvalue: ""` σε `SUPPLIER`, `CREDITOR` **και** `CUSTOMER`. Η αυτόματη
 * αρίθμηση ΔΕΝ είναι ιδιότητα του object — θα ήταν μάσκα αρίθμησης της εγκατάστασης,
 * και αυτή η εγκατάσταση δεν έχει τέτοια για συναλλασσομένους: `setData` με το `CODE`
 * **παραλειμμένο** απορρίπτεται με «Δεν έχετε συμπληρώσει το πεδίο 'Κωδικός'»
 * (επιβεβαιωμένο ζωντανά, 2026-09-16).
 *
 * Άρα τον κωδικό πρέπει να τον δώσει κάποιος. Αντί να τον εφεύρουμε, τον
 * **συμπεραίνουμε από ό,τι ήδη υπάρχει** για τον ΙΔΙΟ τύπο συναλλασσομένου.
 */

/** Το σχήμα ενός κωδικού: πρόθεμα + τελική ακολουθία ψηφίων. */
export interface CodeShape {
  /** Ό,τι προηγείται της τελικής ακολουθίας ψηφίων («53-» στο «53-00001», «» στο «0001»). */
  prefix: string;
  /** Η αριθμητική τιμή της τελικής ακολουθίας (00001 → 1). */
  value: number;
  /** Πόσα ψηφία έχει η ακολουθία (00001 → 5) — διατηρείται στο padding. */
  width: number;
}

/** Από πού προέκυψε η πρόταση. */
export type CodeSource =
  /** Συμπεράθηκε από τους υπάρχοντες κωδικούς του ΙΔΙΟΥ τύπου. */
  | 'pattern'
  /** Δεν υπήρχε κανένας κωδικός — χρησιμοποιήθηκε η μάσκα που όρισε ο χρήστης. */
  | 'mask'
  /** Ούτε κωδικοί ούτε μάσκα: δεν προτείνουμε τίποτα. */
  | 'none';

export interface NextCodeResult {
  /** Ο προτεινόμενος κωδικός — `null` όταν δεν υπάρχει καμία βάση για πρόταση. */
  code: string | null;
  source: CodeSource;
  /** Το σχήμα που αναγνωρίστηκε (για εξήγηση στο UI). */
  prefix?: string;
  width?: number;
  /** Πόσοι κωδικοί του τύπου λήφθηκαν υπόψη. */
  taken: number;
}

/** «53-00001» → { prefix: '53-', value: 1, width: 5 }. Χωρίς τελικά ψηφία → `null`. */
export function parseCodeShape(code: string): CodeShape | null {
  const s = String(code ?? '').trim();
  if (!s) return null;
  const m = /^(.*?)(\d+)$/.exec(s);
  if (!m) return null;
  const digits = m[2];
  // Πάνω από 15 ψηφία χάνεται η ακρίβεια του Number — τέτοιος κωδικός δεν είναι σειρά.
  if (digits.length > 15) return null;
  return { prefix: m[1], value: Number(digits), width: digits.length };
}

/** `1000` σε πλάτος 4 → «1000»· `1000` σε πλάτος 3 → «1000» (ο κωδικός μεγαλώνει, δεν κόβεται). */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

const MAX_PROBE = 10_000;

/**
 * Ο επόμενος ελεύθερος κωδικός για έναν τύπο συναλλασσομένου.
 *
 * Αλγόριθμος:
 * 1. Κάθε υπάρχων κωδικός σπάει σε **πρόθεμα + τελικά ψηφία**.
 * 2. Οι κωδικοί ομαδοποιούνται κατά πρόθεμα και επιλέγεται το **κυρίαρχο** (το
 *    πολυπληθέστερο· ισοπαλία → αυτό με το μεγαλύτερο max· μετά → αλφαβητικά).
 * 3. Πρόταση = `πρόθεμα + pad(max + 1, πλάτος)`. Το `max + 1` (και ΟΧΙ το πρώτο κενό)
 *    επειδή ένα κενό στη σειρά σημαίνει συνήθως **διαγραμμένη ή δεσμευμένη** εγγραφή
 *    — η επαναχρησιμοποίησή του συγχέει ιστορικό και λογιστικές παραπομπές.
 * 4. Κωδικοί που **δεν** ταιριάζουν στο κυρίαρχο σχήμα αγνοούνται για την αύξηση,
 *    αλλά μετρούν ως **πιασμένοι**: η πρόταση δεν συμπίπτει ποτέ με υπάρχοντα.
 * 5. Χωρίς κανέναν κωδικό, πέφτουμε στη **μάσκα** του τύπου (αν έχει οριστεί) —
 *    ένας δείγμα-κωδικός, π.χ. «53-00001», που χρησιμοποιείται αυτούσιος αν είναι
 *    ελεύθερος. Χωρίς μάσκα ΔΕΝ εφευρίσκουμε τίποτα: `code: null`.
 *
 * Το `existing` πρέπει να περιέχει κωδικούς **ΜΟΝΟ** του ίδιου τύπου: ένας πιστωτής
 * δεν κληρονομεί την αρίθμηση των προμηθευτών ή των λογαριασμών τραπέζης.
 */
export function nextTraderCode(
  existing: readonly string[],
  opts: { mask?: string | null } = {},
): NextCodeResult {
  const codes = existing.map((c) => String(c ?? '').trim()).filter(Boolean);
  const taken = new Set(codes.map((c) => c.toUpperCase()));
  const free = (candidate: string) => !taken.has(candidate.toUpperCase());

  const shapes = codes
    .map((c) => ({ code: c, shape: parseCodeShape(c) }))
    .filter((r): r is { code: string; shape: CodeShape } => r.shape !== null);

  if (shapes.length > 0) {
    // Ομαδοποίηση κατά πρόθεμα.
    const groups = new Map<string, { count: number; max: number; width: number }>();
    for (const { shape } of shapes) {
      const g = groups.get(shape.prefix);
      if (!g) {
        groups.set(shape.prefix, { count: 1, max: shape.value, width: shape.width });
        continue;
      }
      g.count += 1;
      if (shape.value > g.max) g.max = shape.value;
      // Το πλάτος του ΜΕΓΑΛΥΤΕΡΟΥ κωδικού ορίζει το padding της ομάδας.
      if (shape.width > g.width) g.width = shape.width;
    }

    const [prefix, g] = [...groups.entries()].sort((a, b) =>
      b[1].count - a[1].count || b[1].max - a[1].max || a[0].localeCompare(b[0]),
    )[0];

    for (let n = g.max + 1, i = 0; i < MAX_PROBE; n += 1, i += 1) {
      const candidate = prefix + pad(n, g.width);
      if (free(candidate)) {
        return { code: candidate, source: 'pattern', prefix, width: g.width, taken: taken.size };
      }
    }
    // Πρακτικά ανέφικτο· καλύτερα «δεν ξέρω» παρά ένας κωδικός που θα απορριφθεί.
    return { code: null, source: 'none', taken: taken.size };
  }

  // Καμία απόδειξη από τα δεδομένα: μόνο ό,τι έχει δηλώσει ρητά ο χρήστης.
  const mask = String(opts.mask ?? '').trim();
  if (!mask) return { code: null, source: 'none', taken: taken.size };

  const shape = parseCodeShape(mask);
  if (!shape) {
    // Μάσκα χωρίς ψηφία (π.χ. «ΠΙΣΤ»): δεν είναι σειρά — τη δίνουμε ως έχει αν είναι ελεύθερη.
    return free(mask)
      ? { code: mask, source: 'mask', prefix: mask, width: 0, taken: taken.size }
      : { code: null, source: 'none', taken: taken.size };
  }
  for (let n = shape.value, i = 0; i < MAX_PROBE; n += 1, i += 1) {
    const candidate = shape.prefix + pad(n, shape.width);
    if (free(candidate)) {
      return { code: candidate, source: 'mask', prefix: shape.prefix, width: shape.width, taken: taken.size };
    }
  }
  return { code: null, source: 'none', taken: taken.size };
}

/** Οι τρεις τύποι συναλλασσομένου, χωρίς εξάρτηση από το `server-only` lib/softone. */
export type TraderCodeKind = 'supplier' | 'creditor' | 'debtor';

/**
 * Το κλειδί ρύθμισης με τη **μάσκα** κωδικού του τύπου (δες `SETTING_CATALOG`).
 * Η μάσκα είναι ο ΠΡΩΤΟΣ κωδικός που θα δοθεί όταν δεν υπάρχει κανένας άλλος.
 */
export const traderCodeMaskKey = (kind: TraderCodeKind) => `softone.traderCodeMask.${kind}`;
