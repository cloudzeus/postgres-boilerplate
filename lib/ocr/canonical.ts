// lib/ocr/canonical.ts — ISOMORPHIC, PURE (no prisma, no server-only, no React).
//
// Το κανονικό JSON εγγράφου (spec §17.1). Κάθε εκτέλεση — βασικό OCR ή πρότυπο — καταλήγει σε ΕΝΑ
// `document`: εκδότης, παραλήπτης, γραμμές, σύνολα, ΦΠΑ, ψηφιακή σήμανση, πληρωμή, αναφορές,
// χειρόγραφα και ένα `custom` για ό,τι δεν χωράει αλλού. Το SoftOne posting και το Excel διαβάζουν
// ΜΟΝΟ αυτό.
//
// Τα σημερινά flat κλειδιά (`OcrDocument.extractedData`) δεν φεύγουν: παράγονται από το έγγραφο με
// `toLegacy` ώστε λίστα / row-detail / ουρές / doc-type / softone-match να συνεχίσουν να δουλεύουν
// αμετάβλητα, και διαβάζονται πίσω με `fromLegacy` για τα έγγραφα που γράφτηκαν πριν από το plan 5.
import { z } from 'zod';
import { normalizeAfm } from '@/lib/ocr/validate';
import { reconcileInvoice } from '@/lib/ocr/invoice-math';

export const DOCUMENT_VERSION = 3 as const;

export type DocumentKind = 'invoice' | 'receipt' | 'general';
/** Ο τύπος εγγράφου όπως τον ξέρει το pipeline (`lib/ocr/templates.ts` DocType) — δομικά, χωρίς import. */
export type CanonicalDocType = 'invoice' | 'receipt' | 'general_text';
export type DocumentValueType = 'TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'LIST';

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * Αριθμός από ό,τι τύπωσε το παραστατικό: «1.234,56», «1,234.56», «24%», «1.234,56 €», «(500)».
 * Επιστρέφει null όταν δεν υπάρχει αριθμός — ΠΟΤΕ NaN.
 */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  s = s.replace(/[\s ]/g, '').replace(/[€$£%]/g, '').replace(/^\+/, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Ο τελευταίος διαχωριστής είναι το δεκαδικό κόμμα/τελεία· ο άλλος είναι χιλιάδες.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    s = parts.length > 2 || (parts[1] ?? '').length === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (s.split('.').length > 2) {
    s = s.replace(/\./g, '');              // 1.234.567 → χιλιάδες· ένα μόνο «.» μένει δεκαδικό
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const prepStr = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') { const t = v.trim(); return t === '' ? null : t; }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  return null;                              // booleans / objects / arrays δεν είναι κείμενο
};

const nstr = z.preprocess(prepStr, z.string().nullable()).default(null);
const nnum = z.preprocess(parseNumber, z.number().nullable()).default(null);
const nbool = z.preprocess(
  (v) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null),
  z.boolean().nullable(),
).default(null);
const objArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (Array.isArray(v) ? v.filter(isObj) : []), z.array(item)).default([]);
const strArray = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String) : []),
  z.array(z.string()),
).default([]);
const customRecord = z.preprocess((v) => (isObj(v) ? v : {}), z.record(z.string(), z.unknown())).default({});
// ΠΡΟΣΟΧΗ: `.default({})` στο zod 4 ΔΕΝ περνάει την προεπιλογή από το σχήμα — το `{}` θα έμενε άδειο.
// Γι' αυτό η προεπιλογή δίνεται μέσα στο preprocess, ώστε το inner object να γεμίσει τα δικά του nulls.
const nobj = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (isObj(v) ? v : {}), inner);

const Party = nobj(z.object({
  name: nstr, vat: nstr, doy: nstr, profession: nstr, address: nstr, city: nstr,
  zip: nstr, country: nstr, phone: nstr, email: nstr, gemi: nstr, code: nstr,
}));

const Line = z.object({
  code: nstr, name: nstr, unit: nstr, quantity: nnum, unitPrice: nnum, discount: nnum,
  net: nnum, vatRate: nnum, vatAmount: nnum, total: nnum, custom: customRecord,
});

export const DocumentSchema = z.object({
  kind: z.enum(['invoice', 'receipt', 'general']),
  type: nobj(z.object({ label: nstr, series: nstr, number: nstr, myDataType: nstr })),
  date: nstr,
  dueDate: nstr,
  currency: z.preprocess((v) => prepStr(v) ?? 'EUR', z.string()).default('EUR'),
  issuer: Party,
  recipient: Party,
  lines: objArray(Line),
  totals: nobj(z.object({
    net: nnum, discount: nnum, vatAmount: nnum, withholding: nnum, fees: nnum, total: nnum, payable: nnum,
  })),
  vatBreakdown: objArray(z.object({ rate: nnum, net: nnum, vat: nnum })),
  digital: nobj(z.object({ mark: nstr, uid: nstr, authCode: nstr, provider: nstr, qr: nbool })),
  payment: nobj(z.object({
    method: nstr, terms: nstr, ibans: objArray(z.object({ bank: nstr, iban: nstr })),
  })),
  references: nobj(z.object({
    orderNo: nstr, deliveryNote: nstr, contract: nstr, shipment: nstr,
    plates: strArray,
    period: z.preprocess((v) => (isObj(v) ? v : null), z.object({ from: nstr, to: nstr }).nullable()).default(null),
    quantities: objArray(z.object({ label: nstr, value: nnum, unit: nstr })),
  })),
  notes: nstr,
  handwritten: nobj(z.object({
    glAccount: nstr, reference: nstr, allocations: objArray(z.object({ label: nstr, amount: nnum })),
  })),
  custom: customRecord,
});

export type DocumentJson = z.infer<typeof DocumentSchema>;
export type DocumentLine = DocumentJson['lines'][number];

/** Ο φάκελος που κατεβάζει ο χρήστης / αποθηκεύεται στο `TemplateRun.output`. */
export type DocumentEnvelope = {
  template: string | null;
  version: typeof DOCUMENT_VERSION;
  extractedAt: string;
  file: string;
  documentId: string;
  document: DocumentJson;
};

// ─────────────────────────────────────────────────────────────────────────────
// Μητρώο διαδρομών
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentPathInfo = { path: string; label: string; valueType: DocumentValueType; isLine: boolean };

const h = (path: string, label: string, valueType: DocumentValueType = 'TEXT'): DocumentPathInfo =>
  ({ path, label, valueType, isLine: false });
const l = (path: string, label: string, valueType: DocumentValueType = 'TEXT'): DocumentPathInfo =>
  ({ path, label, valueType, isLine: true });

/** Κάθε διαδρομή που μπορεί να στοχεύσει ένα πεδίο προτύπου. `custom.<key>` γίνεται δεκτό δυναμικά. */
export const DOCUMENT_PATHS: DocumentPathInfo[] = [
  h('type.label', 'Τύπος παραστατικού'),
  h('type.series', 'Σειρά'),
  h('type.number', 'Αριθμός παραστατικού'),
  h('type.myDataType', 'Τύπος myDATA'),
  h('date', 'Ημερομηνία', 'DATE'),
  h('dueDate', 'Ημερομηνία λήξης', 'DATE'),
  h('currency', 'Νόμισμα'),
  h('issuer.name', 'Επωνυμία εκδότη'),
  h('issuer.vat', 'ΑΦΜ εκδότη'),
  h('issuer.doy', 'ΔΟΥ εκδότη'),
  h('issuer.profession', 'Επάγγελμα εκδότη'),
  h('issuer.address', 'Διεύθυνση εκδότη'),
  h('issuer.city', 'Πόλη εκδότη'),
  h('issuer.zip', 'ΤΚ εκδότη'),
  h('issuer.country', 'Χώρα εκδότη'),
  h('issuer.phone', 'Τηλέφωνο εκδότη'),
  h('issuer.email', 'Email εκδότη'),
  h('issuer.gemi', 'ΓΕΜΗ εκδότη'),
  h('recipient.name', 'Επωνυμία παραλήπτη'),
  h('recipient.vat', 'ΑΦΜ παραλήπτη'),
  h('recipient.doy', 'ΔΟΥ παραλήπτη'),
  h('recipient.profession', 'Επάγγελμα παραλήπτη'),
  h('recipient.address', 'Διεύθυνση παραλήπτη'),
  h('recipient.city', 'Πόλη παραλήπτη'),
  h('recipient.zip', 'ΤΚ παραλήπτη'),
  h('recipient.country', 'Χώρα παραλήπτη'),
  h('recipient.code', 'Κωδικός παραλήπτη'),
  h('totals.net', 'Καθαρή αξία', 'CURRENCY'),
  h('totals.discount', 'Έκπτωση', 'CURRENCY'),
  h('totals.vatAmount', 'ΦΠΑ', 'CURRENCY'),
  h('totals.withholding', 'Παρακράτηση', 'CURRENCY'),
  h('totals.fees', 'Επιβαρύνσεις', 'CURRENCY'),
  h('totals.total', 'Γενικό σύνολο', 'CURRENCY'),
  h('totals.payable', 'Πληρωτέο', 'CURRENCY'),
  h('digital.mark', 'ΜΑΡΚ ΑΑΔΕ'),
  h('digital.uid', 'UID ΑΑΔΕ'),
  h('digital.authCode', 'Κωδικός αυθεντικοποίησης'),
  h('digital.provider', 'Πάροχος ηλεκτρονικής τιμολόγησης'),
  h('payment.method', 'Τρόπος πληρωμής'),
  h('payment.terms', 'Όροι πληρωμής'),
  h('references.orderNo', 'Αριθμός παραγγελίας'),
  h('references.deliveryNote', 'Δελτίο αποστολής'),
  h('references.contract', 'Σύμβαση'),
  h('references.shipment', 'Αποστολή'),
  h('references.period.from', 'Περίοδος από', 'DATE'),
  h('references.period.to', 'Περίοδος έως', 'DATE'),
  h('notes', 'Σημειώσεις'),
  h('handwritten.glAccount', 'Χειρόγραφο: λογαριασμός'),
  h('handwritten.reference', 'Χειρόγραφο: αναφορά'),
  l('lines.code', 'Γραμμή: κωδικός'),
  l('lines.name', 'Γραμμή: περιγραφή'),
  l('lines.unit', 'Γραμμή: μονάδα'),
  l('lines.quantity', 'Γραμμή: ποσότητα', 'NUMBER'),
  l('lines.unitPrice', 'Γραμμή: τιμή μονάδας', 'CURRENCY'),
  l('lines.discount', 'Γραμμή: έκπτωση', 'NUMBER'),
  l('lines.net', 'Γραμμή: καθαρή αξία', 'CURRENCY'),
  l('lines.vatRate', 'Γραμμή: ΦΠΑ %', 'NUMBER'),
  l('lines.vatAmount', 'Γραμμή: ΦΠΑ', 'CURRENCY'),
  l('lines.total', 'Γραμμή: σύνολο', 'CURRENCY'),
];

const PATH_SET = new Set(DOCUMENT_PATHS.map((p) => p.path));

/** Τα παλιά flat κλειδιά του `extractedData` / του INVOICE mapping → διαδρομή του κανονικού εγγράφου. */
export const LEGACY_KEY_TO_PATH: Record<string, string> = {
  companyName: 'issuer.name',
  storeName: 'issuer.name',
  vatNumber: 'issuer.vat',
  companyAddress: 'issuer.address',
  companyDoy: 'issuer.doy',
  companyProfession: 'issuer.profession',
  companyPhone: 'issuer.phone',
  phone: 'issuer.phone',
  companyEmail: 'issuer.email',
  email: 'issuer.email',
  customerName: 'recipient.name',
  customerVatNumber: 'recipient.vat',
  customerAddress: 'recipient.address',
  customerDoy: 'recipient.doy',
  customerProfession: 'recipient.profession',
  documentTypeLabel: 'type.label',
  invoiceNumber: 'type.number',
  aadeMark: 'digital.mark',
  date: 'date',
  time: 'custom.time',
  itemsCount: 'custom.itemsCount',
  subtotal: 'totals.net',
  vatAmount: 'totals.vatAmount',
  totalAmount: 'totals.total',
  'items.code': 'lines.code',
  'items.name': 'lines.name',
  'items.quantity': 'lines.quantity',
  'items.price': 'lines.unitPrice',
  'items.discount': 'lines.discount',
  'items.vatRate': 'lines.vatRate',
  'items.total': 'lines.net',
};

/** `customFields.<slug>` → `custom.<slug>`· κανονική διαδρομή → η ίδια· άγνωστο → null. */
export function legacyKeyToPath(key: string): string | null {
  const mapped = LEGACY_KEY_TO_PATH[key];
  if (mapped) return mapped;
  const m = /^customFields\.([a-z0-9_]+)$/.exec(key);
  if (m) return `custom.${m[1]}`;
  if (PATH_SET.has(key) || /^custom\.[a-z0-9_]+$/.test(key)) return key;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Βοηθοί διαδρομών
// ─────────────────────────────────────────────────────────────────────────────

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function walk(root: unknown, segs: string[]): unknown {
  let cur: unknown = root;
  for (const s of segs) {
    if (!isObj(cur)) return null;
    cur = cur[s];
  }
  return cur ?? null;
}

/** Τιμή σε διαδρομή. `lines.*` επιστρέφει τον πίνακα των τιμών, μία ανά γραμμή. */
export function getPath(doc: DocumentJson, path: string): unknown {
  const segs = path.split('.').filter(Boolean);
  if (!segs.length) return null;
  if (segs[0] === 'lines') return doc.lines.map((line) => walk(line, segs.slice(1)));
  return walk(doc, segs);
}

/** Νέο έγγραφο με τη διαδρομή γραμμένη (τα ενδιάμεσα objects δημιουργούνται). Το input μένει άθικτο. */
export function setPath(doc: DocumentJson, path: string, value: unknown): DocumentJson {
  const segs = path.split('.').filter(Boolean);
  if (!segs.length) throw new Error('setPath: κενή διαδρομή');
  if (segs.some((s) => UNSAFE_SEGMENTS.has(s))) throw new Error(`setPath: μη επιτρεπτή διαδρομή «${path}»`);
  if (segs[0] === 'lines') throw new Error(`setPath: η «${path}» είναι διαδρομή γραμμής — γράψε το lines[] ολόκληρο`);
  const root: Record<string, unknown> = { ...(doc as unknown as Record<string, unknown>) };
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const child = cur[segs[i]];
    cur[segs[i]] = isObj(child) ? { ...child } : {};
    cur = cur[segs[i]] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
  return root as unknown as DocumentJson;
}

// ─────────────────────────────────────────────────────────────────────────────
// Δημιουργία / ανίχνευση
// ─────────────────────────────────────────────────────────────────────────────

export function emptyDocument(kind: DocumentKind): DocumentJson {
  return DocumentSchema.parse({ kind });
}

/** Μοιάζει με κανονικό έγγραφο (σε αντίθεση με το παλιό flat payload); */
export function isCanonical(raw: unknown): boolean {
  if (!isObj(raw)) return false;
  return typeof raw.kind === 'string'
    || isObj(raw.issuer) || isObj(raw.recipient) || isObj(raw.totals)
    || isObj(raw.digital) || isObj(raw.handwritten) || Array.isArray(raw.lines);
}

const kindFromDocType = (docType?: CanonicalDocType): DocumentKind =>
  docType === 'general_text' ? 'general' : docType === 'receipt' ? 'receipt' : 'invoice';

const has = (v: unknown) => v != null && String(v).trim() !== '';

/** «Έχει παραλήπτη» → τιμολόγιο· αλλιώς απόδειξη. Το general_text αποφασίζεται από τον τύπο. */
function deriveKind(raw: Record<string, unknown>, docType?: CanonicalDocType): DocumentKind {
  if (docType === 'general_text') return 'general';
  const k = raw.kind;
  if (k === 'invoice' || k === 'receipt' || k === 'general') return k;
  const recipient = isObj(raw.recipient) ? raw.recipient : {};
  const hasRecipient = has(recipient.name) || has(recipient.vat) || has(raw.customerName) || has(raw.customerVatNumber);
  return hasRecipient ? 'invoice' : 'receipt';
}

/** Ανεκτικό parse: ποτέ δεν πετάει — ό,τι δεν περνάει το σχήμα γίνεται null / άδειο. */
function parseLoose(raw: Record<string, unknown>, kind: DocumentKind): DocumentJson {
  const parsed = DocumentSchema.safeParse({ ...raw, kind });
  if (parsed.success) return parsed.data;
  // Δεύτερη προσπάθεια χωρίς τα containers που απέτυχαν — δεν χάνουμε ολόκληρο το έγγραφο για ένα πεδίο.
  const stripped: Record<string, unknown> = { kind };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'kind') continue;
    const attempt = DocumentSchema.safeParse({ ...stripped, [key]: value });
    if (attempt.success) stripped[key] = value;
  }
  const final = DocumentSchema.safeParse(stripped);
  return final.success ? final.data : emptyDocument(kind);
}

/**
 * Ό,τι γύρισε το μοντέλο (ή ό,τι είναι αποθηκευμένο) → έγκυρο κανονικό έγγραφο.
 * Κανονικό σχήμα → επικύρωση· παλιό flat → `fromLegacy`· σκουπίδια → άδειο έγγραφο.
 */
export function coerceDocument(raw: unknown, docType?: CanonicalDocType): DocumentJson {
  if (!isObj(raw)) return emptyDocument(kindFromDocType(docType));
  if (!isCanonical(raw)) return fromLegacy(raw, raw.items as unknown[] | undefined, docType);
  return parseLoose(raw, deriveKind(raw, docType));
}

// ─────────────────────────────────────────────────────────────────────────────
// Γέφυρες legacy ↔ κανονικό
// ─────────────────────────────────────────────────────────────────────────────

/** Κλειδιά του `custom` που έχουν δικό τους legacy όνομα στο `extractedData`. */
const PROMOTED_CUSTOM = ['time', 'itemsCount', 'title', 'fullText', 'summary', 'keywords'] as const;
const LEGACY_ITEM_KEYS = new Set(['code', 'name', 'quantity', 'price', 'discount', 'vatRate', 'total', 'unit']);
const HANDLED_LEGACY_KEYS = new Set([
  ...Object.keys(LEGACY_KEY_TO_PATH).filter((k) => !k.startsWith('items.')),
  'items', 'bankAccounts', 'customFields',
]);

/** Μια γραμμή του παλιού `items[]` → γραμμή του κανονικού εγγράφου. */
function lineFromLegacyItem(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  const net = parseNumber(raw.total);
  const rate = parseNumber(raw.vatRate);
  const vatAmount = net != null && rate != null ? round2((net * rate) / 100) : null;
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!LEGACY_ITEM_KEYS.has(k)) custom[k] = v;
  return {
    code: raw.code ?? null,
    name: raw.name ?? null,
    unit: raw.unit ?? null,
    quantity: raw.quantity ?? null,
    unitPrice: raw.price ?? null,
    discount: raw.discount ?? null,
    net,
    vatRate: rate,
    vatAmount,
    total: net != null ? round2(net + (vatAmount ?? 0)) : null,
    custom,
  };
}

/**
 * Παλιό flat `extractedData` (+ γραμμές) → κανονικό έγγραφο. Τίποτα δεν χάνεται: κλειδιά που δεν
 * έχουν διαδρομή καταλήγουν στο `custom`.
 */
export function fromLegacy(
  flat: Record<string, unknown> | null | undefined,
  items?: unknown[] | null,
  docType?: CanonicalDocType,
): DocumentJson {
  const f = isObj(flat) ? flat : {};
  const kind: DocumentKind = docType === 'general_text'
    ? 'general'
    : has(f.customerName) || has(f.customerVatNumber) ? 'invoice' : 'receipt';

  const custom: Record<string, unknown> = {};
  if (isObj(f.customFields)) Object.assign(custom, f.customFields);
  for (const [k, v] of Object.entries(f)) {
    if (HANDLED_LEGACY_KEYS.has(k)) continue;
    custom[k] = v;
  }
  if (f.time != null) custom.time = f.time;
  if (f.itemsCount != null) custom.itemsCount = f.itemsCount;

  const rawItems = Array.isArray(items) ? items : Array.isArray(f.items) ? (f.items as unknown[]) : [];
  const lines = rawItems.map(lineFromLegacyItem).filter((x): x is Record<string, unknown> => x != null);
  const total = parseNumber(f.totalAmount);

  return parseLoose({
    kind,
    type: { label: f.documentTypeLabel, number: f.invoiceNumber },
    date: f.date,
    issuer: {
      name: f.companyName ?? f.storeName,
      vat: f.vatNumber,
      doy: f.companyDoy,
      profession: f.companyProfession,
      address: f.companyAddress,
      phone: f.companyPhone ?? f.phone,
      email: f.companyEmail ?? f.email,
    },
    recipient: {
      name: f.customerName,
      vat: f.customerVatNumber,
      doy: f.customerDoy,
      profession: f.customerProfession,
      address: f.customerAddress,
    },
    lines,
    totals: { net: f.subtotal, vatAmount: f.vatAmount, total, payable: total },
    digital: { mark: f.aadeMark },
    payment: { ibans: Array.isArray(f.bankAccounts) ? f.bankAccounts : [] },
    notes: kind === 'general' ? (custom.summary ?? null) : null,
    custom,
  }, kind);
}

/** Κανονικό έγγραφο → τα σημερινά flat κλειδιά του `extractedData` (συμβατότητα). */
export function toLegacy(document: DocumentJson): Record<string, unknown> {
  const custom = { ...document.custom };
  const promoted: Record<string, unknown> = {};
  for (const k of PROMOTED_CUSTOM) {
    if (k in custom) { promoted[k] = custom[k]; delete custom[k]; }
  }
  const out: Record<string, unknown> = {};

  if (document.kind === 'general') {
    out.title = promoted.title ?? null;
    out.fullText = promoted.fullText ?? null;
    out.summary = promoted.summary ?? document.notes ?? null;
    out.keywords = promoted.keywords ?? [];
  } else {
    out.companyName = document.issuer.name;
    out.vatNumber = document.issuer.vat;
    out.companyAddress = document.issuer.address;
    out.companyDoy = document.issuer.doy;
    out.companyProfession = document.issuer.profession;
    out.companyPhone = document.issuer.phone;
    out.companyEmail = document.issuer.email;
    out.customerName = document.recipient.name;
    out.customerVatNumber = document.recipient.vat;
    out.customerAddress = document.recipient.address;
    out.customerDoy = document.recipient.doy;
    out.customerProfession = document.recipient.profession;
    out.documentTypeLabel = document.type.label;
    out.invoiceNumber = document.type.number;
    out.aadeMark = document.digital.mark;
    out.date = document.date;
    out.time = promoted.time ?? null;
    out.itemsCount = promoted.itemsCount ?? null;
    out.subtotal = document.totals.net;
    out.vatAmount = document.totals.vatAmount;
    out.totalAmount = document.totals.total;
    out.bankAccounts = document.payment.ibans.map((b) => ({ bank: b.bank, iban: b.iban }));
    out.items = document.lines.map((line) => ({
      ...line.custom,
      code: line.code,
      name: line.name ?? '',
      quantity: line.quantity,
      price: line.unitPrice,
      discount: line.discount,
      vatRate: line.vatRate,
      total: line.net,
    }));
  }
  if (Object.keys(custom).length) out.customFields = custom;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Κανονικοποίηση + αριθμητική συμφωνία
// ─────────────────────────────────────────────────────────────────────────────

/** «22/06/2026» / «1.7.2026» / «2026-06-22T00:00» → «2026-06-22». Ό,τι δεν αναγνωρίζεται μένει ως έχει. */
export function normalizeDate(value: unknown): string | null {
  const s = prepStr(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(s);
  if (!m) return s;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (day < 1 || day > 31 || month < 1 || month > 12) return s;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Επικύρωση + καθάρισμα: ΑΦΜ, ημερομηνίες, αριθμοί από κείμενο, νόμισμα, trim. Ιδεμποτητικό. */
export function normalizeDocument(raw: unknown): DocumentJson {
  const doc = isObj(raw) ? parseLoose(raw, deriveKind(raw)) : emptyDocument('invoice');
  const afm = (v: string | null) => (v == null ? null : normalizeAfm(v) ?? v);
  return {
    ...doc,
    date: normalizeDate(doc.date),
    dueDate: normalizeDate(doc.dueDate),
    issuer: { ...doc.issuer, vat: afm(doc.issuer.vat) },
    recipient: { ...doc.recipient, vat: afm(doc.recipient.vat) },
    references: {
      ...doc.references,
      period: doc.references.period
        ? { from: normalizeDate(doc.references.period.from), to: normalizeDate(doc.references.period.to) }
        : null,
    },
  };
}

export type DocumentChecks = {
  /** Σ(γραμμές) vs τυπωμένη καθαρή αξία — null όταν λείπει κάποιο από τα δύο. */
  linesVsNet: boolean | null;
  vatOk: boolean | null;
  totalOk: boolean | null;
};

/**
 * Συμπληρώνει ό,τι λείπει από τα σύνολα με βάση τις γραμμές και επιστρέφει τους ελέγχους συμφωνίας.
 * ΠΟΤΕ δεν γράφει πάνω σε τυπωμένη τιμή — ο έλεγχος αναφέρει τη διαφορά, δεν τη «διορθώνει».
 */
export function reconcileDocument(document: DocumentJson): { document: DocumentJson; checks: DocumentChecks } {
  const rec = reconcileInvoice({
    items: document.lines.map((l) => ({
      quantity: l.quantity, price: l.unitPrice, discount: l.discount, vatRate: l.vatRate, total: l.net,
    })),
    subtotal: document.totals.net,
    vatAmount: document.totals.vatAmount,
    totalAmount: document.totals.total,
  });

  const hasLines = document.lines.length > 0;
  const net = document.totals.net ?? (hasLines ? rec.sumNet : null);
  const vatAmount = document.totals.vatAmount ?? (rec.vatGroups.length ? rec.vatComputed : null);
  const total = document.totals.total ?? (net != null && vatAmount != null ? round2(net + vatAmount) : null);
  const payable = document.totals.payable
    ?? (total != null ? round2(total - (document.totals.withholding ?? 0) + (document.totals.fees ?? 0)) : null);

  return {
    document: {
      ...document,
      totals: { ...document.totals, net, vatAmount, total, payable },
      vatBreakdown: document.vatBreakdown.length
        ? document.vatBreakdown
        : rec.vatGroups.map((g) => ({ rate: g.rate, net: g.net, vat: g.vat })),
    },
    checks: {
      linesVsNet: hasLines ? rec.linesVsSubtotal?.ok ?? null : null,
      vatOk: hasLines ? rec.vatOk : null,
      totalOk: rec.totalOk,
    },
  };
}
