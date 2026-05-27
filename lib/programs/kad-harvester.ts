/**
 * Regex-based ΚΑΔ harvester. Scans raw PDF text for any code that matches the
 * Greek ΚΑΔ pattern (2 digits + 1-3 dotted segments of 1-3 digits each) and
 * extracts the immediately following description text up to the next code or
 * 200 chars, whichever comes first.
 *
 * Used as a SAFETY NET on top of the LLM-extracted list — pdfjs sometimes
 * scrambles ΚΑΔ tables and the LLM may miss rows. The harvester guarantees we
 * capture every code that physically appears in the text.
 */

import { formatKadDots, stripKadDots } from '@/lib/kad/resolve';

export interface HarvestedKad {
  code: string;            // canonical dotted
  codeWithoutDots: string; // digits only
  description: string | null;
}

/** Matches ΚΑΔ codes: 2 digits + 1-3 groups of `.digits`. */
const KAD_RE = /(?<![\d.])(\d{2}(?:\.\d{1,3}){1,3})(?![\d])/g;

/** False-positive contexts: code is part of legal citations, page refs, etc. */
const NOT_KAD_KEYWORDS = [
  /ΦΕΚ/i, /Α\.Δ\.Α/i, /ΑΔΑ/i, /άρθρο/i, /κεφάλαιο/i, /ΚΑΝ\./i,
  /σελίδα/i, /Page/i, /€/, /\$/,
];

/**
 * Verbs/nouns that a REAL ΚΑΔ description almost always starts with.
 * Used to distinguish ΚΑΔ tables from document-checklist tables
 * (e.g. "01.01 Κατάλληλο έγγραφο αδειοδότησης…" — a checklist item, not ΚΑΔ).
 */
const KAD_DESCRIPTION_STARTERS = [
  /^Παραγωγή/i,
  /^Παρασκευή/i,
  /^Εμπόριο/i,
  /^Χονδρικό/i,
  /^Λιανικό/i,
  /^Πώληση/i,
  /^Υπηρεσίες/i,
  /^Παροχή/i,
  /^Καλλιέργεια/i,
  /^Φύτευση/i,
  /^Εκτροφή/i,
  /^Αλιεία/i,
  /^Υδατοκαλλιέργειες?/i,
  /^Δασοκομία/i,
  /^Μεταποίηση/i,
  /^Επεξεργασία/i,
  /^Συσκευασία/i,
  /^Τυποποίηση/i,
  /^Δραστηριότητες/i,
  /^Εκμετάλλευση/i,
  /^Κατασκευή/i,
  /^Εξόρυξη/i,
  /^Εστιατόρια/i,
  /^Καταλύματα/i,
  /^Εστίαση/i,
  /^Μεταφορά/i,
  /^Μεταφορές/i,
  /^Διανομή/i,
  /^Αποθήκευση/i,
  /^Εγκατάσταση/i,
  /^Συντήρηση/i,
  /^Επισκευή/i,
  /^Διαχείριση/i,
  /^Παραγωγές?/i,
  /^Προμήθεια/i,
  /^Φυτώρια/i,
  /^Αγορά/i,
  /^Ενοικίαση/i,
  /^Έκδοση/i,
  /^Εκτύπωση/i,
  /^Ανάπτυξη/i,
  /^Σχεδιασμός/i,
  /^Δημιουργία/i,
  /^Παροχέας?/i,
  /^Άλλες/i,
  /^Λοιπές/i,
  /^Χρήση/i,
  /^Διαχειρισμός/i,
  /^Ηλεκτρ/i,
  /^Έρευνα/i,
  /^Προγραμματισμός/i,
];

/** Strong markers that we're INSIDE a document checklist, not a ΚΑΔ table. */
const CHECKLIST_MARKERS = [
  /Δικαιολογητικ/i,
  /Παράρτημα\s+(?:I|Ι)\b/i,
  /Κατάλληλο έγγραφο/i,
  /Αποφάσεις Αρμοδίων/i,
  /Πιστοποιητικ/i,
  /Βεβαίωση/i,
  /Υπεύθυνη Δήλωση/i,
  /έντυπο/i,
  /έγγραφα/i,
  /checklist/i,
];

function looksLikeKadDescription(desc: string): boolean {
  if (!desc) return false;
  if (desc.length < 6) return false;
  // Reject obvious checklist phrases
  for (const re of CHECKLIST_MARKERS) {
    if (re.test(desc)) return false;
  }
  // Accept if starts with a known ΚΑΔ verb/noun
  for (const re of KAD_DESCRIPTION_STARTERS) {
    if (re.test(desc)) return true;
  }
  return false;
}

export function harvestKadsFromText(text: string): HarvestedKad[] {
  if (!text) return [];
  const found = new Map<string, HarvestedKad>();
  const matches = [...text.matchAll(KAD_RE)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const code = m[1];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : Math.min(text.length, start + 300);

    // Skip obvious non-ΚΑΔ contexts (look at 50 chars before).
    const before = text.slice(Math.max(0, (m.index ?? 0) - 50), m.index ?? 0);
    if (NOT_KAD_KEYWORDS.some((re) => re.test(before))) continue;

    // ΚΑΔ canonical: minimum 4-digit segment (e.g. "20.59" is a CPA category — keep it).
    const digits = code.replace(/\./g, '');
    if (digits.length < 4) continue;
    if (digits.length > 10) continue;

    // Description: text from end of code to next match, stripped.
    const rawDesc = text.slice(start, end)
      .replace(/^[\s\.\-:·,]+/, '')         // strip leading punctuation
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);

    // STRICT filter: the description MUST start with a ΚΑΔ-style verb/noun.
    // This excludes document checklists like "01.01 Κατάλληλο έγγραφο αδειοδότησης".
    if (!looksLikeKadDescription(rawDesc)) continue;

    const dotted = formatKadDots(code);
    if (!found.has(dotted)) {
      found.set(dotted, {
        code: dotted,
        codeWithoutDots: stripKadDots(code),
        description: rawDesc,
      });
    }
  }

  return Array.from(found.values());
}

/**
 * Merge LLM-extracted ΚΑΔ list with harvested ΚΑΔ list. Preserves LLM
 * `description` (better quality) when present, otherwise uses the harvested
 * one. Preserves `excluded` flag from LLM. Adds harvested ΚΑΔ that the LLM
 * missed entirely as eligible (excluded=false).
 */
export function mergeKads(
  fromLLM: Array<{ code: string; description?: string | null; excluded?: boolean }>,
  harvested: HarvestedKad[],
): Array<{ code: string; description: string | null; excluded: boolean }> {
  const seen = new Map<string, { code: string; description: string | null; excluded: boolean }>();
  // Seed with LLM output first (it carries excluded flag + better descriptions).
  for (const k of fromLLM) {
    if (!k.code) continue;
    const dotted = formatKadDots(k.code);
    seen.set(dotted, {
      code: dotted,
      description: k.description ?? null,
      excluded: !!k.excluded,
    });
  }
  // Add harvested codes that the LLM didn't list. Default to NOT excluded
  // (eligible) — we don't know context from raw text, but if kadRule is
  // ALL_EXCEPT_LISTED at the program level, the UI will surface this clearly.
  for (const h of harvested) {
    if (seen.has(h.code)) {
      // Backfill description if LLM didn't provide one.
      const existing = seen.get(h.code)!;
      if (!existing.description && h.description) existing.description = h.description;
      continue;
    }
    seen.set(h.code, { code: h.code, description: h.description, excluded: false });
  }
  return Array.from(seen.values()).sort((a, b) => a.code.localeCompare(b.code));
}
