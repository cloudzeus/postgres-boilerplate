// lib/ocr/depreciation.ts — ΚΑΘΑΡΟ. Φορολογικοί συντελεστές απόσβεσης παγίων.
//
// Πηγή: άρθρο 24 παρ. 4 του Ν.4172/2013 (ΚΦΕ), όπως ισχύει (πίνακας 17 κατηγοριών), και παρ. 7 για τα
// πάγια μικρής αξίας. Οι λογιστικές κατηγορίες παγίων του SoftOne (ASSETGL) συχνά κουβαλούν ακόμη
// τους ΠΑΛΙΟΥΣ συντελεστές του Π.Δ. 299/2003 — στο Demo S1: Η/Υ 30% (νόμος 20%), μηχανήματα 15%
// (10%), έπιπλα 20% (10%), κτίρια 25% (4%). Γι' αυτό προτείνουμε τον συντελεστή του ΝΟΜΟΥ ανά πάγιο
// και λέμε ρητά όταν η κατηγορία του SoftOne διαφέρει.

export const DEPRECIATION_SOURCE = 'άρθρο 24 παρ. 4 Ν.4172/2013 (ΚΦΕ)';

/** Κάτω από αυτή την αξία ένα πάγιο ΜΠΟΡΕΙ να αποσβεστεί ολόκληρο στη χρήση απόκτησης (παρ. 7). */
export const LOW_VALUE_LIMIT = 1500;

export type DeprClass =
  | 'buildings' | 'ev_charging' | 'mining_land' | 'ships_aircraft' | 'machinery'
  | 'passenger' | 'passenger_zero' | 'passenger_low'
  | 'goods_vehicle' | 'goods_zero' | 'goods_low'
  | 'intangible' | 'it' | 'other' | 'research' | 'land';

export const LEGAL_DEPRECIATION: Record<DeprClass, { rate: number; label: string }> = {
  buildings: { rate: 4, label: 'Κτίρια, κατασκευές, εγκαταστάσεις, αποθήκες και σταθμοί' },
  ev_charging: { rate: 100, label: 'Κατασκευές φόρτισης οχημάτων μηδενικών ή χαμηλών ρύπων' },
  mining_land: { rate: 5, label: 'Εδαφικές εκτάσεις για εξόρυξη και λατομεία' },
  ships_aircraft: { rate: 5, label: 'Αεροσκάφη, σιδηροδρομικοί συρμοί, πλοία και σκάφη' },
  machinery: { rate: 10, label: 'Μηχανήματα και εξοπλισμός (εκτός Η/Υ και λογισμικού)' },
  passenger: { rate: 16, label: 'Μέσα μεταφοράς ατόμων' },
  passenger_zero: { rate: 50, label: 'Μέσα μεταφοράς ατόμων μηδενικών ρύπων' },
  passenger_low: { rate: 25, label: 'Μέσα μεταφοράς ατόμων χαμηλών ρύπων (έως 50 γρ. CO2/χλμ.)' },
  goods_vehicle: { rate: 12, label: 'Μέσα μεταφοράς εμπορευμάτων' },
  goods_zero: { rate: 50, label: 'Μέσα μεταφοράς εμπορευμάτων μηδενικών ρύπων' },
  goods_low: { rate: 25, label: 'Μέσα μεταφοράς εμπορευμάτων χαμηλών ρύπων (έως 50 γρ. CO2/χλμ.)' },
  intangible: { rate: 10, label: 'Άυλα στοιχεία, δικαιώματα και έξοδα πολυετούς απόσβεσης' },
  it: { rate: 20, label: 'Εξοπλισμός Η/Υ (κύριος και περιφερειακός) και λογισμικό' },
  other: { rate: 10, label: 'Λοιπά πάγια στοιχεία (έπιπλα, σκεύη, λοιπός εξοπλισμός)' },
  research: { rate: 40, label: 'Εξοπλισμός και όργανα επιστημονικής και τεχνολογικής έρευνας' },
  land: { rate: 0, label: 'Γήπεδα και οικόπεδα (δεν αποσβένονται)' },
};

const fold = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const VEHICLE = /ΑΥΤΟΚΙΝΗΤ|ΟΧΗΜΑ|ΕΠΙΒΑΤΙΚ|ΦΟΡΤΗΓ|\bVAN\b|TRUCK|PICK ?UP|ΗΜΙΦΟΡΤ|ΜΟΤΟΣΙΚΛ|ΔΙΚΥΚΛ|SCOOTER|ΠΑΤΙΝΙ/;
const GOODS_VEHICLE = /ΦΟΡΤΗΓ|\bVAN\b|TRUCK|PICK ?UP|ΗΜΙΦΟΡΤ|ΚΛΑΡΚ|FORKLIFT|ΠΕΡΟΝΟΦΟΡ/;
const ZERO_EMISSION = /ΗΛΕΚΤΡΙΚ|ELECTRIC|\bEV\b|\bBEV\b|TESLA|ΜΗΔΕΝΙΚ/;
const LOW_EMISSION = /PLUG.?IN|\bPHEV\b|ΕΠΑΝΑΦΟΡΤΙΖ/;

/** Κατηγορία του νόμου από την περιγραφή της γραμμής. `null` = δεν φαίνεται. */
export function legalClassForLine(lineName: string | null | undefined): DeprClass | null {
  const t = fold(lineName);
  if (!t) return null;
  if (/ΦΟΡΤΙΣΤ|WALLBOX|CHARGER|CHARGING|ΣΤΑΘΜΟΣ ΦΟΡΤΙΣ/.test(t)) return 'ev_charging';
  if (VEHICLE.test(t) || GOODS_VEHICLE.test(t)) {
    const goods = GOODS_VEHICLE.test(t);
    if (ZERO_EMISSION.test(t)) return goods ? 'goods_zero' : 'passenger_zero';
    if (LOW_EMISSION.test(t)) return goods ? 'goods_low' : 'passenger_low';
    return goods ? 'goods_vehicle' : 'passenger';
  }
  if (/MACBOOK|LAPTOP|NOTEBOOK|\bNB\b|\bPC\b|Η\/Υ|ΥΠΟΛΟΓΙΣΤ|SERVER|MONITOR|ΟΘΟΝ|PRINTER|ΕΚΤΥΠΩΤ|IPAD|TABLET|SCANNER|ΣΑΡΩΤ|ROUTER|SWITCH|\bNAS\b|ΛΟΓΙΣΜΙΚ|SOFTWARE|ΑΔΕΙΑ ΧΡΗΣΗΣ|LICEN[CS]E/.test(t)) return 'it';
  if (/ΟΙΚΟΠΕΔ|ΓΗΠΕΔ|ΑΓΡΟΤΕΜΑΧ/.test(t)) return 'land';
  if (/ΚΤΙΡΙ|ΑΠΟΘΗΚ|ΚΤΙΡΙΑΚ|ΑΝΑΚΑΙΝΙΣ|ΠΡΟΚΑΤ/.test(t)) return 'buildings';
  if (/ΕΡΕΥΝ|ΕΡΓΑΣΤΗΡΙΑΚ|RESEARCH/.test(t)) return 'research';
  if (/REACTOR|ΑΝΤΙΔΡΑΣΤ|CONDENSER|ΣΥΜΠΥΚΝ|EXCHANGER|ΕΝΑΛΛΑΚΤ|DECANT|COLUMN|PUMP|ΑΝΤΛΙ|ΜΗΧΑΝ|COMPRESSOR|ΣΥΜΠΙΕΣΤ|TANK|ΔΕΞΑΜΕΝ|ΚΛΙΜΑΤΙΣΤ|ΓΕΝΝΗΤΡ|ΤΟΡΝ|ΚΛΑΡΚ/.test(t)) return 'machinery';
  if (/ΕΠΙΠΛ|ΚΑΡΕΚΛ|ΚΑΘΙΣΜ|ΠΟΛΥΘΡΟΝ|DESK|CHAIR|ΕΡΜΑΡ|ΝΤΟΥΛΑΠ|ΤΡΑΠΕΖ|ΚΙΝΗΤΟ|ΤΗΛΕΦΩΝ|PHONE|IPHONE|SMARTPHONE|FAX/.test(t)) return 'other';
  return null;
}

/**
 * Κατηγορία του νόμου από τη ΛΟΓΙΣΤΙΚΗ κατηγορία του SoftOne: ο λογαριασμός ΕΓΛΣ (10–16) λέει
 * περισσότερα από το όνομα, που αλλάζει από εγκατάσταση σε εγκατάσταση.
 */
export function legalClassForGl(name: string | null | undefined, acnmsk: string | null | undefined): DeprClass | null {
  const n = fold(name);
  const a = (acnmsk ?? '').trim();
  if (/^10\b|^10\./.test(a) || /ΟΙΚΟΠΕΔ|ΓΗΠΕΔ/.test(n)) return 'land';
  if (/^11\b|^11\./.test(a) || /ΚΤΙΡΙ/.test(n)) return 'buildings';
  if (/^12\b|^12\./.test(a) || /ΜΗΧΑΝ/.test(n)) return 'machinery';
  if (/^13\b|^13\./.test(a) || /ΜΕΤΑΦΟΡΙΚ|ΟΧΗΜ/.test(n)) return /ΦΙΧ|ΦΟΡΤΗΓ/.test(n) || /^13\.02/.test(a) ? 'goods_vehicle' : 'passenger';
  if (/^14\.03/.test(a) || /ΗΛΕΚΤΡΟΝ|Η\/Υ|ΥΠΟΛΟΓ/.test(n)) return 'it';
  if (/^16\b|^16\./.test(a) || /ΑΥΛ|ΛΟΓΙΣΜΙΚ|ΔΙΚΑΙΩΜ/.test(n)) return /ΛΟΓΙΣΜΙΚ/.test(n) ? 'it' : 'intangible';
  if (/^14\b|^14\./.test(a) || /ΕΠΙΠΛ|ΤΗΛΕΠΙΚ|ΕΞΟΠΛΙΣΜ/.test(n)) return 'other';
  return null;
}

export interface DepreciationAdvice {
  cls: DeprClass;
  /** Ο συντελεστής του νόμου (%). */
  rate: number;
  label: string;
  /** Από πού βγήκε η κατηγορία — για την εξήγηση. */
  from: 'line' | 'gl';
  /** Ο συντελεστής της λογιστικής κατηγορίας στο SoftOne, αν είναι γνωστός. */
  glRate: number | null;
  /** Η κατηγορία του SoftOne έχει άλλο συντελεστή από τον νόμο. */
  mismatch: boolean;
  /** Ετήσια απόσβεση και χρόνια — μόνο με γνωστή αξία και συντελεστή > 0. */
  annual: number | null;
  years: number | null;
  /** Αξία κάτω από {@link LOW_VALUE_LIMIT}: επιτρέπεται εφάπαξ απόσβεση στη χρήση. */
  lowValue: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Ο προτεινόμενος συντελεστής για ένα νέο πάγιο: πρώτα από την περιγραφή (ένα «MacBook» είναι Η/Υ
 * ό,τι κατηγορία κι αν διαλέξει ο χρήστης), αλλιώς από τη λογιστική κατηγορία του SoftOne.
 */
export function depreciationAdvice(input: {
  lineName: string | null | undefined;
  amount: number | null | undefined;
  gl: { name: string; acnmsk: string | null; depreciation: number | null } | null | undefined;
}): DepreciationAdvice | null {
  const fromLine = legalClassForLine(input.lineName);
  const fromGl = input.gl ? legalClassForGl(input.gl.name, input.gl.acnmsk) : null;
  const cls = fromLine ?? fromGl;
  if (!cls) return null;
  const { rate, label } = LEGAL_DEPRECIATION[cls];
  const glRate = input.gl?.depreciation ?? null;
  const amount = input.amount != null && Number.isFinite(input.amount) ? Math.abs(input.amount) : null;
  return {
    cls, rate, label,
    from: fromLine ? 'line' : 'gl',
    glRate,
    mismatch: glRate != null && Math.abs(glRate - rate) > 0.001,
    annual: amount != null && rate > 0 ? round2((amount * rate) / 100) : null,
    years: rate > 0 ? Math.round((100 / rate) * 10) / 10 : null,
    lowValue: amount != null && amount > 0 && amount < LOW_VALUE_LIMIT,
  };
}

/** Για τη σύγκριση όλων των κατηγοριών του SoftOne με τον νόμο (σελίδα λογιστικής αρχικοποίησης). */
export function auditGlDepreciation(
  gl: readonly { mtrAcn: number; code: string; name: string; acnmsk: string | null; depreciation: number | null }[],
): { mtrAcn: number; code: string; name: string; acnmsk: string | null; glRate: number | null; cls: DeprClass | null; legalRate: number | null; legalLabel: string | null; mismatch: boolean }[] {
  return gl.map((g) => {
    const cls = legalClassForGl(g.name, g.acnmsk);
    const legal = cls ? LEGAL_DEPRECIATION[cls] : null;
    return {
      mtrAcn: g.mtrAcn, code: g.code, name: g.name, acnmsk: g.acnmsk, glRate: g.depreciation, cls,
      legalRate: legal?.rate ?? null, legalLabel: legal?.label ?? null,
      mismatch: legal != null && g.depreciation != null && Math.abs(g.depreciation - legal.rate) > 0.001,
    };
  });
}
