// lib/ocr/split.ts — ISOMORPHIC, ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / pdf).
//
// Ένας σαρωτής γραφείου βγάζει ΕΝΑ PDF με όλα τα παραστατικά της ημέρας. Μέχρι τώρα αυτό γινόταν
// ένα έγγραφο: τα σύνολα της πρώτης σελίδας, οι γραμμές ανακατεμένες, ένας προμηθευτής για δέκα.
// Εδώ μαντεύουμε ΠΟΥ αρχίζει κάθε παραστατικό, με σήματα που υπάρχουν στο ίδιο το χαρτί.
//
// Η πρόταση είναι ΠΡΟΤΑΣΗ: ο χρήστης τη βλέπει στην προεπισκόπηση και την αλλάζει με ένα κλικ.
// Γι' αυτό οι κανόνες είναι συντηρητικοί — προτιμούμε να μη σπάσουμε ένα πολυσέλιδο τιμολόγιο
// παρά να σπάσουμε δέκα φορές μια στοίβα που ο χρήστης θα ξαναενώσει με το χέρι.
import { isValidAfm } from '@/lib/ocr/validate';

export interface SplitPage {
  /** Το κείμενο της σελίδας, όπως το βγάζει το text layer του PDF. Κενό σε σαρωμένο PDF. */
  text: string;
}

/** Πάνω από αυτό δεν δεχόμαστε διαχωρισμό: η προεπισκόπηση θα γινόταν αργή και άχρηστη. */
export const MAX_SPLIT_PAGES = 100;

/**
 * Ελαφριά κανονικοποίηση: κεφαλαία, χωρίς τόνους, ο στίχος σε μία γραμμή. ΚΡΑΤΑΕΙ τη στίξη που
 * κουβαλάει νόημα εδώ (`/`, `-`, `:`, `.`) — ο αριθμός «ΤΠΥ-17/2026» και το «σελ. 1/3» χάνονται
 * αν τη σβήσουμε, σε αντίθεση με το `normalizeGreek` του ταξινομητή σειράς.
 */
export function normalizeForSplit(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\p{Lu}\p{N}\/\-:. ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// «ΣΕΛΙΔΑ 1 ΑΠΟ 3», «ΣΕΛ. 1/3», «PAGE 1 OF 3».
const PAGE_MARKER = /(?:ΣΕΛΙΔΑ|ΣΕΛ|PAGE)\.?\s*:?\s*(\d{1,3})\s*(?:ΑΠΟ|OF|\/)\s*(\d{1,3})/;

// Ο αριθμός παραστατικού, ΜΟΝΟ όταν είναι ρητά ετικετοποιημένος. Χωρίς ετικέτα δεν μαντεύουμε:
// κάθε σελίδα είναι γεμάτη αριθμούς (ΑΦΜ, ΤΚ, ποσά) και μια λάθος «ταυτότητα» σπάει τα πάντα.
//
// Η ετικέτα πρέπει να είναι ΑΥΤΟΤΕΛΗΣ ΛΕΞΗ. Χωρίς το lookbehind, το «ΑΡ» πιάνει μέσα στο
// «ΠΑΡΑΛΗΠΤΗΣ» ή στο «ΠΑΡΑΣΤΑΤΙΚΟ» και «διαβάζει» αριθμό από το πουθενά — και επειδή κρατάμε το
// ΠΡΩΤΟ εύρημα, σκίαζε τον πραγματικό αριθμό παρακάτω στη σελίδα (λιγότερα κοψίματα, σιωπηλά).
const DOC_NUMBER = new RegExp(
  '(?<![\\p{Lu}\\p{N}])(?:ΑΡΙΘΜΟΣ|ΑΡΙΘ|ΑΡ|NUMBER|NO|N)\\.?\\s*'
  + '(?:ΠΑΡΑΣΤΑΤΙΚΟΥ|ΤΙΜΟΛΟΓΙΟΥ|ΑΠΟΔΕΙΞΗΣ|INVOICE|DOC(?:UMENT)?)?\\.?\\s*:?\\s*'
  + '([\\p{Lu}\\p{N}][\\p{Lu}\\p{N}\\/\\-]{0,19})',
  'gu',
);

// ΑΦΜ: εννέα ψηφία μετά από ετικέτα, με ή χωρίς πρόθεμα χώρας.
const AFM_LABEL = /(?:ΑΦΜ|Α\.Φ\.Μ|VAT(?:\s*(?:NO|NUMBER|ID))?|TAX\s*ID)\.?\s*:?\s*(?:EL|GR)?\s*(\d{9})/gu;

/**
 * Ο αριθμός παραστατικού της σελίδας, κανονικοποιημένος για σύγκριση — ή null.
 *
 * Κρατάμε το πρώτο εύρημα ΠΟΥ ΕΧΕΙ ΨΗΦΙΟ, όχι απλώς το πρώτο εύρημα: μια ετικέτα μπορεί να
 * ακολουθείται από λέξη («ΑΡ. ΛΟΓΑΡΙΑΣΜΟΥ ΙΒΑΝ», «NO CHARGE»), και αν σταματούσαμε εκεί θα
 * χάναμε τον πραγματικό αριθμό που τυπώνεται λίγο πιο κάτω.
 */
export function documentNumberOf(text: string): string | null {
  const norm = normalizeForSplit(text);
  DOC_NUMBER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOC_NUMBER.exec(norm)) !== null) {
    const raw = m[1].replace(/[^\p{Lu}\p{N}]/gu, '');
    if (/\p{N}/u.test(raw)) return raw;
  }
  return null;
}

/**
 * Το ΠΡΩΤΟ έγκυρο ΑΦΜ της σελίδας. Στα ελληνικά παραστατικά ο εκδότης τυπώνεται πάνω από τον
 * παραλήπτη, οπότε το πρώτο είναι σχεδόν πάντα ο εκδότης — και ούτως ή άλλως το μόνο που μας
 * ενδιαφέρει είναι αν ΑΛΛΑΞΕ από σελίδα σε σελίδα.
 */
export function issuerAfmOf(text: string): string | null {
  const norm = normalizeForSplit(text);
  AFM_LABEL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AFM_LABEL.exec(norm)) !== null) {
    if (isValidAfm(m[1])) return m[1];
  }
  return null;
}

/** «σελ. k από N» → { page: k, of: N }, αν τυπώνεται. */
export function pageMarkerOf(text: string): { page: number; of: number } | null {
  const m = PAGE_MARKER.exec(normalizeForSplit(text));
  if (!m) return null;
  const page = Number(m[1]);
  const of = Number(m[2]);
  if (!Number.isFinite(page) || !Number.isFinite(of) || page < 1 || of < 1 || page > of) return null;
  return { page, of };
}

/**
 * Πού αρχίζει κάθε παραστατικό. Επιστρέφει τους δείκτες σελίδων (0-based) — ο 0 πάντα μέσα.
 *
 * Σειρά κανόνων ανά σελίδα:
 *   1. «σελ. 1 από N» → νέο παραστατικό,
 *   2. «σελ. k από N» με k>1 → ΣΥΝΕΧΕΙΑ, ό,τι κι αν λένε τα υπόλοιπα σήματα (η ίδια η σελίδα
 *      δηλώνει ότι είναι συνέχεια· ένα OCR-λάθος στον αριθμό δεν επιτρέπεται να τη σπάσει),
 *   3. αριθμός παραστατικού διαφορετικός από του τρέχοντος τμήματος → νέο,
 *   4. ΑΦΜ εκδότη διαφορετικό → νέο,
 *   5. αλλιώς συνέχεια.
 *
 * ΣΑΡΩΜΕΝΟ PDF (κανένα κείμενο πουθενά): δεν υπάρχει κανένα σήμα, οπότε η μόνη τίμια πρόταση
 * είναι «ένα παραστατικό ανά σελίδα» — και το λέμε καθαρά στη διεπαφή.
 */
export function suggestSplits(pages: SplitPage[]): number[] {
  const n = pages.length;
  if (n <= 0) return [];
  if (n === 1) return [0];

  const texts = pages.map((p) => String(p?.text ?? ''));
  if (texts.every((t) => t.trim() === '')) return texts.map((_, i) => i);

  const starts: number[] = [0];
  let currentNumber = documentNumberOf(texts[0]);
  let currentAfm = issuerAfmOf(texts[0]);

  for (let i = 1; i < n; i++) {
    const text = texts[i];
    const marker = pageMarkerOf(text);
    const number = documentNumberOf(text);
    const afm = issuerAfmOf(text);

    let isStart: boolean;
    if (marker?.page === 1) {
      isStart = true;
    } else if (marker && marker.page > 1) {
      isStart = false;
    } else if (number != null && currentNumber != null && number !== currentNumber) {
      isStart = true;
    } else if (afm != null && currentAfm != null && afm !== currentAfm) {
      isStart = true;
    } else {
      isStart = false;
    }

    if (isStart) {
      starts.push(i);
      currentNumber = number;
      currentAfm = afm;
    } else {
      // Μια σελίδα-συνέχεια συχνά επαναλαμβάνει κολοβά την κεφαλίδα: κρατάμε ό,τι ΞΕΡΑΜΕ και
      // συμπληρώνουμε μόνο τα κενά, ώστε το τμήμα να αποκτήσει ταυτότητα όταν η πρώτη σελίδα
      // δεν είχε τυπωμένο αριθμό ή ΑΦΜ.
      currentNumber ??= number;
      currentAfm ??= afm;
    }
  }
  return starts;
}

/** Οι δείκτες έναρξης → τμήματα σελίδων `{ from, to }` (0-based, `to` ΜΕΣΑ). */
export function segmentsOf(starts: number[], pageCount: number): { from: number; to: number }[] {
  const clean = normalizeCuts(starts, pageCount);
  return clean.map((from, i) => ({ from, to: (clean[i + 1] ?? pageCount) - 1 }));
}

/**
 * Καθαρίζει μια λίστα κοψιμάτων που ήρθε από τον client: κρατάει μόνο έγκυρους δείκτες, χωρίς
 * διπλά, ταξινομημένους, και ΠΑΝΤΑ με το 0 μέσα (η πρώτη σελίδα αρχίζει πάντα κάτι).
 */
export function normalizeCuts(starts: number[], pageCount: number): number[] {
  const set = new Set<number>([0]);
  for (const s of starts ?? []) {
    const i = Math.trunc(Number(s));
    if (Number.isFinite(i) && i > 0 && i < pageCount) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}
