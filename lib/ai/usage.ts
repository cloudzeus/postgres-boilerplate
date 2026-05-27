import { prisma } from '@/lib/db';
import { computeCost } from '@/lib/ai/pricing';

export type AiScope = 'OCR_TEXT' | 'OCR_VISION' | 'OCR_VISION_RETRY' | 'TRANSLATION' | 'OTHER';

interface LogInput {
  scope: AiScope;
  provider: string;
  model: string;
  operation?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number | null;
  userId?: string | null;
  refType?: string | null;
  refId?: string | null;
}

/**
 * Fire-and-forget logger for AI provider calls. Never throws — failures get
 * swallowed so usage logging cannot break the user-facing request.
 */
export async function logAiUsage(input: LogInput): Promise<void> {
  try {
    const totalTokens = input.totalTokens
      ?? ((input.inputTokens ?? 0) + (input.outputTokens ?? 0));

    const cost = computeCost(input.model, {
      input: input.inputTokens,
      output: input.outputTokens,
      total: input.totalTokens,
    });

    await prisma.aiUsage.create({
      data: {
        scope: input.scope,
        provider: input.provider,
        model: input.model,
        operation: input.operation ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        totalTokens,
        inputCost: cost.matched ? cost.inputCost : null,
        outputCost: cost.matched ? cost.outputCost : null,
        totalCost: cost.matched ? cost.totalCost : null,
        durationMs: input.durationMs ?? null,
        userId: input.userId ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
      },
    });
  } catch (err) {
    console.error('logAiUsage failed', err);
  }
}

/** Infer provider id from a URL (best-effort). */
export function providerFromUrl(url: string): string {
  if (url.includes('generativelanguage.googleapis')) return 'gemini';
  if (url.includes('deepinfra')) return 'deepinfra';
  if (url.includes('openai')) return 'openai';
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('openrouter')) return 'openrouter';
  if (url.includes('mistral')) return 'mistral';
  return 'unknown';
}
