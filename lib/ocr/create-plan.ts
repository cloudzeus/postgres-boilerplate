// lib/ocr/create-plan.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// «Δημιούργησε ό,τι λείπει από το μητρώο» — η απόφαση ΠΟΙΑ ομάδα μπορεί να γίνει εγγραφή
// μητρώου χωρίς να ρωτηθεί άνθρωπος για τεχνικές λεπτομέρειες, και με ΤΙ στοιχεία.
//
// Γιατί υπάρχει: στα ζωντανά δεδομένα 38 από 48 ομάδες δεν βρίσκουν τίποτα στο μητρώο. Η
// αντιστοίχιση δεν έχει τι να διαλέξει — πρέπει πρώτα να **υπάρξει** η εγγραφή. Αυτό γινόταν
// μόνο μία-μία, μέσα από φόρμα, και είναι ο λόγος που η δουλειά δεν τελείωνε ποτέ.
//
// ΤΙ ΔΕΝ ΚΑΝΕΙ ΕΔΩ: δεν αποφασίζει τύπο. Ο τύπος έρχεται από τα στοιχεία της ομάδας ή από το
// μοντέλο, και ο άνθρωπος τον βλέπει τσεκαρισμένο πριν γραφτεί οτιδήποτε.

/** Ο τύπος μητρώου της ομάδας, όπως τον ξέρει η ουρά. */
export type CreateKind = 'product' | 'service' | 'expense' | 'lineitem';

export interface CreateCandidate {
  key: string;
  kind: CreateKind | null;
  /** Ο κωδικός που κουβαλά η γραμμή — του ΠΡΟΜΗΘΕΥΤΗ, όχι δικός μας. */
  code: string | null;
  /** Η περιγραφή όπως τυπώνεται. */
  sample: string;
  /** Ο συντελεστής ΦΠΑ της γραμμής (π.χ. 24) και ο κωδικός κατηγορίας του μητρώου. */
  vatId: string | null;
  /** `MTRUNIT` που ταίριαξε αναμφισβήτητα· `null` = δεν βρέθηκε. */
  unitId: string | null;
  /** Βρέθηκε ήδη εγγραφή με τον ίδιο κωδικό/EAN/κωδικό εργοστασίου; */
  duplicateOf?: { mtrl: number; code: string; name: string } | null;
}

export type CreateBlocked =
  | 'χωρίς τύπο'
  | 'υπάρχει ήδη'
  | 'χωρίς περιγραφή'
  | 'χωρίς ΦΠΑ'
  | 'χωρίς μονάδα'
  | 'θέλει πρότυπο';

export interface CreateProposal {
  key: string;
  kind: CreateKind;
  code: string | null;
  name: string;
  vatId: string;
  unitId: string;
}

export type CreateVerdict =
  | { ok: true; proposal: CreateProposal }
  | { ok: false; reason: CreateBlocked; duplicate?: { mtrl: number; code: string; name: string } };

/** Το μήκος που δέχεται το μητρώο για περιγραφή — το ίδιο με τη φόρμα δημιουργίας. */
const NAME_MAX = 200;

/**
 * Μπορεί αυτή η ομάδα να γίνει εγγραφή μητρώου **μόνη της**;
 *
 * Μόνο **είδος** και **υπηρεσία**. Το έξοδο και η χρεοπίστωση απαιτούν ΠΡΟΤΥΠΟ (από εκεί
 * αντιγράφονται υποχρεωτικά flags, κατηγορία τιμολόγησης και λογαριασμός γενικής) — και το
 * πρότυπο είναι επιλογή με συνέπειες που δεν μαντεύεται μαζικά. Δες `lib/ocr/lineitem-create.ts`.
 */
export function createVerdict(c: CreateCandidate): CreateVerdict {
  if (c.duplicateOf) return { ok: false, reason: 'υπάρχει ήδη', duplicate: c.duplicateOf };
  if (!c.kind) return { ok: false, reason: 'χωρίς τύπο' };
  if (c.kind === 'expense' || c.kind === 'lineitem') return { ok: false, reason: 'θέλει πρότυπο' };
  const name = String(c.sample ?? '').trim().slice(0, NAME_MAX);
  if (!name) return { ok: false, reason: 'χωρίς περιγραφή' };
  if (!c.vatId) return { ok: false, reason: 'χωρίς ΦΠΑ' };
  if (!c.unitId) return { ok: false, reason: 'χωρίς μονάδα' };
  return { ok: true, proposal: { key: c.key, kind: c.kind, code: c.code?.trim() || null, name, vatId: c.vatId, unitId: c.unitId } };
}

/** Χωρίζει τις υποψήφιες σε «έτοιμες» και «θέλουν εσένα», κρατώντας τον λόγο. */
export function splitCandidates(list: readonly CreateCandidate[]): {
  ready: CreateProposal[];
  blocked: { key: string; sample: string; reason: CreateBlocked; duplicate?: { mtrl: number; code: string; name: string } }[];
} {
  const ready: CreateProposal[] = [];
  const blocked: { key: string; sample: string; reason: CreateBlocked; duplicate?: { mtrl: number; code: string; name: string } }[] = [];
  for (const c of list) {
    const v = createVerdict(c);
    if (v.ok) ready.push(v.proposal);
    else blocked.push({ key: c.key, sample: c.sample, reason: v.reason, duplicate: v.duplicate });
  }
  return { ready, blocked };
}
