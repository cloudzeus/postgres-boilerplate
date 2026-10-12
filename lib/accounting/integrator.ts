// lib/accounting/integrator.ts — SERVER. Η ΑΝΑΦΟΡΑ ΓΙΑ ΤΟΝ INTEGRATOR, ζωντανή.
//
// Αντικαθιστά τη στατική αναφορά: υπολογίζεται σε ΚΑΘΕ άνοιγμα από την τρέχουσα κατάσταση, άρα δεν
// παλιώνει ποτέ. Τρία μέρη:
//  1. Θέματα που ζήτησε ο λογιστής και η εφαρμογή δεν μπορεί να κάνει μέσω web services
//     (`IntegratorItem` — δημιουργούνται αυτόματα από τα «Ερωτήματα λογιστή»).
//  2. Ζωντανοί έλεγχοι: ό,τι η ίδια η εφαρμογή βλέπει ότι λείπει στο SoftOne.
//  3. Ιστορικό αλλαγών της εγκατάστασης από την εφαρμογή (λογαριασμοί, χρεοπιστώσεις, έξοδα, είδη,
//     καρτέλες, ενεργοποιήσεις) — ώστε ο integrator να ξέρει τι βρίσκει όταν ανοίξει το SoftOne.
import 'server-only';
import { prisma } from '@/lib/db';
import { checkAccounts } from '@/lib/ocr/account-check';
import { currentTenantSince } from './tenant-since';

export interface LiveCheck {
  key: string;
  title: string;
  detail: string;
  severity: 'high' | 'mid' | 'low';
  rows: string[];
}

export interface ChangeEntry {
  at: string;
  who: string | null;
  label: string;
  summary: string;
}

/** Ενέργειες που ΑΛΛΑΖΟΥΝ την εγκατάσταση του SoftOne, με ελληνικό όνομα. */
const ERP_ACTIONS: Record<string, string> = {
  'softone.account.create': 'Άνοιγμα λογαριασμού γενικής',
  'softone.lineitem.activate': 'Ενεργοποίηση χρεοπίστωσης',
  'softone.item.update': 'Διόρθωση είδους/υπηρεσίας',
  'ocr.item.create_softone': 'Νέα εγγραφή μητρώου',
  'ocr.item.create': 'Νέο είδος/υπηρεσία',
  'ocr.trader.create': 'Νέος συναλλασσόμενος',
  'ocr.post.mark': 'Ενημέρωση ΜΑΡΚ',
};

const KIND_LABEL: Record<string, string> = { product: 'είδος', service: 'υπηρεσία', expense: 'έξοδο', lineitem: 'χρεοπίστωση', asset: 'πάγιο' };
const TRADER_LABEL: Record<string, string> = { supplier: 'προμηθευτής', creditor: 'πιστωτής', debtor: 'χρεώστης' };

function summarize(action: string, md: Record<string, unknown>): string {
  const s = (k: string) => (md[k] == null ? '' : String(md[k]));
  switch (action) {
    case 'softone.account.create': return `${s('code')} «${s('name')}»${s('template') ? ` · πρότυπο ${s('template')}` : ''}`;
    case 'softone.lineitem.activate': return `${s('code')}${md.creditorsAdded ? ' · δέχεται πλέον πιστωτές' : ''}`;
    case 'softone.item.update': {
      const b = (md.before ?? {}) as { code?: string; isActive?: boolean };
      const a = (md.after ?? {}) as { code?: string; isActive?: boolean };
      return b.code !== a.code ? `κωδικός ${b.code} → ${a.code}` : a.isActive === false ? `${a.code} · αδρανοποίηση` : String(a.code ?? '');
    }
    case 'ocr.item.create_softone':
    case 'ocr.item.create': return `${KIND_LABEL[s('kind')] ?? s('kind')} ${s('code')} «${s('name')}»`;
    case 'ocr.trader.create': return `${TRADER_LABEL[s('kind')] ?? s('kind')} ${s('code')} «${s('name')}» (ΑΦΜ ${s('afm')})`;
    case 'ocr.post.mark': return `FINDOC ${s('ref')} · ΜΑΡΚ ${s('mark')}`;
    default: return '';
  }
}

export interface IntegratorReport {
  generatedAt: string;
  /** Από πότε ισχύει η τρέχουσα εγκατάσταση — το ιστορικό ξεκινά από εκεί. */
  tenantSince: string | null;
  open: { id: string; title: string; detail: string; severity: string; createdAt: string; createdBy: string | null; questionKey: string | null }[];
  done: { id: string; title: string; resolvedAt: string | null; resolvedBy: string | null }[];
  checks: LiveCheck[];
  changes: ChangeEntry[];
}

export async function loadIntegratorReport(): Promise<IntegratorReport> {
  const since = await currentTenantSince();
  const [items, audits, openDocs, posted] = await Promise.all([
    prisma.integratorItem.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.auditLog.findMany({
      where: { action: { in: Object.keys(ERP_ACTIONS) }, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 300,
      select: { action: true, metadata: true, userEmail: true, createdAt: true },
    }),
    prisma.ocrDocument.findMany({
      where: { status: 'COMPLETED', postStatus: { not: 'POSTED' }, OR: [{ reconOverride: null }, { reconOverride: { not: 'IGNORED' } }] },
      select: {
        fileName: true, softoneSeries: true,
        items: { select: { name: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneAsset: true, softoneMatchedBy: true } },
      },
    }),
    prisma.ocrDocument.findMany({ where: { postStatus: 'POSTED', ...(since ? { postedAt: { gte: since } } : {}) }, select: { fileName: true, postedRef: true, postedAt: true, document: true } }),
  ]);

  const checks: LiveCheck[] = [];

  // α. Μητρώα σε χρήση χωρίς χαρακτηρισμό myDATA — η καταχώριση θα φύγει αχαρακτήριστη.
  const usedLin = [...new Set(openDocs.flatMap((d) => d.items.map((i) => i.softoneLinMtrl)).filter((v): v is number => v != null))];
  const usedExp = [...new Set(openDocs.flatMap((d) => d.items.map((i) => i.softoneExpn)).filter((v): v is number => v != null))];
  const [lins, exps] = await Promise.all([
    usedLin.length ? prisma.softoneLineItem.findMany({ where: { mtrl: { in: usedLin } }, select: { mtrl: true, code: true, name: true, acnmsk: true, acnmskSyncedAt: true, classType: true, classCategory: true, myDataCode: true } }) : [],
    usedExp.length ? prisma.softoneExpense.findMany({ where: { expn: { in: usedExp } }, select: { expn: true, code: true, name: true, classTypeX: true, classCategoryX: true } }) : [],
  ]);
  const noClass = [
    ...lins.filter((l) => !l.classType && !l.classCategory && !l.myDataCode).map((l) => `Χρεοπίστωση ${l.code} «${l.name}»`),
    ...exps.filter((e) => !e.classTypeX && !e.classCategoryX).map((e) => `Έξοδο ${e.code} «${e.name}»`),
  ];
  if (noClass.length) {
    checks.push({
      key: 'mydata', severity: 'high', rows: noClass,
      title: 'Χαρακτηρισμός myDATA στα μητρώα',
      detail: 'Χρησιμοποιούνται από ανοιχτά παραστατικά αλλά δεν έχουν χαρακτηρισμό εξόδων myDATA. Η εφαρμογή δεν τον ορίζει (ανήκει στο μητρώο)· χωρίς αυτόν οι καταχωρίσεις φεύγουν αχαρακτήριστες.',
    });
  }

  // β. Χρεοπιστώσεις σε χρήση που δείχνουν σε λογαριασμό που δεν υπάρχει / δεν κινείται / είναι μοτίβο.
  if (lins.length) {
    const masks = lins.map((l) => l.acnmsk).filter((v): v is string => !!v);
    const chart = await prisma.softoneAccount.findMany({ where: { code: { in: masks } }, select: { code: true, name: true, isActive: true, postable: true } });
    const total = await prisma.softoneAccount.count();
    const res = checkAccounts(
      lins.map((l, rowIndex) => ({ rowIndex, path: 'LINLINES' as const, article: `${l.code} — ${l.name}`, acnmsk: l.acnmsk, acnmskKnown: l.acnmskSyncedAt != null })),
      { synced: total > 0, accounts: chart },
    );
    const bad = res.lines.filter((l) => ['missing', 'not_in_chart', 'not_postable', 'mask'].includes(l.status)).map((l) => l.message);
    if (bad.length) {
      checks.push({
        key: 'accounts', severity: 'high', rows: bad,
        title: 'Χρεοπιστώσεις με προβληματικό λογαριασμό',
        detail: 'Η καταχώριση θα μπλοκάρει μέχρι να διορθωθεί ο λογαριασμός της καρτέλας (ACNMSK) ή να ανοίξει ο λογαριασμός.',
      });
    }
  }

  // γ. ΜΑΡΚ σε καταχωρισμένα παραστατικά: σε αυτή την εγκατάσταση το SomyDataMARK δεν γράφεται από WS.
  const marks = posted
    .map((p) => ({ p, mark: String(((p.document ?? {}) as { digital?: { mark?: string } }).digital?.mark ?? '').trim() }))
    .filter((x) => x.mark)
    .map((x) => `FINDOC ${x.p.postedRef} — ΜΑΡΚ ${x.mark} (${x.p.fileName.replace(/^.*\//, '')})`);
  if (marks.length) {
    checks.push({
      key: 'mark', severity: 'mid', rows: marks,
      title: 'ΜΑΡΚ για χειροκίνητη συμπλήρωση',
      detail: 'Το SoftOne δέχεται το SomyDataMARK από τα web services αλλά δεν το αποθηκεύει (επαληθευμένο). Χρειάζεται συμπλήρωση στο SoftOne ή ρύθμιση της ενότητας myDATA.',
    });
  }

  // δ. Γραμμές που η εφαρμογή δεν μπορεί να αντιστοιχίσει (π.χ. πάγια χωρίς γραμμές ASSLINES).
  const stuck = openDocs
    .map((d) => ({ d, n: d.items.filter((i) => i.softoneMtrl == null && i.softoneExpn == null && i.softoneLinMtrl == null && i.softoneAsset == null && i.softoneMatchedBy !== 'skipped').length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.d.fileName.replace(/^.*\//, '')} — ${x.n} γραμμ${x.n === 1 ? 'ή' : 'ές'}${x.d.softoneSeries ? '' : ' · χωρίς σειρά'}`);
  if (stuck.length) {
    checks.push({
      key: 'stuck', severity: 'low', rows: stuck,
      title: 'Παραστατικά με γραμμές χωρίς στόχο',
      detail: 'Συνήθως πάγια: οι γραμμές παγίων (ASSLINES) θέλουν αποθήκη και εγγραφή απόκτησης (ASSDEPR) — χρειάζεται μία αγορά παγίου καταχωρισμένη χειροκίνητα στο SoftOne ώστε να φανεί η ρύθμιση.',
    });
  }

  const changes: ChangeEntry[] = [
    ...audits.map((a) => ({
      at: a.createdAt.toISOString(), who: a.userEmail ?? null, label: ERP_ACTIONS[a.action] ?? a.action,
      summary: summarize(a.action, (a.metadata ?? {}) as Record<string, unknown>),
    })),
    ...posted.filter((p) => p.postedAt).map((p) => ({
      at: p.postedAt!.toISOString(), who: null, label: 'Καταχώριση παραστατικού',
      summary: `FINDOC ${p.postedRef} · ${p.fileName.replace(/^.*\//, '')}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    generatedAt: new Date().toISOString(),
    tenantSince: since?.toISOString() ?? null,
    open: items.filter((i) => i.status === 'OPEN').map((i) => ({
      id: i.id, title: i.title, detail: i.detail, severity: i.severity, createdAt: i.createdAt.toISOString(), createdBy: i.createdBy, questionKey: i.questionKey,
    })),
    done: items.filter((i) => i.status === 'DONE').map((i) => ({ id: i.id, title: i.title, resolvedAt: i.resolvedAt?.toISOString() ?? null, resolvedBy: i.resolvedBy })),
    checks,
    changes,
  };
}
