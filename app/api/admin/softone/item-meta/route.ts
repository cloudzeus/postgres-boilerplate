import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAnyPermission } from '@/lib/rbac';

/**
 * Οι λίστες της φόρμας «νέα εγγραφή μητρώου».
 *
 * ⚠️ ΤΟ ΦΠΑ ΔΕΝ ΕΡΧΕΤΑΙ ΑΠΟ ΤΟ `SoftoneLookup`. Στην εγκατάσταση του πελάτη ο πίνακας
 * `SoftoneLookup` έχει **μηδέν** γραμμές `kind: 'VAT'` — ο συγχρονισμός του ΦΠΑ γράφει στο
 * **`VatCategory`** (11 ενεργές κατηγορίες), που είναι και το μητρώο από το οποίο η καταχώριση
 * βγάζει το `VAT` κάθε γραμμής. Όσο η φόρμα ρωτούσε το `SoftoneLookup`, το dropdown ΦΠΑ ήταν
 * πάντα άδειο — και το ΦΠΑ ήταν **υποχρεωτικό** πεδίο. Δηλαδή η δημιουργία είδους από τη σελίδα
 * ενός παραστατικού ήταν αδύνατη, χωρίς κανένα μήνυμα που να το λέει.
 *
 * Μία πηγή για το ΦΠΑ, λοιπόν: το ίδιο μητρώο που χρησιμοποιεί η καταχώριση. Το `SoftoneLookup`
 * μένει εφεδρεία για εγκαταστάσεις που όντως το γεμίζουν.
 */
export async function GET() {
  await requireAnyPermission('ocr.read', 'ocr.categorize', 'metadata.read');

  const [rows, vatRows, lineCategories] = await Promise.all([
    prisma.softoneLookup.findMany({ orderBy: { order: 'asc' }, select: { kind: true, code: true, name: true } }),
    prisma.vatCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, descr: true, rate: true },
    }),
    prisma.softoneLineCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { mtrCategory: true, code: true, name: true },
    }),
  ]);

  const group = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ id: r.code, name: r.name }));
  const lookupVats = group('VAT');

  return NextResponse.json({
    // `rate` ταξιδεύει μαζί: η φόρμα προεπιλέγει κατηγορία από τον συντελεστή της ΓΡΑΜΜΗΣ, και
    // το ποσοστό δεν επιτρέπεται να μαντεύεται από το κείμενο της περιγραφής.
    vats: vatRows.length > 0
      ? vatRows.map((v) => ({ id: v.code, name: v.descr || v.code, rate: v.rate ?? null }))
      : lookupVats.map((v) => ({ ...v, rate: null })),
    units: group('MTRUNIT'),
    groups: group('MTRGROUP'),
    categories: group('MTRCATEGORY'),
    /** LINCATEGORY — οι κατηγορίες **δαπανών**, που αφορούν χρεοπιστώσεις (όχι είδη). */
    lineCategories: lineCategories.map((c) => ({ id: String(c.mtrCategory), name: c.name || c.code })),
    manufacturers: group('MTRMANFCTR'),
    brands: group('MTRMARK'),
  });
}
