// Το «Σχόλιο» της κεφαλίδας στη SoftOne: ΤΙ ΑΦΟΡΑ το παραστατικό, σε μία γραμμή — καθαρό module.
//
// Μέχρι τώρα στελνόταν το `document.notes`, δηλαδή ό,τι ελεύθερο κείμενο έβρισκε η ανάγνωση στο
// χαρτί. Σε λογαριασμό ρεύματος αυτό ήταν διαφήμιση 380 χαρακτήρων («Ο λογαριασμός σας παρουσιάζει
// προηγούμενο ανεξόφλητο υπόλοιπο…»): άχρηστο σε όποιον ανοίξει την εγγραφή, και μεγαλύτερο από τους
// 255 χαρακτήρες που χωρά το πεδίο `COMMENTS` — πιθανότατα το «SoftOne Range Error» της καταχώρισης.
// Τώρα: «Λογαριασμός ρεύματος · 28/08–29/09/2026» ή «Cloud VPS V AS SSD, Cloud VPS I AS SSD +2».
import type { DocumentJson } from '@/lib/ocr/canonical';

/** Μέγιστο μήκος του `COMMENTS` (κεφαλίδα και γραμμές) στο schema της SoftOne. */
export const COMMENTS_MAX = 255;

/** Κόβει σε όριο χαρακτήρων, σε όριο λέξης, με «…». */
export function clip(text: string, max = COMMENTS_MAX): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,·–-]+$/, '')}…`;
}

const ddmm = (iso: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

/** «28/08–29/09/2026» (το έτος μία φορά όταν είναι κοινό). */
export function periodText(from: string | null | undefined, to: string | null | undefined): string | null {
  const a = ddmm(from), b = ddmm(to);
  if (a && b) return a.slice(6) === b.slice(6) ? `${a.slice(0, 5)}–${b}` : `${a}–${b}`;
  return a ?? b;
}

/**
 * Τι αφορά το παραστατικό. Ο χρήστης μπορεί να το ορίσει ο ίδιος (`custom.postingComment`)·
 * αλλιώς: τίτλος λογαριασμού κοινής ωφέλειας ή οι κύριες γραμμές, και η περίοδος αν τυπώθηκε.
 */
export function postingComment(doc: DocumentJson, opts: { utilityTitle?: string | null } = {}): string | null {
  const own = String((doc.custom as Record<string, unknown> | undefined)?.postingComment ?? '').trim();
  if (own) return clip(own);

  let subject = opts.utilityTitle?.trim() || null;
  if (!subject) {
    const names: string[] = [];
    for (const l of [...doc.lines].sort((x, y) => Math.abs(y.net ?? 0) - Math.abs(x.net ?? 0))) {
      const n = String(l.name ?? '').replace(/\s+/g, ' ').trim();
      if (n && !names.includes(n)) names.push(n);
    }
    if (names.length) subject = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  }
  const period = periodText(doc.references?.period?.from, doc.references?.period?.to);
  const out = [subject, period].filter(Boolean).join(' · ');
  return out ? clip(out) : null;
}
