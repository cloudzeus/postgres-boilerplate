/**
 * Positional ΚΑΔ extractor — uses unpdf's `extractTextItems` to read the PDF
 * as positioned text fragments (x, y, str) per page, then reconstructs the
 * table by grouping fragments into rows by Y-coordinate. This lets us pair
 * each ΚΑΔ code with the description that visually sits in the same row.
 *
 * Why this exists: plain text extraction merges columns left-to-right, so a
 * 6-column ΚΑΔ table comes out as "code code code code... description
 * description description...", impossible to pair afterwards.
 */

import { formatKadDots, stripKadDots } from '@/lib/kad/resolve';

export interface PositionalKad {
  code: string;
  codeWithoutDots: string;
  description: string | null;
  page: number;
}

interface PdfItem { str: string; x: number; y: number; w?: number }

const CODE_ONLY_RE = /^\d{2}(?:\.\d{1,3}){1,3}$/;
const CODE_INLINE_RE = /(?<![\d.])(\d{2}(?:\.\d{1,3}){1,3})(?![\d])/g;
// Rows can wrap into 2-3 visual lines in wide tables. Allow generous Y tolerance.
const Y_TOLERANCE = 12;

// Same description allow-list used by the text harvester.
const KAD_STARTERS = /^(Παραγωγή|Παρασκευή|Εμπόριο|Χονδρικό|Λιανικό|Πώληση|Υπηρεσίες|Παροχή|Καλλιέργεια|Φύτευση|Εκτροφή|Αλιεία|Υδατοκαλλιέργ|Δασοκομία|Μεταποίηση|Επεξεργασία|Συσκευασία|Τυποποίηση|Δραστηριότητες|Εκμετάλλευση|Κατασκευή|Εξόρυξη|Εστιατόρια|Καταλύματα|Εστίαση|Μεταφορά|Μεταφορές|Διανομή|Αποθήκευση|Εγκατάσταση|Συντήρηση|Επισκευή|Διαχείριση|Προμήθεια|Φυτώρια|Ενοικίαση|Έκδοση|Εκτύπωση|Ανάπτυξη|Σχεδιασμός|Δημιουργία|Παρ\.|Άλλες|Λοιπές|Ηλεκτρ|Έρευνα|Προγραμματισμός|Παραγωγές|Προστασία|Εξυπηρέτηση)/i;
const CHECKLIST_MARKERS = /Δικαιολογητικ|Παράρτημα\s+(?:I|Ι)\b|Κατάλληλο έγγραφο|Αποφάσεις Αρμοδίων|Πιστοποιητικ|Βεβαίωση|Υπεύθυνη Δήλωση/i;

function looksLikeKadDescription(desc: string): boolean {
  if (!desc || desc.length < 6) return false;
  if (CHECKLIST_MARKERS.test(desc)) return false;
  // Accept if it starts with a known ΚΑΔ verb/noun, OR if it's reasonably long
  // Greek text (>= 12 chars, mostly letters) — this catches valid descriptions
  // we didn't anticipate (e.g. "Δραστηριότητες…").
  if (KAD_STARTERS.test(desc)) return true;
  const letters = (desc.match(/[α-ωΑ-ΩάέήίόύώϊϋΆΈΉΊΌΎΏΪΫ]/g) ?? []).length;
  return desc.length >= 12 && letters >= 8 && letters / desc.length > 0.5;
}

/**
 * Group text items into visual rows by their Y coordinate.
 * Returns array of rows, each sorted left-to-right by X.
 */
function groupRowsByY(items: PdfItem[]): PdfItem[][] {
  if (items.length === 0) return [];
  // Sort by Y descending (PDF coordinates: Y=0 is bottom), then X ascending.
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows: PdfItem[][] = [];
  let current: PdfItem[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    const last = current[current.length - 1];
    if (Math.abs(it.y - last.y) <= Y_TOLERANCE) {
      current.push(it);
    } else {
      // Flush current row sorted by X
      current.sort((a, b) => a.x - b.x);
      rows.push(current);
      current = [it];
    }
  }
  current.sort((a, b) => a.x - b.x);
  rows.push(current);
  return rows;
}

/**
 * For a row of items, find the rightmost piece of text that looks like a
 * description. Description usually lives in the last (widest) column.
 */
function descriptionFromRow(row: PdfItem[], codeXs: Set<number>): string | null {
  // Concatenate everything that is NOT a code into a string, in left-to-right order.
  const parts: string[] = [];
  for (const it of row) {
    const s = it.str.trim();
    if (!s) continue;
    if (CODE_ONLY_RE.test(s)) continue;      // it's a code cell, skip
    if (codeXs.has(it.x)) continue;          // code-column item (same x as code)
    parts.push(s);
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text;
}

/**
 * Extract ΚΑΔ codes + descriptions from a PDF buffer using positional layout.
 * Handles wide multi-column tables where the same row contains a code (left
 * columns) and a description (rightmost column).
 */
export async function extractKadsPositional(buffer: Buffer): Promise<PositionalKad[]> {
  const { getDocumentProxy } = await import('unpdf');
  let pdf: any;
  try { pdf = await getDocumentProxy(new Uint8Array(buffer)); }
  catch (err) { console.error('getDocumentProxy failed', err); return []; }
  const numPages: number = pdf.numPages ?? 0;

  const found = new Map<string, PositionalKad>();

  // Use pdfjs directly via the documentProxy (unpdf exposes it). Each page's
  // getTextContent() returns items with `.str` and `.transform` (transform[4]=x,
  // transform[5]=y) — exactly what we need to reconstruct table rows.
  for (let pageNo = 1; pageNo <= numPages; pageNo++) {
    let items: PdfItem[] = [];
    try {
      const page = await pdf.getPage(pageNo);
      const tc = await page.getTextContent();
      items = (tc.items ?? []).map((it: any) => ({
        str: String(it.str ?? ''),
        x: it.transform?.[4] ?? 0,
        y: it.transform?.[5] ?? 0,
        w: it.width ?? 0,
      })).filter((it: PdfItem) => it.str.trim().length > 0);
    } catch (err) {
      // Some PDFs have a few unreadable pages; skip them silently.
      continue;
    }

    if (items.length === 0) continue;
    const rows = groupRowsByY(items);

    for (const row of rows) {
      // Find every code in this row.
      const codeItems = row.filter((it) => CODE_ONLY_RE.test(it.str.trim()));
      if (codeItems.length === 0) continue;
      const codeXs = new Set(codeItems.map((it) => it.x));

      // Try to extract a description from the rest of the row.
      const desc = descriptionFromRow(row, codeXs);

      // Strategy:
      //  · If the row has ONE code + a valid description → pair them
      //  · If multiple codes + one description → attribute to the most-specific
      //    (longest) code — sub-categories typically inherit their parent's
      //    description in CPA tables.
      const validDesc = desc && looksLikeKadDescription(desc) ? desc : null;

      const sortedCodes = [...codeItems]
        .map((it) => it.str.trim())
        .sort((a, b) => b.length - a.length);  // longest first
      const primary = sortedCodes[0];
      const dotted = formatKadDots(primary);
      if (!found.has(dotted)) {
        found.set(dotted, {
          code: dotted,
          codeWithoutDots: stripKadDots(primary),
          description: validDesc,
          page: pageNo,
        });
      }
      // Also store the shorter codes (parent levels) without description.
      for (const c of sortedCodes.slice(1)) {
        const dotShort = formatKadDots(c);
        if (!found.has(dotShort)) {
          found.set(dotShort, {
            code: dotShort,
            codeWithoutDots: stripKadDots(c),
            description: null,
            page: pageNo,
          });
        }
      }
    }

    // Second pass: in the same page, look for codes that appear INLINE in
    // longer text strings (some PDFs collapse cells into one big string).
    const pageText = items.map((it) => it.str).join(' ');
    const inline = [...pageText.matchAll(CODE_INLINE_RE)];
    for (let i = 0; i < inline.length; i++) {
      const code = inline[i][1];
      const dotted = formatKadDots(code);
      if (found.has(dotted)) continue;
      // Try to harvest a description following the code.
      const start = (inline[i].index ?? 0) + inline[i][0].length;
      const end = i + 1 < inline.length ? (inline[i + 1].index ?? pageText.length) : Math.min(pageText.length, start + 300);
      const rawDesc = pageText.slice(start, end).replace(/^[\s\.\-:·,]+/, '').replace(/\s+/g, ' ').trim().slice(0, 220);
      if (!looksLikeKadDescription(rawDesc)) continue;
      found.set(dotted, {
        code: dotted,
        codeWithoutDots: stripKadDots(code),
        description: rawDesc,
        page: pageNo,
      });
    }
  }

  await pdf.destroy?.();
  return Array.from(found.values());
}
