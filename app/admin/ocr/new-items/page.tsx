import { BulkResolveItemsButton } from '@/components/admin/bulk-resolve-items';
import { FiPackage } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { loadItemQueue } from '@/lib/ocr/queues';
import { disambiguateLabels } from '@/lib/unique-labels';
import { NewItemsClient } from './queue-client';

export const dynamic = 'force-dynamic';

/** Πόσες ομάδες παίρνουν προτάσεις στο πρώτο render — οι υπόλοιπες lazy. */
const SUGGEST_FOR = 50;

// Σελίδα «Είδη & έξοδα» (spec 2026-09-11 §3): οι αταίριαστες γραμμές των
// παραστατικών ομαδοποιημένες ανά (εκδότης, κείμενο γραμμής), με προτάσεις
// από τα τοπικά μητρώα SoftOne και δυνατότητα δημιουργίας νέου είδους/εξόδου.
export default async function NewItemsPage() {
  await requirePermission('ocr.read');

  const [queue, canManage, vats, units, groups, categories, lineCategories] = await Promise.all([
    loadItemQueue({ suggestFor: SUGGEST_FOR }),
    // Χωρίς `ocr.categorize` η σελίδα είναι μόνο για ανάγνωση (ίδιο με «Νέοι συναλλασσόμενοι»).
    hasPermission('ocr.categorize'),
    // Ίδια πηγή με τα υπόλοιπα σημεία της εφαρμογής: το μητρώο `VatCategory`
    // (κλειδί = ο κωδικός ΦΠΑ του SoftOne, ό,τι περιμένει το setData).
    prisma.vatCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, descr: true, rate: true },
    }),
    prisma.softoneLookup.findMany({
      where: { kind: 'MTRUNIT' },
      orderBy: { order: 'asc' },
      select: { code: true, name: true },
    }),
    // Ομάδες / εμπορικές κατηγορίες ειδών (`ITEM.MTRGROUP` / `ITEM.MTRCATEGORY`) από τον
    // τοπικό καθρέφτη — ο χρήστης τα διαλέγει στη φόρμα δημιουργίας.
    prisma.softoneLookup.findMany({
      where: { kind: 'MTRGROUP' }, orderBy: { order: 'asc' }, select: { code: true, name: true },
    }),
    prisma.softoneLookup.findMany({
      where: { kind: 'MTRCATEGORY' }, orderBy: { order: 'asc' }, select: { code: true, name: true },
    }),
    // Κατηγορίες δαπανών (LINCATEGORY): το φίλτρο που κάνει τη λίστα χρεοπιστώσεων χρησιμοποιήσιμη.
    prisma.softoneLineCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { mtrCategory: true, code: true, name: true },
    }),
  ]);

  const vatOpts = disambiguateLabels(vats.map((v) => ({
    code: v.code, label: v.rate != null ? `${v.descr} (${v.rate}%)` : v.descr, rate: v.rate,
  })));
  const unitOpts = disambiguateLabels(units.map((u) => ({ code: u.code, label: u.name })));

  return (
    <NewItemsClient
      header={
        <PageHeader
          icon={<FiPackage />}
          title="Είδη & έξοδα"
          description="Γραμμές παραστατικών που δεν βρέθηκαν στο SoftOne — αντιστοίχισέ τες ή δημιούργησε νέο είδος/έξοδο."
          helpAnchor="new-items"
          // Μόνο ό,τι χρειάζεται η κρίση ανά ομάδα: η κορυφαία πρόταση γίνεται ΕΠΙΛΟΓΗ, όχι απόφαση.
          actions={
            <BulkResolveItemsButton
              canManage={canManage}
              vats={vatOpts}
              units={unitOpts}
              groups={queue.groups.map((g) => {
                const s = g.suggestions?.[0];
                const id = s ? (s.lin ?? s.expn ?? s.mtrl) : null;
                return {
                  key: g.key, afm: g.afm, pattern: g.pattern, sample: g.sample, supplier: g.supplier,
                  code: g.code, category: g.category, lineCount: g.lineCount, docCount: g.docCount,
                  price: g.lines.find((l) => l.price != null)?.price ?? null,
                  suggestion: s && id != null
                    ? { kind: s.kind, id, code: s.code, name: s.name, isService: s.kind === 'service', score: s.score }
                    : null,
                };
              })}
            />
          }
        />
      }
      initialGroups={queue.groups}
      total={queue.total}
      truncated={queue.truncated}
      suggestedFor={SUGGEST_FOR}
      canManage={canManage}
      // Δύο κατηγορίες ΦΠΑ μπορούν να έχουν ΙΔΙΑ περιγραφή («Μηδενικός Συντελεστής ΦΠΑ 0%»)
      // με διαφορετικό κωδικό: τότε — και μόνο τότε — η ετικέτα κουβαλά και τον κωδικό.
      vats={vatOpts}
      units={unitOpts}
      itemGroups={disambiguateLabels(groups.map((g) => ({ code: g.code, label: g.name })))}
      itemCategories={disambiguateLabels(categories.map((c) => ({ code: c.code, label: c.name })))}
      lineCategories={lineCategories.map((c) => ({ id: c.mtrCategory, label: c.name || c.code }))}
    />
  );
}
