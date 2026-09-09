// lib/ocr/field-rules-db.ts — SERVER ONLY. Prisma-backed reads/writes for SupplierFieldRule.
// Split out of field-rules.ts so that module (isomorphic — imported by lib/templates/schema.ts,
// which is in turn imported by client components) never pulls in `@/lib/db` (pg → node:dns),
// which broke client bundling (Turbopack "Module not found: Can't resolve 'dns'").
import { prisma } from '@/lib/db';
import type { DocType } from '@/lib/ocr/templates';

const docTypeToEnum: Record<DocType, 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT'> = {
  invoice: 'INVOICE', receipt: 'RECEIPT', general_text: 'GENERAL_TEXT',
};

/** Active custom-field rules for a normalized ΑΦΜ + docType. Empty for general_text. */
export async function findActiveFieldRules(vatNumber: string, docType: DocType) {
  const afm = String(vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm) || docType === 'general_text') return [];
  return prisma.supplierFieldRule.findMany({
    where: { vatNumber: afm, docType: docTypeToEnum[docType], isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Upsert a rule by (ΑΦΜ, docType, key). Used by the create route. */
export async function upsertFieldRule(args: {
  vatNumber: string; docType: DocType; key: string; label: string;
  description?: string | null; regionHint?: unknown; supplierName?: string | null;
  createdById?: string | null; scope?: 'document' | 'line'; valueType?: 'text' | 'list';
}) {
  const afm = String(args.vatNumber ?? '').replace(/\D+/g, '');
  const enumType = docTypeToEnum[args.docType];
  return prisma.supplierFieldRule.upsert({
    where: { vatNumber_docType_key: { vatNumber: afm, docType: enumType, key: args.key } },
    create: {
      vatNumber: afm, docType: enumType, key: args.key, label: args.label,
      description: args.description ?? null, regionHint: (args.regionHint ?? null) as any,
      supplierName: args.supplierName ?? null, createdById: args.createdById ?? null,
      scope: args.scope ?? 'document', valueType: args.valueType ?? 'text',
    },
    update: {
      label: args.label, description: args.description ?? null,
      regionHint: (args.regionHint ?? null) as any, supplierName: args.supplierName ?? null,
      isActive: true,
    },
  });
}
