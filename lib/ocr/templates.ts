// OCR engine configuration: supported languages + document schemas.
// Edit this file to add new templates or localization targets.

export const SUPPORTED_LANGUAGES = {
  el: { label: 'Ελληνικά', instruction: 'Extract data in Greek language where appropriate. Translate generic terms to Greek.' },
  en: { label: 'English',  instruction: 'Extract data in English language where appropriate. Translate generic terms to English.' },
  de: { label: 'Deutsch',  instruction: 'Extract data in German language where appropriate. Translate generic terms to German.' },
} as const;

export type SupportedLang = keyof typeof SUPPORTED_LANGUAGES;

export type DocType = 'invoice' | 'receipt' | 'general_text';

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice: 'Τιμολόγιο (Invoice)',
  receipt: 'Απόδειξη (Receipt)',
  general_text: 'Ελεύθερο κείμενο (General text)',
};

interface TemplateSchema {
  systemInstructions: string;
  jsonStructure: string;
}

export const TEMPLATE_SCHEMAS: Record<DocType, TemplateSchema> = {
  invoice: {
    systemInstructions: 'You are an expert system specialized in Greek financial documents (invoices AND retail receipts). They contain an issuer (ΕΚΔΟΤΗΣ — the supplier / the store) and, on invoices, a recipient (ΠΑΡΑΛΗΠΤΗΣ / Πελάτης — the customer / buyer). Extract EVERY field you can see — even on a simple retail receipt, capture the issuer/store details. CUSTOMER/RECIPIENT RULE: the recipient is the buyer; if the document has NO recipient/customer block at all, it is a retail receipt (ΑΠΟΔΕΙΞΗ), you MUST set `kind` to "receipt" and leave every `recipient` field null — never invent or copy the issuer into the recipient slot. DOCUMENT TYPE: ALWAYS capture the printed document type EXACTLY as written (almost always at the top), into `type.label` — e.g. «ΤΙΜΟΛΟΓΙΟ», «ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ», «ΤΙΜΟΛΟΓΙΟ – ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ», «ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ», «ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ» — and split the printed document number into `type.series` (letters/prefix) and `type.number` (digits). BANK DETAILS: ALWAYS look for the ISSUER\'s bank account details (ΤΡΑΠΕΖΑ / IBAN), usually printed in the footer or payment-terms area, and list EVERY one found in `payment.ibans`. Match visual rows accurately: every line of the goods/services table becomes one entry in `lines`, with its net value (before VAT) in `net`. Always extract the net amount before VAT, the VAT amount and the grand total separately — ΚΑΘΑΡΗ ΑΞΙΑ / ΣΥΝΟΛΟ ΦΠΑ / ΓΕΝΙΚΟ ΣΥΝΟΛΟ — into `totals.net` / `totals.vatAmount` / `totals.total`, plus `totals.withholding` (ΠΑΡΑΚΡΑΤΗΣΗ), `totals.fees` (ΕΠΙΒΑΡΥΝΣΕΙΣ / ΤΕΛΗ) and `totals.payable` (ΠΛΗΡΩΤΕΟ) when printed. Also extract the ISSUER\'s phone (ΤΗΛ / Τηλέφωνο) and email when printed (only the issuer\'s). Capture the myDATA digital signature block (ΜΑΡΚ, UID, κωδικός αυθεντικοποίησης, provider) in `digital`. HANDWRITTEN: if anything is written by hand on the document (a ledger account, a reference, an allocation of the amount), read it into `handwritten` — never mix it with the printed fields. For retail receipts also capture the time and the number of items if printed, inside `custom`. If a field is missing, output null — never guess. FOREIGN ISSUERS: when the issuer is NOT Greek, KEEP the country prefix in `issuer.vat` exactly as printed (e.g. DE144960040, CY10123456A, IE6388047V) — do not strip it and do not invent one; for Greek issuers output the 9 digits only, without the EL/GR prefix. ADDRESSES: when an address is printed on several lines, join them with ", " (comma + space) — never concatenate the lines without a separator.',
    jsonStructure: `{
  "kind": "invoice | receipt",  // "invoice" when the document has a recipient/customer block, else "receipt"
  "type": {
    "label": "string or null (the EXACT printed παραστατικό type, VERBATIM — e.g. ΤΙΜΟΛΟΓΙΟ, ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ, ΤΙΜΟΛΟΓΙΟ – ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ, ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ, ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ)",
    "series": "string or null (ΣΕΙΡΑ — the letter/prefix part of the document number; «ΤΠΥ 17» → \\"ΤΠΥ\\")",
    "number": "string (ΑΡΙΘΜΟΣ — the numeric part only; «ΤΠΥ 17» → \\"17\\")",
    "myDataType": "string or null (myDATA type code if printed, e.g. 1.1, 2.1)"
  },
  "date":     "string (issue date, YYYY-MM-DD)",
  "dueDate":  "string or null (ΛΗΞΗ / payment due date, YYYY-MM-DD)",
  "currency": "string (ISO code, default EUR)",
  "issuer": {                   // ΕΚΔΟΤΗΣ — supplier / store that issued the document
    "name": "string", "vat": "string (ΑΦΜ; keep the country prefix for foreign issuers, e.g. DE123456789)",
    "doy": "string or null", "profession": "string or null (ΕΠΑΓΓΕΛΜΑ / activity)",
    "address": "string or null", "city": "string or null", "zip": "string or null", "country": "string or null",
    "phone": "string or null (ΤΗΛ — only if printed)", "email": "string or null (only if printed)",
    "gemi": "string or null (ΓΕΜΗ)", "code": "string or null"
  },
  "recipient": {                // ΠΑΡΑΛΗΠΤΗΣ / Πελάτης — the buyer. Leave EVERY field null on a retail receipt.
    "name": "string or null", "vat": "string or null (ΑΦΜ; keep the country prefix for foreign buyers)",
    "doy": "string or null", "profession": "string or null (ΕΠΑΓΓΕΛΜΑ / activity)",
    "address": "string or null", "city": "string or null", "zip": "string or null", "country": "string or null",
    "phone": "string or null (only if printed)", "email": "string or null (only if printed)",
    "gemi": "string or null (ΓΕΜΗ)", "code": "string or null"
  },
  "lines": [                    // one entry per printed line of goods/services; [] if the document has no line table
    {
      "code": "string or null (ΚΩΔΙΚΟΣ)",
      "name": "string (ΠΕΡΙΓΡΑΦΗ)",
      "unit": "string or null (ΜΟΝΑΔΑ — ΤΕΜ, ΚΙΛΑ, ΩΡΕΣ…)",
      "quantity": number,
      "unitPrice": number,      // ΤΙΜΗ ΜΟΝΑΔΑΣ
      "discount": number,       // line discount (% or amount, as printed)
      "net": number,            // ΚΑΘΑΡΗ ΑΞΙΑ of the line — BEFORE VAT
      "vatRate": number,        // ΦΠΑ % for the line (e.g. 24)
      "vatAmount": number,      // VAT amount of the line
      "total": number           // net + vatAmount
    }
  ],
  "totals": {
    "net": number,              // ΚΑΘΑΡΗ ΑΞΙΑ / ΣΥΝΟΛΟ ΠΡΟ ΦΠΑ
    "discount": number,         // ΕΚΠΤΩΣΗ on the whole document, or null
    "vatAmount": number,        // ΣΥΝΟΛΟ ΦΠΑ
    "withholding": number,      // ΠΑΡΑΚΡΑΤΗΣΗ (withholding tax), or null
    "fees": number,             // ΕΠΙΒΑΡΥΝΣΕΙΣ / ΤΕΛΗ / ΧΑΡΤΟΣΗΜΟ, or null
    "total": number,            // ΓΕΝΙΚΟ ΣΥΝΟΛΟ
    "payable": number           // ΠΛΗΡΩΤΕΟ ΠΟΣΟ — what is actually owed; equals total when nothing is withheld
  },
  "vatBreakdown": [             // ΑΝΑΛΥΣΗ ΦΠΑ — one row per VAT rate printed in the totals table; [] if absent
    { "rate": number, "net": number, "vat": number }
  ],
  "digital": {
    "mark": "string or null (ΜΑΡΚ ΑΑΔΕ / Μ.ΑΡΚ. — myDATA reference)",
    "uid":  "string or null (UID ΑΑΔΕ)",
    "authCode": "string or null (Κωδικός Αυθεντικοποίησης / authentication code)",
    "provider": "string or null (e-invoicing provider name, if printed)",
    "qr": "boolean or null (true if a QR code is printed on the document)"
  },
  "payment": {
    "method": "string or null (ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ — μετρητά, κατάθεση, επιταγή…)",
    "terms":  "string or null (ΟΡΟΙ ΠΛΗΡΩΜΗΣ — π.χ. 30 ημέρες)",
    "ibans": [                  // EVERY bank account of the ISSUER printed on the document (usually the footer); [] if none
      { "bank": "string or null (ΤΡΑΠΕΖΑ)", "iban": "string (IBAN as printed)" }
    ]
  },
  "references": {
    "orderNo": "string or null (ΑΡ. ΠΑΡΑΓΓΕΛΙΑΣ)",
    "deliveryNote": "string or null (ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ)",
    "contract": "string or null (ΣΥΜΒΑΣΗ)",
    "shipment": "string or null (ΑΠΟΣΤΟΛΗ / ΣΚΟΠΟΣ ΔΙΑΚΙΝΗΣΗΣ)",
    "plates": ["string"],       // ΑΡ. ΚΥΚΛΟΦΟΡΙΑΣ of the vehicles printed on the document; [] if none
    "period": null,             // { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } for utility/service billing periods
    "quantities": [             // metered quantities printed outside the line table (π.χ. κατανάλωση kWh, m³)
      { "label": "string", "value": number, "unit": "string or null" }
    ]
  },
  "notes": "string or null (ΠΑΡΑΤΗΡΗΣΕΙΣ / free-text remarks)",
  "handwritten": {              // anything written BY HAND on the document (pen/stamp annotations)
    "glAccount": "string or null (handwritten ledger / λογαριασμός, e.g. 64.00)",
    "reference": "string or null (any other handwritten reference)",
    "allocations": [ { "label": "string", "amount": number } ]
  },
  "custom": {}                  // anything printed and meaningful that fits nowhere above; {} when there is nothing
}`,
  },
  receipt: {
    systemInstructions: 'You are a system specialized in retail B2C receipts and tax-document receipts. Always extract the issuer\'s VAT number (ΑΦΜ — 9 Greek digits) and the receipt/document number when visible. Also extract the issuer/store phone (ΤΗΛ) and email when printed. Receipts are compact; preserve totals exactly.',
    jsonStructure: `{
  "storeName": "string (Issuer name / brand)",
  "vatNumber": "string (9-digit Greek ΑΦΜ of the issuer — required if visible)",
  "invoiceNumber": "string (Receipt / document number — required if visible)",
  "date": "string (YYYY-MM-DD)",
  "time": "string (HH:MM or null)",
  "phone": "string or null (store phone / ΤΗΛ — only if printed)",
  "email": "string or null (store email — only if printed)",
  "itemsCount": number,
  "totalAmount": number
}`,
  },
  general_text: {
    systemInstructions: 'You are an advanced text digitization module. Transcribe the document text verbatim while adhering to the user\'s target language for structural metadata summaries.',
    jsonStructure: `{
  "title": "string",
  "fullText": "string (Complete transcribed content verbatim)",
  "summary": "string (3-sentence executive summary)",
  "keywords": ["string"]
}`,
  },
};

/**
 * Τα υποχρεωτικά πεδία ως ΔΙΑΔΡΟΜΕΣ του κανονικού εγγράφου (spec §17.1) — αυτά μετράει το
 * pipeline (`missingRequired`) για να αποφασίσει αν αξίζει δεύτερο πέρασμα με ακριβότερο μοντέλο.
 *
 * Ο παραλήπτης ΔΕΝ είναι υποχρεωτικός: σε παραστατικά αγοράς ο παραλήπτης είμαστε πάντα εμείς, και
 * σε απόδειξη λιανικής δεν υπάρχει καθόλου. Η απουσία του είναι σήμα ταξινόμησης (→ απόδειξη), όχι
 * πεδίο που λείπει — δεν επιτρέπεται να πυροδοτεί επανεκτέλεση.
 */
export const REQUIRED_PATHS: Record<DocType, string[]> = {
  invoice: ['issuer.name', 'issuer.vat', 'type.number', 'date', 'totals.net', 'totals.vatAmount', 'totals.total'],
  receipt: ['issuer.name', 'issuer.vat', 'type.number', 'date', 'totals.total'],
  general_text: ['custom.title', 'custom.fullText'],
};

/**
 * Τα ίδια υποχρεωτικά πεδία στα ΠΑΛΙΑ flat κλειδιά. Δεν τα διαβάζει πια το pipeline — μένουν για
 * το `qualityScore` (`lib/ocr/validate.ts`), που κρίνει τα δύο περάσματα πάνω στην προβολή
 * `toLegacy(document)` μαζί με τους ελέγχους ΑΦΜ/αριθμητικής που ζουν κι αυτοί στα flat κλειδιά.
 */
export const REQUIRED_FIELDS: Record<DocType, string[]> = {
  // The recipient/customer is intentionally NOT required: on purchase documents the
  // recipient is always us (the company running the app), and on retail receipts
  // there is no recipient at all. Absence of a customer is a classification signal
  // (→ receipt), not a missing field — so it must not trigger model auto-retries.
  invoice: [
    'companyName', 'vatNumber',
    'invoiceNumber', 'date',
    'subtotal', 'vatAmount', 'totalAmount',
  ],
  // Receipts are extracted with the invoice (superset) schema, so the issuer is
  // `companyName` (the store), not `storeName`.
  receipt: ['companyName', 'invoiceNumber', 'vatNumber', 'date', 'totalAmount'],
  general_text: ['title', 'fullText'],
};

/** Count missing required fields in an extracted payload. */
export function countMissingRequired(data: any, docType: DocType): number {
  if (!data || typeof data !== 'object') return REQUIRED_FIELDS[docType].length;
  let n = 0;
  for (const key of REQUIRED_FIELDS[docType]) {
    const v = (data as any)[key];
    const missing = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (missing) n += 1;
  }
  return n;
}

export function buildSystemPrompt(
  docType: DocType,
  lang: SupportedLang,
  example?: unknown,
  fieldHints?: unknown,
): string {
  // Always extract the full (invoice) field set for financial documents — same
  // OCR cost, and the user reduces what is shown per chosen type afterwards.
  const tpl = TEMPLATE_SCHEMAS[docType === 'receipt' ? 'invoice' : docType];
  const ln = SUPPORTED_LANGUAGES[lang];
  const lines = [
    'You are a highly resilient JSON document extraction node.',
    tpl.systemInstructions,
    ln.instruction,
    '',
    'You MUST respond EXCLUSIVELY with a raw valid JSON object matching this blueprint.',
    'Do not wrap output in markdown code fences (no ```json).',
    'Do not include conversational text, prefixes, or trailing notes.',
    '',
    'Blueprint:',
    tpl.jsonStructure,
  ];
  if (example != null) {
    lines.push(
      '',
      'Reference example — a previously VERIFIED document from this SAME issuer had',
      'the structure below. Use it ONLY to locate and disambiguate fields (e.g. which',
      'block is the issuer vs the recipient, where the ΑΦΜ sits). Do NOT copy values —',
      'μην αντιγράφεις τιμές — read the ACTUAL document in front of you:',
      JSON.stringify(example),
    );
    if (fieldHints != null) {
      lines.push('Field location hints (page/position notes):', JSON.stringify(fieldHints));
    }
  }
  return lines.join('\n');
}
