// lib/ocr/document.ts — SERVER. Ο ΜΟΝΟΣ γραφέας του κανονικού εγγράφου και των παραγώγων του.
//
// Κάθε γράψιμο στο `OcrDocument.document` περνάει από εδώ, και μαζί του — στο ΙΔΙΟ transaction —
// γράφονται τα παράγωγα ώστε να μην αποκλίνουν ποτέ:
//   • `extractedData` = `toLegacy(document)`  (λίστα, row-detail, ουρές, doc-type, softone-match)
//   • `issuerAfm`     = `normalizeAfm(document.issuer.vat)`  (indexed φίλτρο ουρών)
//   • `OcrInvoiceItem` γραμμές από το `document.lines` (προαιρετικά), με το SoftOne match να
//     μεταφέρεται στη νέα γραμμή — μια αντιστοίχιση που έκανε άνθρωπος με το χέρι δεν χάνεται.
import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizeAfm } from '@/lib/ocr/validate';
import {
  docTypeOf, fromLegacy, legacyKeyToPath, normalizeDocument, setPath, toLegacy, UNSAFE_SEGMENTS,
  type CanonicalDocType, type DocumentJson, type DocumentLine,
} from '@/lib/ocr/canonical';

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
const has = (v: unknown) => v != null && String(v).trim() !== '';

// Ο μεταφραστής του τύπου εγγράφου ζει στο καθαρό `canonical.ts` (τον χρειάζεται και ο εξαγωγέας
// του Excel, που δεν φορτώνει Prisma) — εδώ μόνο ξανα-εξάγεται, ώστε οι σημερινοί καλούντες να μην
// χρειαστεί να αλλάξουν import.
export { docTypeOf };

// ─────────────────────────────────────────────────────────────────────────────
// Γραμμές: κανονικό `lines[]` ↔ `OcrInvoiceItem`
// ─────────────────────────────────────────────────────────────────────────────

export type ItemRow = {
  rowIndex: number; code: string | null; name: string;
  quantity: number | null; price: number | null; discount: number | null;
  vatRate: number | null; total: number | null;
};

/** `document.lines` → γραμμές `OcrInvoiceItem` (η στήλη `price` είναι το `unitPrice`, η `total` το `net`). */
export function linesToRows(lines: DocumentLine[]): ItemRow[] {
  return lines.map((line, rowIndex) => ({
    rowIndex,
    code: line.code,
    name: line.name ?? '',
    quantity: line.quantity,
    price: line.unitPrice,
    discount: line.discount,
    vatRate: line.vatRate,
    total: line.net,
  }));
}

/** Το SoftOne match μιας γραμμής — ακριβό να υπολογιστεί, και καμιά φορά φτιαγμένο ΜΕ ΤΟ ΧΕΡΙ. */
export type SoftoneCarry = {
  softoneMtrl: number | null; softoneExpn: number | null; softoneCode: string | null;
  softoneName: string | null; softoneIsService: boolean | null; softoneMatchedBy: string | null;
};
export type SoftoneColumns = SoftoneCarry & { rowIndex: number; code: string | null; name: string | null };

export const CARRY_SELECT = {
  rowIndex: true, code: true, name: true,
  softoneMtrl: true, softoneExpn: true, softoneCode: true, softoneName: true,
  softoneIsService: true, softoneMatchedBy: true,
} as const;

const NO_CARRY: SoftoneCarry = {
  softoneMtrl: null, softoneExpn: null, softoneCode: null, softoneName: null,
  softoneIsService: null, softoneMatchedBy: null,
};
const carryOf = (o: SoftoneColumns): SoftoneCarry => ({
  softoneMtrl: o.softoneMtrl, softoneExpn: o.softoneExpn, softoneCode: o.softoneCode,
  softoneName: o.softoneName, softoneIsService: o.softoneIsService, softoneMatchedBy: o.softoneMatchedBy,
});

/**
 * Ζευγαρώνει κάθε ξαναχτισμένη γραμμή με τη γραμμή που αντικαθιστά, ώστε το SoftOne match να επιβιώσει.
 * Πρώτα το ίδιο `rowIndex` (η ίδια εξαγωγή στο ίδιο έγγραφο βγάζει τις ίδιες γραμμές με την ίδια σειρά)
 * — αλλά μόνο όταν ο κωδικός ΚΑΙ η περιγραφή δεν διαψεύδουν ο ένας τον άλλον, γιατί το να κουβαλήσεις
 * ένα MTRL σε γραμμή που είναι πλέον ΑΛΛΟ είδος θα καταχωρούσε λάθος είδος. Αλλιώς, η γραμμή με τον
 * ίδιο κωδικό όπου κι αν μετακινήθηκε.
 */
export function carryForward(rows: ItemRow[], old: SoftoneColumns[]): SoftoneCarry[] {
  const byIndex = new Map(old.map((o) => [o.rowIndex, o]));
  const byCode = new Map(old.filter((o) => (o.code ?? '').trim()).map((o) => [(o.code ?? '').trim(), o]));
  return rows.map((r) => {
    const code = (r.code ?? '').trim();
    const name = (r.name ?? '').trim();
    const sameIndex = byIndex.get(r.rowIndex);
    const oldCode = (sameIndex?.code ?? '').trim();
    const oldName = (sameIndex?.name ?? '').trim();
    const codeAgrees = !code || !oldCode || code === oldCode;
    const nameAgrees = !name || !oldName || name === oldName;
    const hit = sameIndex && codeAgrees && nameAgrees ? sameIndex : (code ? byCode.get(code) : undefined);
    return hit ? carryOf(hit) : { ...NO_CARRY };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ανάγνωση / γράψιμο
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Το κανονικό έγγραφο. Για εγγραφές που γράφτηκαν πριν από το plan 5 (`document IS NULL`) χτίζεται
 * επιτόπου από το `extractedData` + τις γραμμές — ίδιο αποτέλεσμα με το backfill, χωρίς να γράφει.
 */
export async function loadDocumentJson(documentId: string): Promise<DocumentJson> {
  const doc = await prisma.ocrDocument.findUnique({
    where: { id: documentId },
    select: { document: true, extractedData: true, docType: true },
  });
  if (!doc) throw new Error('document not found');
  const docType = docTypeOf(doc.docType);
  if (isObj(doc.document)) return normalizeDocument(doc.document);
  const items = await prisma.ocrInvoiceItem.findMany({
    where: { documentId },
    orderBy: { rowIndex: 'asc' },
    select: { code: true, name: true, quantity: true, price: true, discount: true, vatRate: true, total: true },
  });
  return fromLegacy(isObj(doc.extractedData) ? doc.extractedData : {}, items, docType);
}

export type SaveDocumentOptions = {
  /** Ξαναχτίζει τις γραμμές `OcrInvoiceItem` από το `document.lines`. Χωρίς αυτό οι γραμμές μένουν ως έχουν. */
  replaceItems?: boolean;
};

/**
 * Γράφει το κανονικό έγγραφο και ΟΛΑ τα παράγωγά του σε ένα transaction.
 *
 * Το έγγραφο περνάει από `normalizeDocument` πρώτα: είναι το τελευταίο σημείο πριν τη βάση, και το
 * `extractedData` με το `issuerAfm` δεν επιτρέπεται να διαφωνούν για το ίδιο ΑΦΜ.
 *
 * ΣΗΜΕΙΩΣΗ: δεν τρέχει αντιστοίχιση SoftOne — όποιος αντικαθιστά γραμμές πρέπει να καλέσει
 * `matchDocItems(documentId)` μετά, ώστε τα `itemsTotal`/`itemsMatched` να μην περιγράφουν
 * γραμμές που μόλις διαγράφηκαν.
 */
export async function saveDocumentJson(
  documentId: string,
  input: DocumentJson,
  opts: SaveDocumentOptions = {},
): Promise<void> {
  const document = normalizeDocument(input);
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const data: Prisma.OcrDocumentUpdateInput = {
    document: document as unknown as Prisma.InputJsonValue,
    extractedData: toLegacy(document) as Prisma.InputJsonValue,
    issuerAfm: normalizeAfm(document.issuer.vat),
  };

  if (opts.replaceItems) {
    // Οι γραμμές αντικαθίστανται ολόκληρες, άρα ό,τι δεν ξαναγράφεται χάνεται — γι' αυτό το
    // SoftOne match διαβάζεται ΠΡΙΝ και μεταφέρεται στις νέες γραμμές.
    const old = (await prisma.ocrInvoiceItem
      .findMany({ where: { documentId }, select: CARRY_SELECT })
      .catch(() => [])) as SoftoneColumns[];
    const rows = linesToRows(document.lines);
    const carried = carryForward(rows, old);
    ops.push(prisma.ocrInvoiceItem.deleteMany({ where: { documentId } }));
    if (rows.length) {
      ops.push(prisma.ocrInvoiceItem.createMany({
        data: rows.map((r, i) => ({ ...r, ...carried[i], documentId })),
      }));
    }
  }

  await prisma.$transaction([prisma.ocrDocument.update({ where: { id: documentId }, data }), ...ops]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy patch → κανονικό έγγραφο
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Επιτρεπτό κλειδί `custom.<key>`. Το `UNSAFE_SEGMENTS` κόβει τα `__proto__` / `constructor` /
 * `prototype`: το `JSON.parse` τα φτιάχνει ως ΚΑΝΟΝΙΚΑ κλειδιά, περνούν το regex, και το `setPath`
 * τα απορρίπτει πετώντας — δηλαδή ένα σώμα PATCH θα γινόταν 500 αντί για «αγνοήθηκε».
 */
const SAFE_CUSTOM_KEY = /^[A-Za-z0-9_]{1,60}$/;
const isSafeCustomKey = (key: string) => SAFE_CUSTOM_KEY.test(key) && !UNSAFE_SEGMENTS.has(key);

/**
 * Ένας παλιός client που στέλνει `{ extractedData, items }` ξέρει μόνο τα flat κλειδιά. Αν γράφαμε
 * το `fromLegacy` του αποτέλεσμα κατευθείαν, θα έσβηνε ό,τι δεν ξέρει να πει (ψηφιακή σήμανση,
 * πληρωμή, αναφορές, χειρόγραφα). Εδώ επικαλύπτονται ΜΟΝΟ τα κλειδιά που όντως ήρθαν.
 */
export function mergeLegacyPatch(
  existing: DocumentJson,
  extractedData: unknown,
  items?: unknown[] | null,
  /** Ο τύπος που ορίζει το ΙΔΙΟ PATCH, όταν το αλλάζει (`docType: 'GENERAL_TEXT'`). */
  nextDocType?: CanonicalDocType | null,
): DocumentJson {
  const flat = isObj(extractedData) ? extractedData : {};
  const docType: CanonicalDocType = nextDocType
    ?? (existing.kind === 'general' ? 'general_text' : existing.kind);
  const patch = fromLegacy(flat, items, docType);

  let out = existing;
  for (const key of Object.keys(flat)) {
    if (key === 'items' || key === 'bankAccounts' || key === 'customFields') continue;
    const path = legacyKeyToPath(key);
    if (path) {
      if (path.startsWith('lines.')) continue;                  // οι γραμμές γράφονται μόνο ολόκληρες
      const segs = path.split('.');
      let value: unknown = patch;
      for (const s of segs) value = isObj(value) ? value[s] : undefined;
      out = setPath(out, path, value ?? null);
    } else if (isSafeCustomKey(key)) {
      out = setPath(out, `custom.${key}`, flat[key]);
    }
  }
  if (isObj(flat.customFields)) {
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(flat.customFields)) if (isSafeCustomKey(k)) extra[k] = patch.custom[k];
    out = { ...out, custom: { ...out.custom, ...extra } };
  }
  if (Array.isArray(flat.bankAccounts)) out = setPath(out, 'payment.ibans', patch.payment.ibans);
  if (Array.isArray(items) || Array.isArray(flat.items)) out = { ...out, lines: patch.lines };

  // Ο παραλήπτης είναι το σήμα τιμολόγιο/απόδειξη (όπως το `inferDocKind`). Ένα γενικό μένει γενικό
  // — εκτός αν το ίδιο το PATCH άλλαξε τον τύπο του εγγράφου, οπότε εκείνο έχει τον λόγο.
  const general = nextDocType ? nextDocType === 'general_text' : out.kind === 'general';
  const kind = general
    ? 'general'
    : has(out.recipient.name) || has(out.recipient.vat) ? 'invoice' : 'receipt';

  return normalizeDocument({ ...out, kind });
}
