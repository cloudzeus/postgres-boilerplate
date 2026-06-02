// lib/programs/eligibility.ts
// Pure βασικά-κριτήρια engine. asOf is injected for deterministic tests.

export type KadRule = 'ALL_EXCEPT_LISTED' | 'ONLY_LISTED' | 'MIXED' | 'UNSPECIFIED';

export interface CompanyEligInput {
  activities: { code: string }[];
  legalForm: string | null;
  employeeCount: number | null;
  foundingDate: Date | null;
  regionName: string | null;
}
export interface ProgramEligInput {
  kadRule: KadRule;
  kads: { code: string; excluded: boolean }[];
  eligibleLegalForms: string[];
  minEmployeesFte: number | null;
  minOperationalYears: number | null;
  regions: string[];
}
export interface EligibilityCriterion {
  key: 'kad' | 'legalForm' | 'employeeCount' | 'operationalYears' | 'region';
  label: string;
  required: string | null;
  actual: string | null;
  pass: boolean;
  note?: string;
}
export interface EligibilityResult { criteria: EligibilityCriterion[]; eligible: boolean }

const NA = 'δεν απαιτείται';

/** Remove Greek diacritics so "Αττική" === "ΑΤΤΙΚΗ" after upper-casing. */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/**
 * Canonicalise a Greek legal form to a comparable token, handling abbreviation ↔ full name:
 * "Ι.Κ.Ε.", "ΙΚΕ", "Ιδιωτική Κεφαλαιουχική Εταιρεία", "Μονοπρόσωπη ΙΚΕ" → "ΙΚΕ".
 */
export function canonicalLegalForm(s: string): string {
  const t = stripAccents(s).toUpperCase().replace(/[^Α-ΩA-Z]/g, '');
  // Κ.ΑΛ.Ο. / κοινωνικοί φορείς FIRST — many contain "Περιορισμένης Ευθύνης" or "Εταιρεία"
  // and must NOT be mistaken for ΕΠΕ / ΑΕ.
  if (/ΚΟΙΣΠΕ/.test(t) || (/ΚΟΙΝΩΝΙΚΟΣΣΥΝΕΤΑΙΡΙΣΜΟΣ/.test(t) && /ΠΕΡΙΟΡΙΣΜΕΝΗΣΕΥΘΥΝΗΣ/.test(t))) return 'ΚΟΙΣΠΕ';
  if (/ΚΟΙΝΣΕΠ/.test(t) || /ΚΟΙΝΩΝΙΚΗΣΥΝΕΤΑΙΡΙΣΤΙΚΗ/.test(t)) return 'ΚΟΙΝΣΕΠ';
  if (/ΣΥΝΕΤΑΙΡΙΣΜ/.test(t)) return 'ΣΥΝΕΤΑΙΡΙΣΜΟΣ';
  if (/ΑΣΤΙΚΗΜΗΚΕΡΔΟΣΚΟΠΙΚΗ/.test(t) || /^ΑΜΚΕ/.test(t)) return 'ΑΜΚΕ';
  // Εμπορικές μορφές
  if (/ΙΔΙΩΤΙΚΗΚΕΦΑΛΑΙΟΥΧΙΚΗ/.test(t) || t === 'ΙΚΕ' || t.endsWith('ΙΚΕ')) return 'ΙΚΕ';
  if (/ΑΝΩΝΥΜ/.test(t) || t === 'ΑΕ') return 'ΑΕ';
  // ΕΠΕ μόνο όταν είναι «Εταιρ(ε)ία Περιορισμένης Ευθύνης» και ΟΧΙ «Συνεταιρισμός».
  if (t === 'ΕΠΕ' || (/ΕΤΑΙΡ/.test(t) && /ΠΕΡΙΟΡΙΣΜΕΝΗΣΕΥΘΥΝΗΣ/.test(t) && !/ΣΥΝΕΤΑΙΡ/.test(t))) return 'ΕΠΕ';
  if (/ΟΜΟΡΡΥΘΜ/.test(t) || t === 'ΟΕ') return 'ΟΕ';
  if (/ΕΤΕΡΟΡΡΥΘΜ/.test(t) || t === 'ΕΕ') return 'ΕΕ';
  if (/ΑΤΟΜΙΚ/.test(t)) return 'ΑΤΟΜΙΚΗ';
  return t;
}
/** Normalise a region name: drop accents + the word "ΠΕΡΙΦΕΡΕΙΑ", keep letters only.
 *  Καλλικράτης registry stores "ΠΕΡΙΦΕΡΕΙΑ ΑΤΤΙΚΗΣ" (genitive); programs say "Αττική". */
function normRegion(s: string): string {
  return stripAccents(s).toUpperCase().replace(/ΠΕΡΙΦΕΡΕΙΑ/g, '').replace(/[^Α-ΩA-Z]/g, '');
}
/** hierarchical dotted prefix: program "62.01" matches company "62.01.11" (and equal codes). */
function kadMatches(programCode: string, companyCode: string): boolean {
  const p = programCode.replace(/\s/g, '');
  const c = companyCode.replace(/\s/g, '');
  return c === p || c.startsWith(p + '.') || p.startsWith(c + '.');
}

function evalKad(company: CompanyEligInput, program: ProgramEligInput): EligibilityCriterion {
  const codes = company.activities.map((a) => a.code).filter(Boolean);
  const listed = program.kads.filter((k) => !k.excluded).map((k) => k.code);
  const excluded = program.kads.filter((k) => k.excluded).map((k) => k.code);
  const base = { key: 'kad' as const, label: 'ΚΑΔ' };

  if (program.kadRule === 'UNSPECIFIED' || (listed.length === 0 && excluded.length === 0)) {
    return { ...base, required: null, actual: codes.join(', ') || null, pass: true, note: 'δεν διευκρινίζεται' };
  }

  // Δείχνουμε μόνο τους ΚΑΔ της επιχείρησης που ταιριάζουν (όχι όλη τη λίστα του προγράμματος).
  const matchedListed = codes.filter((c) => listed.some((l) => kadMatches(l, c)));
  const matchedExcluded = codes.filter((c) => excluded.some((e) => kadMatches(e, c)));

  if (program.kadRule === 'ALL_EXCEPT_LISTED') {
    const pass = matchedExcluded.length === 0;
    return {
      ...base, required: null,
      actual: pass ? null : matchedExcluded.join(', '),
      pass, note: pass ? 'δεν εμπίπτει σε εξαίρεση' : 'ΚΑΔ εξαιρείται από το πρόγραμμα',
    };
  }
  if (program.kadRule === 'ONLY_LISTED') {
    const pass = matchedListed.length > 0;
    return {
      ...base, required: null,
      actual: pass ? matchedListed.join(', ') : null,
      pass, note: pass ? 'επιλέξιμος ΚΑΔ' : 'κανένας επιλέξιμος ΚΑΔ',
    };
  }
  // MIXED
  const pass = matchedListed.length > 0 && matchedExcluded.length === 0;
  return {
    ...base, required: null,
    actual: pass ? matchedListed.join(', ') : (matchedExcluded.length ? matchedExcluded.join(', ') : null),
    pass, note: pass ? 'επιλέξιμος ΚΑΔ' : (matchedExcluded.length ? 'ΚΑΔ εξαιρείται' : 'κανένας επιλέξιμος ΚΑΔ'),
  };
}

export function evaluateEligibility(
  company: CompanyEligInput,
  program: ProgramEligInput,
  asOf: Date,
): EligibilityResult {
  const criteria: EligibilityCriterion[] = [];
  criteria.push(evalKad(company, program));

  // Legal form
  if (program.eligibleLegalForms.length === 0) {
    criteria.push({ key: 'legalForm', label: 'Νομική μορφή', required: null, actual: company.legalForm, pass: true, note: NA });
  } else {
    const allowed = program.eligibleLegalForms.map(canonicalLegalForm);
    const pass = !!company.legalForm && allowed.includes(canonicalLegalForm(company.legalForm));
    criteria.push({ key: 'legalForm', label: 'Νομική μορφή', required: program.eligibleLegalForms.join(', '), actual: company.legalForm, pass });
  }

  // Employees (approx ΕΜΕ)
  if (program.minEmployeesFte == null) {
    criteria.push({ key: 'employeeCount', label: 'Προσωπικό (ΕΜΕ)', required: null, actual: company.employeeCount?.toString() ?? null, pass: true, note: NA });
  } else {
    const have = company.employeeCount ?? 0;
    criteria.push({ key: 'employeeCount', label: 'Προσωπικό (ΕΜΕ)', required: `≥ ${program.minEmployeesFte}`, actual: `${have} (κατά προσέγγιση)`, pass: have >= program.minEmployeesFte });
  }

  // Operational years
  if (program.minOperationalYears == null) {
    criteria.push({ key: 'operationalYears', label: 'Έτη λειτουργίας', required: null, actual: null, pass: true, note: NA });
  } else if (!company.foundingDate) {
    criteria.push({ key: 'operationalYears', label: 'Έτη λειτουργίας', required: `≥ ${program.minOperationalYears}`, actual: 'άγνωστη ίδρυση', pass: false });
  } else {
    const years = (asOf.getTime() - company.foundingDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    criteria.push({ key: 'operationalYears', label: 'Έτη λειτουργίας', required: `≥ ${program.minOperationalYears}`, actual: years.toFixed(1), pass: years >= program.minOperationalYears });
  }

  // Region
  if (program.regions.length === 0) {
    criteria.push({ key: 'region', label: 'Περιφέρεια', required: null, actual: company.regionName, pass: true, note: NA });
  } else {
    const c = company.regionName ? normRegion(company.regionName) : '';
    // bidirectional substring: "ΑΤΤΙΚΗΣ" (registry, genitive) ⊇ "ΑΤΤΙΚΗ" (program, nominative)
    const pass = !!c && program.regions.some((r) => { const a = normRegion(r); return !!a && (a.includes(c) || c.includes(a)); });
    criteria.push({ key: 'region', label: 'Περιφέρεια', required: null, actual: company.regionName, pass, note: pass ? 'εντός επιλέξιμων περιφερειών' : 'εκτός επιλέξιμων περιφερειών' });
  }

  return { criteria, eligible: criteria.every((c) => c.pass) };
}
