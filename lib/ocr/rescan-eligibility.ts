// Ποια παραστατικά ξαναδιαβάζονται με ασφάλεια σε μια ΜΑΖΙΚΗ επανασάρωση — καθαρό module.
//
// Η επανασάρωση ξαναγράφει την ανάγνωση. Κρατά αντιστοιχίσεις, σειρά, εκδότη, σύνδεση πιστωτικού και
// απόφαση παρακράτησης (βλ. `reextract-server.ts`), αλλά ΟΧΙ τις χειροκίνητες διορθώσεις πεδίων/γραμμών/
// ποσών ούτε τους επιμερισμούς. Μαζικά, κανείς δεν βλέπει το παράθυρο «τι θα χαθεί» ανά παραστατικό —
// οπότε ό,τι έχει δουλειά χεριού ΠΑΡΑΛΕΙΠΕΤΑΙ, με λόγο. Ένα-ένα (κουμπί του παραστατικού) γίνεται πάντα.

import type { DocumentJson } from './canonical';

export interface RescanFacts {
  status: string;
  postStatus: string;
  /** Ο χρήστης επιβεβαίωσε/διόρθωσε την ανάγνωση (`verifiedAt`). */
  verified: boolean;
  /** Υπάρχει χειροκίνητη διόρθωση (πεδία, γραμμές, ποσά) ΜΕΤΑ την τελευταία επανασάρωση. */
  handEdited: boolean;
  /** Επιμερισμοί γραμμών σε λογαριασμούς/κέντρα κόστους. */
  allocations: number;
}

/** Οι ενέργειες του ιστορικού που σημαίνουν «δουλειά χεριού πάνω στην ανάγνωση». */
export const HAND_EDIT_ACTIONS = ['ocr.document.edit', 'ocr.lines.edit', 'ocr.amounts.fix', 'ocr.document.split_regions', 'ocr.line.qty_unit'] as const;

/** `null` = ξαναδιαβάζεται· αλλιώς ο λόγος, στα ελληνικά. */
export function rescanSkipReason(f: RescanFacts): string | null {
  if (f.postStatus === 'POSTED') return 'έχει καταχωριστεί στη SoftOne';
  if (f.postStatus === 'PENDING' || f.status === 'PROCESSING') return 'επεξεργάζεται αυτή τη στιγμή';
  if (f.handEdited) return 'έχει χειροκίνητες διορθώσεις που θα χάνονταν';
  if (f.allocations > 0) return 'έχει μοίρασμα γραμμών σε λογαριασμούς που θα χανόταν';
  if (f.verified) return 'η ανάγνωση έχει επιβεβαιωθεί από χρήστη';
  return null;
}

/** Κρατά τις ανθρώπινες αποφάσεις της παλιάς ανάγνωσης (σύνδεση πιστωτικού, παρακράτηση) στη νέα. */
export function carryDecisions(before: DocumentJson | null, next: DocumentJson): DocumentJson {
  if (!before) return next;
  const ref = before.references ?? ({} as DocumentJson['references']);
  const custom = (before.custom ?? {}) as Record<string, unknown>;
  const keepLink = ref?.linkedFindoc != null || ref?.noLink === true;
  const keepAck = custom.withholdingAck === true;
  if (!keepLink && !keepAck) return next;
  return {
    ...next,
    ...(keepLink ? { references: { ...next.references, linkedFindoc: ref.linkedFindoc ?? null, linkedLabel: ref.linkedLabel ?? null, noLink: ref.noLink === true } } : {}),
    ...(keepAck ? { custom: { ...(next.custom ?? {}), withholdingAck: true } } : {}),
  };
}


/**
 * «Ισχύς» μοντέλου ανάγνωσης: pro > flash > flash-lite (το πρόθεμα παρόχου, π.χ. `google/`, αγνοείται).
 * Άγνωστο όνομα = μεσαίο: δεν το θεωρούμε ούτε αναβάθμιση ούτε υποβάθμιση.
 */
export function modelRank(model: string | null | undefined): number {
  const m = String(model ?? '').toLowerCase().replace(/^.*\//, '');
  if (!m) return 0;
  // ΟΧΙ σκέτο «mini»: το «gemini» το περιέχει.
  if (/-(lite|nano|mini)\b/.test(m)) return 1;
  if (/\bpro\b|-pro|ultra|opus/.test(m)) return 3;
  return 2;
}

/**
 * Γράφεται η νέα ανάγνωση; ΟΧΙ αν τη διάβασε ΑΣΘΕΝΕΣΤΕΡΟ μοντέλο από την παλιά.
 *
 * Γιατί: στις 22/10/2026 η μαζική επανασάρωση ζήτησε gemini-2.5-pro, ο πάροχος δεν είχε μονάδες, και η
 * αλυσίδα εφεδρείας διάβασε σιωπηλά 16 παραστατικά με gemini-2.5-flash-lite — πάνω από αναγνώσεις του
 * gemini-2.5-flash. «Επανασάρωση με καλύτερο μοντέλο» που καταλήγει σε χειρότερο είναι χειρότερη από καμία.
 */
export function acceptReading(previousModel: string | null | undefined, newModel: string | null | undefined): boolean {
  return modelRank(newModel) >= modelRank(previousModel);
}
