// Model fallback for upstream overload. Gemini returns 503 UNAVAILABLE
// ("this model is currently experiencing high demand") on per-model capacity
// spikes. Retrying the SAME model (see fetch-retry.ts) does not help when the
// overload is sustained — a *different* model has a separate capacity pool, so
// we try the configured model first and fall back through alternatives.

/** Primary model first, then fallbacks; trimmed and de-duplicated. */
export function buildModelChain(primary: string, fallbacks: string[]): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const m of [primary, ...fallbacks]) {
    const t = (m ?? '').trim();
    if (t && !seen.has(t)) { seen.add(t); chain.push(t); }
  }
  return chain;
}

export type AttemptResult<T> = { ok: true; value: T } | { ok: false; error: Error };

/**
 * Try each model in order until one succeeds. On total failure, throw the FIRST
 * model's error — that is the meaningful one (e.g. the primary model's "high
 * demand"), not a misleading "model not found" from a misconfigured fallback.
 */
export async function tryModels<T>(
  models: string[],
  attempt: (model: string) => Promise<AttemptResult<T>>,
): Promise<T> {
  let firstError: Error | null = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const r = await attempt(model);
    if (r.ok) {
      if (i > 0) console.warn(`[ocr-model-fallback] recovered with fallback model "${model}" (primary "${models[0]}" was unavailable)`);
      return r.value;
    }
    if (!firstError) firstError = r.error;
    if (i < models.length - 1) {
      console.warn(`[ocr-model-fallback] model "${model}" failed (${r.error.message.slice(0, 100)}); trying "${models[i + 1]}"`);
    }
  }
  throw firstError ?? new Error('No models attempted');
}
