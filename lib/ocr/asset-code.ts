// lib/ocr/asset-code.ts — ΚΑΘΑΡΟ. Ο κωδικός νέου παγίου.
//
// Στο Demo S1 (και στη συνήθη πρακτική του SoftOne) ο κωδικός παγίου είναι ο λογαριασμός αγορών της
// λογιστικής κατηγορίας + τετραψήφιος αύξων: «14.03.00.0013» = 13ο Η/Υ στον 14.03.00. Ο επόμενος
// αύξων βγαίνει από τα υπάρχοντα πάγια με το ίδιο πρόθεμα.

/** Ο επόμενος ελεύθερος κωδικός `<πρόθεμα>.<NNNN>`. */
export function nextAssetCode(prefix: string, existing: readonly string[]): string {
  const p = prefix.trim().replace(/\.$/, '');
  const re = new RegExp(`^${p.replace(/\./g, '\\.')}\\.(\\d{4})$`);
  let max = 0;
  for (const c of existing) {
    const m = re.exec(c.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${p}.${String(max + 1).padStart(4, '0')}`;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * Οικογένειες παγίων: πότε μια γραμμή μοιάζει με τέτοιο πάγιο και πώς λέγεται η κατηγορία του στο
 * SoftOne. Αντιστοιχίζουμε με το ΟΝΟΜΑ της κατηγορίας (όχι με id/σύντμηση της εγκατάστασης), ώστε η
 * πρόταση να δουλεύει σε κάθε εγκατάσταση με ελληνικό λογιστικό σχέδιο.
 */
const ASSET_FAMILIES: { line: RegExp; gl: RegExp; category: RegExp }[] = [
  { line: /MACBOOK|LAPTOP|NOTEBOOK|\bNB\b|\bPC\b|Η\/Υ|ΥΠΟΛΟΓΙΣΤ|SERVER|MONITOR|ΟΘΟΝ|PRINTER|ΕΚΤΥΠΩΤ|IPAD|TABLET|ΦΩΤΟΤΥΠ/, gl: /ΗΛΕΚΤΡΟΝ|ΥΠΟΛΟΓ|Η\/Υ/, category: /Η\/Υ|ΗΛΕΚΤΡΟΝ|ΥΠΟΛΟΓ/ },
  { line: /ΚΙΝΗΤΟ|ΤΗΛΕΦΩΝ|PHONE|ΤΗΛΕΠΙΚ|ROUTER|SWITCH|FAX/, gl: /ΤΗΛΕΠΙΚ/, category: /ΤΗΛΕΠΙΚ/ },
  { line: /REACTOR|ΑΝΤΙΔΡΑΣΤ|CONDENSER|ΣΥΜΠΥΚΝ|EXCHANGER|ΕΝΑΛΛΑΚΤ|DECANT|COLUMN|COIL|PUMP|ΑΝΤΛΙ|ΜΗΧΑΝ|COMPRESSOR|ΣΥΜΠΙΕΣΤ|BY ?PASS|TANK|ΔΕΞΑΜΕΝ|ΚΛΙΜΑΤΙΣΤ/, gl: /ΜΗΧΑΝ/, category: /ΜΗΧΑΝ/ },
  { line: /ΕΠΙΠΛ|ΚΑΡΕΚΛ|ΚΑΘΙΣΜ|ΠΟΛΥΘΡΟΝ|DESK|CHAIR|ΕΡΜΑΡ|ΝΤΟΥΛΑΠ|ΤΡΑΠΕΖ/, gl: /ΕΠΙΠΛ/, category: /ΔΙΟΙΚΗΣ|ΕΠΙΠΛ/ },
  { line: /ΑΥΤΟΚΙΝΗΤ|ΟΧΗΜΑ|\bVAN\b|TRUCK|ΦΟΡΤΗΓ|ΕΠΙΒΑΤΙΚ/, gl: /ΜΕΤΑΦΟΡΙΚ.*ΕΙΧ|ΜΕΤΑΦΟΡΙΚ/, category: /ΟΧΗΜ/ },
];

/** Πρόταση λογιστικής και εμπορικής κατηγορίας από την περιγραφή της γραμμής. `null` = δεν ξέρουμε. */
export function guessAssetCategories(
  lineName: string | null | undefined,
  gl: readonly { mtrAcn: number; name: string }[],
  categories: readonly { mtrCategory: number; name: string }[],
): { mtrAcn: number | null; mtrCategory: number | null } {
  const t = fold(lineName ?? '');
  const fam = t ? ASSET_FAMILIES.find((f) => f.line.test(t)) : undefined;
  if (!fam) return { mtrAcn: null, mtrCategory: null };
  return {
    mtrAcn: gl.find((g) => fam.gl.test(fold(g.name)))?.mtrAcn ?? null,
    mtrCategory: categories.find((c) => fam.category.test(fold(c.name)))?.mtrCategory ?? null,
  };
}
