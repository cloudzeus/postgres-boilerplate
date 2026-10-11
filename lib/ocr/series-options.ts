// lib/ocr/series-options.ts — SERVER. Οι σειρές που προσφέρονται στον επιλογέα «Είδος παραστατικού».
//
// ΕΝΑ σημείο για τη λίστα (/admin/ocr) ΚΑΙ για τη σελίδα του παραστατικού (/admin/ocr/[id]). Πριν, η
// λογική ζούσε μόνο στη λίστα και η σελίδα του παραστατικού δεν είχε καθόλου επιλογέα σειράς — δύο
// οθόνες για την ίδια δουλειά, με διαφορετικές δυνατότητες.
import 'server-only';
import { prisma } from '@/lib/db';

export interface SeriesOption {
  code: string;
  abbrev: string | null;
  name: string;
  section: string | null;
  /** Ελληνική ετικέτα της ΕΝΟΤΗΤΑΣ («Παραστατικά αγορών», «Παραστατικά πιστωτών»…). */
  family: string;
  sosource: number;
  /** `false` = απενεργοποιημένη σειρά που κρατά ήδη κάποιο παραστατικό: φαίνεται, δεν ξαναεπιλέγεται. */
  enabled: boolean;
}

export const PURCHASE_FAMILY = 'Παραστατικά αγορών';

/**
 * Οι ενεργοποιημένες σειρές (αγορών 1251 + κάθε άλλης ενότητας που ενεργοποίησε ο χρήστης), συν όσες
 * ΑΠΕΝΕΡΓΟΠΟΙΗΜΕΝΕΣ κρατούν ακόμη τα δοσμένα παραστατικά — αλλιώς ο επιλογέας θα φαινόταν άδειος.
 */
export async function loadSeriesOptions(
  docs: readonly { softoneSeries: string | null; seriesSource: number | null }[],
): Promise<SeriesOption[]> {
  const [purchaseSeries, otherSeries] = await Promise.all([
    prisma.purchaseDocType.findMany({
      where: { enabled: true, isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, abbrev: true, name: true, section: true },
    }),
    prisma.softoneDocSeries.findMany({
      where: { enabled: true, isActive: true },
      orderBy: [{ sosource: 'asc' }, { order: 'asc' }, { code: 'asc' }],
      select: { code: true, abbrev: true, name: true, section: true, sosource: true, family: true },
    }),
  ]);
  const rows: SeriesOption[] = [
    ...purchaseSeries.map((s) => ({ ...s, family: PURCHASE_FAMILY, sosource: 1251, enabled: true })),
    ...otherSeries.map((s) => ({ ...s, family: s.family ?? '', enabled: true })),
  ];
  rows.push(...(await loadInactiveSeries(docs, rows)));
  return rows;
}

async function loadInactiveSeries(
  docs: readonly { softoneSeries: string | null; seriesSource: number | null }[],
  enabled: SeriesOption[],
): Promise<SeriesOption[]> {
  const have = new Set(enabled.map((o) => `${o.sosource}:${o.code}`));
  const missing = new Map<number, Set<string>>();
  for (const d of docs) {
    if (!d.softoneSeries) continue;
    const sosource = d.seriesSource ?? 1251;
    if (have.has(`${sosource}:${d.softoneSeries}`)) continue;
    if (!missing.has(sosource)) missing.set(sosource, new Set());
    missing.get(sosource)!.add(d.softoneSeries);
  }
  if (!missing.size) return [];
  const purchaseCodes = [...(missing.get(1251) ?? [])];
  const otherCodes = [...missing].filter(([s]) => s !== 1251).flatMap(([, codes]) => [...codes]);
  const [purchases, others] = await Promise.all([
    purchaseCodes.length
      ? prisma.purchaseDocType.findMany({ where: { code: { in: purchaseCodes } }, select: { code: true, abbrev: true, name: true, section: true } })
      : [],
    otherCodes.length
      ? prisma.softoneDocSeries.findMany({
        where: { code: { in: otherCodes }, sosource: { in: [...missing.keys()].filter((s) => s !== 1251) } },
        select: { code: true, abbrev: true, name: true, section: true, sosource: true, family: true },
      })
      : [],
  ]);
  return [
    ...purchases.map((s) => ({ ...s, family: PURCHASE_FAMILY, sosource: 1251, enabled: false })),
    ...others.filter((s) => missing.get(s.sosource)?.has(s.code)).map((s) => ({ ...s, family: s.family ?? '', enabled: false })),
  ];
}
