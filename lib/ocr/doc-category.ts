// lib/ocr/doc-category.ts — ΚΑΘΑΡΟ. Οι κατηγορίες παραστατικού (`OcrDocument.category`).
// Ένα σημείο για τη λίστα και για τη σελίδα του παραστατικού — η κατηγορία είναι εμπόδιο της
// καταχώρισης (`no_category`), άρα πρέπει να ορίζεται όπου κι αν φαίνεται το εμπόδιο.
export const DOC_CATEGORY_OPTIONS = [
  { value: 'EXPENSE', label: 'Δαπάνη' },
  { value: 'INVOICE_IN', label: 'Τιμολόγιο αγοράς' },
  { value: 'INVOICE_OUT', label: 'Τιμολόγιο πώλησης' },
  { value: 'RECEIPT', label: 'Απόδειξη' },
  { value: 'CREDIT_NOTE', label: 'Πιστωτικό' },
  { value: 'PAYROLL', label: 'Μισθοδοσία' },
  { value: 'TAX', label: 'Φόρος' },
  { value: 'OTHER', label: 'Άλλο' },
] as const;
