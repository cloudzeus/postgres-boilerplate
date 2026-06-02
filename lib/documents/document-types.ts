// lib/documents/document-types.ts

export interface DocumentTypeInput {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  categoryId?: unknown;
  requiresExpiry?: unknown;
  notifyExpiry?: unknown;
  active?: unknown;
  order?: unknown;
}

export interface NormalizedDocumentType {
  name: string;
  description: string | null;
  category: string | null;
  categoryId: string | null;
  requiresExpiry: boolean;
  notifyExpiry: boolean;
  active: boolean;
  order: number;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedDocumentType }
  | { ok: false; error: string };

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function normalizeDocumentTypeInput(input: DocumentTypeInput): NormalizeResult {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  const order = Number.isFinite(Number(input.order)) ? Math.trunc(Number(input.order)) : 0;
  return {
    ok: true,
    value: {
      name,
      description: strOrNull(input.description),
      category: strOrNull(input.category),
      categoryId: typeof input.categoryId === 'string' && input.categoryId.trim() ? input.categoryId.trim() : null,
      requiresExpiry: boolOr(input.requiresExpiry, true),
      notifyExpiry: boolOr(input.notifyExpiry, true),
      active: boolOr(input.active, true),
      order,
    },
  };
}
