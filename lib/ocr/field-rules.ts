import type { DocType } from '@/lib/ocr/templates';

export type FieldRuleLite = {
  key: string;
  label: string;
  description?: string | null;
  regionHint?: unknown;
};

const GREEK_MAP: Record<string, string> = {
  α:'a',ά:'a',β:'v',γ:'g',δ:'d',ε:'e',έ:'e',ζ:'z',η:'i',ή:'i',θ:'th',ι:'i',ί:'i',ϊ:'i',ΐ:'i',
  κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',ό:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',ύ:'y',ϋ:'y',ΰ:'y',
  φ:'f',χ:'ch',ψ:'ps',ω:'o',ώ:'o',
};

/** Stable, readable machine key for a custom field label. */
export function slugifyFieldKey(label: string): string {
  const lower = String(label ?? '').trim().toLowerCase();
  let out = '';
  for (const ch of lower) out += GREEK_MAP[ch] ?? ch;
  out = out.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!out) {
    let h = 5381;
    for (let i = 0; i < lower.length; i++) h = ((h << 5) + h + lower.charCodeAt(i)) >>> 0;
    out = `field_${h.toString(36)}`;
  }
  return out.slice(0, 60);
}

/** Focused system prompt for the targeted custom-fields pass. */
export function buildCustomFieldsPrompt(rules: FieldRuleLite[]): string {
  const fields = rules.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description ?? null,
  }));
  return [
    'You are a precise field extractor for a Greek financial document.',
    'Extract ONLY the fields listed below. Respond with a single raw JSON object',
    'mapping each field KEY to the value found on the document, or null if absent.',
    'Do not wrap in markdown fences. Do not add extra keys or commentary.',
    '',
    'Fields:',
    JSON.stringify(fields, null, 2),
    '',
    'Output shape:',
    `{ ${rules.map((r) => `"${r.key}": "value or null"`).join(', ')} }`,
  ].join('\n');
}

/** Merge a parsed targeted-pass result into data.customFields (in place). */
export function mergeCustomFields<T extends Record<string, any>>(
  data: T, parsed: Record<string, unknown> | null | undefined, rules: { key: string }[],
): T {
  const cf: Record<string, unknown> = { ...((data as any).customFields ?? {}) };
  for (const r of rules) {
    const v = parsed?.[r.key];
    cf[r.key] = v == null || v === '' ? null : v;
  }
  (data as any).customFields = cf;
  return data;
}

const docTypeToEnum: Record<DocType, 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT'> = {
  invoice: 'INVOICE', receipt: 'RECEIPT', general_text: 'GENERAL_TEXT',
};

/** Active custom-field rules for a normalized ΑΦΜ + docType. Empty for general_text. */
export async function findActiveFieldRules(vatNumber: string, docType: DocType) {
  const afm = String(vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm) || docType === 'general_text') return [];
  const { prisma } = await import('@/lib/db');
  return prisma.supplierFieldRule.findMany({
    where: { vatNumber: afm, docType: docTypeToEnum[docType], isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Upsert a rule by (ΑΦΜ, docType, key). Used by the create route. */
export async function upsertFieldRule(args: {
  vatNumber: string; docType: DocType; key: string; label: string;
  description?: string | null; regionHint?: unknown; supplierName?: string | null;
  createdById?: string | null;
}) {
  const { prisma } = await import('@/lib/db');
  const afm = String(args.vatNumber ?? '').replace(/\D+/g, '');
  const enumType = docTypeToEnum[args.docType];
  return prisma.supplierFieldRule.upsert({
    where: { vatNumber_docType_key: { vatNumber: afm, docType: enumType, key: args.key } },
    create: {
      vatNumber: afm, docType: enumType, key: args.key, label: args.label,
      description: args.description ?? null, regionHint: (args.regionHint ?? null) as any,
      supplierName: args.supplierName ?? null, createdById: args.createdById ?? null,
    },
    update: {
      label: args.label, description: args.description ?? null,
      regionHint: (args.regionHint ?? null) as any, supplierName: args.supplierName ?? null,
      isActive: true,
    },
  });
}
