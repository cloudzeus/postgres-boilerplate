export interface NamedCatalogInput { name?: unknown; order?: unknown; active?: unknown }
export interface NormalizedNamedCatalog { name: string; order: number; active: boolean }
export type NamedCatalogResult =
  | { ok: true; value: NormalizedNamedCatalog }
  | { ok: false; error: string };

export function normalizeNamedCatalogInput(input: NamedCatalogInput): NamedCatalogResult {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  const order = Number.isFinite(Number(input.order)) ? Math.trunc(Number(input.order)) : 0;
  const active = typeof input.active === 'boolean' ? input.active : true;
  return { ok: true, value: { name, order, active } };
}
