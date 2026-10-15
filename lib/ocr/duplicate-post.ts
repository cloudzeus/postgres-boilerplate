// lib/ocr/duplicate-post.ts — SERVER. «Έχει ήδη καταχωριστεί αυτό το τιμολόγιο;» — με ΑΦΜ, όχι με καρτέλα.
//
// Ο έλεγχος διπλών του SoftOne ψάχνει ανά TRDR. Στις 15/10 ο ίδιος προμηθευτής απέκτησε ΔΥΟ καρτέλες
// (955 και 958), και το ίδιο τιμολόγιο (Μαργαρίτης 126738) ξαναμπήκε στην εφαρμογή μετά τον
// διαχωρισμό ενός PDF — συνδεδεμένο στη ΝΕΑ καρτέλα. Ο έλεγχος ανά καρτέλα δεν θα έβρισκε το ήδη
// καταχωρισμένο (115577, στην 955), και θα γινόταν δεύτερη καταχώριση.
//
// Εδώ ο έλεγχος γίνεται με την ταυτότητα του ίδιου του χαρτιού: ΑΦΜ εκδότη + αριθμός παραστατικού,
// (1) στα ήδη καταχωρισμένα της εφαρμογής και (2) στο SoftOne, σε ΟΛΕΣ τις καρτέλες του ΑΦΜ.
import 'server-only';
import { prisma } from '@/lib/db';
import { softoneCheckPurchaseDoc } from '@/lib/softone';
import { normalizeDocRef } from '@/lib/doc-reference';
import { normalizeAfm } from '@/lib/ocr/validate';
import { documentReference } from '@/lib/ocr/purdoc-payload';

export interface DuplicatePosting {
  where: 'app' | 'softone';
  /** Αριθμός του ήδη καταχωρισμένου παραστατικού στο SoftOne (FINDOC ή «Παραστατικό»). */
  ref: string | null;
  /** Το αρχείο της εφαρμογής που το καταχώρισε (όταν `where = app`). */
  fileName?: string | null;
}

/** Ίδιο τιμολόγιο = ίδιος ΑΦΜ εκδότη ΚΑΙ ίδιος (κανονικοποιημένος) αριθμός. ΚΑΘΑΡΟ. */
export function sameInvoice(
  a: { afm: string | null | undefined; number: string | null | undefined },
  b: { afm: string | null | undefined; number: string | null | undefined },
): boolean {
  const afmA = normalizeAfm(a.afm); const afmB = normalizeAfm(b.afm);
  const nA = normalizeDocRef(a.number ?? ''); const nB = normalizeDocRef(b.number ?? '');
  return !!afmA && afmA === afmB && !!nA && nA === nB;
}

export async function findDuplicatePosting(input: {
  id: string;
  afm: string | null | undefined;
  type: { series: string | null; number: string | null };
  date: string | null | undefined;
}): Promise<DuplicatePosting | null> {
  const afm = normalizeAfm(input.afm);
  const number = input.type.number;
  if (!afm || !normalizeDocRef(number ?? '')) return null;

  // (1) Στην εφαρμογή: άλλο έγγραφο, ίδιο χαρτί, ήδη καταχωρισμένο.
  const posted = await prisma.ocrDocument.findMany({
    where: { id: { not: input.id }, postStatus: 'POSTED', issuerAfm: afm },
    select: { fileName: true, postedRef: true, extractedData: true, document: true },
  });
  for (const p of posted) {
    const canon = (p.document ?? null) as { type?: { number?: string | null } } | null;
    const legacy = (p.extractedData ?? {}) as { invoiceNumber?: string | null };
    if (sameInvoice({ afm, number }, { afm, number: canon?.type?.number ?? legacy.invoiceNumber })) {
      return { where: 'app', ref: p.postedRef, fileName: p.fileName };
    }
  }

  // (2) Στο SoftOne: σε ΚΑΘΕ καρτέλα με αυτόν τον ΑΦΜ (και στις διπλές).
  const traders = (await prisma.softoneTrader.findMany({
    where: { afm: { contains: afm } }, select: { trdr: true, afm: true },
  })).filter((t) => normalizeAfm(t.afm) === afm);
  const ref = documentReference(input.type);
  if (!ref.taxSeriesNum) return null;
  for (const t of traders) {
    const r = await softoneCheckPurchaseDoc(t.trdr, { number: ref.taxSeriesNum, fincode: ref.fincode }, input.date ?? null)
      .catch(() => ({ exists: false, ref: null }));
    if (r.exists) return { where: 'softone', ref: r.ref };
  }
  return null;
}
