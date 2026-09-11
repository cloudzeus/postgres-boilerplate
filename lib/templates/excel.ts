// lib/templates/excel.ts — PURE. Canonical documents → Excel sheets (spec §3δ, §15.6, §17.1). No exceljs here.
import type { DocumentJson } from '@/lib/ocr/canonical';
import { projectToExcel } from './mapping';
import type { FieldValue, MappingRowExcel, TemplateFieldKind } from './schema';

/** Only `.value` is read, so a run's stored FieldValue fits without a cast at the call site. */
export type CellValues = Record<string, { value: unknown }>;
export type SheetField = { key: string; label: string; kind: TemplateFieldKind; columns: { key: string; label: string }[] | null };

export type SheetInput = {
  templateSlug: string;
  templateName: string;
  file: string;
  fields: SheetField[];
  /** Rows of the template's EXCEL mapping, or null when it has none (→ one column per SINGLE field). */
  excelRows: MappingRowExcel[] | null;
  values: CellValues;
  /** The canonical document this row describes — the header, the lines and the VAT sheet all read it. */
  document: DocumentJson;
};

export type Sheet = { name: string; columns: string[]; rows: (string | number)[][] };

const FILE_COL = 'Αρχείο';
const LINES_SUFFIX = ' — Γραμμές';
const VAT_SUFFIX = ' — ΦΠΑ';
const MAX_NAME = 31; // Excel's hard limit on worksheet names.

/** Excel-safe, unique worksheet name. Mutates `used` so the next call sees this one. */
export function sheetName(raw: string, used: Set<string>): string {
  const base =
    raw
      .replace(/[[\]:*?/\\]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .trim()
      .slice(0, MAX_NAME)
      .trim() || 'Φύλλο';
  let name = base;
  for (let n = 2; used.has(name); n += 1) {
    const suffix = `_${n}`;
    name = base.slice(0, MAX_NAME - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

/** One cell: numbers stay numbers (Excel must be able to sum a column), everything else is text. */
function cell(v: unknown): string | number {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'ναι' : 'όχι';
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0] !== null) return ''; // TABLE rows → the lines sheet
    return v.map((x) => String(x)).join(', ');
  }
  if (typeof v === 'object') return '';
  return String(v);
}

/**
 * The columns every document has, whatever template read it. They come FIRST on the main sheet, so
 * a folder mixing templates still opens as one comparable table — the template's own columns follow.
 */
const DOCUMENT_COLUMNS: { label: string; of: (d: DocumentJson) => unknown }[] = [
  { label: 'Τύπος', of: (d) => d.type.label },
  { label: 'Σειρά', of: (d) => d.type.series },
  { label: 'Αριθμός', of: (d) => d.type.number },
  { label: 'Ημερομηνία', of: (d) => d.date },
  { label: 'Εκδότης', of: (d) => d.issuer.name },
  { label: 'ΑΦΜ εκδότη', of: (d) => d.issuer.vat },
  { label: 'Παραλήπτης', of: (d) => d.recipient.name },
  { label: 'Καθαρή αξία', of: (d) => d.totals.net },
  { label: 'Έκπτωση', of: (d) => d.totals.discount },
  { label: 'ΦΠΑ', of: (d) => d.totals.vatAmount },
  { label: 'Παρακράτηση', of: (d) => d.totals.withholding },
  { label: 'Επιβαρύνσεις', of: (d) => d.totals.fees },
  { label: 'Σύνολο', of: (d) => d.totals.total },
  { label: 'Πληρωτέο', of: (d) => d.totals.payable },
  { label: 'ΜΑΡΚ', of: (d) => d.digital.mark },
];

const LINE_COLUMNS: { label: string; of: (l: DocumentJson['lines'][number]) => unknown }[] = [
  { label: 'Κωδικός', of: (l) => l.code },
  { label: 'Περιγραφή', of: (l) => l.name },
  { label: 'Μονάδα', of: (l) => l.unit },
  { label: 'Ποσότητα', of: (l) => l.quantity },
  { label: 'Τιμή μονάδας', of: (l) => l.unitPrice },
  { label: 'Έκπτωση', of: (l) => l.discount },
  { label: 'Καθαρή αξία', of: (l) => l.net },
  { label: 'ΦΠΑ %', of: (l) => l.vatRate },
  { label: 'ΦΠΑ', of: (l) => l.vatAmount },
  { label: 'Σύνολο', of: (l) => l.total },
];

/** Keys of `custom` seen across a group, in first-seen order — a stable column order per export. */
function customKeys(objects: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const o of objects) for (const k of Object.keys(o)) if (!out.includes(k)) out.push(k);
  return out;
}

/**
 * One main sheet per template (a row per document), plus a «Γραμμές» sheet when any document of that
 * template has lines and a «ΦΠΑ» sheet when any has a VAT breakdown. Groups keep the order in which
 * their template first appears.
 */
export function buildSheets(inputs: SheetInput[]): Sheet[] {
  const groups = new Map<string, SheetInput[]>();
  for (const i of inputs) {
    const g = groups.get(i.templateSlug);
    if (g) g.push(i);
    else groups.set(i.templateSlug, [i]);
  }

  const used = new Set<string>();
  const sheets: Sheet[] = [];

  for (const group of groups.values()) {
    // The template is the same for every document of the group, so the first one defines the columns.
    const head = group[0];
    const excelRows = head.excelRows;
    const singles = head.fields.filter((f) => f.kind === 'SINGLE');
    const templateColumns = excelRows
      ? [...excelRows].sort((a, b) => a.order - b.order).map((r) => r.column)
      : singles.map((f) => f.label);
    // Χωρίς EXCEL mapping οι στήλες ΕΙΝΑΙ τα SINGLE πεδία — και κάθε αντιστοιχισμένο πεδίο ζει
    // παράλληλα στο `custom[fieldKey]`. Χωρίς αυτή την αφαίρεση το ίδιο πεδίο θα έβγαινε δύο φορές:
    // μία με την ετικέτα του και μία με το κλειδί του.
    const singleKeys = new Set(singles.map((f) => f.key));
    const extras = customKeys(group.map((i) => i.document.custom))
      .filter((k) => excelRows != null || !singleKeys.has(k));

    const rows = group.map((i) => [
      i.file,
      ...DOCUMENT_COLUMNS.map((c) => cell(c.of(i.document))),
      ...(excelRows
        // projectToExcel only reads `.value`; the cast keeps SheetInput usable with any FieldValue-shaped map.
        ? projectToExcel(i.values as Record<string, FieldValue>, excelRows).row
        : singles.map((f) => cell(i.values[f.key]?.value))),
      ...extras.map((k) => cell(i.document.custom[k])),
    ]);
    const name = sheetName(head.templateName, used);
    sheets.push({ name, columns: [FILE_COL, ...DOCUMENT_COLUMNS.map((c) => c.label), ...templateColumns, ...extras], rows });

    // Built from the RAW template name, not from `name`: a name already at the 31-char cap would be
    // truncated straight back to `name` and collide with its own main sheet.
    const suffixed = (suffix: string) => sheetName(head.templateName.slice(0, MAX_NAME - suffix.length) + suffix, used);

    const lined = group.filter((i) => i.document.lines.length > 0);
    if (lined.length) {
      const lineExtras = customKeys(lined.flatMap((i) => i.document.lines.map((l) => l.custom)));
      sheets.push({
        name: suffixed(LINES_SUFFIX),
        columns: [FILE_COL, 'Α/Α', ...LINE_COLUMNS.map((c) => c.label), ...lineExtras],
        rows: lined.flatMap((i) =>
          i.document.lines.map((l, n) => [
            i.file, n + 1,
            ...LINE_COLUMNS.map((c) => cell(c.of(l))),
            ...lineExtras.map((k) => cell(l.custom[k])),
          ]),
        ),
      });
    }

    const vated = group.filter((i) => i.document.vatBreakdown.length > 0);
    if (vated.length) {
      sheets.push({
        name: suffixed(VAT_SUFFIX),
        columns: [FILE_COL, 'Συντελεστής', 'Καθαρή αξία', 'ΦΠΑ'],
        rows: vated.flatMap((i) => i.document.vatBreakdown.map((v) => [i.file, cell(v.rate), cell(v.net), cell(v.vat)])),
      });
    }
  }

  return sheets;
}
