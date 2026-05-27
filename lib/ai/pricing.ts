// AI provider pricing — USD per 1M tokens (input / output).
// Keep this list updated; we only use it for INTERNAL cost dashboards.
// Sources: official provider pricing pages (Jan 2026).

export interface PricingEntry {
  inputPerMTokens: number;   // $ per 1,000,000 input tokens
  outputPerMTokens: number;  // $ per 1,000,000 output tokens
}

// Match by *exact* model id first; falls back to a best-effort prefix below.
const PRICING: Record<string, PricingEntry> = {
  // DeepSeek (official API)
  'deepseek-chat':       { inputPerMTokens: 0.27, outputPerMTokens: 1.10 },
  'deepseek-reasoner':   { inputPerMTokens: 0.55, outputPerMTokens: 2.19 },

  // Google Gemini (AI Studio)
  'gemini-2.5-flash':         { inputPerMTokens: 0.30, outputPerMTokens: 2.50 },
  'gemini-2.5-flash-lite':    { inputPerMTokens: 0.10, outputPerMTokens: 0.40 },
  'gemini-2.5-pro':           { inputPerMTokens: 1.25, outputPerMTokens: 10.00 },
  'gemini-2.0-flash':         { inputPerMTokens: 0.10, outputPerMTokens: 0.40 },
  'gemini-2.0-flash-lite':    { inputPerMTokens: 0.075, outputPerMTokens: 0.30 },
  'gemini-1.5-flash':         { inputPerMTokens: 0.075, outputPerMTokens: 0.30 },
  'gemini-1.5-pro':           { inputPerMTokens: 1.25, outputPerMTokens: 5.00 },
  'gemini-3-flash-preview':   { inputPerMTokens: 0.40, outputPerMTokens: 3.00 },
  'gemini-3-pro-preview':     { inputPerMTokens: 1.50, outputPerMTokens: 12.00 },
  'gemini-3.5-flash':         { inputPerMTokens: 0.45, outputPerMTokens: 3.50 },

  // OpenAI (reference)
  'gpt-4o-mini':  { inputPerMTokens: 0.15, outputPerMTokens: 0.60 },
  'gpt-4o':       { inputPerMTokens: 2.50, outputPerMTokens: 10.00 },

  // DeepInfra (Qwen/Llama VL — cheap)
  'Qwen/Qwen2.5-VL-7B-Instruct':                 { inputPerMTokens: 0.04, outputPerMTokens: 0.10 },
  'meta-llama/Llama-3.2-11B-Vision-Instruct':    { inputPerMTokens: 0.05, outputPerMTokens: 0.05 },
  'deepseek-ai/deepseek-vl2':                    { inputPerMTokens: 0.50, outputPerMTokens: 0.50 },
};

const PREFIX_FALLBACKS: Array<[string, PricingEntry]> = [
  ['gemini-2.5-flash', PRICING['gemini-2.5-flash']],
  ['gemini-2.5-pro',   PRICING['gemini-2.5-pro']],
  ['gemini-1.5-flash', PRICING['gemini-1.5-flash']],
  ['gemini-3',         PRICING['gemini-3-pro-preview']],
  ['gpt-4o',           PRICING['gpt-4o']],
  ['deepseek',         PRICING['deepseek-chat']],
];

export function getPricing(model: string): PricingEntry | null {
  if (!model) return null;
  if (PRICING[model]) return PRICING[model];
  for (const [prefix, entry] of PREFIX_FALLBACKS) {
    if (model.includes(prefix)) return entry;
  }
  return null;
}

export interface UsageCost {
  inputCost: number;   // USD
  outputCost: number;  // USD
  totalCost: number;   // USD
  matched: boolean;    // false if we had to fall back to $0 (unknown model)
}

/**
 * Compute USD cost for a single call. If only `totalTokens` is known we
 * approximate as 70% input / 30% output — typical for structured extraction.
 */
export function computeCost(
  model: string,
  tokens: { input?: number; output?: number; total?: number },
): UsageCost {
  const p = getPricing(model);
  if (!p) return { inputCost: 0, outputCost: 0, totalCost: 0, matched: false };

  let inputTokens = tokens.input ?? 0;
  let outputTokens = tokens.output ?? 0;
  if (!inputTokens && !outputTokens && tokens.total) {
    inputTokens = Math.round(tokens.total * 0.7);
    outputTokens = tokens.total - inputTokens;
  }
  const inputCost = (inputTokens / 1_000_000) * p.inputPerMTokens;
  const outputCost = (outputTokens / 1_000_000) * p.outputPerMTokens;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    matched: true,
  };
}
