// lib/ocr/example-lookup.ts — SERVER-ONLY (prisma). Το «ποιο παράδειγμα» της few-shot ανάγνωσης.
//
// Ο κανόνας είναι αυστηρός επίτηδες: παράδειγμα γίνεται ΜΟΝΟ έγγραφο που (α) έχει το ίδιο ΑΦΜ
// εκδότη, (β) το επιβεβαίωσε άνθρωπος (`verifiedAt`) και (γ) ολοκληρώθηκε κανονικά. Ένα αυτόματο
// αποτέλεσμα δεν έχει καμία εγγύηση ορθότητας, και ένα λανθασμένο παράδειγμα δεν είναι ουδέτερο —
// διδάσκει στο μοντέλο ακριβώς το λάθος, σε κάθε επόμενη ανάγνωση του ίδιου προμηθευτή.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { coerceDocument } from '@/lib/ocr/canonical';
import { trimExample } from '@/lib/ocr/example';

/** Ο διακόπτης του χαρακτηριστικού. Κλειστός ⇒ ούτε ένα ερώτημα στη βάση. */
export const USE_ISSUER_EXAMPLE_KEY = 'ocr.useIssuerExample';

/**
 * Το νεότερο επιβεβαιωμένο έγγραφο του ίδιου εκδότη, συμπυκνωμένο για το prompt — ή `null` όταν
 * δεν υπάρχει (η συντριπτική πλειοψηφία των πρώτων αναγνώσεων). Ένα ερώτημα, με index
 * (`issuerAfm`, `verifiedAt`) και `select` μόνο του `document`. Με `excludeId` αποκλείεται το
 * έγγραφο που ξαναδιαβάζεται αυτή τη στιγμή.
 */
export async function loadIssuerExample(
  afm: string | null | undefined,
  opts: { excludeId?: string } = {},
): Promise<unknown | null> {
  const issuerAfm = String(afm ?? '').trim();
  if (!issuerAfm) return null;
  if ((await getSetting<boolean>(USE_ISSUER_EXAMPLE_KEY)) === false) return null;

  const row = await prisma.ocrDocument.findFirst({
    where: {
      issuerAfm,
      verifiedAt: { not: null },
      // `DbNull` = η ΣΤΗΛΗ είναι NULL (όχι το JSON `null`) — ό,τι γράφει ο γραφέας όταν δεν υπάρχει
      // ακόμη κανονικό έγγραφο.
      document: { not: Prisma.DbNull },
      status: 'COMPLETED',
      // ΠΟΤΕ το ίδιο το έγγραφο που ξαναδιαβάζουμε: θα έδινε στο μοντέλο τις τιμές που υποτίθεται
      // ότι ξαναπάει να διαβάσει, και η επανεκτέλεση θα επιβεβαίωνε τον εαυτό της.
      ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
    },
    orderBy: { verifiedAt: 'desc' },
    select: { document: true },
  });
  if (!row?.document) return null;
  return trimExample(coerceDocument(row.document));
}
