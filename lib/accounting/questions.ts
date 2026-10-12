// lib/accounting/questions.ts — SERVER. ΕΡΩΤΗΜΑΤΑ ΠΡΟΣ ΤΟΝ ΛΟΓΙΣΤΗ.
//
// Κάθε απόφαση που πήρε η εφαρμογή (ή ο χρήστης μέσα από αυτήν) για το ΠΩΣ λογιστικοποιείται μια
// κατηγορία δαπάνης είναι κάτι που ο λογιστής της επιχείρησης πρέπει να εγκρίνει: «τα καύσιμα πάνε
// στο 64.00.00.0199», «ο ναύλος 0% στο 64.00.02.0000», «ανοίχτηκε ο 15.01.00.0000». Τα ερωτήματα ΔΕΝ
// γράφονται με το χέρι και ΔΕΝ αποθηκεύονται: παράγονται ΖΩΝΤΑΝΑ από την κατάσταση της εφαρμογής,
// οπότε κάθε νέα απόφαση εμφανίζεται μόνη της. Αποθηκεύεται μόνο η απάντηση (`AccountingAnswer`), με
// «αποτύπωμα» της πρότασης — αν η πρόταση αλλάξει, η απάντηση γίνεται «παλιά» και ξαναρωτάμε.
import 'server-only';
import { prisma } from '@/lib/db';
import { familyMemoryKeyLabel } from '@/lib/ocr/expense-families';
import { utilityMemoryKeyLabel } from '@/lib/ocr/utility-bills';
import { currentTenantSince } from './tenant-since';

export type QuestionGroup = 'family' | 'utility' | 'account' | 'registry';

export const QUESTION_GROUP_LABEL: Record<QuestionGroup, string> = {
  family: 'Κατηγορίες δαπάνης',
  utility: 'Λογαριασμοί κοινής ωφέλειας & μισθώματα',
  account: 'Λογαριασμοί που άνοιξαν στο SoftOne',
  registry: 'Έξοδα & χρεοπιστώσεις που δημιουργήθηκαν',
};

export type AnswerStatus = 'ACCEPTED' | 'CHANGED' | 'NEEDS_ERP';

export interface AccountingQuestion {
  key: string;
  group: QuestionGroup;
  /** «Καύσιμα · 24% · τιμολόγια αγορών» */
  title: string;
  /** Η ερώτηση σε μία πρόταση. */
  question: string;
  /** Τι ισχύει σήμερα: «983 Καύσιμα → 64.00.00.0199». */
  proposal: string;
  fingerprint: string;
  /** Για την αλλαγή στόχου: ποιο μητρώο χωράει (έξοδο σε αγορές, χρεοπίστωση σε ειδικές συναλλαγές). */
  changeKind: 'expense' | 'lineitem' | null;
  /** Πόσες γραμμές παραστατικών χρησιμοποιούν σήμερα αυτόν τον στόχο. */
  lines: number;
  answer: null | {
    status: AnswerStatus;
    comment: string | null;
    answeredAt: string;
    answeredBy: string | null;
    /** Απαντήθηκε για ΑΛΛΗ πρόταση — χρειάζεται νέα απάντηση. */
    stale: boolean;
  };
}

const WORLD_LABEL: Record<string, string> = { pur: 'τιμολόγια αγορών', lin: 'ειδικές συναλλαγές' };
const WORLD_IN: Record<string, string> = { pur: 'στα τιμολόγια αγορών', lin: 'στις ειδικές συναλλαγές' };

/** Όλα τα ερωτήματα, με τις απαντήσεις τους. Πρώτα τα ανοιχτά. */
export async function loadAccountingQuestions(): Promise<AccountingQuestion[]> {
  const since = await currentTenantSince();
  const after = since ? { createdAt: { gte: since } } : {};
  const [rules, answers, accountAudits, registryAudits] = await Promise.all([
    // Μόνο οι ΓΕΝΙΚΟΙ κανόνες σταθερού κλειδιού: αυτοί είναι πολιτική της επιχείρησης, όχι συνήθεια ενός εκδότη.
    prisma.lineMatchRule.findMany({
      where: { afm: '', OR: [{ pattern: { startsWith: '@family:' } }, { pattern: { startsWith: '@utility:' } }] },
      select: { pattern: true, mtrl: true, expn: true, lin: true },
    }),
    prisma.accountingAnswer.findMany(),
    prisma.auditLog.findMany({ where: { action: 'softone.account.create', ...after }, orderBy: { createdAt: 'asc' }, select: { resourceId: true, metadata: true, userEmail: true, createdAt: true } }),
    prisma.auditLog.findMany({
      where: { action: 'ocr.item.create_softone', resource: { in: ['softone_expense', 'softone_lineitem'] }, ...after },
      orderBy: { createdAt: 'asc' }, select: { resource: true, resourceId: true, metadata: true, createdAt: true },
    }),
  ]);
  const answerBy = new Map(answers.map((a) => [a.questionKey, a]));

  // Ονόματα στόχων και λογαριασμών, με ένα ερώτημα ανά μητρώο.
  const expns = [...new Set([...rules.map((r) => r.expn), ...registryAudits.filter((a) => a.resource === 'softone_expense').map((a) => Number(a.resourceId))].filter((v): v is number => v != null && Number.isFinite(v)))];
  const lins = [...new Set([...rules.map((r) => r.lin), ...registryAudits.filter((a) => a.resource === 'softone_lineitem').map((a) => Number(a.resourceId))].filter((v): v is number => v != null && Number.isFinite(v)))];
  const mtrls = [...new Set(rules.map((r) => r.mtrl).filter((v): v is number => v != null))];
  const [expenses, lineItems, items] = await Promise.all([
    expns.length ? prisma.softoneExpense.findMany({ where: { expn: { in: expns } }, select: { expn: true, code: true, name: true } }) : [],
    lins.length ? prisma.softoneLineItem.findMany({ where: { mtrl: { in: lins } }, select: { mtrl: true, code: true, name: true, acnmsk: true } }) : [],
    mtrls.length ? prisma.softoneItem.findMany({ where: { mtrl: { in: mtrls } }, select: { mtrl: true, code: true, name: true } }) : [],
  ]);
  const accCodes = [...new Set(lineItems.map((l) => l.acnmsk).filter((v): v is string => !!v))];
  const accounts = accCodes.length ? await prisma.softoneAccount.findMany({ where: { code: { in: accCodes } }, select: { code: true, name: true } }) : [];
  const accName = new Map(accounts.map((a) => [a.code, a.name]));
  const expBy = new Map(expenses.map((e) => [e.expn, e]));
  const linBy = new Map(lineItems.map((l) => [l.mtrl, l]));
  const itemBy = new Map(items.map((i) => [i.mtrl, i]));

  const describe = (r: { mtrl: number | null; expn: number | null; lin: number | null }): string => {
    if (r.lin != null) {
      const l = linBy.get(r.lin);
      return l ? `χρεοπίστωση ${l.code} «${l.name}»${l.acnmsk ? ` → λογ. ${l.acnmsk}${accName.get(l.acnmsk) ? ` «${accName.get(l.acnmsk)}»` : ''}` : ''}` : `χρεοπίστωση ${r.lin}`;
    }
    if (r.expn != null) { const e = expBy.get(r.expn); return e ? `έξοδο ${e.code} «${e.name}»` : `έξοδο ${r.expn}`; }
    if (r.mtrl != null) { const i = itemBy.get(r.mtrl); return i ? `είδος ${i.code} «${i.name}»` : `είδος ${r.mtrl}`; }
    return '—';
  };
  const fp = (r: { mtrl: number | null; expn: number | null; lin: number | null }) =>
    r.lin != null ? `lin:${r.lin}` : r.expn != null ? `expn:${r.expn}` : r.mtrl != null ? `mtrl:${r.mtrl}` : 'none';

  // Πόσες γραμμές χρησιμοποιούν κάθε στόχο — ένα groupBy ανά μητρώο.
  const [byExpn, byLin] = await Promise.all([
    expns.length ? prisma.ocrInvoiceItem.groupBy({ by: ['softoneExpn'], where: { softoneExpn: { in: expns } }, _count: true }) : [],
    lins.length ? prisma.ocrInvoiceItem.groupBy({ by: ['softoneLinMtrl'], where: { softoneLinMtrl: { in: lins } }, _count: true }) : [],
  ]);
  const useExpn = new Map(byExpn.map((g) => [g.softoneExpn, g._count]));
  const useLin = new Map(byLin.map((g) => [g.softoneLinMtrl, g._count]));
  const usage = (r: { expn: number | null; lin: number | null }) => (r.lin != null ? useLin.get(r.lin) ?? 0 : r.expn != null ? useExpn.get(r.expn) ?? 0 : 0);

  const out: AccountingQuestion[] = [];
  const withAnswer = (q: Omit<AccountingQuestion, 'answer'>): AccountingQuestion => {
    const a = answerBy.get(q.key);
    return {
      ...q,
      answer: a ? {
        status: a.status as AnswerStatus, comment: a.comment, answeredAt: a.answeredAt.toISOString(),
        answeredBy: a.answeredBy, stale: a.fingerprint !== q.fingerprint,
      } : null,
    };
  };

  // 1–2. Κανόνες οικογένειας / είδους χρέωσης. Ο κανόνας ΧΩΡΙΣ ΦΠΑ είναι η προεπιλογή — δείχνεται μόνο
  //      όταν δεν υπάρχει ειδικότερος του ίδιου κόσμου με τον ίδιο στόχο (αλλιώς θα ρωτούσαμε δύο φορές).
  for (const r of rules) {
    const m = /^(@(?:family|utility):[a-z_:]+?)(?:@([\d.]+))?(?:#(lin|pur))?$/.exec(r.pattern);
    if (!m) continue;
    const [, base, vat, world] = m;
    if (!vat) {
      const specific = rules.find((o) => o !== r && o.pattern.startsWith(`${base}@`) && o.pattern.endsWith(world ? `#${world}` : '') && fp(o) === fp(r));
      if (specific) continue;
    }
    const group: QuestionGroup = r.pattern.startsWith('@utility:') ? 'utility' : 'family';
    const label = (group === 'family' ? familyMemoryKeyLabel(r.pattern) : utilityMemoryKeyLabel(r.pattern)) ?? r.pattern;
    const where = world ? WORLD_LABEL[world] : null;
    const whereIn = world ? WORLD_IN[world] : null;
    const target = describe(r);
    out.push(withAnswer({
      key: `rule:${r.pattern}`,
      group,
      title: [label, !vat ? 'κάθε συντελεστής' : null, where].filter(Boolean).join(' · '),
      question: `Οι γραμμές «${label}»${whereIn ? ` ${whereIn}` : ''} καταχωρούνται σε ${target}. Είναι σωστό;`,
      proposal: target,
      fingerprint: fp(r),
      changeKind: world === 'lin' ? 'lineitem' : world === 'pur' ? 'expense' : null,
      lines: usage(r),
    }));
  }

  // 3. Λογαριασμοί γενικής που άνοιξε η εφαρμογή.
  for (const a of accountAudits) {
    const md = (a.metadata ?? {}) as { code?: string; name?: string; template?: string; vat?: { rate: number } | null; vatAccount?: string | null };
    if (!md.code) continue;
    out.push(withAnswer({
      key: `account:${md.code}`,
      group: 'account',
      title: `${md.code} «${md.name ?? ''}»`,
      question: `Ανοίχτηκε ο λογαριασμός ${md.code} «${md.name ?? ''}» με ρυθμίσεις από τον ${md.template ?? '—'}${md.vat ? `, ΦΠΑ ${md.vat.rate}%${md.vatAccount ? ` και λογαριασμό ΦΠΑ ${md.vatAccount}` : ''}` : ', χωρίς ΦΠΑ'}. Είναι σωστός;`,
      proposal: `${md.code} ${md.name ?? ''}`,
      fingerprint: `acnt:${a.resourceId ?? md.code}`,
      changeKind: null,
      lines: 0,
    }));
  }

  // 4. Έξοδα και χρεοπιστώσεις που δημιούργησε η εφαρμογή στο SoftOne.
  for (const a of registryAudits) {
    const id = Number(a.resourceId);
    if (!Number.isFinite(id)) continue;
    const isExp = a.resource === 'softone_expense';
    // Εγγραφή που δεν υπάρχει πια στο μητρώο (διαγράφηκε ή ανήκε σε άλλη εγκατάσταση): τίποτα να εγκριθεί.
    if (isExp ? !expBy.has(id) : !linBy.has(id)) continue;
    const desc = describe(isExp ? { expn: id, lin: null, mtrl: null } : { lin: id, expn: null, mtrl: null });
    out.push(withAnswer({
      key: `${isExp ? 'expense' : 'lineitem'}:${id}`,
      group: 'registry',
      title: desc.replace(/^(έξοδο|χρεοπίστωση) /, ''),
      question: `Δημιουργήθηκε στο SoftOne ${desc}. Λογαριασμός και ονομασία είναι σωστά;`,
      proposal: desc,
      fingerprint: `${isExp ? 'expn' : 'lin'}:${id}`,
      changeKind: null,
      lines: usage(isExp ? { expn: id, lin: null } : { lin: id, expn: null }),
    }));
  }

  const open = (q: AccountingQuestion) => !q.answer || q.answer.stale;
  // Ίδιο κλειδί δύο φορές (π.χ. λογαριασμός που ξανανοίχτηκε): κρατάμε το νεότερο.
  const unique = [...new Map(out.map((q) => [q.key, q])).values()];
  return unique.sort((a, b) => Number(open(b)) - Number(open(a)) || a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}

/** Πόσα ερωτήματα περιμένουν απάντηση — για το badge του μενού. */
export async function countOpenQuestions(): Promise<number> {
  return (await loadAccountingQuestions()).filter((q) => !q.answer || q.answer.stale).length;
}
