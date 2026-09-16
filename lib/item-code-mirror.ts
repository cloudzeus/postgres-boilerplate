// lib/item-code-mirror.ts — SERVER. Οι κωδικοί του μητρώου ειδών από τον **τοπικό καθρέφτη**.
//
// Είναι η ΕΦΕΔΡΕΙΑ του `softoneNextItemCode`: όταν το SoftOne δεν απαντά, η πρόταση βγαίνει από
// εδώ και σημειώνεται `stale: true`. Ζει σε δικό του αρχείο επειδή τη χρειάζονται **δύο** δρόμοι
// — η αρχική πρόταση (`GET .../next-code`) και η **επαναπρόταση μετά από 409** (`POST
// .../create`). Όταν τη χρησιμοποιούσε μόνο ο ένας, ο άλλος πρότεινε κωδικό από άδεια λίστα.

import 'server-only';
import { prisma } from '@/lib/db';
import type { ItemCodeKind } from '@/lib/item-code';

/** Ποτέ δεν πετάει: χωρίς καθρέφτη, η πρόταση απλώς δεν έχει εφεδρεία. */
export async function mirrorItemCodes(kind: ItemCodeKind): Promise<string[]> {
  try {
    if (kind === 'expense') {
      const rows = await prisma.softoneExpense.findMany({ select: { code: true } });
      return rows.map((r) => r.code);
    }
    if (kind === 'lineitem') {
      const rows = await prisma.softoneLineItem.findMany({ select: { code: true } });
      return rows.map((r) => r.code);
    }
    const rows = await prisma.softoneItem.findMany({
      where: { isService: kind === 'service' }, select: { code: true },
    });
    return rows.map((r) => r.code);
  } catch {
    return [];
  }
}
