// lib/ocr/extract-merge.ts — ISOMORPHIC, ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// Το pipeline διαβάζει ένα παραστατικό με περισσότερους από έναν τρόπους: σελίδα-σελίδα όταν το PDF
// ρασταροποιείται, και δύο φορές (ψηφιακό κείμενο + όραση) όταν το PDF είναι υβριδικό. Παλιά οι
// συγχωνεύσεις γίνονταν πάνω στα flat κλειδιά με χειρόγραφη λίστα κεφαλίδων· εδώ γίνονται πάνω στο
// κανονικό έγγραφο, άρα καλύπτουν ΚΑΘΕ πεδίο του σχήματος χωρίς να χρειάζεται λίστα.
//
// Οι δύο κανόνες που κρύβουν τη γνώση για τα ελληνικά παραστατικά:
//   • κεφαλίδα → κερδίζει η ΠΡΩΤΗ σελίδα που τη διάβασε (τυπώνεται πάνω-πάνω, οι επόμενες σελίδες
//     την επαναλαμβάνουν κολοβή),
//   • σύνολα / ανάλυση ΦΠΑ → κερδίζει η ΤΕΛΕΥΤΑΙΑ σελίδα που τα έχει (τυπώνονται στο υποσέλιδο, και
//     οι ενδιάμεσες σελίδες κουβαλάνε μερικά αθροίσματα «εις νέον» που δεν είναι τα τελικά).
import { emptyDocument, type DocumentJson, type DocumentLine, getPath } from '@/lib/ocr/canonical';
import { REQUIRED_PATHS, resolveDocType, type ExtractDocType } from '@/lib/ocr/templates';

type Dict = Record<string, unknown>;

const isNil = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');
const has = (v: unknown) => !isNil(v);

/** Πρώτη τιμή κερδίζει: το `base` κρατιέται, τα κενά του γεμίζουν από τα επόμενα με τη σειρά. */
function fillGaps<T extends Dict>(objs: T[]): T {
  const out = { ...objs[0] } as Dict;
  for (const o of objs.slice(1)) {
    for (const [k, v] of Object.entries(o ?? {})) if (isNil(out[k]) && has(v)) out[k] = v;
  }
  return out as T;
}

/** Τελευταία τιμή κερδίζει (ανά πεδίο): μια σελίδα χωρίς σύνολα δεν σβήνει τα προηγούμενα. */
function lastWins<T extends Dict>(objs: T[]): T {
  const out = { ...objs[0] } as Dict;
  for (const o of objs.slice(1)) {
    for (const [k, v] of Object.entries(o ?? {})) if (has(v)) out[k] = v;
  }
  return out as T;
}

/** Κλειδί ταυτότητας γραμμής — ό,τι χρησιμοποιούσε και ο παλιός υβριδικός συνδυασμός. */
const lineKey = (l: DocumentLine) => `${l.code ?? ''}|${(l.name ?? '').slice(0, 40)}`;

function dedupeLines(groups: DocumentLine[][]): DocumentLine[] {
  const seen = new Set<string>();
  const out: DocumentLine[] = [];
  for (const group of groups) {
    for (const line of group) {
      const key = lineKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}

function unionIbans(groups: DocumentJson['payment']['ibans'][]): DocumentJson['payment']['ibans'] {
  const seen = new Set<string>();
  const out: DocumentJson['payment']['ibans'] = [];
  for (const group of groups) {
    for (const row of group) {
      const key = (row.iban ?? '').replace(/\s+/g, '').toUpperCase() || `bank:${row.bank ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

/** Ο παραλήπτης είναι το σήμα τιμολόγιο/απόδειξη — ένα γενικό κείμενο μένει γενικό. */
function kindOf(base: DocumentJson, recipient: DocumentJson['recipient']): DocumentJson['kind'] {
  if (base.kind === 'general') return 'general';
  return has(recipient.name) || has(recipient.vat) ? 'invoice' : 'receipt';
}

/** Η τελευταία μη κενή τιμή μιας λίστας — για τα υποσέλιδα (ανάλυση ΦΠΑ). */
function lastNonEmpty<T>(groups: T[][]): T[] {
  for (let i = groups.length - 1; i >= 0; i--) if (groups[i].length) return groups[i];
  return [];
}

/** Σελίδες ενός πολυσέλιδου παραστατικού → ΕΝΑ έγγραφο. */
export function mergeDocuments(pages: DocumentJson[]): DocumentJson {
  if (pages.length === 0) return emptyDocument('invoice');
  if (pages.length === 1) return pages[0];

  const base = pages[0];
  const recipient = fillGaps(pages.map((p) => p.recipient));
  const period = pages.map((p) => p.references.period).find((p) => p != null) ?? null;

  return {
    ...fillGaps(pages.map((p) => ({ date: p.date, dueDate: p.dueDate, currency: p.currency, notes: p.notes }))),
    kind: kindOf(base, recipient),
    type: fillGaps(pages.map((p) => p.type)),
    issuer: fillGaps(pages.map((p) => p.issuer)),
    recipient,
    lines: dedupeLines(pages.map((p) => p.lines)),
    totals: lastWins(pages.map((p) => p.totals)),
    vatBreakdown: lastNonEmpty(pages.map((p) => p.vatBreakdown)),
    digital: fillGaps(pages.map((p) => p.digital)),
    payment: {
      ...fillGaps(pages.map((p) => ({ method: p.payment.method, terms: p.payment.terms }))),
      ibans: unionIbans(pages.map((p) => p.payment.ibans)),
    },
    references: {
      ...fillGaps(pages.map((p) => ({
        orderNo: p.references.orderNo, deliveryNote: p.references.deliveryNote,
        contract: p.references.contract, shipment: p.references.shipment,
      }))),
      plates: lastNonEmpty(pages.map((p) => p.references.plates)),
      period,
      quantities: lastNonEmpty(pages.map((p) => p.references.quantities)),
    },
    handwritten: {
      ...fillGaps(pages.map((p) => ({ glAccount: p.handwritten.glAccount, reference: p.handwritten.reference }))),
      allocations: lastNonEmpty(pages.map((p) => p.handwritten.allocations)),
    },
    // Το `custom` δεν έχει σχήμα: μια επόμενη σελίδα μπορεί να προσθέσει κλειδί ή να διορθώσει
    // τιμή, αλλά ένα κενό δεν επιτρέπεται να σβήσει ό,τι διάβασε η προηγούμενη.
    custom: lastWins(pages.map((p) => p.custom)),
  };
}

/**
 * Υβριδικό PDF: το ψηφιακό κείμενο είναι η αλήθεια (είναι το ίδιο το αρχείο, όχι ανάγνωση εικόνας)
 * και η όραση γεμίζει μόνο ό,τι δεν βρέθηκε — τυπικά τις σαρωμένες περιοχές.
 */
export function mergeHybridDocuments(digital: DocumentJson, vision: DocumentJson): DocumentJson {
  const recipient = fillGaps([digital.recipient, vision.recipient]);
  return {
    ...fillGaps([
      { date: digital.date, dueDate: digital.dueDate, currency: digital.currency, notes: digital.notes },
      { date: vision.date, dueDate: vision.dueDate, currency: vision.currency, notes: vision.notes },
    ]),
    kind: kindOf(digital, recipient),
    type: fillGaps([digital.type, vision.type]),
    issuer: fillGaps([digital.issuer, vision.issuer]),
    recipient,
    // Οι γραμμές δεν ανακατεύονται: μισές από το κείμενο και μισές από την εικόνα θα έβγαζαν
    // διπλοεγγραφές με άλλη γραφή. Το ψηφιακό τις δίνει ολόκληρες ή καθόλου.
    lines: digital.lines.length ? digital.lines : vision.lines,
    totals: fillGaps([digital.totals, vision.totals]),
    vatBreakdown: digital.vatBreakdown.length ? digital.vatBreakdown : vision.vatBreakdown,
    digital: fillGaps([digital.digital, vision.digital]),
    payment: {
      ...fillGaps([
        { method: digital.payment.method, terms: digital.payment.terms },
        { method: vision.payment.method, terms: vision.payment.terms },
      ]),
      ibans: unionIbans([digital.payment.ibans, vision.payment.ibans]),
    },
    references: {
      ...fillGaps([
        {
          orderNo: digital.references.orderNo, deliveryNote: digital.references.deliveryNote,
          contract: digital.references.contract, shipment: digital.references.shipment,
        },
        {
          orderNo: vision.references.orderNo, deliveryNote: vision.references.deliveryNote,
          contract: vision.references.contract, shipment: vision.references.shipment,
        },
      ]),
      plates: digital.references.plates.length ? digital.references.plates : vision.references.plates,
      period: digital.references.period ?? vision.references.period,
      quantities: digital.references.quantities.length ? digital.references.quantities : vision.references.quantities,
    },
    handwritten: {
      ...fillGaps([
        { glAccount: digital.handwritten.glAccount, reference: digital.handwritten.reference },
        { glAccount: vision.handwritten.glAccount, reference: vision.handwritten.reference },
      ]),
      allocations: digital.handwritten.allocations.length ? digital.handwritten.allocations : vision.handwritten.allocations,
    },
    custom: fillGaps([digital.custom, vision.custom]),
  };
}

/**
 * Πόσα υποχρεωτικά πεδία λείπουν. Οδηγεί τη μοναδική ακριβή απόφαση του pipeline: αν αξίζει
 * δεύτερο πέρασμα με το αναβαθμισμένο μοντέλο (×8 κόστος).
 *
 * Τα υποχρεωτικά διαβάζονται με βάση ΤΟ ΕΙΔΟΣ ΠΟΥ ΑΠΑΝΤΗΣΕ το μοντέλο (`resolveDocType`), όχι την
 * επιλογή του χρήστη: στο «Αυτόματα», ένα ελεύθερο κείμενο (`kind: "general"`) δεν έχει εκδότη,
 * αριθμό ή σύνολα — αν το μετρούσαμε ως τιμολόγιο, ΚΑΘΕ επιστολή θα ξαναδιαβαζόταν με το ακριβό
 * μοντέλο για να «βρει» πεδία που δεν υπάρχουν.
 */
export function missingRequired(document: DocumentJson, docType: ExtractDocType): number {
  let n = 0;
  for (const path of REQUIRED_PATHS[resolveDocType(docType, document.kind)] ?? []) {
    const v = getPath(document, path);
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) n += 1;
  }
  return n;
}

/**
 * Όταν ο «εκδότης» έχει ΤΟ ΔΙΚΟ ΜΑΣ ΑΦΜ, το μοντέλο μπέρδεψε τις δύο πλευρές (συνηθισμένο σε
 * παραστατικά όπου εμείς είμαστε ο αγοραστής). Αντιστρέφονται ΟΛΟΚΛΗΡΑ τα δύο μπλοκ — όχι πεδίο
 * προς πεδίο, ώστε να μη μείνει μισή ταυτότητα στη λάθος πλευρά.
 */
export function fixSwappedPartiesDocument(document: DocumentJson, ownAfm: string | null): DocumentJson {
  const own = String(ownAfm ?? '').replace(/\D+/g, '');
  if (!own) return document;
  const issuer = String(document.issuer.vat ?? '').replace(/\D+/g, '');
  if (issuer !== own) return document;
  return { ...document, issuer: document.recipient, recipient: document.issuer };
}
