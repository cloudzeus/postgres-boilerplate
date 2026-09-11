// lib/templates/mapping.ts — PURE projections of extracted values onto outputs.
import { setPath, UNSAFE_SEGMENTS, type DocumentJson, type DocumentLine } from '@/lib/ocr/canonical';
import { documentKeyInfo, type FieldDef, type FieldValue, type MappingRowExcel, type MappingRowInvoice } from './schema';

type Json = Record<string, unknown>;

/** Μια άδεια γραμμή — κάθε πεδίο δηλωμένο, ώστε ο compiler να πιάσει ένα πεδίο που θα προστεθεί αύριο. */
const blankLine = (): DocumentLine => ({
  code: null, name: null, unit: null, quantity: null, unitPrice: null,
  discount: null, net: null, vatRate: null, vatAmount: null, total: null, custom: {},
});

const isBlank = (v: FieldValue['value']) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * Το κανονικό έγγραφο με τις τιμές του προτύπου γραμμένες πάνω του (spec §17.1). ΚΑΘΑΡΗ:
 * επιστρέφει νέο έγγραφο, το `existing` μένει άθικτο.
 *
 * - κεφαλίδα → `setPath(info.key, value)`· μια κενή/null ανάγνωση ΠΑΡΑΛΕΙΠΕΤΑΙ, ώστε να μην σβήσει
 *   ό,τι διάβασε το βασικό OCR (ένα άδειο crop δεν είναι απόδειξη ότι το τιμολόγιο δεν έχει σύνολο)
 * - `lines.*` → ξαναχτίζει το `lines[]` από τον ΠΡΩΤΟ πίνακα που εμφανίζεται στο mapping· οι στήλες
 *   του πίνακα που δεν χαρτογραφήθηκαν κρατιούνται στο `custom` της γραμμής
 * - κάθε ΑΠΛΟ πεδίο του προτύπου που δεν εμφανίζεται σε καμία γραμμή mapping πάει στο
 *   `custom[fieldKey]`: διαδρομή Ή custom — τίποτα από όσα διάβασε το πρότυπο δεν χάνεται.
 *
 * Τα παλιά `invoiceKey` (`totalAmount`, `items.price`, `customFields.x`) περνούν μέσα από το
 * `documentKeyInfo`, άρα ένα mapping αποθηκευμένο πριν από το κανονικό JSON δουλεύει αυτούσιο.
 */
export function projectToDocument(
  values: Record<string, FieldValue>,
  rows: MappingRowInvoice[],
  existing: DocumentJson,
  fields: FieldDef[] = [],
): DocumentJson {
  let out = existing;
  const lineMaps: { tableKey: string; colKey: string; lineKey: string }[] = [];
  /** Κλειδιά πεδίων που «καταναλώθηκαν» από μια γραμμή mapping — τα υπόλοιπα πάνε στο custom. */
  const mapped = new Set<string>();

  for (const r of rows) {
    const info = documentKeyInfo(r.invoiceKey);
    if (!info) continue;
    if (info.isLine) {
      const dot = r.fieldKey.indexOf('.');
      if (dot <= 0) continue;
      const tableKey = r.fieldKey.slice(0, dot);
      lineMaps.push({ tableKey, colKey: r.fieldKey.slice(dot + 1), lineKey: info.key.slice('lines.'.length) });
      mapped.add(tableKey);
      mapped.add(r.fieldKey);
      continue;
    }
    mapped.add(r.fieldKey);
    const v = values[r.fieldKey]?.value;
    if (isBlank(v)) continue;
    out = setPath(out, info.key, v);
  }

  if (lineMaps.length) {
    // Γραμμές από δεύτερο πίνακα αγνοούνται· το endpoint των mappings απορρίπτει τέτοιο mapping.
    const tableKey = lineMaps[0].tableKey;
    const maps = lineMaps.filter((m) => m.tableKey === tableKey);
    const cols = new Set(maps.map((m) => m.colKey));
    const tableRows = values[tableKey]?.value;
    if (Array.isArray(tableRows)) {
      out = {
        ...out,
        lines: (tableRows as Json[]).map((row) => {
          const line = blankLine();
          const custom: Json = {};
          if (row && typeof row === 'object') {
            for (const m of maps) if (row[m.colKey] != null) (line as unknown as Json)[m.lineKey] = row[m.colKey];
            // Ό,τι διάβασε ο πίνακας και δεν χωράει σε κανονικό πεδίο γραμμής δεν πετιέται.
            for (const [k, v] of Object.entries(row)) if (!cols.has(k) && v != null && !UNSAFE_SEGMENTS.has(k)) custom[k] = v;
          }
          line.custom = custom;
          return line;
        }),
      };
    }
  }

  // Τα αχαρτογράφητα ΑΠΛΑ πεδία: διαδρομή Ή custom, ποτέ τίποτα.
  const extra: Json = {};
  for (const f of fields) {
    if (f.kind !== 'SINGLE' || mapped.has(f.key) || UNSAFE_SEGMENTS.has(f.key)) continue;
    if (!(f.key in values)) continue;
    extra[f.key] = values[f.key]?.value ?? null;
  }
  if (Object.keys(extra).length) out = { ...out, custom: { ...out.custom, ...extra } };

  return out;
}

/** One Excel row for a document: ordered column headers + cell values. */
export function projectToExcel(
  values: Record<string, FieldValue>,
  rows: MappingRowExcel[],
): { columns: string[]; row: (string | number)[] } {
  const ordered = [...rows].sort((a, b) => a.order - b.order);
  const columns = ordered.map((r) => r.column);
  const row = ordered.map((r) => {
    const v = values[r.fieldKey]?.value;
    if (v == null) return '';
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) {
      // TABLE rows do not belong in a single cell — they are exported to their own sheet.
      if (v.length && typeof v[0] === 'object' && v[0] !== null) return '';
      return v.map((x) => String(x)).join(', ');
    }
    return String(v);
  });
  return { columns, row };
}
