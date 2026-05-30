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
    systemInstructions: 'You are an expert system specialized in Greek corporate invoices. Greek invoices contain BOTH an issuer (ΕΚΔΟΤΗΣ — the supplier) AND a recipient (ΠΑΡΑΛΗΠΤΗΣ / Πελάτης / Στοιχεία πελάτη — the customer). Extract BOTH parties separately with their full details. Match visual rows accurately. Always extract subtotal (net amount before VAT), VAT amount, and the grand total separately — they appear as ΚΑΘΑΡΗ ΑΞΙΑ / ΣΥΝΟΛΟ ΦΠΑ / ΓΕΝΙΚΟ ΣΥΝΟΛΟ. Also extract the ISSUER\'s phone (ΤΗΛ / Τηλέφωνο) and email when printed on the document (only the issuer\'s, not the customer\'s). If a field is missing, output null.',
    jsonStructure: `{
  "companyName": "string (ΕΚΔΟΤΗΣ — Issuer / supplier legal name)",
  "vatNumber":   "string (ΑΦΜ of the issuer)",
  "companyAddress": "string or null (issuer address)",
  "companyDoy":     "string or null (issuer ΔΟΥ)",
  "companyProfession": "string or null (issuer ΕΠΑΓΓΕΛΜΑ / activity)",
  "companyPhone":   "string or null (issuer phone / ΤΗΛ — only if printed)",
  "companyEmail":   "string or null (issuer email — only if printed)",
  "customerName":   "string (ΠΑΡΑΛΗΠΤΗΣ / Πελάτης — recipient legal name)",
  "customerVatNumber": "string (ΑΦΜ of the recipient)",
  "customerAddress": "string or null (recipient address)",
  "customerDoy":     "string or null (recipient ΔΟΥ)",
  "customerProfession": "string or null (recipient ΕΠΑΓΓΕΛΜΑ / activity)",
  "invoiceNumber": "string",
  "aadeMark":      "string or null (ΜΑΡΚ ΑΑΔΕ / Μ.ΑΡΚ. — unique myDATA reference printed on the invoice)",
  "date": "string (YYYY-MM-DD)",
  "subtotal":    number,       // ΚΑΘΑΡΗ ΑΞΙΑ — sum of line nets, before VAT
  "vatAmount":   number,       // ΣΥΝΟΛΟ ΦΠΑ — total VAT charged
  "totalAmount": number,       // ΓΕΝΙΚΟ ΣΥΝΟΛΟ — grand total (subtotal + vatAmount)
  "items": [
    {
      "code": "string or null",
      "name": "string (Line item description)",
      "quantity": number,
      "price": number,
      "discount": number,
      "vatRate": number,        // ΦΠΑ % for the line (e.g. 24)
      "total": number           // line net total (before VAT)
    }
  ]
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
 * Required fields per docType — used by extract.ts to decide whether to auto-retry
 * with a stronger model. Keep aligned with TEMPLATE_SCHEMAS above.
 */
export const REQUIRED_FIELDS: Record<DocType, string[]> = {
  invoice: [
    'companyName', 'vatNumber',
    'customerName', 'customerVatNumber',
    'invoiceNumber', 'date',
    'subtotal', 'vatAmount', 'totalAmount',
  ],
  receipt: ['storeName', 'invoiceNumber', 'vatNumber', 'date', 'totalAmount'],
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
  const tpl = TEMPLATE_SCHEMAS[docType];
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
