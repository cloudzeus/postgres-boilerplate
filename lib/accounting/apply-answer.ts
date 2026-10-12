// lib/accounting/apply-answer.ts — SERVER. Εφαρμογή μιας «Αλλαγής στόχου» του λογιστή.
//
// Η απόφαση «τα καύσιμα πάνε στο Χ» ζει σε ΠΟΛΛΟΥΣ κανόνες: τον γενικό (afm '') και τους ίδιους κανόνες
// σταθερού κλειδιού ανά εκδότη, που γράφτηκαν από το ΙΔΙΟ κλικ — και αυτοί προηγούνται του γενικού.
// Αλλάζουμε όλους όσους δείχνουν στον ΠΑΛΙΟ στόχο με το ίδιο κλειδί (ίδια οικογένεια/χρέωση, ίδιος
// κόσμος), μαζί με τους κανόνες ΚΕΙΜΕΝΟΥ των ίδιων εκδοτών που δείχνουν στον παλιό στόχο και ανήκουν
// στην ίδια κατηγορία. Οι γραμμές των ΑΝΟΙΧΤΩΝ παραστατικών που είχε διαλέξει άνθρωπος ('manual')
// ακολουθούν κι αυτές: η απόφαση του λογιστή υπερισχύει της επιλογής της στιγμής. Μετά, στοχευμένη
// επανεφαρμογή στα ανοιχτά παραστατικά (τα καταχωρισμένα δεν αγγίζονται ποτέ).
import 'server-only';
import { prisma } from '@/lib/db';
import { classifyExpenseFamily } from '@/lib/ocr/expense-families';
import { classifyUtilityCharge, type UtilityKind } from '@/lib/ocr/utility-bills';
import { detectUtilityForItems } from '@/lib/ocr/softone-match';
import { rematchOpenDocuments } from '@/lib/ocr/queues';

export interface TargetChange {
  kind: 'expense' | 'lineitem';
  id: number;
}

export function parseRuleKey(pattern: string): null | { base: string; group: 'family' | 'utility'; name: string; vat: number | null; world: string | null } {
  const m = /^(@(family|utility):([a-z_:]+?))(?:@([\d.]+))?(?:#(lin|pur))?$/.exec(pattern);
  if (!m) return null;
  return { base: m[1], group: m[2] as 'family' | 'utility', name: m[3], vat: m[4] == null ? null : Number(m[4]), world: m[5] ?? null };
}

/** Αλλάζει τον στόχο της απόφασης. Επιστρέφει πόσοι κανόνες άλλαξαν και τι έκανε η επανεφαρμογή. */
export async function changeRuleTarget(pattern: string, to: TargetChange) {
  const key = parseRuleKey(pattern);
  if (!key) throw new Error('Άγνωστο κλειδί κανόνα.');
  const general = await prisma.lineMatchRule.findUnique({ where: { afm_pattern: { afm: '', pattern } } });
  if (!general) throw new Error('Ο κανόνας δεν υπάρχει πια.');
  const same = (r: { mtrl: number | null; expn: number | null; lin: number | null }) =>
    r.mtrl === general.mtrl && r.expn === general.expn && r.lin === general.lin;

  const keyed = (await prisma.lineMatchRule.findMany({ where: { pattern: { startsWith: key.base } } }))
    .filter((r) => {
      const k = parseRuleKey(r.pattern);
      return k && k.base === key.base && k.world === key.world && same(r);
    });
  const afms = [...new Set(keyed.map((r) => r.afm).filter((a) => a !== ''))];
  const textRules = afms.length
    ? (await prisma.lineMatchRule.findMany({ where: { afm: { in: afms }, NOT: { pattern: { startsWith: '@' } } } }))
        .filter((r) => same(r) && (key.group === 'utility' || classifyExpenseFamily(r.pattern) === key.name))
    : [];

  const ids = [...keyed, ...textRules].map((r) => r.id);
  const data = {
    mtrl: null, isService: false, targetSource: 'manual',
    expn: to.kind === 'expense' ? to.id : null,
    lin: to.kind === 'lineitem' ? to.id : null,
  };
  await prisma.lineMatchRule.updateMany({ where: { id: { in: ids } }, data });

  // Χειροκίνητες γραμμές ανοιχτών παραστατικών στον παλιό στόχο, της ίδιας κατηγορίας (και του ίδιου
  // ΦΠΑ, αν η απόφαση αφορά συντελεστή): γίνονται 'memory' ώστε η επανεφαρμογή να τις μεταφέρει.
  const manual = await prisma.ocrInvoiceItem.findMany({
    where: {
      softoneMatchedBy: 'manual', softoneMtrl: general.mtrl, softoneExpn: general.expn, softoneLinMtrl: general.lin,
      document: { status: 'COMPLETED', postStatus: { not: 'POSTED' }, OR: [{ reconOverride: null }, { reconOverride: { not: 'IGNORED' } }] },
    },
    select: {
      id: true, name: true, vatRate: true, total: true,
      document: { select: { document: true, issuerAfm: true, items: { select: { name: true, vatRate: true, total: true } } } },
    },
  });
  const [uKind, uCharge] = key.name.split(':') as [UtilityKind, string];
  const moved = manual.filter((l) => {
    if (key.vat != null && Number(l.vatRate) !== key.vat) return false;
    if (key.group === 'family') return classifyExpenseFamily(l.name) === key.name;
    if (detectUtilityForItems(l.document.document, l.document.issuerAfm, l.document.items)?.kind !== uKind) return false;
    const c = classifyUtilityCharge(uKind, { name: l.name, vatRate: l.vatRate == null ? null : Number(l.vatRate), amount: l.total == null ? null : Number(l.total) });
    return (c === 'discount' ? 'consumption' : c) === uCharge;
  }).map((l) => l.id);
  if (moved.length) await prisma.ocrInvoiceItem.updateMany({ where: { id: { in: moved } }, data: { softoneMatchedBy: 'memory' } });

  const only = key.group === 'family' ? { family: key.name } : { utilityKind: uKind };
  const rematch = await rematchOpenDocuments(only);
  return { rules: ids.length, manualLines: moved.length, rematch };
}
