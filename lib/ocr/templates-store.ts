// lib/ocr/templates-store.ts
import { REQUIRED_FIELDS, type DocType } from '@/lib/ocr/templates';
import { isValidAfm } from '@/lib/ocr/validate';

const AFM_FIELDS = new Set(['vatNumber', 'customerVatNumber']);

function isWeak(field: string, v: unknown): boolean {
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return true;
  if (AFM_FIELDS.has(field) && !isValidAfm(String(v))) return true;
  return false;
}

/** Take from pass2 only the required fields that were missing/invalid in pass1. */
export function mergeFromTemplatePass<T extends Record<string, any>>(
  pass1: T, pass2: Record<string, any>, docType: DocType,
): T {
  const out: Record<string, any> = { ...pass1 };
  for (const key of REQUIRED_FIELDS[docType]) {
    if (isWeak(key, out[key]) && !isWeak(key, pass2?.[key])) out[key] = pass2[key];
  }
  if (docType === 'invoice' && (!Array.isArray(out.items) || out.items.length === 0)
      && Array.isArray(pass2?.items) && pass2.items.length) {
    out.items = pass2.items;
  }
  return out as T;
}

const docTypeToEnum: Record<DocType, 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT'> = {
  invoice: 'INVOICE', receipt: 'RECEIPT', general_text: 'GENERAL_TEXT',
};

export async function findSupplierTemplate(vatNumber: string, docType: DocType) {
  const { prisma } = await import('@/lib/db');
  const afm = String(vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm) || docType === 'general_text') return null;
  return prisma.supplierTemplate.findUnique({
    where: { vatNumber_docType: { vatNumber: afm, docType: docTypeToEnum[docType] } },
  });
}

export async function upsertSupplierTemplate(args: {
  vatNumber: string; docType: DocType; supplierName?: string | null;
  example: unknown; fieldHints?: unknown; sampleDocId?: string | null;
  thumbUrl?: string | null; createdById?: string | null;
}) {
  const { prisma } = await import('@/lib/db');
  const afm = String(args.vatNumber ?? '').replace(/\D+/g, '');
  const enumType = docTypeToEnum[args.docType];
  return prisma.supplierTemplate.upsert({
    where: { vatNumber_docType: { vatNumber: afm, docType: enumType } },
    create: {
      vatNumber: afm, docType: enumType, supplierName: args.supplierName ?? null,
      example: args.example as any, fieldHints: (args.fieldHints ?? null) as any,
      sampleDocId: args.sampleDocId ?? null, thumbUrl: args.thumbUrl ?? null,
      createdById: args.createdById ?? null,
    },
    update: {
      supplierName: args.supplierName ?? null, example: args.example as any,
      fieldHints: (args.fieldHints ?? null) as any, sampleDocId: args.sampleDocId ?? null,
      thumbUrl: args.thumbUrl ?? null,
    },
  });
}
