import type { DocType } from '@/lib/ocr/templates';

export type FieldRuleLite = {
  key: string;
  label: string;
  description?: string | null;
  regionHint?: unknown;
  scope?: 'document' | 'line';
  valueType?: 'text' | 'list';
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

/** Coerce a raw model value to the rule's declared value type. */
export function coerceFieldValue(raw: unknown, valueType: 'text' | 'list'): string | string[] | null {
  if (valueType === 'list') {
    let arr: string[];
    if (Array.isArray(raw)) arr = raw.map((x) => String(x ?? '').trim());
    else if (raw == null || raw === '') arr = [];
    else arr = String(raw).split(/[,;\n]+/).map((s) => s.trim());
    arr = arr.filter(Boolean);
    return arr.length ? arr : null;
  }
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

/** Human hint for a normalized region marked on the document (top-left origin). */
function regionHintText(regionHint: unknown): string | null {
  const rh = regionHint as { page?: number; bbox?: [number, number, number, number] } | null;
  if (!rh || !Array.isArray(rh.bbox) || rh.bbox.length !== 4) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const [x, y, w, h] = rh.bbox;
  return `located around the page region starting at left ${pct(x)}, top ${pct(y)}, width ${pct(w)}, height ${pct(h)} (top-left origin)${rh.page ? `, page ${rh.page + 1}` : ''}`;
}

/** Focused system prompt for the targeted custom-fields pass. */
export function buildCustomFieldsPrompt(rules: FieldRuleLite[]): string {
  const fields = rules.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description ?? null,
    location: regionHintText(r.regionHint),
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

/** Focused prompt for the per-line targeted pass (lines enumerated by index). */
export function buildLineFieldsPrompt(
  rules: FieldRuleLite[],
  lines: { index: number; code: string | null; name: string }[],
): string {
  const fields = rules.map((r) => ({
    key: r.key, label: r.label, description: r.description ?? null, type: r.valueType ?? 'text',
  }));
  const shape = `{ "lines": [ { "index": 0${rules
    .map((r) => `, "${r.key}": ${r.valueType === 'list' ? '["…"]' : '"…"'}`)
    .join('')} } ] }`;
  return [
    'You are a precise per-line field extractor for a Greek invoice.',
    'For EACH line listed below, extract the requested fields from the document.',
    'Fields with type "list" (e.g. serial numbers) MUST be a JSON array of strings; "text" a string. Use null when a line has no value.',
    '',
    'Requested fields:',
    JSON.stringify(fields, null, 2),
    '',
    'The document lines (match strictly by index):',
    JSON.stringify(lines, null, 2),
    '',
    'Respond with raw JSON of EXACTLY this shape (no markdown fences):',
    shape,
  ].join('\n');
}

/** Merge a parsed targeted-pass result into customFields — returns a shallow copy, does NOT mutate input. */
export function mergeCustomFields<T extends Record<string, any>>(
  data: T, parsed: Record<string, unknown> | null | undefined,
  rules: { key: string; valueType?: 'text' | 'list' }[],
): T {
  const cf: Record<string, unknown> = { ...((data as any).customFields ?? {}) };
  for (const r of rules) {
    cf[r.key] = coerceFieldValue(parsed?.[r.key], r.valueType ?? 'text');
  }
  return { ...data, customFields: cf } as T;
}

/** Merge per-line parsed values into data.items[i].customFields (pure, index-aligned). */
export function mergeLineCustomFields<T extends Record<string, any>>(
  data: T,
  parsedLines: Array<Record<string, unknown>> | null | undefined,
  rules: { key: string; valueType?: 'text' | 'list' }[],
): T {
  const items = (data as any).items;
  if (!Array.isArray(items) || !Array.isArray(parsedLines)) return data;
  const next = items.map((it: any) => ({ ...it }));
  for (const entry of parsedLines) {
    const idx = Number((entry as any)?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= next.length) continue;
    const cf: Record<string, unknown> = { ...(next[idx].customFields ?? {}) };
    for (const r of rules) cf[r.key] = coerceFieldValue((entry as any)[r.key], r.valueType ?? 'text');
    next[idx] = { ...next[idx], customFields: cf };
  }
  return { ...data, items: next } as T;
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
  createdById?: string | null; scope?: 'document' | 'line'; valueType?: 'text' | 'list';
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
      scope: args.scope ?? 'document', valueType: args.valueType ?? 'text',
    },
    update: {
      label: args.label, description: args.description ?? null,
      regionHint: (args.regionHint ?? null) as any, supplierName: args.supplierName ?? null,
      isActive: true,
    },
  });
}
