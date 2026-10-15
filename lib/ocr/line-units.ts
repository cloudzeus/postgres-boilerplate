// lib/ocr/line-units.ts — ΚΑΘΑΡΟ. Σε ποια μονάδα είναι η ποσότητα μιας γραμμής αγοράς.
//
// Το ΙΔΙΟ module το χρησιμοποιούν η καταχώριση (`post-softone.ts`) και η σελίδα του παραστατικού,
// ώστε αυτό που δείχνει η οθόνη («2 Κιβώτια → 200 Τεμάχια») να είναι ΑΚΡΙΒΩΣ αυτό που θα σταλεί.
import { matchUnit } from '@/lib/ocr/unit-match';

export interface ItemUnitInfo { unit1: string | null; unitBuy: string | null; buyRatio: number | null }

export interface LineUnitDecision {
  /** MU31 (1 = ίδια μονάδα — τίποτα να μετατραπεί). */
  buyRatio: number;
  /** Η ποσότητα του τιμολογίου είναι στη ΒΑΣΙΚΗ μονάδα (αλλιώς στη μονάδα αγορών). */
  qtyInBase: boolean;
  /** Αποφάσισε ο χρήστης (`line.qtyIn`) ή η εφαρμογή από την τυπωμένη μονάδα. */
  source: 'user' | 'printed' | 'default';
}

/** `true` όταν το είδος αγοράζεται σε άλλη μονάδα από τη βασική (κιβώτιο των 100). */
export function hasBuyUnit(item: ItemUnitInfo | null | undefined): boolean {
  return Boolean(item?.unitBuy && item.unitBuy !== item.unit1 && (item.buyRatio ?? 1) !== 1);
}

/**
 * Ρητή επιλογή του χρήστη (`line.qtyIn`), αλλιώς η τυπωμένη μονάδα («PZ», «ΚΙΒ») σε σχέση με τις
 * μονάδες του είδους. Αμφιβολία ⇒ μονάδα αγορών (ό,τι κάνει και η SoftOne στη δική της οθόνη).
 */
export function decideLineUnits(
  item: ItemUnitInfo,
  line: { unit?: string | null; qtyIn?: string | null } | undefined,
  units: { code: string; name: string }[],
): LineUnitDecision {
  const ratio = item.buyRatio ?? 1;
  if (!hasBuyUnit(item)) return { buyRatio: ratio, qtyInBase: false, source: 'default' };
  if (line?.qtyIn === 'base') return { buyRatio: ratio, qtyInBase: true, source: 'user' };
  if (line?.qtyIn === 'buy') return { buyRatio: ratio, qtyInBase: false, source: 'user' };
  const printed = matchUnit(line?.unit ?? '', units)?.code ?? null;
  if (printed != null && printed === item.unit1) return { buyRatio: ratio, qtyInBase: true, source: 'printed' };
  return { buyRatio: ratio, qtyInBase: false, source: printed != null && printed === item.unitBuy ? 'printed' : 'default' };
}
