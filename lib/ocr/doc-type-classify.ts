// lib/ocr/doc-type-classify.ts — PURE. Maps a scanned document to one of the ENABLED SoftOne series (spec 2026-09-11 §1).
export type SeriesKind = 'purchase' | 'creditor';
export type SeriesCandidate = { code: string; abbrev: string | null; name: string; kind: SeriesKind; sosource: number };
export type Family = 'TPY' | 'TDA' | 'TIM' | 'DA' | 'PT' | 'APY' | 'ALP' | 'LOG';
export type ClassifyInput = { documentTypeLabel: string | null | undefined; issuerKind: 'supplier' | 'creditor' | null; totalAmount: number | null | undefined; invoiceKind: 'service' | 'product' | 'mixed' | null | undefined; myDataType?: string | null };
export type ClassifyResult = { code: string; sosource: number; kind: SeriesKind; confidence: number; reason: string; tie: boolean; alternatives: { code: string; abbrev: string | null; name: string; score: number }[] };

export function normalizeGreek(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-ZΑ-Ω0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Σύντμηση ως αυτοτελής λέξη. Το `\b` της JS δουλεύει μόνο με [A-Za-z0-9_], άρα ΔΕΝ πιάνει ποτέ
// ελληνικά (π.χ. /\bΤΠΥ\b/ δεν ταιριάζει στο «ΤΠΥ»): χρησιμοποιούμε lookarounds στο κανονικοποιημένο αλφάβητο.
const w = (abbrev: string) => `(?<![A-ZΑ-Ω0-9])${abbrev}(?![A-ZΑ-Ω0-9])`;
// Order matters: more specific families first.
const FAMILY_RULES: [Family, RegExp][] = [
  ['PT', /ΠΙΣΤΩΤ|CREDIT NOTE|CREDIT INVOICE/],
  ['TDA', new RegExp(`(ΤΙΜΟΛΟΓΙΟ.*ΔΕΛΤΙΟ ΑΠΟΣΤΟΛ|ΔΕΛΤΙΟ ΑΠΟΣΤΟΛ.*ΤΙΜΟΛΟΓΙΟ|${w('ΤΔΑ')}|${w('ΤΔΑΠ')}|${w('ΔΑΤ')})`)],
  ['TPY', new RegExp(`(ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ|${w('ΤΠΥ')}|SERVICE INVOICE)`)],
  ['APY', new RegExp(`(ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ|${w('ΑΠΥ')})`)],
  ['ALP', new RegExp(`(ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚ|${w('ΑΛΠ')}|RECEIPT)`)],
  ['LOG', /(ΛΟΓΑΡΙΑΣΜΟΣ|ΕΚΚΑΘΑΡΙΣΤΙΚ|BILL)/],
  ['DA', new RegExp(`(ΔΕΛΤΙΟ ΑΠΟΣΤΟΛ|${w('ΔΑ')}|DELIVERY NOTE)`)],
  ['TIM', new RegExp(`(ΤΙΜΟΛΟΓΙΟ|${w('ΤΙΜ')}|INVOICE|DEBIT NOTE)`)],
];
export function familyOf(label: string | null | undefined): Family | null {
  const n = normalizeGreek(label ?? ''); if (!n) return null;
  for (const [fam, re] of FAMILY_RULES) if (re.test(n)) return fam;
  return null;
}
/** Family of a SERIES from its abbrev + name (same lexicon). */
export function seriesFamily(c: SeriesCandidate): Family | null { return familyOf(`${c.abbrev ?? ''} ${c.name}`); }
const SERVICE_FAMILIES = new Set<Family>(['TPY', 'APY', 'LOG']);
const GOODS_FAMILIES = new Set<Family>(['TIM', 'TDA', 'DA']);
/** How well a document family fits a series family (0–1). */
function familyAffinity(doc: Family | null, series: Family | null): number {
  if (!doc || !series) return 0.2;
  if (doc === series) return 1;
  if (doc === 'LOG' && series === 'TPY') return 0.9;
  // Σκέτο «ΤΙΜΟΛΟΓΙΟ» ταιριάζει εξίσου σε σειρά ΤΠΥ («Τιμολόγιο Παροχής Υπηρεσιών»): η πλευρά
  // (αγορών/πιστωτών) κρίνεται από τον εκδότη ή το invoiceKind — αλλιώς είναι πραγματική ισοπαλία.
  if (doc === 'TIM' && series === 'TPY') return 1;
  if (doc === 'TDA' && series === 'TIM') return 0.6;
  if (doc === 'TIM' && series === 'TDA') return 0.5;
  if (doc === 'APY' && series === 'TPY') return 0.5;
  if (SERVICE_FAMILIES.has(doc) && SERVICE_FAMILIES.has(series)) return 0.4;
  if (GOODS_FAMILIES.has(doc) && GOODS_FAMILIES.has(series)) return 0.4;
  return 0.1;
}
export function classifySeries(input: ClassifyInput, candidates: SeriesCandidate[]): ClassifyResult | null {
  if (!candidates.length) return null;
  const docFam = familyOf(input.documentTypeLabel);
  const isCredit = docFam === 'PT' || (typeof input.totalAmount === 'number' && input.totalAmount < 0);
  const pool = input.issuerKind === 'supplier' ? candidates.filter((c) => c.kind === 'purchase') : input.issuerKind === 'creditor' ? candidates.filter((c) => c.kind === 'creditor') : candidates;
  const scored = (pool.length ? pool : candidates).map((c) => {
    const sf = seriesFamily(c);
    const creditSeries = sf === 'PT';
    let score = isCredit ? (creditSeries ? 1 : 0.05) : (creditSeries ? 0.02 : familyAffinity(docFam, sf));
    // Side hint when the issuer is unknown: services → creditors, goods → purchases.
    if (!input.issuerKind && input.invoiceKind) {
      const wantsCreditor = input.invoiceKind === 'service';
      if ((c.kind === 'creditor') === wantsCreditor) score += 0.15; else score -= 0.15;
    }
    if (!input.issuerKind && !input.invoiceKind && docFam && (SERVICE_FAMILIES.has(docFam) ? c.kind !== 'creditor' : GOODS_FAMILIES.has(docFam) ? c.kind !== 'purchase' : false)) score -= 0.1;
    return { c, score: Math.max(0, Math.min(1, score)), sf };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]; const second = scored[1];
  const gap = second ? best.score - second.score : 1;
  const confidence = Math.max(0, Math.min(1, best.score * (gap < 0.15 ? 0.75 : 1)));
  const reason = [docFam ? `τύπος «${input.documentTypeLabel}» → ${docFam}` : 'χωρίς τυπωμένο τύπο', input.issuerKind === 'supplier' ? 'εκδότης προμηθευτής' : input.issuerKind === 'creditor' ? 'εκδότης πιστωτής' : 'εκδότης άγνωστος', isCredit ? 'πιστωτικό' : null, input.invoiceKind ? `περιεχόμενο ${input.invoiceKind}` : null].filter(Boolean).join(' · ');
  return { code: best.c.code, sosource: best.c.sosource, kind: best.c.kind, confidence, reason, tie: gap < 0.15 && !!second, alternatives: scored.slice(0, 5).map((s) => ({ code: s.c.code, abbrev: s.c.abbrev, name: s.c.name, score: Math.round(s.score * 100) / 100 })) };
}
