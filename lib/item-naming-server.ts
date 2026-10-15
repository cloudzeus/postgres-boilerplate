// SERVER: τα τελικά ονόματα νέου είδους/υπηρεσίας πριν το setData (βλ. `lib/item-naming.ts`).
import 'server-only';
import { getSetting } from '@/lib/settings';
import { translateItemName, accentGreekLower } from '@/lib/ocr/translate-ai';
import {
  parseNameCase, finalItemNames, looksForeign, needsAccenting, acceptAccented, type NameCase,
} from '@/lib/item-naming';

export interface ItemNamingConfig { nameCase: NameCase; autoTranslate: boolean }

export async function loadItemNaming(): Promise<ItemNamingConfig> {
  const [nameCase, auto] = await Promise.all([
    getSetting<string>('setup.itemNameCase').catch(() => undefined),
    getSetting<boolean | string>('setup.itemAutoTranslate').catch(() => undefined),
  ]);
  return { nameCase: parseNameCase(nameCase), autoTranslate: auto === true || auto === 'true' };
}

/** Πεζά με τόνους: λείπουν τόνοι ⇒ AI, δεκτό ΜΟΝΟ αν άλλαξαν αποκλειστικά τόνοι. */
async function accentIfNeeded(lower: string, ref?: string | null): Promise<string> {
  if (!needsAccenting(lower)) return lower;
  const candidate = await accentGreekLower(lower, ref ?? undefined).catch(() => null);
  return acceptAccented(lower, candidate) ?? lower;
}

/**
 * `original`:
 *   - `undefined` ⇒ ο καλών δεν αποφάσισε (μαζική δημιουργία): με «αυτόματη μετάφραση» και ξένη
 *     περιγραφή, μεταφράζουμε εδώ και η αρχική πάει στο NAME1.
 *   - `string` / `null` ⇒ ο χρήστης είδε και αποφάσισε στη φόρμα (μετάφρασε ή όχι) — καμία μετάφραση.
 */
export async function resolveItemNames(input: { name: string; original?: string | null; ref?: string | null }, cfg?: ItemNamingConfig): Promise<{ name: string; name1: string | null; translated: boolean }> {
  const c = cfg ?? await loadItemNaming();
  let greek = input.name;
  let original = input.original ?? null;
  let translated = false;
  if (input.original === undefined && c.autoTranslate && looksForeign(input.name)) {
    const t = await translateItemName(input.name, input.ref ?? undefined, c.nameCase === 'lower' ? 'lower' : 'upper').catch(() => null);
    if (t) { greek = t; original = input.name; translated = true; }
  }
  const out = finalItemNames(greek, original, c.nameCase);
  if (c.nameCase === 'lower') {
    out.name = await accentIfNeeded(out.name, input.ref);
    if (out.name1) out.name1 = await accentIfNeeded(out.name1, input.ref);
  }
  return { ...out, translated };
}
