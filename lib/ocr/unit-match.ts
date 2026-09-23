// lib/ocr/unit-match.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// Η **τυπωμένη** μονάδα μέτρησης της γραμμής («ΤΕΜ», «KWh», «κιλά») → μονάδα του μητρώου
// `MTRUNIT` του SoftOne.
//
// ΤΙ ΕΚΑΝΕ ΛΑΘΟΣ Η ΠΡΟΗΓΟΥΜΕΝΗ ΦΟΡΜΑ. Η δημιουργία νέου είδους διάλεγε μόνη της
// `m.units.find(/τεμ/i) ?? m.units[0]` — δηλαδή **ΤΕΜΑΧΙΑ για τα πάντα**, σιωπηλά, ακόμη και για
// μια γραμμή ρεύματος μετρημένη σε `KWh`. Η μονάδα δεν είναι διακοσμητική: μένει στην καρτέλα του
// είδους και ακολουθεί κάθε μελλοντική κίνηση. Ένα λάθος «τεμάχιο» δεν φαίνεται πουθενά και δεν
// διορθώνεται ποτέ.
//
// Ο κανόνας εδώ είναι ο ίδιος με όλο τον αγωγό: ταιριάζουμε μόνο ό,τι είναι **αναμφισβήτητο**
// (ίδιο όνομα ή ρητό συνώνυμο) και αλλιώς επιστρέφουμε `null` — που το UI το λέει δυνατά
// («η μονάδα «KWh» δεν υπάρχει στο μητρώο — διάλεξε»), αντί να βάλει ΤΕΜ και να προχωρήσει.

import { GREEK_LATIN_HOMOGLYPHS } from '@/lib/doc-reference';

export interface UnitOption {
  /** `MTRUNIT` — ο κωδικός που φεύγει στο `ITEM.MTRUNIT1/3/4`. */
  code: string;
  name: string;
}

/**
 * Κανονικοποίηση για σύγκριση: κεφαλαία, χωρίς τόνους, με τα **ελληνικά ομόγλυφα** διπλωμένα σε
 * λατινικά, χωρίς τελείες/κενά, πεζά. Ίδια σειρά με το `lib/ocr/line-kind.ts` — τόνοι πρώτα,
 * ομόγλυφα μετά — γιατί αλλιώς το τονισμένο «Ί» και το άτονο «Ι» καταλήγουν διαφορετικά.
 *
 * Τα ομόγλυφα δεν είναι θεωρητικά: οι μονάδες βγαίνουν από τον ΙΔΙΟ αγωγό OCR που έδωσε «ΤΙΜ» με
 * ελληνικά και «AA» με λατινικά μέσα στο ίδιο string.
 */
export function foldUnit(s: string): string {
  const up = String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of up) out += GREEK_LATIN_HOMOGLYPHS[ch] ?? ch;
  return out.toLowerCase().replace(/[\s.\-_/]/g, '');
}

/**
 * Ρητά συνώνυμα: **σύντμηση → όνομα μονάδας του μητρώου**, συγκρινόμενα κανονικοποιημένα.
 *
 * Σκόπιμα ΜΙΚΡΟΣ και σκόπιμα χωρίς τα διφορούμενα. Το σκέτο `m` λείπει επειδή το μητρώο του
 * πελάτη έχει και «MM»· το `KWh` λείπει επειδή **δεν υπάρχει** μονάδα ενέργειας στο μητρώο, και
 * ένα ψεύτικο ταίριασμα θα ήταν χειρότερο από ένα ρητό «δεν βρέθηκε».
 */
const SYNONYMS: { aliases: string[]; unit: string }[] = [
  { aliases: ['τεμ', 'τεμαχ', 'τεμαχια', 'τεμαχιο', 'τμχ', 'pcs', 'pc', 'piece', 'pieces'], unit: 'Τεμάχια' },
  { aliases: ['κιλ', 'κιλα', 'κιλο', 'kg', 'kgr', 'kgs'], unit: 'Κιλά' },
  { aliases: ['λιτ', 'λιτρα', 'λιτρο', 'lt', 'ltr', 'lit', 'liter', 'litre'], unit: 'Λίτρα' },
  { aliases: ['ωρ', 'ωρα', 'ωρες', 'hr', 'hrs', 'hour', 'hours'], unit: 'Ώρες' },
  { aliases: ['μετρ', 'μετρα', 'μετρο', 'mtr', 'meter', 'metre'], unit: 'Μέτρα' },
  { aliases: ['τμ', 'τετρμετρα', 'τετραγωνικα', 'm2', 'sqm'], unit: 'Τετρ. Μέτρα' },
  { aliases: ['κμ', 'κυβ', 'κυβικα', 'm3', 'cbm'], unit: 'Κυβικά Μέτρα' },
  { aliases: ['τον', 'τονοι', 'τοννοι', 'tn', 'ton', 'tons'], unit: 'Τόννοι' },
  { aliases: ['κιβ', 'κιβωτια', 'κιβωτιο', 'box', 'boxes', 'ctn'], unit: 'Κιβώτια' },
  { aliases: ['πακ', 'πακετο', 'πακετα', 'pack', 'pkt'], unit: 'Πακέτο' },
  { aliases: ['σελ', 'σελιδα', 'σελιδες', 'page', 'pages'], unit: 'Σελίδα' },
];

export interface UnitMatch extends UnitOption {
  /** `exact` = ίδιο όνομα μητρώου· `synonym` = ρητή σύντμηση από τον πίνακα πιο πάνω. */
  matchedBy: 'exact' | 'synonym';
}

/**
 * Η μονάδα του μητρώου που αντιστοιχεί στο τυπωμένο κείμενο. `null` όταν **δεν ξέρουμε** —
 * κενό κείμενο, ή μονάδα που το μητρώο απλώς δεν έχει (`KWh`).
 */
export function matchUnit(text: string | null | undefined, units: readonly UnitOption[]): UnitMatch | null {
  const t = foldUnit(text ?? '');
  if (!t) return null;

  const byName = new Map<string, UnitOption>();
  for (const u of units) {
    // Το «MM [SoftOne]» του μητρώου κουβαλά ετικέτα προέλευσης — συγκρίνουμε και χωρίς αυτήν.
    const bare = String(u.name ?? '').replace(/\[[^\]]*\]/g, '');
    for (const key of [foldUnit(u.name), foldUnit(bare)]) if (key && !byName.has(key)) byName.set(key, u);
  }

  const exact = byName.get(t);
  if (exact) return { code: exact.code, name: exact.name, matchedBy: 'exact' };

  for (const s of SYNONYMS) {
    if (!s.aliases.some((a) => foldUnit(a) === t)) continue;
    const hit = byName.get(foldUnit(s.unit));
    if (hit) return { code: hit.code, name: hit.name, matchedBy: 'synonym' };
  }
  return null;
}

/** Η λίστα του dropdown με το πιθανό ταίριασμα πρώτο — η επιλογή μένει πάντα στον χρήστη. */
export function unitOptions(text: string | null | undefined, units: readonly UnitOption[]): UnitOption[] {
  const hit = matchUnit(text, units);
  if (!hit) return [...units];
  return [hit, ...units.filter((u) => u.code !== hit.code)];
}
