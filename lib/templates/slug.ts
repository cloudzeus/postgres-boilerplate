// lib/templates/slug.ts — ISOMORPHIC. Stable machine keys from human labels (Greek → Latin,
// snake_case). Moved verbatim out of the retired legacy supplier-rules module; `schema.ts` (imported by
// client components) depends on it, so this module must stay free of `@/lib/db` and `server-only`.

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
