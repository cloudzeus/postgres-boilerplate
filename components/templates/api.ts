// components/templates/api.ts — CLIENT. Typed fetch helpers for the template endpoints + Greek error text.
import type { TemplateDto } from '@/lib/templates/serialize';
import type { FieldDef, Region } from '@/lib/templates/schema';

export type Cleanup = { mappings: { name: string; removedRows: number }[]; conditions: { id: string; name: string; removedClauses: number; removedActions: number }[] };
export type TestFieldResult = { raw: string | null; value: unknown; source: string; model: string | null; tokensUsed: number; color: string; durationMs: number };

const ERROR_TEXT: Record<string, string> = {
  invalid_body: 'Μη έγκυρα δεδομένα.',
  duplicate: 'Υπάρχει ήδη πρότυπο με αυτό το όνομα για τον προμηθευτή.',
  not_found: 'Δεν βρέθηκε.',
  not_ready: 'Για ενεργοποίηση χρειάζονται δείγμα, ένα πεδίο με περιοχή και ένα mapping.',
  forbidden: 'Δεν έχεις δικαίωμα για αυτή την ενέργεια.',
  has_history: 'Το πρότυπο έχει ιστορικό εκτελέσεων. Απενεργοποίησέ το αντί να το διαγράψεις.',
  unknown_field: 'Άγνωστο πεδίο.',
  multiple_tables: 'Το mapping χαρτογραφεί γραμμές από δύο πίνακες. Επίλεξε έναν.',
  table_to_header: 'Πεδίο πίνακα μπορεί να χαρτογραφηθεί μόνο σε στήλες γραμμών.',
  single_to_line: 'Απλό πεδίο δεν μπορεί να χαρτογραφηθεί σε στήλη γραμμών.',
  unknown_mapping: 'Άγνωστο mapping στον κανόνα.',
  foreign_condition: 'Μη έγκυρο αναγνωριστικό κανόνα.',
  no_sample: 'Ανέβασε πρώτα δείγμα.',
  no_region: 'Το πεδίο δεν έχει περιοχή.',
  read_failed: 'Η ανάγνωση απέτυχε.',
  unsupported_type: 'Μη υποστηριζόμενος τύπος αρχείου (PDF, PNG, JPEG, WebP).',
  too_large: 'Το αρχείο ξεπερνά τα 25 MB.',
  file_required: 'Επίλεξε αρχείο.',
};

export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string, public issues?: unknown) { super(message); }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: { error?: string; message?: string; issues?: unknown } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  const code = body.error ?? `http_${res.status}`;
  throw new ApiError(code, res.status, body.message ?? ERROR_TEXT[code] ?? `Σφάλμα (${res.status})`, body.issues);
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const base = (id: string) => `/api/admin/ocr/templates/${id}`;

export const templatesApi = {
  create: (b: { name: string; vatNumber: string; traderTrdr?: number | null; supplierName?: string | null; docType: 'INVOICE' | 'RECEIPT' }) =>
    fetch('/api/admin/ocr/templates', json(b)).then((r) => handle<{ ok: true; id: string }>(r)),
  get: (id: string) => fetch(base(id), { cache: 'no-store' }).then((r) => handle<TemplateDto>(r)),
  patch: (id: string, b: Partial<{ name: string; mode: TemplateDto['mode']; status: TemplateDto['status']; notifyEmails: string | null; traderTrdr: number | null; supplierName: string | null }>) =>
    fetch(base(id), json(b, 'PATCH')).then((r) => handle<TemplateDto>(r)),
  remove: (id: string) => fetch(base(id), { method: 'DELETE' }).then((r) => handle<{ ok: true }>(r)),
  uploadSample: (id: string, file: File) => { const fd = new FormData(); fd.append('file', file); return fetch(`${base(id)}/sample`, { method: 'POST', body: fd }).then((r) => handle<{ ok: true; mimeType: string; pageCount: number }>(r)); },
  putFields: (id: string, fields: FieldDef[]) => fetch(`${base(id)}/fields`, json({ fields }, 'PUT')).then((r) => handle<TemplateDto & { cleanup?: Cleanup }>(r)),
  putMappings: (id: string, mappings: TemplateDto['mappings']) => fetch(`${base(id)}/mappings`, json({ mappings }, 'PUT')).then((r) => handle<TemplateDto>(r)),
  putConditions: (id: string, conditions: TemplateDto['conditions']) => fetch(`${base(id)}/conditions`, json({ conditions }, 'PUT')).then((r) => handle<TemplateDto>(r)),
  testField: (id: string, fieldKey: string, region?: Region) => fetch(`${base(id)}/test-field`, json({ fieldKey, region })).then((r) => handle<TestFieldResult>(r)),
  searchSuppliers: (q: string) => fetch(`/api/admin/softone/search?type=suppliers&q=${encodeURIComponent(q)}`).then((r) => handle<{ results: { id: number; code: string; name: string; sub: string }[] }>(r)),
  pageImageUrl: (id: string, page: number, version: number, scale = 3) => `${base(id)}/page-image?page=${page}&scale=${scale}&v=${version}`,
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Απρόσμενο σφάλμα.';
}
