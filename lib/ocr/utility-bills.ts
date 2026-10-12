// lib/ocr/utility-bills.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// «Είναι λογαριασμός ρεύματος, νερού, αερίου, τηλεπικοινωνιών ή μίσθωσης οχημάτων — και τι είναι
// κάθε γραμμή του;»
//
// ΓΙΑΤΙ ΥΠΑΡΧΕΙ. Η μνήμη αντιστοιχίσεων (`LineMatchRule`) έχει κλειδί το ΚΕΙΜΕΝΟ της γραμμής. Σε
// έναν λογαριασμό το κείμενο αλλάζει κάθε μήνα («ΥΔΡΕΥΣΗ (265,00M3)», «ΥΔΡΕΥΣΗ (198,00M3)») και από
// πάροχο σε πάροχο («Χρεώσεις Προμήθειας Ρεύματος» στην ΗΡΩΝ, «Χρέωση Ενέργειας» στη ΔΕΗ), οπότε η
// μνήμη δεν έπιανε ποτέ. Όμως ο λογιστής δεν σκέφτεται με το κείμενο: σκέφτεται με το ΕΙΔΟΣ της
// χρέωσης — κατανάλωση, δημοτικά τέλη, ΕΡΤ, εγγύηση. Εδώ κάθε γραμμή παίρνει σταθερό κλειδί
// (`@utility:electricity:consumption`), και μία απόφαση του χρήστη ανά είδος χρέωσης εφαρμόζεται
// σε κάθε επόμενο λογαριασμό, του ίδιου ή άλλου παρόχου.
//
// Ο κανόνας είναι ο ίδιος με όλη την εφαρμογή: **χωρίς απόδειξη, καμία δήλωση**. Γνωστός πάροχος
// από ΑΦΜ αρκεί· όνομα παρόχου χρειάζεται και μία ένδειξη περιεχομένου· χωρίς πάροχο χρειάζονται
// μορφή λογαριασμού ΚΑΙ δύο γραμμές του ίδιου είδους. Γραμμή που δεν αναγνωρίζεται μένει `null`.
import { normalizeGreek } from './doc-type-classify';

export type UtilityKind = 'electricity' | 'water' | 'gas' | 'telecom' | 'vehicle_lease';
export type UtilityCharge =
  | 'consumption' | 'municipal' | 'ert' | 'tax' | 'deposit' | 'works' | 'discount' | 'interest' | 'rental';

export const UTILITY_KIND_LABEL: Record<UtilityKind, string> = {
  electricity: 'Ρεύμα',
  water: 'Νερό',
  gas: 'Φυσικό αέριο',
  telecom: 'Τηλεπικοινωνίες',
  vehicle_lease: 'Μίσθωση οχημάτων',
};

/** Ο τίτλος του παραστατικού, σε γενική: «Λογαριασμός ρεύματος». */
export const UTILITY_KIND_TITLE: Record<UtilityKind, string> = {
  electricity: 'Λογαριασμός ρεύματος',
  water: 'Λογαριασμός νερού',
  gas: 'Λογαριασμός φυσικού αερίου',
  telecom: 'Λογαριασμός τηλεπικοινωνιών',
  vehicle_lease: 'Μισθώματα οχημάτων',
};

export const UTILITY_CHARGE_LABEL: Record<UtilityCharge, string> = {
  consumption: 'Κατανάλωση & πάγια',
  municipal: 'Δημοτικά τέλη',
  ert: 'Τέλος ΕΡΤ',
  tax: 'Φόροι & ειδικά τέλη',
  deposit: 'Εγγύηση',
  works: 'Εργασίες δικτύου',
  discount: 'Έκπτωση',
  interest: 'Προσαυξήσεις',
  rental: 'Μίσθωμα',
};

/** Ποιες χρεώσεις είναι ΕΚΤΟΣ ΦΠΑ από τη φύση τους (τέλη τρίτων που απλώς εισπράττει ο πάροχος). */
export const OUTSIDE_VAT_CHARGES: readonly UtilityCharge[] = ['municipal', 'ert', 'tax', 'deposit'];

// Σύντμηση ως αυτοτελής λέξη στο κανονικοποιημένο αλφάβητο (το `\b` της JS δεν πιάνει ελληνικά).
const w = (s: string) => `(?<![A-ZΑ-Ω0-9])${s}(?![A-ZΑ-Ω0-9])`;

interface Provider {
  name: string;
  kind: UtilityKind;
  /** ΑΦΜ μόνο όπου τον έχουμε δει σε πραγματικό παραστατικό — ποτέ από μνήμης. */
  afms: string[];
  names: RegExp;
}

const PROVIDERS: Provider[] = [
  { name: 'ΔΕΗ', kind: 'electricity', afms: ['090000045'], names: new RegExp(`ΔΗΜΟΣΙΑ ΕΠΙΧΕΙΡΗΣΗ ΗΛΕΚΤΡΙΣΜΟΥ|${w('ΔΕΗ')}|${w('PPC')}`) },
  { name: 'ΗΡΩΝ', kind: 'electricity', afms: ['099810593'], names: /ΗΡΩΝ ΕΝΕΡΓΕΙΑΚΗ|HERON/ },
  { name: 'Enerwave', kind: 'electricity', afms: ['999717970'], names: /ENERWAVE/ },
  { name: 'Protergia', kind: 'electricity', afms: [], names: /PROTERGIA|ΠΡΩΤΕΡΓΙΑ/ },
  { name: 'Elpedison', kind: 'electricity', afms: [], names: /ELPEDISON|ΕΛΠΕΝΤΙΣΟΝ/ },
  { name: 'NRG', kind: 'electricity', afms: [], names: new RegExp(w('NRG')) },
  { name: 'Ζενίθ', kind: 'electricity', afms: [], names: /ΖΕΝΙΘ|ZENITH/ },
  { name: 'Watt+Volt', kind: 'electricity', afms: [], names: /WATT ?(AND |ΚΑΙ )?VOLT/ },
  { name: 'Volton', kind: 'electricity', afms: [], names: /VOLTON/ },
  { name: 'ΔΕΔΔΗΕ', kind: 'electricity', afms: [], names: new RegExp(`ΔΙΑΧΕΙΡΙΣΤΗΣ ΕΛΛΗΝΙΚΟΥ ΔΙΚΤΥΟΥ ΔΙΑΝΟΜΗΣ|${w('ΔΕΔΔΗΕ')}`) },
  { name: 'ΕΥΔΑΠ', kind: 'water', afms: ['094079101'], names: new RegExp(`${w('ΕΥΔΑΠ')}|ΥΔΡΕΥΣΕ?ΩΣ ΚΑΙ ΑΠΟΧΕΤΕΥΣΕ?ΩΣ ΠΡΩΤΕΥΟΥΣ`) },
  { name: 'ΕΥΑΘ', kind: 'water', afms: [], names: new RegExp(`${w('ΕΥΑΘ')}|ΥΔΡΕΥΣΕ?ΩΣ ΚΑΙ ΑΠΟΧΕΤΕΥΣΕ?ΩΣ ΘΕΣΣΑΛΟΝΙΚ`) },
  { name: 'ΔΕΥΑ', kind: 'water', afms: [], names: new RegExp(`${w('ΔΕΥΑ[Α-Ω]*')}|ΔΗΜΟΤΙΚΗ ΕΠΙΧΕΙΡΗΣΗ ΥΔΡΕΥΣΗΣ`) },
  { name: 'Coral Gas', kind: 'gas', afms: ['094031258'], names: /CORAL GAS/ },
  { name: 'Φυσικό Αέριο', kind: 'gas', afms: [], names: new RegExp(`ΦΥΣΙΚΟ ΑΕΡΙΟ ΕΛΛΗΝΙΚΗ ΕΤΑΙΡΕΙΑ|${w('ΕΠΑ')} ΑΤΤΙΚΗΣ|${w('ΕΔΑ')} (ΑΤΤΙΚΗΣ|ΘΕΣΣ)`) },
  { name: 'ΟΤΕ / Cosmote', kind: 'telecom', afms: ['094019245'], names: new RegExp(`ΟΡΓΑΝΙΣΜΟΣ ΤΗΛΕΠΙΚΟΙΝΩΝΙΩΝ|COSMOTE|ΚΟΣΜΟΤΕ|${w('ΟΤΕ')}`) },
  { name: 'Vodafone', kind: 'telecom', afms: [], names: /VODAFONE/ },
  { name: 'Nova', kind: 'telecom', afms: [], names: new RegExp(`${w('NOVA')}|WIND (ΕΛΛΑΣ|HELLAS)|FORTHNET`) },
  { name: 'LeasePlan / Ayvens', kind: 'vehicle_lease', afms: ['999599948'], names: /LEASEPLAN|AYVENS|ALD AUTOMOTIVE/ },
  { name: 'Leasing οχημάτων', kind: 'vehicle_lease', afms: [], names: /ARVAL|ATHLON|SIXT LEASING|HERTZ LEASE|AVIS (BUDGET )?LEASE/ },
];

/** Τι λέει το ΠΕΡΙΕΧΟΜΕΝΟ για κάθε είδος λογαριασμού. */
const KIND_SIGNAL: Record<UtilityKind, RegExp> = {
  electricity: new RegExp(`${w('KWH')}|ΡΕΥΜΑΤΟΣ|ΗΛΕΚΤΡΙΚ|ΡΥΘΜΙΖΟΜΕΝ|${w('ΥΚΩ')}|ΕΤΜΕΑΡ|ΔΕΔΔΗΕ|ΑΔΜΗΕ`),
  water: new RegExp(`ΥΔΡΕΥΣ|ΑΠΟΧΕΤΕΥΣ|${w('M3')}|[0-9]M3|ΚΥΒΙΚ`),
  gas: new RegExp(`ΦΥΣΙΚΟ ΑΕΡΙΟ|ΥΓΡΑΕΡΙΟ|ΥΓΡΟΠΟΙΗΜΕΝΟ|${w('LPG')}|${w('LNG')}|ΠΡΟΠΑΝΙΟ`),
  telecom: new RegExp(`ΠΑΓΙΩΝ|ΚΙΝΗΤΗΣ|ΣΤΑΘΕΡΗΣ|ΣΥΝΔΡΟΜ|ΤΗΛΕΦΩΝ|ΚΛΗΣΕΙΣ|INTERNET|${w('DATA')}|ΤΗΛΕΠΙΚΟΙΝΩΝ`),
  vehicle_lease: /ΜΙΣΘΩΜ|LEASING|ΜΙΣΘΩΣΗ ΟΧΗΜ/,
};

/** Μορφή λογαριασμού: εκκαθαριστικός, «λογαριασμός», bill. */
const BILL_SIGNAL = /ΛΟΓΑΡΙΑΣΜΟΣ|ΕΚΚΑΘΑΡΙΣΤΙΚ|(?<![A-Z])BILL(?![A-Z])/;

/** Ό,τι χρειάζεται η αναγνώριση — ένα υποσύνολο του κανονικού JSON, ώστε να ελέγχεται εύκολα. */
export interface UtilityInput {
  issuerAfm?: string | null;
  issuerName?: string | null;
  label?: string | null;
  notes?: string | null;
  hasPeriod?: boolean;
  plates?: number;
  lines: { name: string | null | undefined; vatRate?: number | null; amount?: number | null }[];
}

export interface UtilityDetection {
  kind: UtilityKind;
  /** Ο πάροχος όπως τον αναγνωρίσαμε — `null` όταν η αναγνώριση έγινε μόνο από το περιεχόμενο. */
  provider: string | null;
  /** 0–1 */
  confidence: number;
  /** Γιατί — ό,τι δείχνει το tooltip. */
  evidence: string[];
}

const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D+/g, '');

/** Αναγνωρίζει λογαριασμό κοινής ωφέλειας ή μίσθωσης οχημάτων — `null` όταν δεν υπάρχει απόδειξη. */
export function detectUtility(input: UtilityInput): UtilityDetection | null {
  const afm = digits(input.issuerAfm).slice(-9);
  const name = normalizeGreek(input.issuerName ?? '');
  const lineTexts = input.lines.map((l) => normalizeGreek(l.name ?? ''));
  const body = [normalizeGreek(input.label ?? ''), normalizeGreek(input.notes ?? ''), ...lineTexts].join(' | ');
  const bill = BILL_SIGNAL.test(normalizeGreek(input.label ?? '')) || !!input.hasPeriod;

  const signalFor = (kind: UtilityKind) =>
    KIND_SIGNAL[kind].test(body) || (kind === 'vehicle_lease' && (input.plates ?? 0) > 0);

  // 1. Γνωστός ΑΦΜ: αρκεί μόνος του.
  if (afm.length === 9) {
    const p = PROVIDERS.find((x) => x.afms.includes(afm));
    if (p) return { kind: p.kind, provider: p.name, confidence: 1, evidence: [`ΑΦΜ ${afm} — ${p.name}`] };
  }

  // 2. Όνομα παρόχου + τουλάχιστον μία ένδειξη (περιεχόμενο ή μορφή λογαριασμού).
  if (name) {
    const p = PROVIDERS.find((x) => x.names.test(name));
    if (p) {
      const content = signalFor(p.kind);
      const confidence = 0.6 + (content ? 0.2 : 0) + (bill ? 0.2 : 0);
      if (confidence >= 0.8) {
        return {
          kind: p.kind, provider: p.name, confidence: Math.round(confidence * 100) / 100,
          evidence: [`εκδότης «${p.name}»`, ...(content ? [`γραμμές ${UTILITY_KIND_LABEL[p.kind].toLowerCase()}`] : []), ...(bill ? ['μορφή λογαριασμού'] : [])],
        };
      }
    }
  }

  // 3. Χωρίς πάροχο: μορφή λογαριασμού ΚΑΙ δύο γραμμές με ενδείξεις του ίδιου είδους.
  if (bill) {
    for (const kind of ['electricity', 'water', 'gas', 'telecom'] as UtilityKind[]) {
      const hits = lineTexts.filter((t) => KIND_SIGNAL[kind].test(t)).length;
      if (hits >= 2) {
        return { kind, provider: null, confidence: 0.8, evidence: ['μορφή λογαριασμού', `${hits} γραμμές ${UTILITY_KIND_LABEL[kind].toLowerCase()}`] };
      }
    }
  }
  return null;
}

/** Το είδος χρέωσης μιας γραμμής — `null` όταν το κείμενο δεν λέει αρκετά. */
export function classifyUtilityCharge(
  kind: UtilityKind,
  line: { name: string | null | undefined; vatRate?: number | null; amount?: number | null },
): UtilityCharge | null {
  const t = normalizeGreek(line.name ?? '');
  if (!t) return null;
  if (/ΕΓΓΥΗΣ/.test(t)) return 'deposit';
  if (/ΠΡΟΣΑΥΞΗΣ|ΤΟΚΟΙ|ΤΟΚΟΣ ΥΠΕΡΗΜΕΡ|ΕΚΠΡΟΘΕΣΜ/.test(t)) return 'interest';
  if (/ΕΡΓΑΣΙ|ΣΥΝΔΕΣΗ ΠΑΡΟΧ|ΝΕΑ ΠΑΡΟΧΗ|ΕΠΑΝΑΣΥΝΔΕΣ|ΑΠΟΣΥΝΔΕΣ|ΜΕΤΑΤΟΠΙΣ/.test(t)) return 'works';
  // «Χρεώσεις Δήμου & ΕΡΤ»: και τα δύο εκτός ΦΠΑ — ο δήμος κερδίζει γιατί είναι το συνηθέστερο.
  if (new RegExp(`ΔΗΜΟ[ΥΤΣ]|${w('ΤΑΠ')}|ΚΑΘΑΡΙΟΤ|ΦΩΤΙΣΜ`).test(t)) return 'municipal';
  if (new RegExp(w('ΕΡΤ')).test(t)) return 'ert';
  if (/ΤΕΛΟΣ ΣΥΝΔΡΟΜΗΤ|ΕΙΔ(ΙΚΟ)? ΤΕΛΟΣ|ΕΙΔΙΚΟΣ ΦΟΡΟΣ|ΕΦΚ|ΦΟΡΟΣ ΚΑΤΑΝΑΛ|ΠΕΡΙΒΑΛΛ|2093/.test(t)) return 'tax';
  const amount = line.amount == null ? null : Number(line.amount);
  if (/ΕΚΠΤΩΣ/.test(t) || (amount != null && amount < 0) || (/ΠΙΣΤΩΣ/.test(t) && !/ΧΡΕΩΣ/.test(t))) return 'discount';
  if (kind === 'vehicle_lease') return 'rental';
  if (KIND_SIGNAL[kind].test(t) || /ΠΑΓΙ|ΧΡΕΩΣ|ΠΡΟΜΗΘΕΙ|ΚΑΤΑΝΑΛ|ΣΥΝΔΡΟΜ|ΑΝΑΛΩΣΙΜ|ΑΠΟΧΕΤΕΥΣ/.test(t)) return 'consumption';
  if (line.vatRate != null && Number(line.vatRate) > 0) return 'consumption';
  return null;
}

/**
 * Το κλειδί μνήμης ενός είδους χρέωσης. Η έκπτωση πάει στον λογαριασμό της κατανάλωσης που
 * μειώνει, άρα μοιράζεται το κλειδί της. Το πρόθεμα `@` δεν μπορεί να βγει ποτέ από το
 * `normalizeLineText` (μόνο γράμματα/ψηφία), οπότε δεν συγκρούεται με κανόνα κειμένου.
 */
export function utilityMemoryKey(kind: UtilityKind, charge: UtilityCharge, vatRate?: number | null): string {
  const base = `@utility:${kind}:${charge === 'discount' ? 'consumption' : charge}`;
  return vatRate == null || !Number.isFinite(vatRate) ? base : `${base}@${vatRate}`;
}

/**
 * Τα κλειδιά μιας γραμμής, από το πιο ειδικό στο πιο γενικό: πρώτα με τον ΦΠΑ της («νερό ·
 * κατανάλωση · 13%»), μετά χωρίς. Ο ΦΠΑ μετράει γιατί το ίδιο είδος χρέωσης πάει σε άλλον
 * λογαριασμό ανά συντελεστή (ύδρευση 13% → 62.02.00.0013, πάγιο τέλος 24% → 62.02.00.0024).
 * Η έκπτωση δεν παίρνει δικό της κλειδί ΦΠΑ: ακολουθεί την κατανάλωση που μειώνει.
 */
export function utilityMemoryKeys(kind: UtilityKind, charge: UtilityCharge, vatRate?: number | null): string[] {
  const base = utilityMemoryKey(kind, charge);
  return vatRate == null || !Number.isFinite(vatRate) || charge === 'discount' ? [base] : [utilityMemoryKey(kind, charge, vatRate), base];
}

export function isUtilityMemoryKey(pattern: string): boolean {
  return pattern.startsWith('@utility:');
}

/** «Ρεύμα · Κατανάλωση & πάγια» από ένα κλειδί μνήμης — για τη λίστα κανόνων. */
export function utilityMemoryKeyLabel(pattern: string): string | null {
  const m = /^@utility:([a-z_]+):([a-z_]+)(?:@([\d.]+))?(?:#(?:lin|pur))?$/.exec(pattern);
  if (!m) return null;
  const kind = UTILITY_KIND_LABEL[m[1] as UtilityKind];
  const charge = UTILITY_CHARGE_LABEL[m[2] as UtilityCharge];
  return kind && charge ? `${kind} · ${charge}${m[3] ? ` · ${m[3]}%` : ''}` : null;
}

export type UtilityFindingCode =
  | 'residential' | 'deposit' | 'works' | 'vat_on_pass_through' | 'nondeductible_vat' | 'missing_vat';

export interface UtilityFinding {
  code: UtilityFindingCode;
  tone: 'warning' | 'info';
  text: string;
}

export interface UtilityLineView {
  index: number;
  charge: UtilityCharge | null;
}

export interface UtilityAnalysis extends UtilityDetection {
  lines: UtilityLineView[];
  findings: UtilityFinding[];
}

/**
 * Αναγνώριση + κατάταξη γραμμών + οι παρατηρήσεις που θα έκανε ο λογιστής πριν την καταχώριση.
 * Οι παρατηρήσεις ΔΕΝ μπλοκάρουν: λένε τι να ελεγχθεί.
 */
export function analyzeUtility(input: UtilityInput): UtilityAnalysis | null {
  const det = detectUtility(input);
  if (!det) return null;
  const lines = input.lines.map((l, index) => ({ index, charge: classifyUtilityCharge(det.kind, l) }));
  const findings: UtilityFinding[] = [];
  const text = normalizeGreek([input.notes, input.label, ...input.lines.map((l) => l.name)].join(' '));
  const nonZero = (i: number) => Math.abs(Number(input.lines[i]?.amount ?? 0)) > 0.004;

  if (/ΣΠΙΤΙΟΥ ΣΑΣ|ΟΙΚΙΑΚ|ΚΑΤΟΙΚΙΑ/.test(text)) {
    findings.push({
      code: 'residential', tone: 'warning',
      text: 'Ο λογαριασμός μιλά για οικιακή κατανάλωση. Αν η παροχή δεν είναι χώρος της επιχείρησης, η δαπάνη δεν εκπίπτει και ο ΦΠΑ δεν συμψηφίζεται.',
    });
  }
  if (lines.some((l) => l.charge === 'deposit' && nonZero(l.index))) {
    findings.push({
      code: 'deposit', tone: 'warning',
      text: 'Η εγγύηση δεν είναι δαπάνη: είναι απαίτηση (δοσμένες εγγυήσεις) και επιστρέφεται με τη λήξη της σύμβασης.',
    });
  }
  if (lines.some((l) => l.charge === 'works' && nonZero(l.index))) {
    findings.push({
      code: 'works', tone: 'info',
      text: 'Οι εργασίες δικτύου για νέα παροχή ή επέκταση κεφαλαιοποιούνται· οι επισκευές πάνε στα έξοδα.',
    });
  }
  // Μηδενική γραμμή με ΦΠΑ δεν αλλάζει κανένα ποσό — δεν αξίζει προειδοποίηση.
  const taxedPassThrough = lines.filter(
    (l) => l.charge && OUTSIDE_VAT_CHARGES.includes(l.charge) && Number(input.lines[l.index]?.vatRate ?? 0) > 0 && nonZero(l.index),
  );
  if (taxedPassThrough.length) {
    const nums = taxedPassThrough.map((l) => l.index + 1).join(', ');
    findings.push({
      code: 'vat_on_pass_through', tone: 'warning',
      text: `${taxedPassThrough.length === 1 ? `Η γραμμή ${nums} διαβάστηκε` : `Οι γραμμές ${nums} διαβάστηκαν`} με ΦΠΑ, ενώ τα τέλη δήμου/ΕΡΤ, οι ειδικοί φόροι και οι εγγυήσεις είναι εκτός ΦΠΑ. Έλεγξε την ανάγνωση.`,
    });
  }
  if (det.kind === 'vehicle_lease') {
    findings.push({
      code: 'nondeductible_vat', tone: 'info',
      text: 'Ο ΦΠΑ σε μισθώματα επιβατικών δεν εκπίπτει και γίνεται κόστος· εκπίπτει για επαγγελματικά οχήματα (π.χ. van).',
    });
  }
  if (input.lines.some((l) => l.vatRate == null) && det.kind !== 'vehicle_lease') {
    findings.push({
      code: 'missing_vat', tone: 'info',
      text: 'Κάποιες γραμμές δεν έχουν συντελεστή ΦΠΑ — ο λογαριασμός έχει μόνο συνολική ανάλυση ΦΠΑ.',
    });
  }
  return { ...det, lines, findings };
}

/** Από το κανονικό JSON (`OcrDocument.document`) στην είσοδο της αναγνώρισης. */
export function utilityInputFromDocument(
  document: unknown,
  issuerAfm?: string | null,
  items?: { name: string; vatRate?: unknown; total?: unknown }[],
): UtilityInput | null {
  const d = (document ?? null) as {
    issuer?: { name?: string | null; vat?: string | null };
    type?: { label?: string | null } | null;
    notes?: string | null;
    references?: { period?: { from?: string | null; to?: string | null } | null; plates?: string[] } | null;
    lines?: { name?: string | null; vatRate?: number | null; net?: number | null; total?: number | null }[];
  } | null;
  if (!d && !items) return null;
  const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const lines = items
    ? items.map((it) => ({ name: it.name, vatRate: num(it.vatRate), amount: num(it.total) }))
    : (d?.lines ?? []).map((l) => ({ name: l.name ?? null, vatRate: num(l.vatRate), amount: num(l.net ?? l.total) }));
  const period = d?.references?.period;
  return {
    issuerAfm: issuerAfm ?? d?.issuer?.vat ?? null,
    issuerName: d?.issuer?.name ?? null,
    label: d?.type?.label ?? null,
    notes: d?.notes ?? null,
    hasPeriod: !!(period && (period.from || period.to)),
    plates: d?.references?.plates?.length ?? 0,
    lines,
  };
}
