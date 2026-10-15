// lib/softone-code-rules.ts — SERVER. Οι ΚΑΝΟΝΕΣ ΚΩΔΙΚΟΠΟΙΗΣΗΣ της εγκατάστασης SoftOne.
//
// Κάθε μητρώο έχει στις παραμέτρους του τη «Μορφή κωδικού» (`<ΜΗΤΡΩΟ>PPRMS.CODEMASK`, ανά εταιρεία):
// είδη ITEPPRMS (και barcode `CODEMASK1`, κωδ. εργοστασίου `CODEMASK2`), υπηρεσίες SRVPPRMS,
// χρεοπιστώσεις LINPPRMS, πάγια ASSPPRMS, προμηθευτές SUPPPRMS, πιστωτές CREPPRMS, χρεώστες DEBPPRMS,
// πελάτες CUSPPRMS. Μέχρι τώρα η εφαρμογή μάθαινε τη μορφή ΜΟΝΟ από το μήνυμα απόρριψης («πρέπει να
// είναι της μορφής nnnnnnnnn») — δηλαδή η πρώτη πρόταση σε κάθε μητρώο μπορούσε να είναι λάθος.
// Τώρα η μορφή διαβάζεται ΠΡΙΝ από την πρόταση.
//
// Μόνο ανάγνωση (GetTable). Cache 1 ώρα· αποτυχία ⇒ «άγνωστη» για 10 λεπτά — η φόρμα δεν περιμένει
// ποτέ πάνω από λίγα δευτερόλεπτα γι' αυτό (οι παράμετροι ειδών μετρήθηκαν να μην απαντούν σε 30″).
import 'server-only';
import { softoneGetTable } from '@/lib/softone';
import { getSetting } from '@/lib/settings';

export type CodeRuleKind = 'product' | 'service' | 'lineitem' | 'asset' | 'supplier' | 'creditor' | 'debtor' | 'customer';

const TABLE: Record<CodeRuleKind, string> = {
  product: 'ITEPPRMS', service: 'SRVPPRMS', lineitem: 'LINPPRMS', asset: 'ASSPPRMS',
  supplier: 'SUPPPRMS', creditor: 'CREPPRMS', debtor: 'DEBPPRMS', customer: 'CUSPPRMS',
};

export interface CodeRules {
  /** «Μορφή κωδικού» — `null` όταν δεν έχει οριστεί ή δεν διαβάστηκε. */
  code: string | null;
  /** Μόνο είδη: μορφή barcode (EAN) και κωδικού εργοστασίου (κατασκευαστή). */
  barcode?: string | null;
  manufacturer?: string | null;
  /** Διαβάστηκε από το SoftOne (`false` = δεν απάντησε· ο κανόνας είναι άγνωστος, όχι «κανένας»). */
  known: boolean;
}

const OK_TTL = 60 * 60 * 1000;
const FAIL_TTL = 10 * 60 * 1000;
const WAIT_MS = 4000;
const cache = new Map<CodeRuleKind, { at: number; ttl: number; value: CodeRules }>();
const inflight = new Map<CodeRuleKind, Promise<CodeRules>>();

const clean = (v: unknown) => { const s = String(v ?? '').trim(); return s || null; };

async function load(kind: CodeRuleKind): Promise<CodeRules> {
  const company = String((await getSetting<string>('integrations.softoneCompany').catch(() => '')) ?? '').trim();
  const fields = kind === 'product' ? ['COMPANY', 'CODEMASK', 'CODEMASK1', 'CODEMASK2'] : ['COMPANY', 'CODEMASK'];
  const rows = await softoneGetTable(TABLE[kind], fields, /^\d+$/.test(company) ? `COMPANY=${company}` : '1=1');
  const r = rows.find((x) => !company || x.COMPANY === company) ?? rows[0];
  return {
    code: clean(r?.CODEMASK),
    ...(kind === 'product' ? { barcode: clean(r?.CODEMASK1), manufacturer: clean(r?.CODEMASK2) } : {}),
    known: true,
  };
}

/** Οι κανόνες ενός μητρώου — από cache, ή φρέσκοι με όριο αναμονής λίγων δευτερολέπτων. */
export async function softoneCodeRules(kind: CodeRuleKind): Promise<CodeRules> {
  const hit = cache.get(kind);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let p = inflight.get(kind);
  if (!p) {
    p = load(kind)
      .then((value) => { cache.set(kind, { at: Date.now(), ttl: OK_TTL, value }); return value; })
      .catch(() => { const value = { code: null, known: false }; cache.set(kind, { at: Date.now(), ttl: FAIL_TTL, value }); return value; })
      .finally(() => inflight.delete(kind));
    inflight.set(kind, p);
  }
  // Δεν κρατάμε τη φόρμα: αν το SoftOne αργεί, η πρόταση φεύγει με ό,τι ξέρουμε και η ανάγνωση
  // ολοκληρώνεται στο παρασκήνιο για την επόμενη φορά.
  return Promise.race([p, new Promise<CodeRules>((res) => setTimeout(() => res({ code: null, known: false }), WAIT_MS))]);
}

/** Μόνο για tests. */
export function __clearCodeRules(): void { cache.clear(); inflight.clear(); }
