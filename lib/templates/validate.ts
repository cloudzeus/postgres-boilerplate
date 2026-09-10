// lib/templates/validate.ts — ISOMORPHIC zod schemas for the bulk endpoints (and plan-2 forms).
import { z } from 'zod';
import { invoiceKeyInfo, isValidBbox, slugKey } from './schema';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Χρώμα hex');
const norm = z.number().min(0).max(1);
const Bbox = z.tuple([norm, norm, norm, norm]).refine(isValidBbox, 'Μη έγκυρη περιοχή');
// `page` is 0-based. The cap is a sanity bound only — the real limit is the document's own page
// count, which nothing here can see; a region past it is refused at read time (`bad_page`).
export const RegionSchema = z.object({ page: z.number().int().min(0).max(999, 'Μη έγκυρη σελίδα'), bbox: Bbox });
const ValueType = z.enum(['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'LIST']);
export const ColumnSchema = z.object({ key: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, 'Κλειδί στήλης: μόνο a-z, 0-9, _'), label: z.string().trim().min(1).max(120), valueType: ValueType.default('TEXT') });

export const FieldSchema = z.object({
  key: z.string().trim().min(1).max(60).optional(),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(['SINGLE', 'TABLE']).default('SINGLE'),
  valueType: ValueType.default('TEXT'),
  color: hex,
  region: RegionSchema.nullable().optional(),
  columns: z.array(ColumnSchema).max(30).nullable().optional(),
  aiHint: z.string().trim().max(1000).nullable().optional(),
  required: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
}).transform((f) => ({ ...f, key: f.key ?? slugKey(f.label), region: f.region ?? null, columns: f.columns ?? null, aiHint: f.aiHint ?? null }))
  // A TABLE with no columns has nothing for readCropTable to ask for and nothing
  // for a mapping to point at — it can only ever extract empty rows.
  .refine((f) => f.kind !== 'TABLE' || (f.columns?.length ?? 0) > 0, { message: 'Ο πίνακας χρειάζεται τουλάχιστον μία στήλη', path: ['columns'] });

export const FieldsBody = z.object({ fields: z.array(FieldSchema).max(100) })
  .refine((b) => new Set(b.fields.map((f) => f.key)).size === b.fields.length, { message: 'Διπλό κλειδί πεδίου', path: ['fields'] })
  // Colour is how the overlay tells one region from another, so two fields sharing
  // one makes the annotated sample unreadable. Compare case-insensitively — the
  // route uppercases on write, but the payload can arrive either way.
  .refine((b) => new Set(b.fields.map((f) => f.color.toUpperCase())).size === b.fields.length, { message: 'Διπλό χρώμα πεδίου', path: ['fields'] });

const InvoiceRow = z.object({ fieldKey: z.string().min(1), invoiceKey: z.string().min(1).refine((k) => invoiceKeyInfo(k) != null, 'Άγνωστο πεδίο παραστατικού') });
const ExcelRow = z.object({ fieldKey: z.string().min(1), column: z.string().trim().min(1).max(80), order: z.number().int().min(0) });
export const MappingSchema = z.discriminatedUnion('target', [
  z.object({ name: z.string().trim().min(1).max(60), target: z.literal('INVOICE'), isDefault: z.boolean().default(false), rows: z.array(InvoiceRow).max(200) }),
  z.object({ name: z.string().trim().min(1).max(60), target: z.literal('EXCEL'), isDefault: z.boolean().default(false), rows: z.array(ExcelRow).max(200) }),
]);
export const MappingsBody = z.object({ mappings: z.array(MappingSchema).max(20) })
  .refine((b) => new Set(b.mappings.map((m) => m.name)).size === b.mappings.length, { message: 'Διπλό όνομα mapping', path: ['mappings'] });

const Clause = z.object({ fieldKey: z.string().min(1), op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'empty', 'notEmpty', 'regex', 'in']), value: z.string().max(500).optional() });
const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SET_FIELD'), params: z.object({ fieldKey: z.string().optional(), invoiceKey: z.string().optional(), value: z.string().max(500) }).refine((p) => !!(p.fieldKey || p.invoiceKey), 'Χρειάζεται πεδίο') }),
  z.object({ type: z.literal('FLAG_REVIEW'), params: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  z.object({ type: z.literal('BLOCK_POSTING'), params: z.object({ reason: z.string().trim().min(1).max(200) }) }),
  z.object({ type: z.literal('SWITCH_MAPPING'), params: z.object({ mappingName: z.string().trim().min(1).max(60) }) }),
  z.object({ type: z.literal('NOTIFY'), params: z.object({ emails: z.string().trim().max(500).optional(), subject: z.string().trim().min(1).max(200) }) }),
]);
export const ConditionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  order: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  logic: z.enum(['AND', 'OR']).default('AND'),
  clauses: z.array(Clause).max(20),
  actions: z.array(ActionSchema).max(10),
});
export const ConditionsBody = z.object({ conditions: z.array(ConditionSchema).max(50) });
