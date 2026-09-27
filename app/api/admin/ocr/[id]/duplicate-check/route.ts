import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { buildDuplicateCheck } from '@/lib/ocr/softone-match';
import { DocumentSchema } from '@/lib/ocr/canonical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ΕΛΕΓΧΟΣ ΔΙΠΛΟΤΥΠΟΥ, ΤΗ ΣΤΙΓΜΗ ΠΟΥ ΜΕΤΡΑΕΙ.
 *
 * Ο έλεγχος έτρεχε ΜΟΝΟ στη σάρωση — τότε όμως ο συναλλασσόμενος συνήθως δεν έχει βρεθεί ακόμη,
 * και το `buildDuplicateCheck` χωρίς `trdr` επιστρέφει «δεν ξέρω». Αποτέλεσμα: μια λωρίδα που
 * έλεγε μόνιμα «Δεν ελέγχθηκε» και ένας έλεγχος που ποτέ δεν γινόταν πραγματικά.
 *
 * Εδώ τρέχει ΤΩΡΑ, με τον συναλλασσόμενο που έχει πλέον δεθεί, λίγο πριν σταλεί το παραστατικό.
 * Είναι ΑΝΑΓΝΩΣΗ στο SoftOne: δεν γράφει τίποτα εκεί — μόνο καταγράφει τοπικά την απάντηση,
 * ώστε η λωρίδα και ο κατάλογος να μη δείχνουν μπαγιάτικο αποτέλεσμα.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;

  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    select: { id: true, softoneTrdr: true, document: true },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Χωρίς συναλλασσόμενο ΔΕΝ υπάρχει ερώτημα: το SoftOne ψάχνει διπλό ΑΝΑ συναλλασσόμενο.
  if (!doc.softoneTrdr) {
    return NextResponse.json({
      status: 'unknown',
      message: 'Δεν έχει δεθεί συναλλασσόμενος — το SoftOne ψάχνει διπλό ανά καρτέλα, οπότε ο έλεγχος δεν μπορεί να γίνει ακόμη.',
    });
  }

  const parsed = DocumentSchema.safeParse(doc.document);
  const type = parsed.success ? parsed.data.type : null;
  const date = parsed.success ? parsed.data.date : null;

  const r = await buildDuplicateCheck(doc.softoneTrdr, type, date);
  await prisma.ocrDocument.update({
    where: { id },
    data: {
      softoneDocExists: r.softoneDocExists,
      softoneDocRef: r.softoneDocRef,
      softoneDocChecked: r.softoneDocChecked,
    },
  });

  // Τρεις ΞΕΧΩΡΙΣΤΕΣ καταστάσεις, όχι δύο: «βρέθηκε», «δεν βρέθηκε» και «δεν μπόρεσα να κρίνω».
  // Το τρίτο ΔΕΝ είναι «καθαρό» — αν το λέγαμε καθαρό, ο χρήστης θα στέλνιζε με ψεύτικη σιγουριά.
  return NextResponse.json({
    status: r.softoneDocExists === true ? 'duplicate'
      : r.softoneDocExists === false ? 'clear' : 'unknown',
    ref: r.softoneDocRef,
    checkedAt: r.softoneDocChecked,
    message: r.softoneDocExists === true
      ? `Υπάρχει ήδη παραστατικό στο SoftOne${r.softoneDocRef ? ` (${r.softoneDocRef})` : ''}.`
      : r.softoneDocExists === false
        ? 'Δεν βρέθηκε ίδιο παραστατικό για αυτόν τον συναλλασσόμενο.'
        : 'Ο έλεγχος δεν απάντησε — δεν μπορούμε να πούμε ούτε ναι ούτε όχι.',
  });
}
