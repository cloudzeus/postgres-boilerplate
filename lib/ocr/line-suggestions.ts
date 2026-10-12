// lib/ocr/line-suggestions.ts — SERVER. «Σε τι να αντιστοιχίσω αυτή τη γραμμή;» — έτοιμη πρόταση με
// ένα κλικ, για ΚΑΘΕ αταίριαστη γραμμή που αναγνωρίζεται (είδος χρέωσης λογαριασμού κοινής
// ωφέλειας ή οικογένεια δαπάνης: ναύλος, καύσιμο, συνδρομή…).
//
// Ο ΣΤΟΧΟΣ ΑΚΟΛΟΥΘΕΙ ΤΗ ΣΕΙΡΑ: σε σειρά αγορών (PURDOC) μια τέτοια γραμμή πάει σε ΕΞΟΔΟ (EXPANAL,
// π.χ. «103 Μεταφορικά Αγορών»)· σε ειδικές συναλλαγές (LINLINES) σε ΧΡΕΟΠΙΣΤΩΣΗ — και εκεί
// προτείνονται και οι ΑΝΕΝΕΡΓΕΣ του SoftOne, που η επιλογή τις ενεργοποιεί. Άγνωστη σειρά ⇒ καμία
// πρόταση: δεν ξέρουμε ποιο μητρώο χωράει.
//
// Είναι ΠΡΟΤΑΣΗ, όχι αντιστοίχιση: τίποτα δεν γράφεται χωρίς κλικ. Μετά το κλικ, η απόφαση μαθαίνεται
// για το είδος/την οικογένεια και απλώνεται σε όλα τα ανοιχτά παραστατικά.
import 'server-only';
import { prisma } from '@/lib/db';
import type { PostingTarget } from './posting-target';
import { normalizeGreek } from './doc-type-classify';
import { classifyExpenseFamily, EXPENSE_FAMILY_LABEL, FAMILY_REGISTRY_HINT } from './expense-families';
import { analyzeUtility, utilityInputFromDocument, UTILITY_CHARGE_LABEL, UTILITY_KIND_LABEL } from './utility-bills';
import { utilityRegistryHint } from './accounts-overview';
import { cachedInactiveLineItems, type InactiveLineItem } from '@/lib/softone-sync/lineitem-activate';

export interface SuggestionCandidate {
  kind: 'lineitem' | 'expense';
  id: number;
  code: string;
  name: string;
  /** Χρεοπίστωση ανενεργή στο SoftOne — η επιλογή την ενεργοποιεί πρώτα. */
  inactive: boolean;
}

export interface LineSuggestion {
  /** «Ναύλοι & μεταφορικά» / «Ρεύμα · Δημοτικά τέλη». */
  label: string;
  candidates: SuggestionCandidate[];
}

interface SuggestItem {
  id: string;
  name: string;
  vatRate: unknown;
  total: unknown;
  softoneMtrl: number | null;
  softoneExpn: number | null;
  softoneLinMtrl: number | null;
  softoneAsset?: number | null;
  softoneMatchedBy: string | null;
}

const MAX = 3;
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Ο ΦΠΑ που λέει το ίδιο το μητρώο: «…με Φ.Π.Α. 24%» ή κατάληξη «.0024». */
function registryVat(code: string, name: string): number | null {
  const m = /(\d{1,2})\s*%/.exec(name) ?? /\.00(\d\d)$/.exec(code);
  return m ? Number(m[1]) : null;
}

export async function suggestionsForDocument(input: {
  document: unknown;
  issuerAfm: string | null;
  items: SuggestItem[];
  target: PostingTarget | null;
}): Promise<Record<string, LineSuggestion>> {
  const t = input.target;
  if (!t || !t.supported) return {};
  const registry: 'lineitem' | 'expense' | null = t.lines === 'LINLINES' ? 'lineitem' : t.lines === 'AUTO' || t.lines === 'EXPANAL' ? 'expense' : null;
  if (!registry) return {};

  // Ποιες γραμμές μένουν και τι είναι η καθεμία.
  const utilityInput = utilityInputFromDocument(input.document, input.issuerAfm, input.items.map((i) => ({ name: i.name, vatRate: i.vatRate, total: i.total })));
  const utility = utilityInput ? analyzeUtility(utilityInput) : null;
  const wanted: { item: SuggestItem; label: string; hint: RegExp; vat: number | null }[] = [];
  input.items.forEach((it, index) => {
    if (it.softoneMtrl != null || it.softoneExpn != null || it.softoneLinMtrl != null || it.softoneAsset != null || it.softoneMatchedBy === 'skipped') return;
    const vat = num(it.vatRate);
    const charge = utility?.lines[index]?.charge ?? null;
    if (utility && charge) {
      const hint = utilityRegistryHint(utility.kind, charge);
      if (hint) wanted.push({ item: it, hint, vat, label: `${UTILITY_KIND_LABEL[utility.kind]} · ${UTILITY_CHARGE_LABEL[charge]}` });
      return;
    }
    const family = classifyExpenseFamily(it.name);
    if (family) wanted.push({ item: it, hint: FAMILY_REGISTRY_HINT[family], vat, label: EXPENSE_FAMILY_LABEL[family] });
  });
  if (!wanted.length) return {};

  // Τα υποψήφια μητρώα, μία φορά για όλο το παραστατικό.
  type Row = SuggestionCandidate & { n: string; vat: number | null };
  let rows: Row[];
  if (registry === 'expense') {
    rows = (await prisma.softoneExpense.findMany({ where: { isActive: true }, select: { expn: true, code: true, name: true } }))
      .map((e) => ({ kind: 'expense' as const, id: e.expn, code: e.code, name: e.name, inactive: false, n: normalizeGreek(e.name), vat: registryVat(e.code, e.name) }));
  } else {
    const active = await prisma.softoneLineItem.findMany({ where: { isActive: true }, select: { mtrl: true, code: true, name: true, acnmsk: true } });
    const inactive = await cachedInactiveLineItems().catch(() => [] as InactiveLineItem[]);
    // Η περιγραφή μιας χρεοπίστωσης είναι συχνά λακωνική («Εξοδα», «0006»). Ο ΛΟΓΑΡΙΑΣΜΟΣ της και ο
    // γονικός του λένε περισσότερα («64.02 Προμήθειες…»), οπότε συγκρίνουμε και με αυτούς.
    const masks = [...new Set([...active, ...inactive].map((l) => l.acnmsk).filter((m): m is string => !!m && !m.includes('*')))];
    const parents = masks.map((m) => m.split('.').slice(0, 3).join('.'));
    const accounts = masks.length
      ? await prisma.softoneAccount.findMany({ where: { code: { in: [...masks, ...parents] } }, select: { code: true, name: true } })
      : [];
    const accName = new Map(accounts.map((a) => [a.code, a.name]));
    const text = (l: { name: string; acnmsk: string | null }) => {
      const m = l.acnmsk ?? '';
      return normalizeGreek([l.name, accName.get(m), accName.get(m.split('.').slice(0, 3).join('.'))].filter(Boolean).join(' | '));
    };
    rows = [
      ...active.map((l) => ({ kind: 'lineitem' as const, id: l.mtrl, code: l.code, name: l.name, inactive: false, n: text(l), vat: registryVat(l.code, l.name) })),
      ...inactive.map((l) => ({ kind: 'lineitem' as const, id: l.mtrl, code: l.code, name: l.name, inactive: true, n: text(l), vat: registryVat(l.code, l.name) })),
    ];
  }

  const out: Record<string, LineSuggestion> = {};
  for (const w of wanted) {
    const hits = rows.filter((r) => w.hint.test(r.n));
    if (!hits.length) continue;
    // Πρώτα ο σωστός ΦΠΑ, μετά οι ενεργές, μετά ο κωδικός.
    const rank = (r: Row) => (w.vat != null && r.vat === w.vat ? 0 : w.vat != null && r.vat != null ? 2 : 1);
    hits.sort((a, b) => rank(a) - rank(b) || Number(a.inactive) - Number(b.inactive) || a.code.localeCompare(b.code));
    out[w.item.id] = {
      label: w.label,
      candidates: hits.slice(0, MAX).map(({ kind, id, code, name, inactive }) => ({ kind, id, code, name, inactive })),
    };
  }
  return out;
}
