// Τα μηνύματα της SoftOne στην καταχώριση, σε γλώσσα χρήστη — καθαρό module.
//
// Η SoftOne απαντά με μηνύματα του ίδιου του ERP («SoftOne Range Error (Name: '')», «Selected record
// with key: 115601 not found!», «Δεν έχετε συμπληρώσει τα παρακάτω πεδία: Έξοδο»). Ο καταχωριστής
// δεν ξέρει τι σημαίνουν ούτε τι να κάνει. Εδώ κάθε γνωστό μήνυμα γίνεται: ΤΙ συνέβη + ΤΙ να κάνεις,
// και το αρχικό κείμενο μένει στο τέλος για τον τεχνικό.

export interface SoftoneErrorText {
  /** Μία πρόταση: τι πήγε στραβά. */
  title: string;
  /** Τι να κάνει ο χρήστης. */
  action: string;
  /** Το αρχικό μήνυμα της SoftOne (για τον τεχνικό). */
  raw: string;
}

/** Όρια κειμένου του schema (FINDOC / γραμμές) — μόνο όσα στέλνει η εφαρμογή. */
const TEXT_LIMITS: Record<string, number> = { COMMENTS: 255, FINCODE: 30, TAXSERIES: 15, TAXSERIESNUM: 50 };

/** Πεδία του payload που ξεπερνούν το μέγεθός τους — η συνήθης αιτία του «Range Error». */
export function oversizedFields(payload: { DATA?: Record<string, unknown[]> } | null | undefined): string[] {
  const out: string[] = [];
  for (const [table, rows] of Object.entries(payload?.DATA ?? {})) {
    (rows as Record<string, unknown>[]).forEach((row, i) => {
      for (const [col, max] of Object.entries(TEXT_LIMITS)) {
        const v = row?.[col];
        if (typeof v === 'string' && v.length > max) out.push(`${table}${rows.length > 1 ? ` γραμμή ${i + 1}` : ''}.${col}: ${v.length}/${max} χαρακτήρες`);
      }
    });
  }
  return out;
}

const FIELD_HINT: Record<string, string> = {
  'Έξοδο': 'η γραμμή πηγαίνει σε κατηγορία εξόδου, αλλά δεν έχει οριστεί ποια',
  'Επιβαρύνει': 'λείπει το «Επιβαρύνει» της γραμμής εξόδου (ρυθμίζεται στο ίδιο το έξοδο στη SoftOne)',
  'Κωδικός': 'λείπει κωδικός',
  'Συναλλασσόμενος': 'δεν έχει οριστεί προμηθευτής/πιστωτής',
  'Σειρά': 'δεν έχει οριστεί σειρά παραστατικού',
};

export function explainSoftoneError(message: unknown, payload?: { DATA?: Record<string, unknown[]> } | null): SoftoneErrorText {
  const raw = String(message ?? '').trim() || 'Άγνωστο σφάλμα';

  if (/range\s*error/i.test(raw)) {
    const fields = oversizedFields(payload);
    return {
      title: 'Η SoftOne απέρριψε μια τιμή που δεν χωρά στο πεδίο της.',
      action: fields.length
        ? `Πολύ μεγάλο κείμενο: ${fields.join(' · ')}. Συντόμευσέ το (π.χ. το σχόλιο ή την περιγραφή γραμμής) και ξαναδοκίμασε.`
        : 'Συνήθως είναι κείμενο μεγαλύτερο από όσο χωρά (σχόλιο, περιγραφή γραμμής) ή αριθμός εκτός ορίων. Έλεγξε περιγραφές και ποσά των γραμμών και ξαναδοκίμασε.',
      raw,
    };
  }

  const missing = /δεν\s+[έε]χετε\s+συμπληρ[ωώ]σει[^:]*:\s*([\s\S]+)/i.exec(raw);
  if (missing) {
    const names = missing[1].split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
    const hints = names.map((nm) => (FIELD_HINT[nm] ? `«${nm}» — ${FIELD_HINT[nm]}` : `«${nm}»`));
    return {
      title: `Η SoftOne ζητά πεδία που δεν συμπληρώθηκαν: ${names.map((x) => `«${x}»`).join(', ')}.`,
      action: `${hints.join(' · ')}. Διάλεξε ξανά τι αφορά κάθε γραμμή (στήλη «SoftOne»), ή άλλαξε σειρά παραστατικού.`,
      raw,
    };
  }

  const notFound = /selected record with key:?\s*(\S+)\s*not found/i.exec(raw);
  if (notFound) {
    return {
      title: `Η SoftOne δεν βρίσκει την εγγραφή ${notFound[1].replace(/!$/, '')} — μάλλον διαγράφηκε ή ανήκει σε άλλη εταιρεία.`,
      action: 'Ξανασυγχρόνισε τα μητρώα (Μητρώα αναφοράς → «Συγχρονισμός όλων») και διάλεξε ξανά προμηθευτή και γραμμές.',
      raw,
    };
  }

  if (/locked|κλειδωμ/i.test(raw)) {
    return { title: 'Η εγγραφή είναι ανοιχτή από άλλον χρήστη στη SoftOne.', action: 'Περίμενε να την κλείσει και ξαναδοκίμασε.', raw };
  }
  if (/κλεισ(τή|μένη)\s+(διαχειριστική\s+)?(χρήση|περίοδο)|closed\s+period|fiscal/i.test(raw)) {
    return { title: 'Η ημερομηνία πέφτει σε κλειστή περίοδο της SoftOne.', action: 'Έλεγξε την ημερομηνία του παραστατικού ή ζήτησε από τον λογιστή να ανοίξει την περίοδο.', raw };
  }
  if (/υπάρχει\s+ήδη|already\s+exists|duplicate/i.test(raw)) {
    return { title: 'Η SoftOne λέει ότι το παραστατικό υπάρχει ήδη.', action: 'Βρες το στη SoftOne με τον αριθμό του — μην το ξανακαταχωρίσεις.', raw };
  }
  if (/δεν\s+απάντησε|timeout|ECONN|fetch failed/i.test(raw)) {
    return { title: 'Η SoftOne δεν απάντησε εγκαίρως.', action: 'Περίμενε λίγο. Πριν ξαναδοκιμάσεις, έλεγξε στη SoftOne ότι δεν δημιουργήθηκε ήδη το παραστατικό.', raw };
  }
  return { title: 'Η SoftOne απέρριψε την καταχώριση.', action: 'Το μήνυμά της είναι παρακάτω. Αν δεν είναι σαφές, στείλ’ το στον τεχνικό.', raw };
}

/** Μία γραμμή για toast / postError: «τίτλος — τι να κάνεις (SoftOne: …)». */
export function softoneErrorLine(message: unknown, payload?: { DATA?: Record<string, unknown[]> } | null): string {
  const e = explainSoftoneError(message, payload);
  return `${e.title} ${e.action} (SoftOne: ${e.raw.replace(/\s+/g, ' ').slice(0, 300)})`;
}
