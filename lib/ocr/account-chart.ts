// lib/ocr/account-chart.ts — SERVER. Φέρνει από τον καθρέφτη ΟΣΟ λογιστικό σχέδιο χρειάζεται ο
// έλεγχος λογαριασμού για συγκεκριμένες μάσκες. Η κρίση ζει στο καθαρό `account-check.ts`.
import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  chartNeeds, checkAccounts,
  type AccountChart, type AccountCheckInput, type AccountCheckLine,
} from './account-check';

/**
 * `synced: false` όταν ο καθρέφτης είναι ΑΔΕΙΟΣ — ποτέ συγχρονισμένος ή (θεωρητικά) σβησμένος.
 * Ο συγχρονισμός δεν αδειάζει ποτέ τον πίνακα σε αποτυχία (`syncAccounts`), οπότε «άδειος» σημαίνει
 * «δεν έχει τρέξει». Και στις δύο περιπτώσεις ο έλεγχος ΔΕΝ κρίνει: ένα άγνωστο δεν γίνεται «λείπει».
 */
export async function loadAccountChart(masks: readonly (string | null | undefined)[]): Promise<AccountChart> {
  const total = await prisma.softoneAccount.count();
  if (total === 0) return { synced: false, accounts: [] };

  const { codes, parents, prefixes } = chartNeeds(masks);
  const or: Prisma.SoftoneAccountWhereInput[] = [];
  if (codes.length) or.push({ code: { in: codes } });
  if (parents.length) or.push({ parentCode: { in: parents } });
  for (const p of prefixes) or.push({ code: { startsWith: p } });
  if (or.length === 0) return { synced: true, accounts: [] };

  const rows = await prisma.softoneAccount.findMany({
    where: { OR: or },
    select: { code: true, name: true, isActive: true, postable: true },
  });
  return { synced: true, accounts: rows };
}

/**
 * Ο έλεγχος λογαριασμού για τη ΣΤΗΛΗ «SoftOne» της σελίδας εγγράφου, ανά γραμμή όπως είναι
 * αντιστοιχισμένη ΤΩΡΑ. Χωρίς στόχο σειράς: μια χρεοπίστωση πάει πάντα σε LINLINES, ένα είδος σε
 * ITELINES/SRVLINES, ένα έξοδο σε EXPANAL. Αν η σειρά δεν δέχεται αυτόν τον πίνακα, το λέει η
 * προεπισκόπηση καταχώρισης — εδώ απαντάμε μόνο «σε ποιον λογαριασμό θα πήγαινε».
 */
export async function lineAccountsFor(items: {
  rowIndex: number; softoneLinMtrl: number | null; softoneMtrl: number | null;
  softoneExpn: number | null; softoneIsService: boolean | null;
}[]): Promise<Record<number, AccountCheckLine>> {
  const linIds = items.map((i) => i.softoneLinMtrl).filter((v): v is number => v != null);
  const lins = linIds.length
    ? await prisma.softoneLineItem.findMany({
      where: { mtrl: { in: linIds } },
      select: { mtrl: true, code: true, name: true, acnmsk: true, acnmskSyncedAt: true },
    })
    : [];
  const linById = new Map(lins.map((l) => [l.mtrl, l]));

  const inputs: AccountCheckInput[] = items.map((i) => {
    if (i.softoneLinMtrl != null) {
      const l = linById.get(i.softoneLinMtrl);
      return {
        rowIndex: i.rowIndex, path: 'LINLINES' as const,
        article: l ? `${l.code} — ${l.name}` : null,
        acnmsk: l?.acnmsk ?? null, acnmskKnown: Boolean(l?.acnmskSyncedAt),
      };
    }
    if (i.softoneMtrl != null) return { rowIndex: i.rowIndex, path: i.softoneIsService ? 'SRVLINES' as const : 'ITELINES' as const };
    if (i.softoneExpn != null) return { rowIndex: i.rowIndex, path: 'EXPANAL' as const };
    return { rowIndex: i.rowIndex, path: null };
  });

  const chart = await loadAccountChart(inputs.filter((i) => i.path === 'LINLINES').map((i) => i.acnmsk));
  const check = checkAccounts(inputs, chart);
  return Object.fromEntries(check.lines.map((l) => [l.rowIndex, l]));
}
