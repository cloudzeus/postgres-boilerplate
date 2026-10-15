// lib/country-detect.ts — ΚΑΘΑΡΟ. Η χώρα του εκδότη από ό,τι ΓΡΑΦΕΙ το παραστατικό.
//
// Τα ξένα τιμολόγια σχεδόν πάντα τυπώνουν τη χώρα στη διεύθυνση («… 30020 NOVENTA DI PIAVE (VE) -
// ITALY», «AT-2355 Wiener Neudorf», «Dublin 2 Ireland») ή στο πεδίο «Χώρα εκδότη». Αν τη ρωτούσαμε
// από τον χρήστη, θα ήταν δουλειά που το χαρτί έχει ήδη κάνει.
//
// Μόνο ονόματα χωρών και προθέματα Τ.Κ. — ΠΟΤΕ σκέτοι διψήφιοι κωδικοί μέσα σε κείμενο («IN», «IT»,
// «DE» είναι και λέξεις). Ανάμεσα σε πολλά ταιριάσματα νικά το ΤΕΛΕΥΤΑΙΟ: η χώρα γράφεται στο τέλος
// της διεύθυνσης, ενώ ένα όνομα δρόμου («Via Roma», «Germany Street») εμφανίζεται νωρίτερα.

/** ISO-2 → ονόματα (κεφαλαία, χωρίς τόνους/διακριτικά). */
const NAMES: Record<string, string[]> = {
  GR: ['GREECE', 'HELLAS', 'ΕΛΛΑΔΑ', 'ΕΛΛΑΣ'],
  AT: ['AUSTRIA', 'OSTERREICH', 'OESTERREICH', 'ΑΥΣΤΡΙΑ'],
  BE: ['BELGIUM', 'BELGIQUE', 'BELGIE', 'BELGIEN', 'ΒΕΛΓΙΟ'],
  BG: ['BULGARIA', 'БЪЛГАРИЯ', 'ΒΟΥΛΓΑΡΙΑ'],
  CY: ['CYPRUS', 'ΚΥΠΡΟΣ'],
  CZ: ['CZECH REPUBLIC', 'CZECHIA', 'CESKA REPUBLIKA', 'ΤΣΕΧΙΑ'],
  DE: ['GERMANY', 'DEUTSCHLAND', 'ΓΕΡΜΑΝΙΑ'],
  DK: ['DENMARK', 'DANMARK', 'ΔΑΝΙΑ'],
  EE: ['ESTONIA', 'EESTI', 'ΕΣΘΟΝΙΑ'],
  ES: ['SPAIN', 'ESPANA', 'ΙΣΠΑΝΙΑ'],
  FI: ['FINLAND', 'SUOMI', 'ΦΙΝΛΑΝΔΙΑ'],
  FR: ['FRANCE', 'ΓΑΛΛΙΑ'],
  HR: ['CROATIA', 'HRVATSKA', 'ΚΡΟΑΤΙΑ'],
  HU: ['HUNGARY', 'MAGYARORSZAG', 'ΟΥΓΓΑΡΙΑ'],
  IE: ['IRELAND', 'EIRE', 'ΙΡΛΑΝΔΙΑ'],
  IT: ['ITALY', 'ITALIA', 'ΙΤΑΛΙΑ'],
  LT: ['LITHUANIA', 'LIETUVA', 'ΛΙΘΟΥΑΝΙΑ'],
  LU: ['LUXEMBOURG', 'LUXEMBURG', 'ΛΟΥΞΕΜΒΟΥΡΓΟ'],
  LV: ['LATVIA', 'LATVIJA', 'ΛΕΤΟΝΙΑ'],
  MT: ['MALTA', 'ΜΑΛΤΑ'],
  NL: ['NETHERLANDS', 'THE NETHERLANDS', 'NEDERLAND', 'HOLLAND', 'ΟΛΛΑΝΔΙΑ'],
  PL: ['POLAND', 'POLSKA', 'ΠΟΛΩΝΙΑ'],
  PT: ['PORTUGAL', 'ΠΟΡΤΟΓΑΛΙΑ'],
  RO: ['ROMANIA', 'ΡΟΥΜΑΝΙΑ'],
  SE: ['SWEDEN', 'SVERIGE', 'ΣΟΥΗΔΙΑ'],
  SI: ['SLOVENIA', 'SLOVENIJA', 'ΣΛΟΒΕΝΙΑ'],
  SK: ['SLOVAKIA', 'SLOVENSKO', 'ΣΛΟΒΑΚΙΑ'],
  GB: ['UNITED KINGDOM', 'GREAT BRITAIN', 'ENGLAND', 'SCOTLAND', 'WALES', 'UK', 'ΗΝΩΜΕΝΟ ΒΑΣΙΛΕΙΟ', 'ΑΓΓΛΙΑ'],
  CH: ['SWITZERLAND', 'SCHWEIZ', 'SUISSE', 'SVIZZERA', 'ΕΛΒΕΤΙΑ'],
  NO: ['NORWAY', 'NORGE', 'ΝΟΡΒΗΓΙΑ'],
  IS: ['ICELAND', 'ΙΣΛΑΝΔΙΑ'],  // ΟΧΙ «ISLAND»: είναι και αγγλική λέξη («Canvey Island»)
  LI: ['LIECHTENSTEIN'],
  MC: ['MONACO'],
  SM: ['SAN MARINO'],
  TR: ['TURKEY', 'TURKIYE', 'ΤΟΥΡΚΙΑ'],
  RS: ['SERBIA', 'SRBIJA', 'СРБИЈА', 'ΣΕΡΒΙΑ'],
  MK: ['NORTH MACEDONIA', 'FYROM'],
  AL: ['ALBANIA', 'SHQIPERIA', 'ΑΛΒΑΝΙΑ'],
  IL: ['ISRAEL', 'ΙΣΡΑΗΛ'],
  LB: ['LEBANON', 'LIBAN', 'ΛΙΒΑΝΟΣ'],
  EG: ['EGYPT', 'ΑΙΓΥΠΤΟΣ'],
  AE: ['UNITED ARAB EMIRATES', 'UAE', 'ΗΝΩΜΕΝΑ ΑΡΑΒΙΚΑ ΕΜΙΡΑΤΑ'],
  US: ['UNITED STATES', 'USA', 'U.S.A.', 'ΗΠΑ'],
  CA: ['CANADA', 'ΚΑΝΑΔΑΣ'],
  CN: ['CHINA', 'P.R. CHINA', 'PRC', 'ΚΙΝΑ'],
  JP: ['JAPAN', 'ΙΑΠΩΝΙΑ'],
  IN: ['INDIA', 'ΙΝΔΙΑ'],
  UA: ['UKRAINE', 'ΟΥΚΡΑΝΙΑ'],
};

/** Ελληνικά ονόματα για τις χώρες εκτός των προθεμάτων ΦΠΑ (τα υπόλοιπα στο `lib/countries.ts`). */
export const EXTRA_COUNTRY_NAMES_EL: Record<string, string> = {
  TR: 'Τουρκία', RS: 'Σερβία', MK: 'Β. Μακεδονία', AL: 'Αλβανία', IL: 'Ισραήλ', LB: 'Λίβανος',
  EG: 'Αίγυπτος', AE: 'Ηνωμένα Αραβικά Εμιράτα', US: 'ΗΠΑ', CA: 'Καναδάς', CN: 'Κίνα',
  JP: 'Ιαπωνία', IN: 'Ινδία', UA: 'Ουκρανία',
};

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Ταχυδρομικός κώδικας με πρόθεμα χώρας: «AT-2355», «D-74321», «I-20147», «F-75008», «CH-8001».
const ZIP_PREFIX: Record<string, string> = { A: 'AT', D: 'DE', I: 'IT', F: 'FR', B: 'BE', E: 'ES', NL: 'NL', CH: 'CH', L: 'LU', PL: 'PL', CZ: 'CZ', SK: 'SK', SI: 'SI', HR: 'HR', H: 'HU', RO: 'RO', BG: 'BG', AT: 'AT', DE: 'DE', IT: 'IT', FR: 'FR', DK: 'DK', S: 'SE', SE: 'SE', FI: 'FI', N: 'NO', P: 'PT', PT: 'PT', LT: 'LT', LV: 'LV', EE: 'EE', CY: 'CY', GR: 'GR' };

const ENTRIES: { cc: string; re: RegExp }[] = Object.entries(NAMES).flatMap(([cc, names]) =>
  names.map((n) => ({ cc, re: new RegExp(`(^|[^A-ZΑ-ΩА-Я0-9])${plain(n).replace(/[.]/g, '\\.')}(?=$|[^A-ZΑ-ΩА-Я0-9])`, 'g') })));

/** Η χώρα μέσα σε ένα κείμενο (το τελευταίο ταίριασμα), ή `null`. */
export function countryInText(text: string | null | undefined): string | null {
  const t = plain(String(text ?? ''));
  if (!t.trim()) return null;
  let best: { cc: string; at: number } | null = null;
  for (const { cc, re } of ENTRIES) {
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const at = m.index + m[1].length;
      if (!best || at > best.at) best = { cc, at };
    }
  }
  if (best) return best.cc;
  const z = /(?:^|[\s,(])([A-Z]{1,2})-\d{3,5}\b/.exec(t);
  return z ? ZIP_PREFIX[z[1]] ?? null : null;
}

/**
 * Η χώρα του εκδότη από τα στοιχεία του παραστατικού: πρώτα το πεδίο «Χώρα» (μπορεί να είναι ήδη
 * ISO-2), μετά η διεύθυνση, μετά η πόλη.
 */
export function detectIssuerCountry(p: { country?: string | null; address?: string | null; city?: string | null }): string | null {
  const c = String(p.country ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase() === 'EL' ? 'GR' : c.toUpperCase() === 'UK' ? 'GB' : c.toUpperCase();
  return countryInText(c) ?? countryInText(p.address) ?? countryInText(p.city);
}
