// lib/ocr/allocation-shape.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// Η ΜΝΗΜΗ ΤΟΥ ΣΧΗΜΑΤΟΣ. Ο λογιστής σπάει κάθε μήνα το ίδιο τιμολόγιο με τον ίδιο τρόπο —
// μετρημένο στα χειρόγραφα των σαρωμένων: «Ιγνατιάδου → 6 κομμάτια», «Δεσποτόπουλος → 4
// λογαριασμοί», «Cosmote → 2». Εδώ ζει ΜΟΝΟ η αριθμητική: τι αξίζει να θυμηθούμε και πώς
// ξαναγίνεται επιμερισμός πάνω σε ΑΛΛΟ ποσό.
import type { AllocationKind } from './line-allocation';

/** Ένα κομμάτι του θυμημένου σχήματος. Ποσοστά, ΠΟΤΕ ποσά — το ποσό αλλάζει κάθε μήνα. */
export type ShapePart = {
  registryMtrl: number;
  accountCode: string | null;
  percent: number;
};

export type AllocationShape = {
  kind: AllocationKind;
  parts: ShapePart[];
  timesUsed: number;
  /** `true` όταν ο κανόνας είναι ΑΥΤΟΥ του εκδότη και όχι ο γενικός — το λέει η οθόνη. */
  sameIssuer: boolean;
};

const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * Αξίζει να θυμηθούμε αυτόν τον επιμερισμό;
 *
 * ΜΟΝΟ από δύο κομμάτια και πάνω. Ένας λογαριασμός στο 100 % είναι απλή αντιστοίχιση και τον
 * καλύπτει ήδη το `LineMatchRule` — αν τον γράφαμε κι εδώ, θα είχαμε δύο μνήμες να λένε το ίδιο
 * πράγμα και να διαφωνούν όταν ο χρήστης αλλάξει τη μία.
 */
export function isShapeWorthRemembering(
  parts: readonly { registryMtrl: number; percent: number }[],
): boolean {
  if (parts.length < 2) return false;
  // Κάθε κομμάτι πρέπει να δείχνει κάπου και να έχει θετικό μερίδιο· αλλιώς δεν είναι σχήμα.
  return parts.every((p) => p.registryMtrl > 0 && Number.isFinite(p.percent) && p.percent > 0);
}

/** Η μορφή που αποθηκεύεται. Κρατά τη ΣΕΙΡΑ — «πρώτα το ρεύμα, μετά τα τέλη» δεν είναι τυχαίο. */
export function toShapeParts(
  parts: readonly { registryMtrl: number; accountCode?: string | null; percent: number }[],
): ShapePart[] {
  return parts.map((p) => ({
    registryMtrl: p.registryMtrl,
    accountCode: p.accountCode ?? null,
    percent: round4(p.percent),
  }));
}

/**
 * Διαβάζει ό,τι βρέθηκε στη βάση (`Json`) και κρατά ΜΟΝΟ ό,τι είναι χρησιμοποιήσιμο.
 *
 * Η στήλη είναι `Json`, άρα μπορεί να κρύβει οτιδήποτε — παλιά μορφή, χειρόγραφη επέμβαση,
 * μισογραμμένη εγγραφή. Ένα σχήμα που δεν διαβάζεται δεν πρέπει να ρίχνει τη σελίδα ούτε να
 * εφαρμόζεται μισό: ή στέκει ολόκληρο, ή δεν υπάρχει.
 */
export function parseShapeParts(raw: unknown): ShapePart[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: ShapePart[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    const mtrl = Number(o.registryMtrl);
    const pct = Number(o.percent);
    if (!Number.isFinite(mtrl) || mtrl <= 0) return null;
    if (!Number.isFinite(pct) || pct <= 0) return null;
    out.push({
      registryMtrl: mtrl,
      accountCode: typeof o.accountCode === 'string' ? o.accountCode : null,
      percent: round4(pct),
    });
  }
  // Άθροισμα εκτός ανοχής = σχήμα που δεν κλείνει· δεν το προτείνουμε.
  const sum = out.reduce((t, p) => t + p.percent, 0);
  return Math.abs(sum - 100) <= 0.05 ? out : null;
}
